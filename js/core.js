'use strict';
/* 共用：函式庫設定、工具函式、存檔、可取消的工作、工具間串接、拖放、範例檔、縮圖、頁碼範圍、座標換算 */
const $ = (s, r = document) => r.querySelector(s);

/* ---------- libraries, loaded the first time they are needed ----------
   pdf-lib (makes PDFs) and pdf.js (reads and draws PDFs) are not loaded with the page: opening 紙匣 costs
   only its own code, and each library arrives on the first action that uses it. tools/build.py swaps these paths
   for cdnjs addresses in the bundled pages. */
const LIBS = { pdflib: 'lib/pdf-lib.min.js', pdfjs: 'lib/pdf.min.js', heic: 'lib/heic2any.min.js',
  tesseract: 'lib/tesseract/tesseract.min.js', qpdf: 'lib/qpdf/qpdf.js', qpdfwasm: 'lib/qpdf/qpdf.wasm.js',
  // pdf.js's character maps: Chinese, Japanese and Korean text in a font the PDF does not embed is unreadable
  // without them (it draws and extracts as nothing). pdf.js fetches only the ones a file names.
  cmaps: 'lib/cmaps/' };
/* Tried when the local copy is missing (heic2any is large, so lib/ may not have it). */
const LIB_FALLBACK = { heic: 'https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js',
  // Opened straight from disk, browsers refuse to let pdf.js read files next to the page, so the maps come from jsdelivr
  // (cdnjs does not serve .bcmap files).
  cmaps: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/' };
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
  pdfLibChunks(window.PDFLib);
  ({ PDFDocument, degrees, rgb, StandardFonts, BlendMode, PDFName, PDFRawStream, PDFArray, PDFDict, PDFNumber, PDFBool } = window.PDFLib);
  return PDFDocument;
}
/* pdf-lib reads and writes a file in chunks, waiting on a zero-delay timer between them so the page stays responsive.
   Browsers make such a timer wait at least 4 ms, and a second in a background tab, and pdf-lib's chunks are small
   (100 objects when reading, 50 when writing): a 3000-page file spent most of its 1.3 s read and 1.8 s write waiting,
   and minutes in a tab not on screen. Bigger chunks still keep each pause short (tens of ms); with the tab hidden
   there is nothing to keep responsive, so the work runs in one go. A caller's own setting still wins. */
const PDFLIB_CHUNK = 1500;
function pdfLibChunks(L) {
  if (L.PDFDocument._chunked) return;
  const load = L.PDFDocument.load, save = L.PDFDocument.prototype.save;
  const chunk = () => document.hidden ? Infinity : PDFLIB_CHUNK;
  L.PDFDocument.load = function (pdf, o) { return load.call(this, pdf, { parseSpeed: chunk(), ...o }); };
  L.PDFDocument.prototype.save = function (o) { return save.call(this, { objectsPerTick: chunk(), ...o }); };
  L.PDFDocument._chunked = true;
}
let WORKER_URL = null;
async function needPdfjs() {
  if (!window.pdfjsLib) await loadScript('pdfjs');
  if (!WORKER_URL) { // the worker sits next to pdf.min.js
    WORKER_URL = new URL(LIBS.pdfjs.replace(/pdf\.min\.js$/, 'pdf.worker.min.js'), location.href).href;
    pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
  }
}
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
/* Choosing a file in the file picker, or dragging one over the page, takes a second or more: the libraries that will
   read it load meanwhile (and pdf.js's worker starts), so the file opens at once instead of first waiting for them,
   about 150 ms here and more on a phone. Only for tools that take PDFs, and only once a file is on its way. */
let pdfLibsWarm = false;
function warmPdfLibs() {
  if (pdfLibsWarm) return; pdfLibsWarm = true;
  // A failure shows up, with its message, when the file is opened.
  Promise.all([needPdfjs(), needPdfLib()]).then(async () => {
    // The first page pdf.js draws, and the first picture the browser encodes, take about 0.4 s longer than the rest
    // (code compiled, encoders set up): a tiny page is drawn now so the file's first thumbnails do not wait for that.
    const d = await PDFDocument.create(), font = await d.embedFont(StandardFonts.Helvetica);
    d.addPage([60, 80]).drawText('Aa', { x: 8, y: 40, size: 14, font });
    const pj = await openPdfjs(await d.save(), true);
    try { URL.revokeObjectURL((await renderThumb(await pj.getPage(1))).thumb); } finally { pj.destroy(); }
  }).catch(() => {});
}
const takesPdf = el => !!el && el.matches('input[type="file"]') && /pdf/i.test(el.accept);
document.addEventListener('click', e => { if (takesPdf(e.target)) warmPdfLibs(); }, true);
window.addEventListener('dragenter', e => {
  if (e.dataTransfer && [...e.dataTransfer.types].includes('Files') && takesPdf($('.panel:not([hidden]) input[type="file"]'))) warmPdfLibs();
});
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
  if (btn._job) {
    // The second click of a double-click lands a moment after the first: that is not 「取消」.
    if (Date.now() - btn._jobAt >= 500) btn._job.abort();
    return Promise.resolve();
  }
  const ac = new AbortController(); btn._job = ac; btn._jobAt = Date.now();
  const old = btn.innerHTML; btn.classList.add('is-running');
  btn.innerHTML = `<span class="spin"></span>${label}<span class="cancel-hint">取消</span>`;
  const check = () => { if (ac.signal.aborted) throw new Cancelled(); };
  return (async () => {
    try { return await fn(check, ac.signal); }
    finally {
      btn._job = null; btn.innerHTML = old; btn.classList.remove('is-running');
      const later = btn._later; btn._later = null; if (later) setJobButton(btn, later);
      if (typeof ocrLeave === 'function') ocrLeave(); // a finished OCR job on a tool left meanwhile: stop the engine now
    }
  })().catch(err => { if (err && err.cancelled) { toast('已取消'); return; } throw err; });
}
/* Label, disabled and hidden of a button that runs jobs. While its job runs the button says 「取消」 and has to stay
   visible and clickable, so what the tool asks for meanwhile (a new label for the list it shows, say) is applied
   once the job is done. */
