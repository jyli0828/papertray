'use strict';
/* 共用：函式庫設定、工具函式、存檔、拖放、範例檔、縮圖、頁碼範圍、座標換算 */

const { PDFDocument, degrees, rgb, StandardFonts } = PDFLib;
const WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
/* Run pdf.js parsing in a real background worker (blob wrapper around the CDN script). */
let sharedWorker = null;
try {
  const w = new Worker(URL.createObjectURL(new Blob([`importScripts('${WORKER_URL}');`], { type: 'text/javascript' })));
  sharedWorker = new pdfjsLib.PDFWorker({ port: w });
} catch (e) { sharedWorker = null; }
/* pdf.js waits on animation frames while painting images; those stop in a background tab.
   Fall back to a timer so long jobs keep going when the page is not on screen. */
(() => {
  const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
  const pending = new Map(); let seq = 0;
  window.requestAnimationFrame = cb => {
    const id = ++seq; let fired = false;
    const run = t => { if (fired) return; fired = true; pending.delete(id); cb(t); };
    pending.set(id, { r: raf(run), t: setTimeout(() => run(performance.now()), 120) });
    return id;
  };
  window.cancelAnimationFrame = id => { const p = pending.get(id); if (!p) return; caf(p.r); clearTimeout(p.t); pending.delete(id); };
})();

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
let _n = 0; const uid = () => 'i' + (++_n);
const isPdf = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const baseName = n => n.replace(/\.pdf$/i, '');
const ensurePdf = n => { n = (n || '').trim() || 'document'; return /\.pdf$/i.test(n) ? n : n + '.pdf'; };
function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}
function paperName(w, h) {
  const mm = v => v * 25.4 / 72;
  const a = mm(Math.min(w, h)), b = mm(Math.max(w, h));
  const sizes = [['A3', 297, 420], ['A4', 210, 297], ['A5', 148, 210], ['B5', 182, 257], ['Letter', 215.9, 279.4], ['Legal', 215.9, 355.6]];
  for (const [n, x, y] of sizes) if (Math.abs(a - x) < 3 && Math.abs(b - y) < 3) return n;
  return Math.round(mm(w)) + '×' + Math.round(mm(h)) + 'mm';
}
const ICON = {
  grip: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  rotl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a8 8 0 1 1 2.3 5.7M4 4v7h7"/></svg>',
  rotr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
  text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c2-1 3-3 5-3s1.5 2 3.5 2 2-1.5 3-1.5"/><path d="m14 4 4 4-8 8H6v-4z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>'
};

