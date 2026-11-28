#!/usr/bin/env node
/* Checks lib/ against the CDN table in tools/build.py, and lists the newest version of each library.
     node .claude/skills/update-lib/check-libs.mjs
   For every entry of CDN: the local file must be byte for byte the file at that address (the bundles load the
   address, the site and the offline copy load lib/, so both must be the same code). Special entries:
     lib/cmaps/            every .bcmap in the folder, against <address><name>
     lib/tesseract/lang    every <lang>.traineddata.gz, against @tesseract.js-data/<lang>@LANG_DATA
     lib/qpdf/qpdf.wasm.js the base64 in it, decoded, against the .wasm at the address
   Also: each versioned address in js/core.js (LIB_FALLBACK) names the same version as build.py.
   Exit code 1 when a file differs or is missing, or the versions disagree. Node 18+ (fetch). */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LANG_DATA = '1.0.0/4.0.0_best_int'; // the @tesseract.js-data version and folder lib/tesseract/lang came from

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}
async function mapLimit(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

/* package and version named by a CDN address */
function pkgOf(url) {
  let m = url.match(/cdnjs\.cloudflare\.com\/ajax\/libs\/([^/]+)\/([^/]+)\//);
  if (m) return { cdn: 'cdnjs', name: m[1], version: m[2] };
  m = url.match(/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^/@]+)@([^/]+)/);
  if (m) return { cdn: 'npm', name: m[1], version: m[2] };
  return null;
}
async function latest(p) {
  try {
    if (p.cdn === 'cdnjs') return (await (await fetch(`https://api.cdnjs.com/libraries/${p.name}?fields=version`)).json()).version;
    return (await (await fetch(`https://data.jsdelivr.com/v1/packages/npm/${p.name}/resolved?specifier=latest`)).json()).version;
  } catch (e) { return '?'; }
}

const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false; };

const build = fs.readFileSync(path.join(ROOT, 'tools', 'build.py'), 'utf8');
const table = [...build.matchAll(/'(lib\/[^']*)':\s*'([^']+)'/g)].map(m => ({ local: m[1], url: m[2] }));
if (!table.length) { console.error('tools/build.py 裡找不到 CDN 表'); process.exit(2); }

const checks = []; // { file, url, decode? }
for (const { local, url } of table) {
  const abs = path.join(ROOT, local);
  if (local.endsWith('/')) {
    // The maps here and the ones the package has: one missing here shows as 缺檔.
    const names = new Set(fs.readdirSync(abs).filter(f => f.endsWith('.bcmap'))), p = pkgOf(url);
    const dir = url.replace(/^.*?@[^/]+/, ''); // e.g. /cmaps/
    try {
      const flat = await (await fetch(`https://data.jsdelivr.com/v1/packages/npm/${p.name}@${p.version}?structure=flat`)).json();
      for (const f of flat.files || []) if (f.name.startsWith(dir) && f.name.endsWith('.bcmap')) names.add(f.name.slice(dir.length));
    } catch (e) { console.log(`（拿不到 ${p.name}@${p.version} 的檔案清單，只比對本機有的對應表）`); }
    for (const f of [...names].sort()) checks.push({ file: local + f, url: url + f });
  } else if (local === 'lib/tesseract/lang') {
    for (const f of fs.readdirSync(abs).filter(f => f.endsWith('.traineddata.gz'))) {
      checks.push({ file: `${local}/${f}`, url: `${url}/${f.split('.')[0]}@${LANG_DATA.split('/')[0]}/${LANG_DATA.split('/')[1]}/${f}` });
    }
  } else {
    checks.push({ file: local, url, decode: /\.wasm$/.test(url) && local.endsWith('.wasm.js') });
    // pdf.js finds its worker next to itself (WORKER_URL in js/core.js), in lib/ and on the CDN alike
    if (local === 'lib/pdf.min.js') checks.push({ file: 'lib/pdf.worker.min.js', url: url.replace(/pdf\.min\.js$/, 'pdf.worker.min.js') });
  }
}

let bad = 0;
const results = await mapLimit(checks, 8, async c => {
  const abs = path.join(ROOT, c.file);
  if (!fs.existsSync(abs)) return { ...c, state: '缺檔' };
  let mine = fs.readFileSync(abs);
  if (c.decode) {
    const m = mine.toString('utf8').match(/"([A-Za-z0-9+/=]{100,})"/);
    if (!m) return { ...c, state: '讀不到 base64' };
    mine = Buffer.from(m[1], 'base64');
  }
  try { return { ...c, state: sha(mine) === sha(await get(c.url)) ? 'same' : '不同' }; }
  catch (e) { return { ...c, state: '下載失敗 ' + e.message }; }
});
const maps = results.filter(r => r.file.startsWith('lib/cmaps/'));
for (const r of results.filter(r => !r.file.startsWith('lib/cmaps/'))) {
  if (r.state !== 'same') bad++;
  console.log(`${r.state === 'same' ? '✓' : '✗'} ${r.file}${r.state === 'same' ? '' : '  ' + r.state}`);
}
const mapsBad = maps.filter(r => r.state !== 'same');
bad += mapsBad.length;
console.log(`${mapsBad.length ? '✗' : '✓'} lib/cmaps/  ${maps.length - mapsBad.length}/${maps.length} 個相同${mapsBad.length ? '：' + mapsBad.slice(0, 5).map(r => path.basename(r.file) + ' ' + r.state).join('、') : ''}`);

// js/core.js names some of the same addresses (fallbacks); they must name the versions build.py does.
const pinned = new Map();
for (const { url } of table) { const p = pkgOf(url); if (p) pinned.set(p.name, p); }
const core = fs.readFileSync(path.join(ROOT, 'js', 'core.js'), 'utf8');
for (const [, url] of core.matchAll(/'(https:\/\/[^']+)'/g)) {
  const p = pkgOf(url); if (!p) continue;
  const want = pinned.get(p.name) || [...pinned.values()].find(q => q.name.endsWith('/' + p.name) || p.name === 'pdfjs-dist' && q.name === 'pdfjs-dist');
  if (want && want.version !== p.version) { bad++; console.log(`✗ js/core.js 的 ${p.name}@${p.version}，build.py 是 ${want.version}`); }
}

console.log('\n版本（build.py 的 CDN 表 → 目前最新）');
for (const p of pinned.values()) {
  const l = await latest(p);
  // Only a higher number counts: a package's "latest" tag can lag behind a release it already has (tesseract.js-core).
  console.log(`  ${p.name.padEnd(30)} ${p.version.padEnd(10)} → ${l}${l !== '?' && newer(l, p.version) ? '  可更新' : ''}`);
}
process.exit(bad ? 1 : 0);