function setJobButton(btn, { text, disabled, hidden }) {
  if (btn._job) {
    const l = btn._later || (btn._later = {});
    if (text != null) l.text = text; if (disabled != null) l.disabled = disabled; if (hidden != null) l.hidden = hidden;
    return;
  }
  if (text != null) btn.textContent = text;
  if (disabled != null) btn.disabled = disabled;
  if (hidden != null) btn.hidden = hidden;
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
      if (toolBusy($('#panel-' + t.tab))) return; // the result stays in the bar for later
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
/* While the result preview has lent a file's bytes to pdf.js (js/preview.js), f.bytes is null and f.lent is a promise
   that settles when they are back; fileBytes() waits for it. */
function pdfFile(bytes, name) {
  const f = { name: ensurePdf(name), type: 'application/pdf', size: bytes.length, bytes, lent: null,
    arrayBuffer: async () => { if (f.lent) await f.lent; return f.bytes.slice().buffer; },
    slice: (...a) => new Blob([f.bytes]).slice(...a) };
  return f;
}
/* A PDF handed on in memory (pdfFile) rather than a File or Blob. Test the bytes themselves: browsers now give every
   Blob a bytes() method, so a plain f.bytes check is true for any File the user picks. */
const inMemory = f => !!f && f.bytes instanceof Uint8Array;
async function fileBytes(f) {
  if (f.lent) await f.lent;
  if (inMemory(f)) return { bytes: f.bytes, owned: false };
  try { return { bytes: new Uint8Array(await f.arrayBuffer()), owned: true }; }
  catch (e) { throw new Error(`「${f.name}」讀不到了：原本的檔案可能已被移動、修改或刪除，請重新放入。`); }
}
/* What a tool keeps of a file it reads again later, instead of the bytes: the File the user picked (only a reference
   to the file on disk, so it takes no memory), a PDF from another tool as it is (shared, not copied), or bytes made
   here (an unlocked file) as a Blob, which the browser holds outside the page and can move to disk. got is what
   readPdf() gave; call this before handing got.bytes to pdf.js, which takes them over. Read it back with fileBytes(). */
function keepFile(f, got) {
  if (!got.unlocked && (inMemory(f) || f instanceof Blob)) return f;
  return new Blob([got.bytes], { type: 'application/pdf' });
}
/* Memory a kept file takes: none for a File the user picked (on disk; a pasted one is the rare exception). */
const heldBytes = src => !src ? 0 : inMemory(src) ? src.bytes.length : src instanceof File ? 0 : src.size || 0;
/* Encrypted files open in pdf.js but cannot be rebuilt; spot them up front without parsing the whole file. */
function hasEncrypt(bytes) {
  // Every file is read through this, so it looks for the 'y' of "/Encrypt" (native indexOf) and checks around it:
  // a '/' starts every name, and stopping at each of them was three times slower.
  const pat = [0x2F, 0x45, 0x6E, 0x63, 0x72, 0x79, 0x70, 0x74]; // "/Encrypt"
  for (let i = bytes.indexOf(0x79, 5); i >= 0 && i + 2 < bytes.length; i = bytes.indexOf(0x79, i + 1)) {
    let k = 0; while (k < 8 && bytes[i - 5 + k] === pat[k]) k++;
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
  return out ? { bytes: out, owned: true, unlocked: true } : null;
}
function encryptedMsg(name) { return `「${name}」有密碼保護，可以到「密碼」分頁解除。`; }
/* pdf.js takes ownership of the bytes it is given. Pass owned = true only when nothing else needs them afterwards;
   otherwise a copy goes to pdf.js. */
async function openPdfjs(bytes, owned) {
  await needPdfjs();
  return await pdfjsLib.getDocument(pdfjsOpts(owned ? bytes : bytes.slice())).promise;
}
/* Goes through the pages of a pdf.js document: page(pg, i) gets each page (pg is null for a page that cannot be
   read), batch() runs after each batch. Pages are asked for 50 at a time: asked one by one, each request waited
   behind the thumbnails being drawn meanwhile, and only listing the page sizes of a 1000-page file took a second.
   Stops early (giving false) once stop() is true. */
async function eachPage(pj, page, { batch, stop } = {}) {
  const to = pj.numPages;
  for (let i = 0; i < to; i += 50) {
    if (stop && stop()) return false;
    const pgs = await Promise.all(Array.from({ length: Math.min(50, to - i) }, (_, k) => pj.getPage(i + k + 1).catch(() => null)));
    if (stop && stop()) return false;
    pgs.forEach((pg, k) => page(pg, i + k));
    if (batch) batch(i);
  }
  return true;
}
/* The options every pdf.js document is opened with (call after needPdfjs). */
function pdfjsOpts(data) {
  const maps = location.protocol === 'file:' && /^lib\//.test(LIBS.cmaps) ? LIB_FALLBACK.cmaps : LIBS.cmaps;
  const opts = { data, isEvalSupported: false, cMapUrl: new URL(maps, location.href).href, cMapPacked: true };
  const w = pdfWorker(); if (w) opts.worker = w;
  return opts;
}

/* pdf-lib's copyPages() brings form fields along with the pages (their widgets and field dictionaries) but not the
   document's list of fields, the AcroForm. Without it the copy still looks like a form, but no viewer, and not
   填表單, can fill it in. Call this on a document made by copying pages: it lists the copied fields again, drops the
   parts of a field that sat on pages not copied, and takes the default font settings (DA, DR) from the sources.
   sources: the source documents, or what formDefaults() took from each (so a source need not stay open till the end). */
/* A source's default form settings (DA, DR, Q), copied into out: only from a source whose copied pages (PDFPages of
   out) carry form fields, since what is copied is written into out whether used or not. null when there is nothing. */
function formDefaults(out, src, pages) {
  const sa = src.catalog.getAcroForm(); if (!sa) return null;
  const N = k => PDFName.of(k), ctx = out.context;
  if (pages && !pages.some(p => {
    const annots = p.node.lookupMaybe(N('Annots'), PDFArray);
    return annots && annots.asArray().some(r => { const d = ctx.lookup(r); return d instanceof PDFDict && d.get(N('Subtype')) === N('Widget'); });
  })) return null;
  const copier = window.PDFLib.PDFObjectCopier.for(src.context, ctx), out2 = {};
  for (const k of ['DA', 'DR', 'Q']) { const v = sa.dict.get(N(k)); if (v) out2[k] = copier.copy(v); }
  return out2;
}
function relinkFormFields(out, sources) {
  const L = window.PDFLib, ctx = out.context, N = k => PDFName.of(k), key = r => r.toString();
  const widgets = new Set(), tops = new Map();
  for (const page of out.getPages()) {
    const annots = page.node.lookupMaybe(N('Annots'), PDFArray); if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      let ref = annots.get(i), dict = ctx.lookup(ref);
      if (!(ref instanceof L.PDFRef) || !(dict instanceof PDFDict) || dict.get(N('Subtype')) !== N('Widget')) continue;
      widgets.add(key(ref));
      for (let up = dict.get(N('Parent')); up instanceof L.PDFRef; up = dict.get(N('Parent'))) { ref = up; dict = ctx.lookup(up); }
      tops.set(key(ref), ref);
    }
  }
  if (!tops.size) return;
  const keep = ref => { // true when this field part (or something under it) is on a copied page
    const dict = ctx.lookup(ref), kids = dict instanceof PDFDict && dict.lookupMaybe(N('Kids'), PDFArray);
    if (!kids) return widgets.has(key(ref));
    const left = kids.asArray().filter(k => k instanceof L.PDFRef && keep(k));
    dict.set(N('Kids'), ctx.obj(left));
    return left.length > 0;
  };
  const fields = [...tops.values()].filter(keep);
  if (!fields.length) return;
  const acro = out.catalog.getOrCreateAcroForm();
  acro.dict.set(N('Fields'), ctx.obj(fields));
  for (const src of sources) {
    if (!src) continue;
    if (src.catalog) { // an open document: copy only what is still missing
      const sa = src.catalog.getAcroForm(); if (!sa) continue;
      const copier = L.PDFObjectCopier.for(src.context, ctx);
      for (const k of ['DA', 'DR', 'Q']) { const v = sa.dict.get(N(k)); if (v && !acro.dict.get(N(k))) acro.dict.set(N(k), copier.copy(v)); }
    } else for (const [k, v] of Object.entries(src)) if (!acro.dict.get(N(k))) acro.dict.set(N(k), v);
  }
}

/* Internal links (a table of contents, "see page 5") point at page objects, and pdf-lib's copyPages() follows them:
   it copies the page each link points at as well, content and pictures, even when that page is left out. One page
   split off a long document with a contents page would carry the whole document, and a page deleted in 編輯 would
   still be inside the exported file. So before copying, each link from the pages being copied is pointed at a marker
   instead (unlinkDests, which gives back a function that undoes this in the source); once the new document is put
   together, relinkDests points each marker at the new copy of its page, or removes the link when that page was not
   copied. A link to a named destination (what LaTeX and Word write) is turned into one to the page itself first: the
   names live in the source's catalog, which is not copied. Other references from the copied pages' annotations to
   pages left out (a form field placed on every page, a reply to a comment on another page) are cut for the copy
   too, or each would bring its whole page along. tag tells apart the source files of one new document. */
const DEST_MARK = 'papertray-dest:';
/* Where an annotation's destination lives: [dict, key] for /Dest, and for /A when it is a GoTo action → /D. */
function linkSlots(dict) {
  const N = k => PDFName.of(k), out = [[dict, 'Dest']], a = dict.lookup(N('A'));
  if (a instanceof PDFDict && a.get(N('S')) === N('GoTo')) out.push([a, 'D']);
  return out;
}
/* A named destination (a name or a string) → its destination array, from the catalog's /Dests or its /Names tree. */
function namedDest(doc, name) {
  const L = window.PDFLib, ctx = doc.context, N = k => PDFName.of(k), cat = doc.catalog;
  const key = name instanceof PDFName || name instanceof L.PDFString || name instanceof L.PDFHexString ? name.decodeText() : null;
  if (key == null) return null;
  const inTree = (node, depth) => {
    if (!(node instanceof PDFDict) || depth > 30) return null;
    const pairs = node.lookup(N('Names'));
    if (pairs instanceof PDFArray) for (let i = 0; i + 1 < pairs.size(); i += 2) {
      const k = pairs.lookup(i); if (k && k.decodeText && k.decodeText() === key) return pairs.lookup(i + 1);
    }
    const kids = node.lookup(N('Kids'));
    if (kids instanceof PDFArray) for (const k of kids.asArray()) { const r = inTree(ctx.lookup(k), depth + 1); if (r) return r; }
    return null;
  };
  const old = cat.lookup(N('Dests')), names = cat.lookup(N('Names')), tree = names instanceof PDFDict ? names.lookup(N('Dests')) : null;
  let d = (old instanceof PDFDict && old.lookup(N(key))) || inTree(tree, 0) || null;
  if (d instanceof PDFDict) d = d.lookup(N('D'));
  return d instanceof PDFArray && d.size() ? d : null;
}
/* Page index by page reference, kept per source: splitting a 1000-page file into single pages listed every page of
   it again for each new file. Sources are only read, so the list stays right while the page count does. */
const pageIndexes = new WeakMap();
function pageIndexOf(src) {
  let c = pageIndexes.get(src);
  if (!c || c.n !== src.getPageCount()) pageIndexes.set(src, c = { n: src.getPageCount(), at: new Map(src.getPages().map((p, i) => [p.ref.toString(), i])) });
  return c.at;
}
function unlinkDests(src, indices, tag) {
  const L = window.PDFLib, ctx = src.context, undo = [], N = k => PDFName.of(k);
  const pageAt = pageIndexOf(src);
  const copied = new Set(indices), seen = new Set();
  // Cuts references to pages left out, anywhere under an annotation (not into page contents or pictures).
  const cut = (holder, key, v) => {
    if (v instanceof L.PDFRef) {
      const at = pageAt.get(v.toString());
      if (at !== undefined) { if (!copied.has(at)) { holder.set(key, L.PDFNull); undo.push(() => holder.set(key, v)); } return; }
      if (seen.has(v.toString())) return;
      seen.add(v.toString()); v = ctx.lookup(v);
    }
    if (v instanceof PDFArray) for (let k = 0; k < v.size(); k++) cut(v, k, v.get(k));
    else if (v instanceof PDFDict && !(v instanceof L.PDFPageLeaf || v instanceof L.PDFPageTree || v instanceof L.PDFCatalog)) {
      for (const [k, x] of v.entries()) cut(v, k, x);
    }
  };
  for (const i of copied) {
    const annots = src.getPage(i).node.lookup(N('Annots')); if (!(annots instanceof PDFArray)) continue;
    for (const ref of annots.asArray()) {
      const a = ctx.lookup(ref); if (!(a instanceof PDFDict)) continue;
      for (const [holder, key] of linkSlots(a)) {
        const raw = holder.get(N(key)), v = ctx.lookup(raw);
        const arr = v instanceof PDFArray ? v : namedDest(src, v);
        if (!arr || !arr.size()) continue;
        const first = arr.get(0), t = first instanceof L.PDFRef ? pageAt.get(first.toString()) : undefined;
        if (t === undefined) continue;
        const mark = PDFName.of(`${DEST_MARK}${tag}:${t}`);
        if (arr === v) { arr.set(0, mark); undo.push(() => arr.set(0, first)); }
        else { holder.set(N(key), ctx.obj([mark, ...arr.asArray().slice(1)])); undo.push(() => holder.set(N(key), raw)); }
      }
      cut(annots, null, ref);
    }
  }
  return () => undo.reverse().forEach(f => f());
}
function relinkDests(out, pageFor) { // pageFor(tag, index) → the new PDFPage for that source page, or nothing
  const ctx = out.context, N = k => PDFName.of(k);
  for (const page of out.getPages()) {
    const annots = page.node.lookup(N('Annots')); if (!(annots instanceof PDFArray)) continue;
    const kept = annots.asArray().filter(ref => {
      const a = ctx.lookup(ref); if (!(a instanceof PDFDict)) return true;
      let ok = true;
      for (const [holder, key] of linkSlots(a)) {
        const arr = holder.lookup(N(key)); if (!(arr instanceof PDFArray) || !arr.size()) continue;
        const first = arr.get(0), s = first instanceof PDFName ? first.decodeText() : '';
        if (!s.startsWith(DEST_MARK)) continue;
        const [tag, idx] = s.slice(DEST_MARK.length).split(':'), target = pageFor(tag, +idx);
        if (target) arr.set(0, target.ref); else ok = false;
      }
      return ok;
    });
    if (kept.length !== annots.size()) page.node.set(N('Annots'), ctx.obj(kept));
  }
}

/* Layers (optional content): a page names the layers its content belongs to, but which layers show is set once for
   the whole document, in the catalog's /OCProperties, and copyPages() leaves that behind. Without it every layer
   shows, the hidden ones too (a CAD drawing's switched-off layers, a watermark meant only for printing). So before
   copying, markLayers(src, tag) tags each layer of a source with its place in that source's list; afterwards
   relinkLayers(out, sources) finds the copies by their tags, lists them in the new document with the sources'
   settings (which are off, their order in the layers panel …) and removes the tags. A layer copied more than once (a
   page used twice) has one copy per copyPages() call, and each copy gets the settings of the original. */
const LAYER_MARK = 'PapertrayLayer';
/* d[k] when it is a T, else null (a broken layer list must not stop the whole job). */
const lookupAs = (d, k, T) => { const v = d instanceof PDFDict ? d.lookup(PDFName.of(k)) : null; return v instanceof T ? v : null; };
function layerList(doc) {
  const props = lookupAs(doc.catalog, 'OCProperties', PDFDict);
  return { props, ocgs: lookupAs(props, 'OCGs', PDFArray) };
}
function markLayers(src, tag) {
  const { ocgs } = layerList(src); if (!ocgs) return;
  ocgs.asArray().forEach((ref, i) => {
    const d = src.context.lookup(ref);
    if (d instanceof PDFDict) d.set(PDFName.of(LAYER_MARK), window.PDFLib.PDFString.of(`${tag}:${i}`));
  });
}
function relinkLayers(out, sources) { // sources: [[tag, source PDFDocument], …]
  writeLayers(out, sources.map(([tag, src]) => layerPart(out, tag, src)));
}
/* One source's share of the new layer list, taken while the source is open (merging lets each file go once its pages
   are copied); writeLayers() puts the shares together. null when the source added no layers. */
function layerPart(out, tag, src) {
  const L = window.PDFLib, ctx = out.context, N = k => PDFName.of(k);
  const { props, ocgs } = layerList(src); if (!ocgs) return null;
  const copies = new Map(), pre = `${tag}:`; // "tag:index" → [new refs]
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const m = obj instanceof PDFDict && obj.lookup(N(LAYER_MARK)); if (!m) continue;
    const k = m.decodeText(); if (!k.startsWith(pre)) continue;
    obj.delete(N(LAYER_MARK));
    if (!copies.has(k)) copies.set(k, []); copies.get(k).push(ref);
  }
  if (!copies.size) return null;
  const all = [], off = [], order = [], extra = { RBGroups: [], Locked: [], AS: [] };
  {
    const mine = new Map(); // a source layer → its copies
    ocgs.asArray().forEach((ref, i) => { const c = copies.get(`${tag}:${i}`); if (c) mine.set(ref.toString(), c); });
    if (!mine.size) return null;
    // A part of the source's settings with its layers swapped for their copies, in the new document; layers that were
    // not copied are left out, and so is a list (or an /AS entry) left without any layer. null when nothing is left.
    const swap = (v, depth = 0) => {
      if (depth > 20) return null; // a list that loops back on itself
      if (v instanceof L.PDFRef) {
        if (mine.has(v.toString())) return mine.get(v.toString());
        const t = src.context.lookup(v);
        return t instanceof PDFArray || (t instanceof PDFDict && t.lookup(N('Type')) !== N('OCG')) ? swap(t, depth + 1) : null;
      }
      if (v instanceof PDFArray) {
        const items = v.asArray().flatMap(x => { const y = swap(x, depth + 1); return y == null ? [] : Array.isArray(y) ? y : [y]; });
        return items.some(x => !(x instanceof L.PDFString || x instanceof L.PDFHexString)) ? ctx.obj(items) : null;
      }
      if (v instanceof PDFDict) {
        const d = ctx.obj({});
        for (const [k, x] of v.entries()) {
          const y = swap(x, depth + 1);
          if (y == null) { if (k === N('OCGs')) return null; continue; }
          d.set(k, Array.isArray(y) ? ctx.obj(y) : y);
        }
        return d;
      }
      return v;
    };
    for (const c of mine.values()) all.push(...c);
    const D = lookupAs(props, 'D', PDFDict);
    const list = k => { const a = lookupAs(D, k, PDFArray); return a ? a.asArray().map(r => r.toString()) : []; };
    const baseOff = !!D && D.lookup(N('BaseState')) === N('OFF'), on = new Set(list('ON')), offs = new Set(list('OFF'));
    for (const [r, c] of mine) if (baseOff ? !on.has(r) : offs.has(r)) off.push(...c);
    const ord = lookupAs(D, 'Order', PDFArray), o = ord && swap(ord);
    if (o) order.push(...o.asArray()); else if (!ord) for (const c of mine.values()) order.push(...c);
    for (const k of Object.keys(extra)) {
      const a = lookupAs(D, k, PDFArray), s = a && swap(a);
      if (s) extra[k].push(...s.asArray());
    }
    // The first source's name, intent and list mode head the new list; kept as plain values, not the source's dict.
    const head = {};
    for (const k of ['Name', 'Intent', 'ListMode']) { const v = D && D.lookup(N(k)); if (v instanceof PDFName || v instanceof L.PDFString || v instanceof L.PDFHexString) head[k] = v; }
    return { all, off, order, extra, head };
  }
}
function writeLayers(out, parts) {
  const ctx = out.context, N = k => PDFName.of(k);
  parts = parts.filter(Boolean); if (!parts.length) return;
  const all = [], off = [], order = [], extra = { RBGroups: [], Locked: [], AS: [] };
  for (const p of parts) {
    all.push(...p.all); off.push(...p.off); order.push(...p.order);
    for (const k of Object.keys(extra)) extra[k].push(...p.extra[k]);
  }
  if (!all.length) return;
  const D = ctx.obj({ Order: ctx.obj(order) });
  for (const [k, v] of Object.entries(parts[0].head)) D.set(N(k), v);
  if (off.length) D.set(N('OFF'), ctx.obj(off));
  for (const [k, list] of Object.entries(extra)) if (list.length) D.set(N(k), ctx.obj(list));
  out.catalog.set(N('OCProperties'), ctx.obj({ OCGs: ctx.obj(all), D }));
}

