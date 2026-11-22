'use strict';
/* 共用：函式庫設定、工具函式、存檔、可取消的工作、工具間串接、拖放、範例檔、縮圖、頁碼範圍、座標換算 */
const $ = (s, r = document) => r.querySelector(s);

/* ---------- libraries, loaded the first time they are needed ----------
   pdf-lib (makes PDFs), pdf.js (reads and draws PDFs) and JSZip are not loaded with the page: opening 紙匣 costs
   only its own code, and each library arrives on the first action that uses it. tools/build.py swaps these paths
   for cdnjs addresses in the bundled pages. */
const LIBS = { pdflib: 'lib/pdf-lib.min.js', pdfjs: 'lib/pdf.min.js', jszip: 'lib/jszip.min.js', heic: 'lib/heic2any.min.js',
  tesseract: 'lib/tesseract/tesseract.min.js', qpdf: 'lib/qpdf/qpdf.js', qpdfwasm: 'lib/qpdf/qpdf.wasm.js' };
/* Tried when the local copy is missing (heic2any is large, so lib/ may not have it). */
const LIB_FALLBACK = { heic: 'https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js' };
const libLoads = {};
function loadScript(key) {
  const add = src => new Promise((resolve, reject) => {
    const sc = document.createElement('script'); sc.src = src;
    sc.onload = resolve; sc.onerror = () => { sc.remove(); reject(); };
    document.head.append(sc);
  });
  return libLoads[key] || (libLoads[key] = (async () => {
    try { await add(LIBS[key]); }
    catch (e) {
      try { if (LIB_FALLBACK[key] && LIB_FALLBACK[key] !== LIBS[key]) { await add(LIB_FALLBACK[key]); return; } } catch (e2) {}
      delete libLoads[key]; throw new Error('函式庫載入失敗，請檢查網路連線後再試一次');
    }
  })());
}
/* Until pdf-lib is loaded, PDFDocument.load / .create load it first. Every other pdf-lib name is only used on
   a document those calls returned, so by then the real values are in place. */
let PDFDocument = {
  load: async (...a) => (await needPdfLib()).load(...a),
  create: async (...a) => (await needPdfLib()).create(...a)
};
let degrees, rgb, StandardFonts, BlendMode, PDFName, PDFRawStream, PDFArray, PDFDict, PDFNumber, PDFBool;
async function needPdfLib() {
  if (!window.PDFLib) await loadScript('pdflib');
  ({ PDFDocument, degrees, rgb, StandardFonts, BlendMode, PDFName, PDFRawStream, PDFArray, PDFDict, PDFNumber, PDFBool } = window.PDFLib);
  return PDFDocument;
}
let WORKER_URL = null;
async function needPdfjs() {
  if (!window.pdfjsLib) await loadScript('pdfjs');
  if (!WORKER_URL) { // the worker sits next to pdf.min.js
    WORKER_URL = new URL(LIBS.pdfjs.replace(/pdf\.min\.js$/, 'pdf.worker.min.js'), location.href).href;
    pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
  }
}
async function newZip() { if (!window.JSZip) await loadScript('jszip'); return new JSZip(); }
/* pdf.js parses in a background worker (blob wrapper around the worker script). It is started the first time a PDF
   is opened, not at page load: the worker script alone is about 1 MB and its thread holds memory of its own.
   Opened straight from disk (file://) browsers refuse that, and pdf.js runs the worker code on the page instead. */
let sharedWorker; // undefined = not tried yet, null = unavailable
function pdfWorker() {
  if (sharedWorker !== undefined) return sharedWorker;
  sharedWorker = null;
  if (location.protocol !== 'file:') {
    try {
      const w = new Worker(URL.createObjectURL(new Blob([`importScripts('${WORKER_URL}');`], { type: 'text/javascript' })));
      sharedWorker = new pdfjsLib.PDFWorker({ port: w });
    } catch (e) { sharedWorker = null; }
  }
  return sharedWorker;
}
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
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2"/></svg>',
  scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="m8 9 8-1 1 8-9 1z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>'
};

