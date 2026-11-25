#!/usr/bin/env node
/* 紙匣的自動化測試：不需要安裝任何套件。
   在專案資料夾執行：
     node tests/run.mjs             跑全部
     node tests/run.mjs 合併 拆分    只跑名稱含有這些字的測試
     node tests/run.mjs --headed    開著視窗跑，看得到過程
     node tests/run.mjs --skip-slow 略過文字辨識之類很慢的測試
     node tests/run.mjs --file      改成直接開啟 index.html（file://），也就是使用者雙擊開啟的情況
     node tests/run.mjs --bundle    測試單一檔案版 dist/紙匣.html（先執行 python tools/build.py；函式庫從 CDN 載入，需要網路）
   需要 Node 22 以上（內建 WebSocket）和 Chrome 或 Edge；找不到瀏覽器時，用環境變數 CHROME 指定執行檔路徑。
   只能在 http 下運作的測試（離線快取、文字辨識）標成 http: true，在 --file、--bundle 時略過。

   How it works: tools/serve.mjs serves the project folder, a headless Chrome or Edge is driven over the
   DevTools protocol, and each test runs in a fresh browser profile (its own storage and service worker). A test is a
   function in tests/cases.mjs that runs inside the page, where every name from js/ is in scope, together with the
   helpers in tests/helpers.js (window.T). A test fails when it throws, times out, logs an error to the console, throws
   an uncaught exception, or shows an error toast it did not expect. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import cases from './cases.mjs';
import { ROOT, serve } from '../tools/serve.mjs';

const args = process.argv.slice(2);
const headed = args.includes('--headed'), skipSlow = args.includes('--skip-slow');
const mode = args.includes('--bundle') ? 'bundle' : args.includes('--file') ? 'file' : 'http';
const filters = args.filter(a => !a.startsWith('--')).map(s => s.toLowerCase());
if (typeof WebSocket === 'undefined') { console.error('需要 Node 22 以上（內建 WebSocket）。'); process.exit(2); }

/* ---------- browser ---------- */
function findBrowser() {
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files', pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const list = [process.env.CHROME,
    `${pf}\\Google\\Chrome\\Application\\chrome.exe`, `${pf86}\\Google\\Chrome\\Application\\chrome.exe`, `${local}\\Google\\Chrome\\Application\\chrome.exe`,
    `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`, `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  return list.find(p => p && fs.existsSync(p));
}
function launch(exe) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'papertray-test-'));
  const flags = [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--window-size=1280,900'];
  if (!headed) flags.push('--headless=new');
  const proc = spawn(exe, [...flags, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('瀏覽器沒有回應')), 30000);
    proc.stderr.on('data', d => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve({ proc, profile, ws: m[1] }); }
    });
    proc.on('exit', code => { clearTimeout(timer); reject(new Error(`瀏覽器結束了（${code}）：${buf.slice(-400)}`)); });
  });
}

/* ---------- DevTools protocol ---------- */
class CDP {
  constructor(url) {
    this.ws = new WebSocket(url); this.seq = 0; this.wait = new Map(); this.listeners = new Set();
    this.ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id) { const w = this.wait.get(m.id); this.wait.delete(m.id); if (w) m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result); }
      else for (const fn of this.listeners) fn(m);
    };
    this.ready = new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = () => reject(new Error('無法連到瀏覽器')); });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.wait.set(id, { resolve, reject }));
  }
}

const HELPERS = fs.readFileSync(path.join(ROOT, 'tests', 'helpers.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const withTimeout = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error(`逾時（${ms / 1000} 秒）：${what}`); })]);

async function runCase(cdp, base, tc) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => cdp.send(method, params, sessionId);
  const problems = [];
  const origin = base.startsWith('file:') ? 'file:' : new URL(base).origin;
  const listener = m => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails; problems.push('未處理的例外：' + ((d.exception && d.exception.description) || d.text));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      problems.push('console.error：' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      // Only our own files (Google Fonts may be unreachable), and not Tesseract's harmless "Parameter not found".
      const e = m.params.entry;
      if ((!e.url || e.url.startsWith(origin)) && !/Parameter not found/.test(e.text)) problems.push(`${e.source}：${e.text} ${e.url || ''}`);
    }
  };
  cdp.listeners.add(listener);
  try {
    await Promise.all([s('Runtime.enable'), s('Log.enable'), s('Page.enable')]);
    if (tc.viewport) await s('Emulation.setDeviceMetricsOverride', { mobile: true, deviceScaleFactor: 2, ...tc.viewport });
    // Requests to Google Fonts are held and never answered, as on a network that drops them: 'all', or only the font
    // files ('files'; the stylesheet still arrives).
    if (tc.stallFonts) {
      const hosts = tc.stallFonts === 'files' ? ['fonts.gstatic.com'] : ['fonts.googleapis.com', 'fonts.gstatic.com'];
      await s('Fetch.enable', { patterns: hosts.map(h => ({ urlPattern: `*://${h}/*` })) });
    }
    await s('Page.navigate', { url: base + (tc.hash ? '#' + tc.hash : '') });
    const evaluate = async (expression, ms) => {
      const r = await withTimeout(s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }), ms, tc.name);
      if (r.exceptionDetails) {
        const d = r.exceptionDetails; throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text);
      }
      return r.result.value;
    };
    // The page is ready once app.js (loaded last) has run. Not the load event: that also waits for the web fonts.
    for (let i = 0; ; i++) {
      try { if (await evaluate(`document.readyState !== 'loading' && typeof showTab === 'function'`, 5000)) break; } catch (e) {}
      if (i > 150) throw new Error('頁面沒有載入完成');
      await sleep(100);
    }
    await evaluate(HELPERS, 5000);
    // run() is written as a method (`async run() {…}`), which is only valid inside an object literal.
    const src = tc.run.toString(), call = /^(async\s+)?run\s*\(/.test(src) ? `({ ${src} }).run()` : `(${src})()`;
    const value = await evaluate(call, tc.timeout || 60000);
    if (tc.offline) { // then cut the network, reload, and run tc.after() in the page as it opens offline
      await s('Network.enable');
      await s('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await s('Page.reload', { ignoreCache: false });
      for (let i = 0; ; i++) {
        try { if (await evaluate(`document.readyState !== 'loading' && typeof showTab === 'function'`, 5000)) break; } catch (e) {}
        if (i > 100) throw new Error('離線時頁面沒有載入完成');
        await sleep(100);
      }
      await evaluate(HELPERS, 5000);
      const after = tc.after.toString(), callAfter = /^(async\s+)?after\s*\(/.test(after) ? `({ ${after} }).after()` : `(${after})()`;
      const v2 = await evaluate(callAfter, tc.timeout || 60000);
      return { value: [value, v2].filter(Boolean).join(' · '), problems: [...problems, ...(await evaluate('T.unexpectedErrors()', 5000)).map(t => '錯誤提示：' + t)] };
    }
    const toasts = await evaluate('T.unexpectedErrors()', 5000);
    problems.push(...toasts.map(t => '錯誤提示：' + t));
    return { value, problems };
  } finally {
    cdp.listeners.delete(listener);
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    await cdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  }
}

async function main() {
  const picked = cases.filter(tc => (!filters.length || filters.some(f => tc.name.toLowerCase().includes(f)))
    && !(skipSlow && tc.slow) && !(mode !== 'http' && tc.http));
  if (!picked.length) { console.error('沒有符合的測試'); process.exit(2); }
  const exe = findBrowser();
  if (!exe) { console.error('找不到 Chrome 或 Edge；請用環境變數 CHROME 指定瀏覽器執行檔的路徑。'); process.exit(2); }
  const server = await serve();
  let base = `http://127.0.0.1:${server.address().port}/`;
  if (mode === 'file') base = pathToFileURL(path.join(ROOT, 'index.html')).href;
  if (mode === 'bundle') {
    const file = path.join(ROOT, 'dist', '紙匣.html');
    if (!fs.existsSync(file)) { console.error('找不到 dist/紙匣.html，請先執行 python tools/build.py'); process.exit(2); }
    base = pathToFileURL(file).href;
  }
  const browser = await launch(exe);
  const cdp = new CDP(browser.ws); await cdp.ready;
  const where = { http: '本機伺服器', file: '直接開啟 index.html', bundle: '單一檔案版' }[mode];
  console.log(`紙匣測試 · ${picked.length} 項 · ${where} · ${path.basename(exe)}${headed ? '（有視窗）' : ''}\n`);
  let failed = 0; const t0 = Date.now();
  for (const tc of picked) {
    const t = Date.now();
    let err = null, info = null;
    try {
      const r = await runCase(cdp, base, tc);
      if (r.problems.length) err = r.problems.join('\n');
      info = r.value;
    } catch (e) { err = e.message; }
    const secs = ((Date.now() - t) / 1000).toFixed(1);
    if (err) { failed++; console.log(`  ✗ ${tc.name}  (${secs}s)\n${err.split('\n').map(l => '      ' + l).join('\n')}`); }
    else console.log(`  ✓ ${tc.name}  (${secs}s)${info ? '  ' + info : ''}`);
  }
  console.log(`\n${picked.length - failed} 項通過，${failed} 項失敗 · ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
  await cdp.send('Browser.close').catch(() => {});
  await sleep(300); browser.proc.kill(); server.close();
  for (let i = 0; i < 5; i++) { try { fs.rmSync(browser.profile, { recursive: true, force: true }); break; } catch (e) { await sleep(400); } }
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