/* ---------- saving files ---------- */
let downloadsNS = null;
const dlReady = (window.claude && typeof window.claude.use === 'function')
  ? window.claude.use('downloads').then(d => { downloadsNS = d; }).catch(() => {})
  : Promise.resolve();
async function saveFile(filename, bytes, mime) {
  await dlReady;
  if (bytes && bytes.lent) await bytes.lent;
  const blob = bytes instanceof Blob ? bytes : inMemory(bytes) ? new Blob([bytes.bytes], { type: bytes.type })
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

/* ---------- zip files ----------
   Several results are saved as one .zip. The files go in as they are, not compressed again (PDFs and pictures already
   are), and the archive is a Blob put together from the files' own Blobs and small headers: a Blob is read only as a
   stream, piece by piece, to compute its checksum, so not even one whole file sits in the page's memory. A zip library
   would hold the whole archive in memory, a second copy of everything, as it built it. Names are UTF-8, and a name used
   twice gets -2, -3 … before its extension. */
/* Eight tables (slicing-by-8): eight bytes per step instead of one, about four times faster on big files. */
const CRC_TABLE = (() => {
  const t = new Int32Array(256 * 8);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  for (let n = 0; n < 256; n++) for (let k = 256; k < 2048; k += 256) t[k + n] = (t[k - 256 + n] >>> 8) ^ t[t[k - 256 + n] & 255];
  return t;
})();
/* prev: the checksum of the bytes before these, to checksum a file piece by piece. */
function crc32(b, prev = 0) {
  const T = CRC_TABLE, n = b.length; let c = ~prev, i = 0;
  for (; i + 8 <= n; i += 8) {
    const a = c ^ (b[i] | b[i + 1] << 8 | b[i + 2] << 16 | b[i + 3] << 24);
    c = T[1792 + (a & 255)] ^ T[1536 + (a >>> 8 & 255)] ^ T[1280 + (a >>> 16 & 255)] ^ T[1024 + (a >>> 24)]
      ^ T[768 + b[i + 4]] ^ T[512 + b[i + 5]] ^ T[256 + b[i + 6]] ^ T[b[i + 7]];
  }
  for (; i < n; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}
async function blobCrc32(blob) {
  const r = blob.stream().getReader(); let c = 0;
  for (;;) { const { done, value } = await r.read(); if (done) return c; c = crc32(value, c); }
}
function zipWriter() {
  const parts = [], dir = [], used = new Set(); let offset = 0;
  const d = new Date(), time = d.getHours() << 11 | d.getMinutes() << 5 | d.getSeconds() >> 1;
  const date = Math.max(0, d.getFullYear() - 1980) << 9 | (d.getMonth() + 1) << 5 | d.getDate();
  // The fields a file's entry and its line in the closing list share: version, UTF-8 flag, stored, date, checksum, sizes.
  const common = (v, at, crc, size, nameLen) => {
    v.setUint16(at, 20, true); v.setUint16(at + 2, 0x0800, true); v.setUint16(at + 4, 0, true);
    v.setUint16(at + 6, time, true); v.setUint16(at + 8, date, true);
    v.setUint32(at + 10, crc, true); v.setUint32(at + 14, size, true); v.setUint32(at + 18, size, true);
    v.setUint16(at + 22, nameLen, true);
  };
  return {
    /* data: a Blob or a Uint8Array */
    async add(name, data) {
      let n = name; for (let k = 2; used.has(n); k++) n = name.replace(/(\.[^.]*)?$/, m => `-${k}${m}`);
      used.add(n);
      const isBlob = data instanceof Blob, size = isBlob ? data.size : data.length, nm = new TextEncoder().encode(n);
      if (offset + 30 + nm.length + size > 0xFFFFFFFF || dir.length >= 0xFFFF) throw new Error('檔案太多或太大，放不進一個 ZIP');
      const crc = isBlob ? await blobCrc32(data) : crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034B50, true); common(h, 4, crc, size, nm.length);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014B50, true); c.setUint16(4, 20, true); common(c, 6, crc, size, nm.length); c.setUint32(42, offset, true);
      parts.push(h.buffer, nm, isBlob ? data : new Blob([data]));
      dir.push(c.buffer, nm);
      offset += 30 + nm.length + size;
    },
    blob() {
      const size = dir.reduce((n, x) => n + x.byteLength, 0), end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054B50, true); end.setUint16(8, dir.length / 2, true); end.setUint16(10, dir.length / 2, true);
      end.setUint32(12, size, true); end.setUint32(16, offset, true);
      return new Blob([...parts, ...dir, end.buffer], { type: 'application/zip' });
    }
  };
}