let toastTimer;
function toast(msg, kind) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (kind === 'err' ? ' err' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 5200 : 3200);
}
function loadErr(name, e) {
  const m = String(e && (e.name + ' ' + e.message) || '');
  if (/encrypt|password/i.test(m)) return encryptedMsg(name);
  return `「${name}」無法讀取，檔案可能已損壞或不是 PDF。`;
}
async function busy(btn, label, fn) {
  const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${label}`;
  try { return await fn(); } finally { btn.innerHTML = old; btn.disabled = false; }
}

/* ---------- cancellable jobs ----------
   The button stays clickable while the job runs and shows「取消」; a second click stops the job at its next check(). */
class Cancelled extends Error { constructor() { super('已取消'); this.cancelled = true; } }
function runJob(btn, label, fn) {
  if (btn._job) { btn._job.abort(); return Promise.resolve(); }
  const ac = new AbortController(); btn._job = ac;
  const old = btn.innerHTML; btn.classList.add('is-running');
  btn.innerHTML = `<span class="spin"></span>${label}<span class="cancel-hint">取消</span>`;
  const check = () => { if (ac.signal.aborted) throw new Cancelled(); };
  return (async () => {
    try { return await fn(check, ac.signal); }
    finally { btn._job = null; btn.innerHTML = old; btn.classList.remove('is-running'); }
  })().catch(err => { if (err && err.cancelled) { toast('已取消'); return; } throw err; });
}

/* ---------- finished results ----------
   When a tool finishes, its file goes to the result bar at the bottom: 預覽 / 下載 / 接著處理 (hand it to another
   tool). By default nothing is downloaded on its own and a single PDF or picture opens in the preview right away;
   with 「完成後自動下載」 ticked the file is saved immediately instead. */
const NEXT_TARGETS = { pdf: [], image: [] };
function registerTarget(kind, tab, label, load) { NEXT_TARGETS[kind].push({ tab, label, load }); }
let lastResult = null;
let autoDownload = false;
try { autoDownload = localStorage.getItem('papertray.autodl') === '1'; } catch (e) {}
/* deliver(file, kind, fromTab): kind is 'pdf', 'image', 'text', 'zip' or 'locked' (a zip or a password-protected PDF can
   only be downloaded: no preview, no handing on) */
async function deliver(file, kind, fromTab) {
  offerNext(file, kind, fromTab);
  if (autoDownload) await saveFile(file.name, file);
  else if (kind !== 'zip' && kind !== 'locked') openResultPreview();
}
function offerNext(file, kind, fromTab) {
  lastResult = { file, kind };
  const bar = $('#handoff'), acts = $('#handoff-actions');
  $('#handoff-name').textContent = `${file.name}（${fmtSize(file.size)}）`;
  $('#handoff-preview').hidden = kind === 'zip' || kind === 'locked';
  acts.innerHTML = '';
  for (const t of NEXT_TARGETS[kind] || []) {
    if (t.tab === fromTab) continue;
    const b = document.createElement('button'); b.className = 'btn'; b.textContent = t.label;
    b.addEventListener('click', () => {
      hideNext();
      showTab(t.tab); try { history.replaceState(null, '', '#' + t.tab); } catch (e) {}
      t.load([file]);
    });
    acts.append(b);
  }
  $('#handoff-next').hidden = !acts.children.length;
  bar.hidden = false; document.body.classList.add('has-handoff');
}
function hideNext() { $('#handoff').hidden = true; document.body.classList.remove('has-handoff'); lastResult = null; }
/* A finished PDF travels between tools as its bytes, not as a File: making a File copies them, and the next tool
   would copy them again. fileBytes() gives a tool the bytes either way; owned = false means others share them. */
const pdfFile = (bytes, name) => ({ name: ensurePdf(name), type: 'application/pdf', size: bytes.length, bytes,
  arrayBuffer: async () => bytes.slice().buffer, slice: (...a) => new Blob([bytes]).slice(...a) });
async function fileBytes(f) {
  if (f.bytes) return { bytes: f.bytes, owned: false };
  return { bytes: new Uint8Array(await f.arrayBuffer()), owned: true };
}
/* Encrypted files open in pdf.js but cannot be rebuilt; spot them up front without parsing the whole file. */
function hasEncrypt(bytes) {
  const pat = [0x2F, 0x45, 0x6E, 0x63, 0x72, 0x79, 0x70, 0x74]; // "/Encrypt"
  for (let i = bytes.indexOf(0x2F); i >= 0 && i < bytes.length - 8; i = bytes.indexOf(0x2F, i + 1)) {
    let k = 1; while (k < 8 && bytes[i + k] === pat[k]) k++;
    if (k === 8) return true;
  }
  return false;
}
/* A file's bytes for a tool that works on PDFs. A password-protected file is unlocked on the spot (js/password.js):
   print / copy restrictions alone are lifted without asking, an opening password is asked for. Gives
   { bytes, owned } like fileBytes(), or null when the file could not be opened or the user gave up. */
async function readPdf(f) {
  const r = await fileBytes(f);
  if (!hasEncrypt(r.bytes)) return r;
  const out = await unlockPdf(f.name, r.bytes);
  return out ? { bytes: out, owned: true } : null;
}
function encryptedMsg(name) { return `「${name}」有密碼保護，可以到「密碼」分頁解除。`; }
/* pdf.js takes ownership of the bytes it is given. Pass owned = true only when nothing else needs them afterwards;
   otherwise a copy goes to pdf.js. */
async function openPdfjs(bytes, owned) {
  await needPdfjs();
  const opts = { data: owned ? bytes : bytes.slice(), isEvalSupported: false };
  const w = pdfWorker(); if (w) opts.worker = w;
  return await pdfjsLib.getDocument(opts).promise;
}

/* ---------- saving files ---------- */
let downloadsNS = null;
const dlReady = (window.claude && typeof window.claude.use === 'function')
  ? window.claude.use('downloads').then(d => { downloadsNS = d; }).catch(() => {})
  : Promise.resolve();
async function saveFile(filename, bytes, mime) {
  await dlReady;
  const blob = bytes instanceof Blob ? bytes : bytes && bytes.bytes ? new Blob([bytes.bytes], { type: bytes.type })
    : new Blob([bytes], { type: mime || 'application/pdf' });
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
  const panel = area.closest('.panel'); if (panel && !panel._paste) panel._paste = handler; // Ctrl+V goes to the same place
  area.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); highlight && highlight.classList.add('is-over'); } });
  area.addEventListener('dragleave', e => { if (highlight && !area.contains(e.relatedTarget)) highlight.classList.remove('is-over'); });
  area.addEventListener('drop', e => {
    highlight && highlight.classList.remove('is-over');
    const files = [...(e.dataTransfer.files || [])];
    if (!files.length) return;
    e.preventDefault(); e.stopPropagation(); handler(files);
  });
}
/* Ctrl+V: pictures (a screenshot, a copied image) or files copied in the file manager go to the open tool,
   exactly as if they were dropped on it. Plain text pastes into text fields as usual. */
document.addEventListener('paste', e => {
  if (document.querySelector('dialog[open]')) return;
  const cd = e.clipboardData; if (!cd) return;
  // Copying from Word or a web page carries a picture of the text too; in a text field the text is what was meant.
  if (e.target.closest && e.target.closest('input, textarea, [contenteditable]') && [...cd.types].includes('text/plain')) return;
  let files = [...(cd.files || [])];
  if (!files.length) files = [...(cd.items || [])].filter(it => it.kind === 'file').map(it => it.getAsFile()).filter(Boolean);
  if (!files.length) return;
  const panel = document.querySelector('.panel:not([hidden])');
  if (!panel || !panel._paste) return;
  e.preventDefault();
  const t = new Date(), stamp = [t.getHours(), t.getMinutes(), t.getSeconds()].map(n => String(n).padStart(2, '0')).join('');
  files = files.map((f, i) => {
    // Screenshots arrive as "image.png" (or with no name at all); give them a name worth keeping.
    if (f.name && !/^image\.\w+$/i.test(f.name)) return f;
    const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    return new File([f], `貼上的圖片-${stamp}${files.length > 1 ? '-' + (i + 1) : ''}.${ext}`, { type: f.type });
  });
  panel._paste(files);
});
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
/* Reorder items by dragging. Mouse uses native drag and drop; touch uses long-press (phones don't drag natively),
   then the lifted item follows the finger. before() runs just before the list changes (used for undo). */
function makeSortable(container, sel, getArr, onChange, horizontal, beforeChange) {
  let dragId = null;
  const clear = () => container.querySelectorAll('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
  const isBefore = (el, x, y) => { const r = el.getBoundingClientRect(); return horizontal ? x < r.left + r.width / 2 : y < r.top + r.height / 2; };
  const move = (fromId, toEl, before) => {
    if (!toEl || toEl.dataset.id === fromId) return;
    beforeChange && beforeChange();
    const arr = getArr();
    const from = arr.findIndex(x => x.id === fromId); const [item] = arr.splice(from, 1);
    let to = arr.findIndex(x => x.id === toEl.dataset.id); if (!before) to++;
    arr.splice(to, 0, item); onChange();
  };
  container.addEventListener('dragstart', e => {
    const el = e.target.closest && e.target.closest(sel); if (!el) return;
    dragId = el.dataset.id; el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId);
  });
  container.addEventListener('dragend', () => { dragId = null; clear(); container.querySelectorAll('.dragging').forEach(x => x.classList.remove('dragging')); });
  container.addEventListener('dragover', e => {
    if (!dragId) return;
    const el = e.target.closest(sel); if (!el || el.dataset.id === dragId) return;
    e.preventDefault(); clear(); el.classList.add(isBefore(el, e.clientX, e.clientY) ? 'drop-before' : 'drop-after');
  });
  container.addEventListener('drop', e => {
    if (!dragId) return;
    const el = e.target.closest(sel); e.preventDefault(); clear();
    const id = dragId; dragId = null;
    if (el) move(id, el, isBefore(el, e.clientX, e.clientY));
  });

  let t = null;
  const end = () => {
    if (!t) return;
    clearTimeout(t.timer);
    if (t.ghost) t.ghost.remove();
    t.el.classList.remove('sort-lifted'); t.el.draggable = t.wasDraggable;
    clear();
    const done = t; t = null;
    if (done.active) container._sortedAt = Date.now(); // the finger lifts on a card; that is not a click on it
    if (done.active && done.target) move(done.id, done.target, done.before);
  };
  container.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    const el = e.target.closest(sel);
    if (!el || e.target.closest('button, input, label, select, textarea')) return;
    t = { el, id: el.dataset.id, x: e.clientX, y: e.clientY, active: false, wasDraggable: el.draggable };
    el.draggable = false;
    t.timer = setTimeout(() => {
      if (!t) return;
      const r = el.getBoundingClientRect();
      t.active = true; t.dx = t.x - r.left; t.dy = t.y - r.top;
      t.ghost = el.cloneNode(true); t.ghost.classList.add('sort-ghost');
      Object.assign(t.ghost.style, { width: r.width + 'px', height: r.height + 'px', left: r.left + 'px', top: r.top + 'px' });
      document.body.append(t.ghost); el.classList.add('sort-lifted');
      try { navigator.vibrate && navigator.vibrate(12); } catch (_) {}
    }, 350);
  });
  window.addEventListener('pointermove', e => {
    if (!t || e.pointerType !== 'touch') return;
    if (!t.active) { if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10) end(); return; } // it was a scroll
    t.ghost.style.left = (e.clientX - t.dx) + 'px'; t.ghost.style.top = (e.clientY - t.dy) + 'px';
    if (e.clientY < 70) window.scrollBy(0, -14); else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 14);
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const el = under && under.closest(sel);
    clear(); t.target = null;
    if (el && el !== t.el && container.contains(el)) {
      t.target = el; t.before = isBefore(el, e.clientX, e.clientY);
      el.classList.add(t.before ? 'drop-before' : 'drop-after');
    }
  });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  document.addEventListener('touchmove', e => { if (t && t.active) e.preventDefault(); }, { passive: false });
  container.addEventListener('contextmenu', e => { if (t) e.preventDefault(); });
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
const asFile = (bytes, name) => pdfFile(bytes, name);


/* ---------- page thumbnails ---------- */

const THUMB_PX = 320;

async function renderThumb(pg) {
  const vp1 = pg.getViewport({ scale: 1 });
  const vp = pg.getViewport({ scale: THUMB_PX / Math.max(vp1.width, vp1.height) });
  const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await pg.render({ canvasContext: ctx, viewport: vp }).promise;
  // A Blob URL keeps the picture outside the JavaScript heap (a data: URL would be a base64 string a third larger).
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .8));
  const out = { thumb: URL.createObjectURL(blob), tw: cv.width, th: cv.height };
  pg.cleanup(); cv.width = cv.height = 0;
  return out;
}
/* Give back thumbnail pictures that are no longer shown (a file was replaced or cleared). */
function releaseThumbs(items) { for (const it of items) if (it && typeof it.thumb === 'string' && it.thumb.startsWith('blob:')) { URL.revokeObjectURL(it.thumb); it.thumb = null; } }
/* ---------- lazy thumbnails ----------
   A long document would otherwise render every page before anything else can happen. Each card asks for its
   thumbnail when it comes near the screen; at most two render at once. */
const thumbJobs = []; let thumbBusy = 0;
const thumbIO = new IntersectionObserver(entries => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    thumbIO.unobserve(en.target);
    const job = en.target._thumbJob; en.target._thumbJob = null;
    if (job) { thumbJobs.push(job); pumpThumbs(); }
  }
}, { rootMargin: '600px 0px' });
function pumpThumbs() {
  while (thumbBusy < 2 && thumbJobs.length) {
    const job = thumbJobs.shift(); thumbBusy++;
    Promise.resolve().then(job).catch(() => {}).finally(() => { thumbBusy--; pumpThumbs(); });
  }
}
function whenVisible(el, job) { el._thumbJob = job; thumbIO.observe(el); }
function forgetCards(container) { container.querySelectorAll('.page-card').forEach(c => { c._thumbJob = null; thumbIO.unobserve(c); }); }
function setCardThumb(card, src, tw, th, rot) {
  const box = card && card.querySelector('.thumb'); if (!box || !src) return;
  let img = box.querySelector('img');
  if (!img) {
    img = document.createElement('img'); img.alt = ''; img.draggable = false;
    const ph = box.querySelector('.thumb-loading'); if (ph) ph.replaceWith(img); else box.prepend(img);
  }
  img.src = src; sizeThumbImg(img, tw, th, rot);
}
function sizeThumbImg(img, tw, th, rot) {
  const L = Math.max(tw, th);
  img.style.width = (88 * tw / L) + '%'; img.style.height = (88 * th / L) + '%';
  img.style.transform = `translate(-50%,-50%) rotate(${rot || 0}deg)`;
}

const isImage = f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|hei[cf])$/i.test(f.name);
const isHeic = f => /^image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);
/* iPhone photos (HEIC) become JPEG before any tool sees them. Safari can decode HEIC itself; other browsers
   use heic2any, loaded the first time it is needed. Other files pass through untouched. */
async function prepImages(files) {
  const out = [];
  for (const f of files) {
    if (!isHeic(f)) { out.push(f); continue; }
    const name = f.name.replace(/\.hei[cf]$/i, '') + '.jpg';
    try {
      let blob = null;
      try {
        const bmp = await createImageBitmap(f);
        const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
        cv.getContext('2d').drawImage(bmp, 0, 0); bmp.close && bmp.close();
        blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .92)); cv.width = cv.height = 0;
      } catch (e) { blob = null; }
      if (!blob) {
        toast(`正在轉換「${f.name}」…`);
        if (!window.heic2any) await loadScript('heic');
        const r = await window.heic2any({ blob: f, toType: 'image/jpeg', quality: .92 });
        blob = Array.isArray(r) ? r[0] : r;
      }
      out.push(new File([blob], name, { type: 'image/jpeg' }));
    } catch (e) {
      toast(`「${f.name}」無法轉換：${(e && e.message) || 'HEIC 解碼失敗'}`, 'err');
    }
  }
  return out;
}
/* One A4 page per picture (10 mm margin, turned to match the picture), for tools that work on PDFs. */
async function imagesToPdf(files, name) {
  const out = await PDFDocument.create();
  for (const f of files) {
    const bmp = await createImageBitmap(f); // applies the photo's rotation (EXIF)
    const w = bmp.width, h = bmp.height;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(bmp, 0, 0); bmp.close && bmp.close();
    const png = f.type === 'image/png' || /\.png$/i.test(f.name);
    const blob = await new Promise(r => cv.toBlob(r, png ? 'image/png' : 'image/jpeg', .92)); cv.width = cv.height = 0;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const img = png ? await out.embedPng(bytes) : await out.embedJpg(bytes);
    let [pw, ph] = [595.28, 841.89]; if (w > h) [pw, ph] = [ph, pw];
    const m = 28.35, s = Math.min((pw - m * 2) / w, (ph - m * 2) / h);
    out.addPage([pw, ph]).drawImage(img, { x: (pw - w * s) / 2, y: (ph - h * s) / 2, width: w * s, height: h * s });
  }
  return pdfFile(await out.save({ useObjectStreams: true }), name || files[0].name.replace(/\.[^.]+$/, '') + '.pdf');
}

/* Some fonts (Microsoft JhengHei among them) map common characters to look-alike Kangxi radicals (⽇ U+2F47 for 日,
   ⻑ U+2ED1 for 長), so text taken out of the PDF looks right but cannot be searched. Map them back; every character
   stays exactly one character, so positions in the string do not move. */
const RADICAL_FIX = { '⺠': '民', '⻄': '西', '⻑': '長', '⻝': '食', '⻣': '骨', '⻤': '鬼', '⺟': '母', '⻘': '青' };
const fixCjk = s => s.replace(/[⺀-⿟]/g, ch => RADICAL_FIX[ch] || ch.normalize('NFKC'));

/* ---------- memory held by tools that are not on screen ----------
   Every tool keeps its files until they are replaced or cleared, so after a few big files in different tools the
   page can hold hundreds of MB. Each tool registers how much it holds (roughly: file bytes plus decoded pictures)
   and how to let go of it. Switching tabs shows a notice when the other tools hold a lot together; 釋放 clears them.
   The editor's files belong to 編輯、簽名、遮蔽個資 alike, so those three count as one place. */
const HOLDERS = [];
function registerHolder(tab, size, release) { HOLDERS.push({ tab, size, release }); }
const MEM_NOTE_MIN = 50 * 1048576;
const memGroup = t => ['edit', 'sign', 'redact'].includes(t) ? 'edit' : t;
let memShownFor = null, memDismissedAt = 0;
function heldElsewhere(active) {
  return HOLDERS.filter(h => memGroup(h.tab) !== memGroup(active) && !$('#panel-' + h.tab).querySelector('.is-running'))
    .map(h => { let bytes = 0; try { bytes = h.size() || 0; } catch (e) {} return { ...h, bytes }; })
    .filter(h => h.bytes > 0).sort((a, b) => b.bytes - a.bytes);
}
function checkMemory(active) {
  const note = $('#mem-note'), list = heldElsewhere(active), total = list.reduce((n, h) => n + h.bytes, 0);
  // After 「不用」 the notice stays away until the other tools hold clearly more than they did then.
  if (total < MEM_NOTE_MIN || total < memDismissedAt + 20 * 1048576) { note.hidden = true; memShownFor = null; return; }
  memShownFor = active;
  const mb = b => b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${+(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`;
  const names = list.slice(0, 3).map(h => `${$('#tab-' + h.tab + ' span').textContent} ${mb(h.bytes)}`).join('、') + (list.length > 3 ? ` 等 ${list.length} 個工具` : '');
  $('#mem-text').textContent = `其他工具還留著檔案（${names}，共約 ${mb(total)}）。不再需要的話可以釋放，電腦或手機會順一些；那些工具會回到空白狀態。`;
  note.hidden = false;
}
$('#mem-free').addEventListener('click', () => {
  const list = heldElsewhere(memShownFor), total = list.reduce((n, h) => n + h.bytes, 0);
  for (const h of list) { try { h.release(); } catch (e) {} }
  $('#mem-note').hidden = true; memDismissedAt = 0;
  toast(`已釋放約 ${fmtSize(total)}，${list.length} 個工具已清空`);
});
$('#mem-close').addEventListener('click', () => {
  memDismissedAt = heldElsewhere(memShownFor).reduce((n, h) => n + h.bytes, 0);
  $('#mem-note').hidden = true;
});
const canvasBytes = sel => [...document.querySelectorAll(sel)].reduce((n, c) => n + c.width * c.height * 4, 0);

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
