#!/usr/bin/env node
/* 本機伺服器：提供專案資料夾，不快取（改完重新整理就看得到）。不需要安裝任何套件。
     node tools/serve.mjs          打開 http://localhost:8000
     node tools/serve.mjs 8765     改用其他連接埠
   tests/run.mjs 也用這個伺服器（連接埠 0：由系統挑一個空的）。 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.md': 'text/markdown; charset=utf-8' };

export function serve(port = 0, host = '127.0.0.1') {
  const server = http.createServer((req, res) => {
    let file;
    try {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
      file = path.resolve(ROOT, rel);
    } catch (err) { res.writeHead(400); res.end(); return; }
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve(server)); });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const port = Number(process.argv[2]) || 8000;
  serve(port).then(() => console.log(`紙匣：http://localhost:${port}（Ctrl+C 結束）`), err => { console.error(err.message); process.exit(1); });
}
