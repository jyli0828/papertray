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
   parts of a field that sat on pages not copied, and takes the default font settings (DA, DR) from the sources. */
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
    const sa = src.catalog.getAcroForm(); if (!sa) continue;
    const copier = L.PDFObjectCopier.for(src.context, ctx);
    for (const k of ['DA', 'DR', 'Q']) { const v = sa.dict.get(N(k)); if (v && !acro.dict.get(N(k))) acro.dict.set(N(k), copier.copy(v)); }
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
function unlinkDests(src, indices, tag) {
  const L = window.PDFLib, ctx = src.context, undo = [], N = k => PDFName.of(k);
  const pageAt = new Map(src.getPages().map((p, i) => [p.ref.toString(), i]));
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
  const L = window.PDFLib, ctx = out.context, N = k => PDFName.of(k), copies = new Map(); // "tag:index" → [new refs]
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const m = obj instanceof PDFDict && obj.lookup(N(LAYER_MARK)); if (!m) continue;
    obj.delete(N(LAYER_MARK));
    const k = m.decodeText(); if (!copies.has(k)) copies.set(k, []); copies.get(k).push(ref);
  }
  if (!copies.size) return;
  const all = [], off = [], order = [], extra = { RBGroups: [], Locked: [], AS: [] };
  let first = null;
  for (const [tag, src] of sources) {
    const { props, ocgs } = layerList(src); if (!ocgs) continue;
    const mine = new Map(); // a source layer → its copies
    ocgs.asArray().forEach((ref, i) => { const c = copies.get(`${tag}:${i}`); if (c) mine.set(ref.toString(), c); });
    if (!mine.size) continue;
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
    if (!first) first = D;
    const list = k => { const a = lookupAs(D, k, PDFArray); return a ? a.asArray().map(r => r.toString()) : []; };
    const baseOff = !!D && D.lookup(N('BaseState')) === N('OFF'), on = new Set(list('ON')), offs = new Set(list('OFF'));
    for (const [r, c] of mine) if (baseOff ? !on.has(r) : offs.has(r)) off.push(...c);
    const ord = lookupAs(D, 'Order', PDFArray), o = ord && swap(ord);
    if (o) order.push(...o.asArray()); else if (!ord) for (const c of mine.values()) order.push(...c);
    for (const k of Object.keys(extra)) {
      const a = lookupAs(D, k, PDFArray), s = a && swap(a);
      if (s) extra[k].push(...s.asArray());
    }
  }
  if (!all.length) return;
  const D = ctx.obj({ Order: ctx.obj(order) });
  for (const k of ['Name', 'Intent', 'ListMode']) { const v = first && first.lookup(N(k)); if (v instanceof PDFName || v instanceof L.PDFString || v instanceof L.PDFHexString) D.set(N(k), v); }
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