/* ---------- drop + sortable ---------- */
window.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
window.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) e.preventDefault(); });
/* While a tool is working, its job still reads the files it started with: a new file put in now would be mixed into
   the result or pulled out from under it. Dropped, pasted, picked and handed-on files wait until it is done. */
function toolBusy(panel) {
  if (!panel || !panel.querySelector('.is-running')) return false;
  toast('這個工具正在處理，請等完成（或按「取消」）再放入新的檔案');
  return true;
}
function acceptFiles(area, highlight, handler) {
  const panel = area.closest('.panel'); if (panel && !panel._paste) panel._paste = handler; // Ctrl+V goes to the same place
  area.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); highlight && highlight.classList.add('is-over'); } });
  area.addEventListener('dragleave', e => { if (highlight && !area.contains(e.relatedTarget)) highlight.classList.remove('is-over'); });
  area.addEventListener('drop', e => {
    highlight && highlight.classList.remove('is-over');
    const files = [...(e.dataTransfer.files || [])];
    if (!files.length) return;
    e.preventDefault(); e.stopPropagation();
    if (!toolBusy(area.closest('.panel'))) handler(files);
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
  if (toolBusy(panel)) return;
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
  input.addEventListener('change', () => { const f = [...input.files]; input.value = ''; if (f.length && !toolBusy(input.closest('.panel'))) handler(f); });
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
    const emb = await embedCanvasImage(doc, cv); cv.width = cv.height = 0;
    const p = doc.addPage([595.28, 841.89]);
    p.drawText(i ? 'Site survey, north field' : 'Site survey, east ridge', { x: 50, y: 780, size: 22, font: bold });
    p.drawText('Photo log, scanned at 300 dpi', { x: 50, y: 756, size: 11, font, color: rgb(.4, .45, .5) });
    p.drawImage(emb, { x: 50, y: 380, width: 495, height: 353.6 });
    p.drawText(`Page ${i + 1} of 2`, { x: 262, y: 36, size: 10, font, color: rgb(.4, .45, .5) });
  }
  return doc.save();
}
const asFile = (bytes, name) => pdfFile(bytes, name);