let toastTimer;
function toast(msg, kind) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (kind === 'err' ? ' err' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 5200 : 3200);
}
function loadErr(name, e) {
  const m = String(e && (e.name + ' ' + e.message) || '');
  if (/encrypt|password/i.test(m)) return `「${name}」有密碼保護，請先移除密碼再處理。`;
  return `「${name}」無法讀取，檔案可能已損壞或不是 PDF。`;
}
async function busy(btn, label, fn) {
  const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${label}`;
  try { return await fn(); } finally { btn.innerHTML = old; btn.disabled = false; }
}
function openPdfjs(bytes) {
  const opts = { data: bytes.slice(), isEvalSupported: false };
  if (sharedWorker) opts.worker = sharedWorker;
  return pdfjsLib.getDocument(opts).promise;
}

/* ---------- saving files ---------- */
let downloadsNS = null;
const dlReady = (window.claude && typeof window.claude.use === 'function')
  ? window.claude.use('downloads').then(d => { downloadsNS = d; }).catch(() => {})
  : Promise.resolve();
async function saveFile(filename, bytes, mime) {
  await dlReady;
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime || 'application/pdf' });
  if (downloadsNS) {
    try { await downloadsNS.save({ filename, data: blob }); toast(`已儲存 ${filename}`); }
    catch (e) {
      const c = e && e.code;
      if (c === 'declined') toast('已取消儲存');
      else if (c === 'rate_limited') toast('已有一個儲存視窗開著，請先處理它');
      else toast('這個檢視無法儲存檔案：' + ((e && e.message) || c || '未知原因'), 'err');
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast(`已下載 ${filename}`);
}

/* ---------- drop + sortable ---------- */
window.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
window.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) e.preventDefault(); });
function acceptFiles(area, highlight, handler) {
  area.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); highlight && highlight.classList.add('is-over'); } });
  area.addEventListener('dragleave', e => { if (highlight && !area.contains(e.relatedTarget)) highlight.classList.remove('is-over'); });
  area.addEventListener('drop', e => {
    highlight && highlight.classList.remove('is-over');
    const files = [...(e.dataTransfer.files || [])];
    if (!files.length) return;
    e.preventDefault(); e.stopPropagation(); handler(files);
  });
}
function bindInput(input, handler) {
  input.addEventListener('change', () => { const f = [...input.files]; input.value = ''; if (f.length) handler(f); });
}
/* File-name fields: clicking clears the text for a fresh name (keyboard focus selects it instead);
   leaving it empty puts the previous name back. Only a click clears, so switching windows never wipes what was typed. */
const isNameField = el => el && el.matches && el.matches('.name-field input');
document.addEventListener('pointerdown', e => {
  const el = e.target;
  if (!isNameField(el) || document.activeElement === el) return;
  el.dataset.prev = el.value; el.placeholder = el.value; el.value = '';
});
document.addEventListener('focusin', e => {
  const el = e.target;
  if (isNameField(el) && el.value) { el.dataset.prev = el.value; el.select(); }
});
document.addEventListener('focusout', e => {
  const el = e.target;
  if (!isNameField(el)) return;
  if (!el.value.trim()) el.value = el.dataset.prev || '';
  el.placeholder = '';
});
function makeSortable(container, sel, getArr, onChange, horizontal) {
  let dragId = null;
  const clear = () => container.querySelectorAll('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
  container.addEventListener('dragstart', e => {
    const el = e.target.closest && e.target.closest(sel); if (!el) return;
    dragId = el.dataset.id; el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId);
  });
  container.addEventListener('dragend', () => { dragId = null; clear(); container.querySelectorAll('.dragging').forEach(x => x.classList.remove('dragging')); });
  const before = (el, e) => { const r = el.getBoundingClientRect(); return horizontal ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2; };
  container.addEventListener('dragover', e => {
    if (!dragId) return;
    const el = e.target.closest(sel); if (!el || el.dataset.id === dragId) return;
    e.preventDefault(); clear(); el.classList.add(before(el, e) ? 'drop-before' : 'drop-after');
  });
  container.addEventListener('drop', e => {
    if (!dragId) return;
    const el = e.target.closest(sel); e.preventDefault(); clear();
    if (!el || el.dataset.id === dragId) return;
    const arr = getArr();
    const from = arr.findIndex(x => x.id === dragId); const [item] = arr.splice(from, 1);
    let to = arr.findIndex(x => x.id === el.dataset.id); if (!before(el, e)) to++;
    arr.splice(to, 0, item); dragId = null; onChange();
  });
}

/* ---------- sample documents ---------- */
async function makeSample(title, pages, color) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const c = rgb(...color);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([595.28, 841.89]);
    p.drawRectangle({ x: 0, y: 770, width: 595.28, height: 72, color: c });
    p.drawText(title, { x: 50, y: 795, size: 24, font: bold, color: rgb(1, 1, 1) });
    p.drawText(`Section ${i + 1}`, { x: 50, y: 720, size: 18, font: bold, color: rgb(.1, .13, .17) });
    let y = 690;
    for (let k = 0; k < 16; k++) {
      const w = k % 5 === 4 ? 260 : 495 - ((k * 37) % 60);
      p.drawRectangle({ x: 50, y, width: w, height: 7, color: rgb(.82, .85, .88) });
      y -= k % 5 === 4 ? 30 : 17;
    }
    p.drawRectangle({ x: 50, y: y - 150, width: 495, height: 150, borderColor: c, borderWidth: 1.5, color: rgb(.96, .97, .98) });
    p.drawText(`Page ${i + 1} of ${pages}`, { x: 255, y: 36, size: 10, font, color: rgb(.4, .45, .5) });
  }
  return doc.save();
}
async function makePhotoSample() {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) {
    const cv = document.createElement('canvas'); cv.width = 1400; cv.height = 1000;
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 1400, 1000);
    g.addColorStop(0, i ? '#1b3a5c' : '#e6a45a'); g.addColorStop(.55, i ? '#3f7d8c' : '#c2573a'); g.addColorStop(1, i ? '#a9d4c9' : '#47283f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1400, 1000);
    for (let k = 0; k < 40; k++) {
      ctx.fillStyle = `hsla(${(k * 47 + i * 120) % 360},60%,${40 + (k % 5) * 10}%,.35)`;
      ctx.beginPath(); ctx.arc((k * 173) % 1400, (k * 311) % 1000, 40 + (k * 13) % 160, 0, 7); ctx.fill();
    }
    const img = ctx.getImageData(0, 0, 1400, 1000); const d = img.data;
    for (let p = 0; p < d.length; p += 4) { const n = (Math.random() - .5) * 46; d[p] += n; d[p + 1] += n; d[p + 2] += n; }
    ctx.putImageData(img, 0, 0);
    const png = await new Promise(r => cv.toBlob(r, 'image/png'));
    const emb = await doc.embedPng(new Uint8Array(await png.arrayBuffer()));
    const p = doc.addPage([595.28, 841.89]);
    p.drawText(i ? 'Site survey, north field' : 'Site survey, east ridge', { x: 50, y: 780, size: 22, font: bold });
    p.drawText('Photo log, scanned at 300 dpi', { x: 50, y: 756, size: 11, font, color: rgb(.4, .45, .5) });
    p.drawImage(emb, { x: 50, y: 380, width: 495, height: 353.6 });
    p.drawText(`Page ${i + 1} of 2`, { x: 262, y: 36, size: 10, font, color: rgb(.4, .45, .5) });
  }
  return doc.save();
}
const asFile = (bytes, name) => new File([bytes], name, { type: 'application/pdf' });


/* ---------- page thumbnails ---------- */

const THUMB_PX = 320;

async function renderThumb(pg) {
  const vp1 = pg.getViewport({ scale: 1 });
  const vp = pg.getViewport({ scale: THUMB_PX / Math.max(vp1.width, vp1.height) });
  const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await pg.render({ canvasContext: ctx, viewport: vp }).promise;
  const out = { thumb: cv.toDataURL('image/jpeg', .82), tw: cv.width, th: cv.height };
  pg.cleanup(); cv.width = cv.height = 0;
  return out;
}
function sizeThumbImg(img, tw, th, rot) {
  const L = Math.max(tw, th);
  img.style.width = (88 * tw / L) + '%'; img.style.height = (88 * th / L) + '%';
  img.style.transform = `translate(-50%,-50%) rotate(${rot || 0}deg)`;
}

const isImage = f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name);

/* ================= shared: page ranges ================= */
function parseRanges(text, n) {
  const toks = String(text || '').split(/[,，、;；\s]+/).filter(Boolean);
  const out = [];
  for (const tok of toks) {
    let m = tok.match(/^(\d+)$/), a, b;
    if (m) { a = b = +m[1]; }
    else if ((m = tok.match(/^(\d*)[-–~～](\d*)$/)) && (m[1] || m[2])) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : n; }
    else return { error: `「${tok}」看不懂，請用 1-3, 5, 8- 這樣的寫法` };
    if (a < 1 || b < 1) return { error: '頁碼從 1 開始' };
    if (a > b) return { error: `「${tok}」的起始頁比結束頁大` };
    if (b > n) return { error: `第 ${b} 頁超出範圍（這份只有 ${n} 頁）` };
    out.push([a, b]);
  }
  return { ranges: out };
}


/* coordinate mapping between display space (top-left origin, y down, after rotation) and PDF user space */
function dispSize(view, R) { const W = view[2] - view[0], H = view[3] - view[1]; return R % 180 ? [H, W] : [W, H]; }
function displayToUser(view, R, dx, dy) {
  const [x0, y0, x1, y1] = view;
  switch (R) {
    case 90: return [x0 + dy, y0 + dx];
    case 180: return [x1 - dx, y0 + dy];
    case 270: return [x1 - dy, y1 - dx];
    default: return [x0 + dx, y1 - dy];
  }
}
function userToDisplay(view, R, ux, uy) {
  const [x0, y0, x1, y1] = view;
  switch (R) {
    case 90: return [uy - y0, ux - x0];
    case 180: return [x1 - ux, uy - y0];
    case 270: return [y1 - uy, x1 - ux];
    default: return [ux - x0, y1 - uy];
  }
}

const LH = 1.3;
const fontStr = s => `500 ${s}px "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif`;
const mctx = document.createElement('canvas').getContext('2d');
async function ensureFont(text, size) { try { await document.fonts.load(fontStr(size || 16), text); } catch (e) {} }
function measureAnnot(a) {
  mctx.font = fontStr(a.size);
  const lines = a.text.split('\n');
  const w = Math.max(...lines.map(l => mctx.measureText(l).width));
  a.wPt = Math.max(w, a.size * .5) + 2; a.hPt = lines.length * a.size * LH;
}
async function renderTextPng(a) {
  await ensureFont(a.text, a.size);
  const k = 4, c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(a.wPt * k)); c.height = Math.max(1, Math.ceil(a.hPt * k));
  const ctx = c.getContext('2d'); ctx.scale(k, k);
  ctx.font = fontStr(a.size); ctx.fillStyle = a.color; ctx.textBaseline = 'middle';
  a.text.split('\n').forEach((ln, i) => ctx.fillText(ln, 1, (i + .5) * a.size * LH));
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
