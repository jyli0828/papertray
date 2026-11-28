#!/usr/bin/env node
/* Makes <root>/tests/_bench-run.mjs from <root>/tests/run.mjs: the same runner, with
   - the cases taken from the file named by the BENCH environment variable (not tests/cases.mjs),
   - Chrome started with --expose-gc and precise memory info,
   - on Windows, the total private bytes of the test browser's processes sampled every ~100 ms (PowerShell); a case
     brackets a measurement with console.log('MARK <name> start|end'), and the peak rise is added to its result line.
     Elsewhere memory is not sampled and the result lines have timings only,
   - PROFILE=run (or PROFILE=load): a CPU profile around each case (or around page load), top 25 self times printed.
   Usage: node make-runner.mjs <project root>     (run it again for every copy, e.g. a baseline from git archive) */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
let s = fs.readFileSync(path.join(root, 'tests', 'run.mjs'), 'utf8');
const rep = (a, b, what) => { if (!s.includes(a)) throw new Error(`tests/run.mjs changed, cannot patch: ${what}`); s = s.replace(a, b); };

rep("import cases from './cases.mjs';", "const cases = (await import(pathToFileURL(process.env.BENCH).href)).default;", 'cases import');
rep("'--remote-debugging-port=0',", "'--remote-debugging-port=0', '--js-flags=--expose-gc', '--enable-precise-memory-info',", 'browser flags');

// memory sampling
rep('const browser = await launch(exe);', `const browser = await launch(exe);
  globalThis.__mem = [];
  if (process.platform === 'win32') {
  const ps = spawn('powershell', ['-NoProfile', '-Command', \`$prof = '\${browser.profile.replace(/'/g, "''")}'; $ids = @(); $k = 0;
    while ($true) {
      if ($k % 10 -eq 0) { $ids = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | Where-Object { $_.CommandLine -like "*$prof*" } | ForEach-Object { $_.ProcessId }) }
      $k++; $sum = 0; foreach ($i in $ids) { $p = Get-Process -Id $i -ErrorAction SilentlyContinue; if ($p) { $sum += $p.PrivateMemorySize64 } }
      [Console]::Out.WriteLine("$([DateTimeOffset]::Now.ToUnixTimeMilliseconds()) $sum"); Start-Sleep -Milliseconds 80 }\`], { stdio: ['ignore', 'pipe', 'ignore'] });
  let psBuf = '';
  ps.stdout.on('data', d => { psBuf += d; const lines = psBuf.split(/\\r?\\n/); psBuf = lines.pop(); for (const l of lines) { const [t, b] = l.split(' ').map(Number); if (t) globalThis.__mem.push([t, b]); } });
  process.on('exit', () => { try { ps.kill(); } catch (e) {} });
  await sleep(3000);
  }`, 'launch');
rep("    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {", `    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'log' && /^MARK /.test(m.params.args[0].value || '')) {
      const [, name, what] = m.params.args[0].value.split(' ');
      (globalThis.__marks = globalThis.__marks || []).push([name, what, Date.now()]);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {`, 'console listener');
rep('    const secs = ((Date.now() - t) / 1000).toFixed(1);', `    if (globalThis.__mem.length) await sleep(300); // the last samples of the case (Windows only)
    const marks = globalThis.__marks || []; globalThis.__marks = [];
    const rises = [];
    for (let i = 0; i < marks.length; i++) {
      if (marks[i][1] !== 'start') continue;
      const end = marks.slice(i + 1).find(m => m[0] === marks[i][0] && m[1] === 'end'); if (!end) continue;
      const before = globalThis.__mem.filter(([t]) => t <= marks[i][2]).slice(-1)[0];
      const during = globalThis.__mem.filter(([t]) => t >= marks[i][2] && t <= end[2] + 100);
      if (before && during.length) rises.push(Math.round((Math.max(...during.map(x => x[1])) - before[1]) / 1048576));
    }
    if (rises.length) info = (info || '') + ' · 行程記憶體峰值 +' + rises.join('/') + ' MB';
    const secs = ((Date.now() - t) / 1000).toFixed(1);`, 'result line');

// CPU profile
rep("    await s('Page.navigate',", `    const profTop = async () => {
      const { profile: p } = await s('Profiler.stop'), self = new Map(), byId = new Map(p.nodes.map(n => [n.id, n]));
      p.samples.forEach((id, i) => { const c = byId.get(id).callFrame, k = (c.functionName || '(anon)') + ' ' + c.url.split('/').pop() + ':' + (c.lineNumber + 1); self.set(k, (self.get(k) || 0) + (p.timeDeltas[i] || 0)); });
      const tot = [...self.values()].reduce((a, b) => a + b, 0);
      console.log('    PROFILE total ' + Math.round(tot / 1000) + ' ms');
      [...self].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log('      ' + String(Math.round(v / 1000)).padStart(6) + ' ms  ' + k));
    };
    const profStart = async () => { await s('Profiler.enable'); await s('Profiler.setSamplingInterval', { interval: 200 }); await s('Profiler.start'); };
    if (process.env.PROFILE === 'load') await profStart();
    await s('Page.navigate',`, 'navigate');
rep('    await evaluate(HELPERS, 5000);\n    // run()', "    if (process.env.PROFILE === 'load') await profTop();\n    await evaluate(HELPERS, 5000);\n    // run()", 'helpers');
rep('    const value = await evaluate(call, tc.timeout || 60000);', `    if (process.env.PROFILE === 'run') await profStart();
    const value = await evaluate(call, tc.timeout || 60000);
    if (process.env.PROFILE === 'run') await profTop();`, 'case evaluate');

const out = path.join(root, 'tests', '_bench-run.mjs');
fs.writeFileSync(out, s);
console.log('wrote ' + out);