/* ---------- page jobs: drawing the next page while finishing this one ----------
   Turning pages into pictures has two halves: drawing a page (pdf.js prepares it on its own thread, then paints on
   the page's) and finishing it (encoding a JPEG, which the browser does off the page; deflating; adding it to the
   file). Done one after the other, each half waits for the other; here page i + 1 is drawn while page i is finished.
   make(i) draws page i and gives { px (pixels), … }; use(r, i) finishes it; drop(r) frees what make() made, used or
   not. At most two drawn pages exist at once, and a page over PIPE_PX pixels is finished before the next is drawn,
   so a very large page never has a second one beside it. */
const PIPE_PX = 24e6;
async function pagePipeline(n, make, use, drop0, check) {
  const drop = r => { try { drop0(r); } catch (e) {} };
  let next = null;
  const start = i => { next = make(i); next.catch(() => {}); }; // a failure is reported when awaited, not before
  try {
    if (n) start(0);
    for (let i = 0; i < n; i++) {
      if (check) check();
      const r = await next; next = null;
      const early = i + 1 < n && !(r.px > PIPE_PX);
      try {
        if (early) start(i + 1);
        await use(r, i);
      } finally { drop(r); }
      if (!early && i + 1 < n) start(i + 1);
    }
  } finally { if (next) next.then(drop, () => {}); } // cancelled or failed: free the page drawn ahead
}

/* ---------- page thumbnails ---------- */

/* The long side of a thumbnail, in pixels. A card shows it about 130–270 CSS px tall (the grid's columns are 156 px
   and up), so 240 px per CSS px, up to 320 on sharp screens. On an ordinary screen 320 px only made each thumbnail
   kept for a long file nearly twice the bytes. */
const thumbPx = () => Math.min(320, Math.round(240 * (window.devicePixelRatio || 1)));

async function renderThumb(pg) {
  const vp1 = pg.getViewport({ scale: 1 });
  const vp = pg.getViewport({ scale: thumbPx() / Math.max(vp1.width, vp1.height) });
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
   thumbnail when it comes near the screen; at most two render at once. A card that leaves the screen before its
   turn goes back to waiting: queued for good, every card scrolled past in a 1000-page file had to be drawn before the
   ones on screen, about 16 s after scrolling to the end. */
const thumbJobs = []; let thumbBusy = 0; // the cards waiting their turn
/* Cards on the screen itself go first, the ones within 600 px of it after: in file order, scrolling up drew the cards
   above the screen before the ones being looked at. Made before thumbIO, so its news of a card arrives first. */
const onScreenIO = new IntersectionObserver(entries => {
  for (const en of entries) en.target._onScreen = en.isIntersecting;
});
const thumbIO = new IntersectionObserver(entries => {
  for (const { target: el, isIntersecting } of entries) {
    if (isIntersecting) { if (el._thumbJob && !el._queued) { el._queued = true; thumbJobs.push(el); } }
    else if (el._queued) { el._queued = false; thumbJobs.splice(thumbJobs.indexOf(el), 1); }
  }
  pumpThumbs();
}, { rootMargin: '600px 0px' });
function pumpThumbs() {
  while (thumbBusy < 2 && thumbJobs.length) {
    const at = thumbJobs.findIndex(el => el._onScreen), el = thumbJobs[at < 0 ? 0 : at], job = el._thumbJob;
    stopThumb(el);
    thumbBusy++;
    Promise.resolve().then(job).catch(() => {}).finally(() => { thumbBusy--; pumpThumbs(); });
  }
}
function whenVisible(el, job) { el._thumbJob = job; onScreenIO.observe(el); thumbIO.observe(el); }
/* A card no longer waits for its thumbnail (drawn now, or the card is going away). */
function stopThumb(el) {
  el._thumbJob = null; thumbIO.unobserve(el); onScreenIO.unobserve(el);
  if (el._queued) { el._queued = false; thumbJobs.splice(thumbJobs.indexOf(el), 1); }
}
function forgetCards(container) { container.querySelectorAll('.page-card').forEach(stopThumb); }
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
/* A HEIC photo renamed to .jpg is still HEIC, which most browsers cannot open: its first bytes tell. */
async function looksHeic(f) {
  if (isPdf(f) || !isImage(f)) return false;
  try {
    const b = new Uint8Array(await f.slice(0, 12).arrayBuffer());
    return /^ftyp(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)$/.test(String.fromCharCode(...b.subarray(4, 12)));
  } catch (e) { return false; }
}
/* A picture's size as shown (EXIF rotation applied, like createImageBitmap), without decoding its pixels: a 48 MP
   photo would otherwise take about 190 MB, just to read two numbers. */
function imageSize(f) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(f), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法讀取圖片')); };
    img.src = url;
  });
}
/* A small picture for a file-list row (44 px, 2× for sharp screens), as a Blob URL. Showing the photo itself there
   would keep it decoded at full size, about 48 MB for each 12 MP photo in the list. pic: an ImageBitmap or canvas. */
async function listThumb(pic, px = 96) {
  const k = Math.min(1, px / Math.min(pic.width, pic.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(pic.width * k)); c.height = Math.max(1, Math.round(pic.height * k));
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(pic, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/png')); c.width = c.height = 0;
  return URL.createObjectURL(blob);
}
/* iPhone photos (HEIC) become JPEG before any tool sees them. Safari can decode HEIC itself; other browsers
   use heic2any, loaded the first time it is needed. Other files pass through untouched. */
async function prepImages(files) {
  const out = [];
  for (const f of files) {
    if (!isHeic(f) && !(await looksHeic(f))) { out.push(f); continue; }
    const name = f.name.replace(/\.[^.]+$/, '') + '.jpg';
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
/* One A4 page per picture (10 mm margin, turned to match the picture), for tools that work on PDFs. A JPEG or PNG that
   needs no turning goes in as it is (directKind() in img2pdf.js), like in 圖片轉 PDF: decoding a 12 MP photo and
   encoding it again took about 0.3 s and 48 MB, and lost a little quality each time. Other pictures are drawn as the
   browser shows them. */
async function imagesToPdf(files, name) {
  const out = await PDFDocument.create();
  for (const f of files) {
    const buf = await f.arrayBuffer(), kind = directKind(buf);
    if (kind !== 'other') await imageSize(f); // a broken picture is refused here, as when it was decoded
    let img = null;
    try {
      if (kind === 'jpg') img = await out.embedJpg(new Uint8Array(buf));
      // Only the PNGs embedPngFast() reads itself: pdf-lib can hang on a broken one of the other kinds.
      else if (kind === 'png') img = await embedPngFast(out, new Uint8Array(buf), false);
    } catch (e) { img = null; } // pdf-lib cannot read this JPEG's header: the browser decodes it below
    if (!img) {
      const bmp = await createImageBitmap(f); // applies the photo's rotation (EXIF)
      const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(bmp, 0, 0); bmp.close && bmp.close();
      if (f.type === 'image/png' || /\.png$/i.test(f.name)) img = await embedCanvasImage(out, cv); // lossless, like the PNG it was
      else {
        const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .92));
        img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      }
      cv.width = cv.height = 0;
    }
    const w = img.width, h = img.height;
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
   The editor's files belong to 編輯 and 簽名 alike, so those two count as one place. */
const HOLDERS = [];
function registerHolder(tab, size, release) { HOLDERS.push({ tab, size, release }); }
const MEM_NOTE_MIN = 50 * 1048576;
const memGroup = t => t === 'sign' ? 'edit' : t;
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
  // NFKC turns what a Chinese input method types (１－３，５) into 1-3,5.
  // Spaces around a dash belong to the range: "1 - 3" is 1-3 (and "1 -3" must not become page 1 plus 1-3).
  const toks = String(text || '').normalize('NFKC').replace(/\s*([-–~])\s*/g, '$1').split(/[,，、;；\s]+/).filter(Boolean);
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


/* The part of a pdf-lib page that is shown, [x0, y0, x1, y1]: its crop box within its media box. Viewers (and pdf.js,
   whose page.view is the same box) show only where the two overlap; getCropBox() gives the crop box as written,
   which can reach past the paper. */
function visibleBox(page) {
  const box = b => [Math.min(b.x, b.x + b.width), Math.min(b.y, b.y + b.height), Math.max(b.x, b.x + b.width), Math.max(b.y, b.y + b.height)];
  const m = box(page.getMediaBox()), c = box(page.getCropBox());
  const v = [Math.max(m[0], c[0]), Math.max(m[1], c[1]), Math.min(m[2], c[2]), Math.min(m[3], c[3])];
  return v[2] > v[0] && v[3] > v[1] ? v : m;
}
/* Where a text run starts, measured along the direction of the run `dir` (x) and across it (y), both transforms as
   pdf.js gives them ([a b c d e f]). For text as usually set this is just (e, f); for a line running down or up the
   page it still gives x along the line and y from line to line. */
function textAxes(tr, dir) {
  const n = Math.hypot(dir[0], dir[1]) || 1, ux = dir[0] / n, uy = dir[1] / n;
  return { x: tr[4] * ux + tr[5] * uy, y: tr[5] * ux - tr[4] * uy };
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
/* Waits for a web font, but not for long: when the network drops the request instead of refusing it, the font never
   arrives and the job would hang. The system font is drawn instead. */
function loadFont(font, text, ms = 3000) {
  return Promise.race([Promise.resolve().then(() => document.fonts.load(font, text)).catch(() => {}), new Promise(r => setTimeout(r, ms))]);
}
const ensureFont = (text, size) => loadFont(fontStr(size || 16), text);
function measureAnnot(a) {
  mctx.font = fontStr(a.size);
  const lines = a.text.split('\n');
  const w = Math.max(...lines.map(l => mctx.measureText(l).width));
  a.wPt = Math.max(w, a.size * .5) + 2; a.hPt = lines.length * a.size * LH;
}
/* A canvas put into doc as a picture, the same objects embedPng() makes of a PNG of it (colour, and the transparency
   as a soft mask), without first encoding that PNG and having pdf-lib decode it again: a form with 600 filled
   fields, each its own picture, spent most of its export doing that. Gives the picture's reference. */
function embedCanvas(doc, cv) {
  return embedPixels(doc, cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, cv.width, 0, 0, cv.width, cv.height);
}
/* Only the part of a canvas with something on it: { ref, x0, y0, x1, y1 } (that part, in canvas pixels), or null for
   a blank canvas. A filled form field's picture is mostly empty box, and that emptiness cost as much as the text. */
function embedCanvasInk(doc, cv) {
  const W = cv.width, H = cv.height, px = cv.getContext('2d').getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0, j = y * W * 4 + 3; x < W; x++, j += 4) {
    if (px[j]) { if (x < x0) x0 = x; if (x >= x1) x1 = x + 1; if (y < y0) y0 = y; y1 = y + 1; }
  }
  return x1 > x0 ? { ref: embedPixels(doc, px, W, x0, y0, x1, y1), x0, y0, x1, y1 } : null;
}
function embedPixels(doc, px, W, x0, y0, x1, y1) {
  const ctx = doc.context, w = x1 - x0, h = y1 - y0, rgb = new Uint8Array(w * h * 3), alpha = new Uint8Array(w * h);
  let see = false;
  for (let y = y0, i = 0, o = 0; y < y1; y++) for (let j = (y * W + x0) * 4, end = j + w * 4; j < end; j += 4, i++, o += 3) {
    rgb[o] = px[j]; rgb[o + 1] = px[j + 1]; rgb[o + 2] = px[j + 2];
    if ((alpha[i] = px[j + 3]) < 255) see = true;
  }
  const img = { Type: 'XObject', Subtype: 'Image', BitsPerComponent: 8, Width: w, Height: h, ColorSpace: 'DeviceRGB' };
  if (see) img.SMask = ctx.register(ctx.flateStream(alpha, { Type: 'XObject', Subtype: 'Image', Height: h, Width: w, BitsPerComponent: 8, ColorSpace: 'DeviceGray', Decode: [0, 1] }));
  return ctx.register(ctx.flateStream(rgb, img));
}
/* zlib streams by the browser's own code. pdf-lib's (pako, in JavaScript) took about 3 s for one 12 MP picture. */
const zstream = (bytes, ts) => new Blob([bytes]).stream().pipeThrough(ts);
async function deflate(bytes) { return new Uint8Array(await new Response(zstream(bytes, new CompressionStream('deflate'))).arrayBuffer()); }
async function inflate(bytes) { return new Uint8Array(await new Response(zstream(bytes, new DecompressionStream('deflate'))).arrayBuffer()); }
/* How many bytes a zlib stream inflates to, without keeping them; throws when the stream is broken. */
async function inflatedSize(bytes) {
  const r = zstream(bytes, new DecompressionStream('deflate')).getReader(); let n = 0;
  for (;;) { const { done, value } = await r.read(); if (done) return n; n += value.length; }
}
/* A pdf-lib PDFImage (what page.drawImage() takes) for an image already in doc under ref. */
function pdfImageAt(doc, ref, width, height) {
  const L = window.PDFLib, e = Object.create(L.PngEmbedder.prototype); // PDFImage accepts only pdf-lib's own embedders
  Object.assign(e, { width, height, embedIntoContext: async () => ref });
  const img = L.PDFImage.of(ref, doc, e); doc.images.push(img);
  return img;
}
/* One plane of an image (colour, or alpha) deflated row by row as the rows come, so the whole plane never sits in
   memory. Each row goes in with PNG's "Up" filter (the row minus the one above), which PDF undoes (Predictor 15):
   a photo deflates to about half the size, and faster, than its plain pixels. add(row) copies the row; now and then,
   when a batch of rows goes to the compressor, it gives a promise that must settle before the next add(): the
   batch's buffer is used again, and the compressor has taken its bytes once its write is done. */
function planeWriter(rowLen) {
  const cs = new CompressionStream('deflate'), out = new Response(cs.readable).arrayBuffer(), wr = cs.writable.getWriter();
  out.catch(() => {}); // a failure reaches done()
  const per = rowLen + 1, batch = Math.max(1, Math.floor((1 << 20) / per)), prev = new Uint8Array(rowLen);
  const buf = new Uint8Array(batch * per); let n = 0;
  const flush = () => { const chunk = buf.subarray(0, n * per); n = 0; return wr.write(chunk); };
  return {
    add(row) {
      const o = n * per; buf[o] = 2;
      for (let i = 0; i < rowLen; i++) buf[o + 1 + i] = row[i] - prev[i];
      prev.set(row);
      if (++n === batch) return flush();
    },
    async done() { if (n) await flush(); await wr.close(); return new Uint8Array(await out); },
    abort() { wr.abort().catch(() => {}); }
  };
}
/* Rows of pixels with an alpha channel (grey+alpha when comps is 1, RGBA when 3) split into a colour plane and an
   alpha plane, each deflated as it comes (planeWriter). finish(doc) puts the picture into doc, with the alpha as a
   soft mask only when some pixel is not opaque, as pdf-lib's embedPng() does, and gives its PDFImage. */
function planeSplitter(w, h, comps) {
  const cz = planeWriter(w * comps), az = planeWriter(w), crow = new Uint8Array(w * comps), arow = new Uint8Array(w);
  let see = false;
  return {
    row(px, at) { // px[at …]: one row, comps + 1 bytes a pixel
      if (comps === 3) for (let x = 0, j = at, o = 0; x < w; x++, j += 4, o += 3) {
        crow[o] = px[j]; crow[o + 1] = px[j + 1]; crow[o + 2] = px[j + 2]; if ((arow[x] = px[j + 3]) < 255) see = true;
      } else for (let x = 0, j = at; x < w; x++, j += 2) { crow[x] = px[j]; if ((arow[x] = px[j + 1]) < 255) see = true; }
      const p = cz.add(crow), q = az.add(arow);
      return p || q ? Promise.all([p, q]) : null;
    },
    async finish(doc) {
      const [c, a] = await Promise.all([cz.done(), az.done()]), ctx = doc.context, ref = ctx.nextRef();
      const pred = cols => ({ Predictor: 15, Colors: cols, BitsPerComponent: 8, Columns: w });
      const img = { Type: 'XObject', Subtype: 'Image', BitsPerComponent: 8, Width: w, Height: h, ColorSpace: comps === 1 ? 'DeviceGray' : 'DeviceRGB',
        Filter: 'FlateDecode', DecodeParms: pred(comps) };
      if (see) img.SMask = ctx.register(ctx.stream(a, { Type: 'XObject', Subtype: 'Image', Height: h, Width: w, BitsPerComponent: 8,
        ColorSpace: 'DeviceGray', Decode: [0, 1], Filter: 'FlateDecode', DecodeParms: pred(1) }));
      ctx.assign(ref, ctx.stream(c, img));
      return pdfImageAt(doc, ref, w, h);
    },
    abort() { cz.abort(); az.abort(); }
  };
}
/* A canvas as a picture in doc (a PDFImage), lossless, like embedPng() of a PNG of it but without encoding that PNG
   and having pdf-lib decode it again. Colours of half-transparent pixels can differ from the PNG's by 1 (rounding). */
async function embedCanvasImage(doc, cv) {
  const W = cv.width, H = cv.height, sp = planeSplitter(W, H, 3), ctx = cv.getContext('2d');
  try {
    // A band of rows at a time: the whole picture read out at once would be a second copy of it.
    for (let y0 = 0, band = Math.max(1, Math.floor(4e6 / (W * 4))); y0 < H; y0 += band) {
      const n = Math.min(band, H - y0), px = ctx.getImageData(0, y0, W, n).data;
      for (let y = 0; y < n; y++) { const p = sp.row(px, y * W * 4); if (p) await p; }
    }
    return await sp.finish(doc);
  } catch (e) { sp.abort(); throw e; }
}
/* PNG filters undone on one row (cur gets the pixels; prev is the row above, zeros for the first). */
function unfilterRow(ft, raw, at, cur, prev, stride, bpp) {
  let i = 0;
  switch (ft) {
    case 0: cur.set(raw.subarray(at, at + stride)); return true;
    case 1: for (; i < bpp; i++) cur[i] = raw[at + i]; for (; i < stride; i++) cur[i] = raw[at + i] + cur[i - bpp]; return true;
    case 2: for (; i < stride; i++) cur[i] = raw[at + i] + prev[i]; return true;
    case 3: for (; i < bpp; i++) cur[i] = raw[at + i] + (prev[i] >> 1); for (; i < stride; i++) cur[i] = raw[at + i] + ((cur[i - bpp] + prev[i]) >> 1); return true;
    case 4:
      for (; i < bpp; i++) cur[i] = raw[at + i] + prev[i];
      for (; i < stride; i++) {
        const a = cur[i - bpp], b = prev[i], c = prev[i - bpp], p = a + b - c;
        const pa = p > a ? p - a : a - p, pb = p > b ? p - b : b - p, pc = p > c ? p - c : c - p;
        cur[i] = raw[at + i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      return true;
  }
  return false;
}
/* A PNG put into doc with the same pixels as doc.embedPng(), only faster and smaller. pdf-lib decodes the whole
   picture in JavaScript and deflates it again with pako: about 3 s for a 12 MP photo, 0.2 s for a screenshot.
   - 8-bit grey or RGB without transparency: the PNG's own compressed data goes in as it is. PDF decodes it with the
     same row filters (the PNG predictors), so nothing is decoded or compressed at all; it is only checked to inflate
     to the right size.
   - 8-bit grey or RGB with an alpha channel: inflated by the browser's zlib a piece at a time, each row unfiltered
     and split into colour and alpha (planeSplitter).
   Any other kind of PNG (palette, 16-bit, fewer bits, interlaced, a tRNS colour key) goes to pdf-lib as before. Pixel
   data that turns out broken goes to the browser's decoder, which draws what it can: pdf-lib's never returns on some
   broken files (the page hangs). */
async function embedPngFast(doc, bytes, viaPdfLib = true) { // viaPdfLib false: null for those other kinds
  const p = pngLayout(bytes);
  if (!p) return viaPdfLib ? doc.embedPng(bytes) : null;
  try {
    const { w, h, ct, idat } = p, comps = ct === 0 || ct === 4 ? 1 : 3;
    if (ct === 0 || ct === 2) {
      if (await inflatedSize(idat) !== (w * comps + 1) * h) throw new Error('size');
      const ctx = doc.context, ref = ctx.nextRef();
      ctx.assign(ref, ctx.stream(idat, { Type: 'XObject', Subtype: 'Image', BitsPerComponent: 8, Width: w, Height: h,
        ColorSpace: comps === 1 ? 'DeviceGray' : 'DeviceRGB', Filter: 'FlateDecode',
        DecodeParms: { Predictor: 15, Colors: comps, BitsPerComponent: 8, Columns: w } }));
      return pdfImageAt(doc, ref, w, h);
    }
    return await embedPngRows(doc, p);
  } catch (e) {
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { colorSpaceConversion: 'none' });
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    cv.getContext('2d').drawImage(bmp, 0, 0); bmp.close && bmp.close();
    try { return await embedCanvasImage(doc, cv); } finally { cv.width = cv.height = 0; }
  }
}
async function embedPngRows(doc, { w, h, ct, idat }) {
  const comps = ct === 4 ? 1 : 3, bpp = comps + 1, stride = w * bpp, per = stride + 1;
  const sp = planeSplitter(w, h, comps), r = zstream(idat, new DecompressionStream('deflate')).getReader();
  let cur = new Uint8Array(stride), prev = new Uint8Array(stride), fill = 0, y = 0;
  const row = new Uint8Array(per);
  try {
    for (;;) {
      const { done, value } = await r.read(); if (done) break;
      for (let i = 0; i < value.length;) {
        const k = Math.min(per - fill, value.length - i);
        row.set(value.subarray(i, i + k), fill); fill += k; i += k;
        if (fill < per) break;
        fill = 0;
        if (y >= h || !unfilterRow(row[0], row, 1, cur, prev, stride, bpp)) throw new Error('png');
        const wait = sp.row(cur, 0); if (wait) await wait;
        [cur, prev] = [prev, cur]; y++;
      }
    }
    if (y !== h || fill) throw new Error('size');
    return await sp.finish(doc);
  } catch (e) { sp.abort(); r.cancel().catch(() => {}); throw e; }
}
/* The parts of a PNG that embedPngFast() can use: { w, h, ct (colour type 0, 2, 4 or 6), idat (the compressed
   pixels) }, or null for any other kind of PNG. */
function pngLayout(b) {
  if (!(b instanceof Uint8Array) || b.length < 45 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4E || b[3] !== 0x47) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength), parts = [];
  let w = 0, h = 0, ct = 0, ok = false, total = 0;
  for (let o = 8; o + 12 <= b.length;) {
    const len = v.getUint32(o), type = v.getUint32(o + 4), at = o + 8;
    if (at + len + 4 > b.length) return null;
    if (type === 0x49484452) { // IHDR: 8 bits, grey / RGB / grey+alpha / RGBA, standard compression and filters, not interlaced
      w = v.getUint32(at); h = v.getUint32(at + 4); ct = b[at + 9];
      ok = b[at + 8] === 8 && [0, 2, 4, 6].includes(ct) && !b[at + 10] && !b[at + 11] && !b[at + 12];
      if (!ok) return null;
    } else if (type === 0x74524E53) return null; // tRNS: a colour that stands for transparent
    else if (type === 0x49444154) { parts.push(b.subarray(at, at + len)); total += len; }
    else if (type === 0x49454E44) break; // IEND
    o = at + len + 4;
  }
  if (!ok || !w || !h || !parts.length || w * h > 1e8) return null;
  // A copy: the stream must not share the caller's buffer (which may be handed on or let go).
  const idat = new Uint8Array(total); let o = 0;
  for (const p of parts) { idat.set(p, o); o += p.length; }
  return { w, h, ct, idat };
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
