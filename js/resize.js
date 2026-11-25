'use strict';
/* ================= RESIZE =================
   fit:  every page goes onto a new page of one paper size; the original page is embedded as vector content
         (text stays selectable), scaled and centred. Links and form fields of the original page are not carried over.
   crop: render each page small, find where the ink is, and set the crop box around it. Nothing is re-drawn. */
const PAPERS = { a4: [595.28, 841.89], a3: [841.89, 1190.55], a5: [419.53, 595.28], b5: [515.91, 728.5], letter: [612, 792], legal: [612, 1008] };
/* src: the file itself (on disk for a picked file), read again when the job runs */
const rs = { name: '', src: null, size: 0, n: 0, mode: 'fit', first: [595.28, 841.89] };
const pageDisp = page => {
  const view = visibleBox(page), R = ((page.getRotation().angle % 360) + 360) % 360;
  const cb = { x: view[0], y: view[1], width: view[2] - view[0], height: view[3] - view[1] };
  return { cb, R, view, dims: R % 180 ? [cb.height, cb.width] : [cb.width, cb.height] };
};
async function loadResize(files) {
  const f = files[0];
  if (!isPdf(f)) { toast(`「${f.name}」不是 PDF 檔`, 'err'); return; }
  const got = await readPdf(f); if (!got) return; // a password-protected file is unlocked here first
  const { bytes } = got;
  let doc;
  try { doc = await PDFDocument.load(bytes); } catch (e) { toast(loadErr(f.name, e), 'err'); return; }
  const src = keepFile(f, got);
  const counts = new Map();
  doc.getPages().forEach((pg, i) => {
    const [w, h] = pageDisp(pg).dims;
    if (i === 0) rs.first = [w, h];
    const key = paperName(w, h) + (w > h ? ' 橫' : '');
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  Object.assign(rs, { name: f.name, src, size: bytes.length, n: doc.getPageCount() });
  $('#rs-fname').textContent = f.name;
  $('#rs-fmeta').textContent = `${rs.n} 頁 · ${fmtSize(bytes.length)} · ` + [...counts].map(([k, v]) => `${k} ×${v}`).join('、');
  $('#rs-name').value = baseName(f.name) + '-調整尺寸.pdf';
  $('#rs-empty').hidden = true; $('#rs-work').hidden = false; $('#rs-progress').hidden = true;
  updateRsSummary();
}
function setRsMode(m) {
  rs.mode = m;
  $('#rs-m-fit').setAttribute('aria-pressed', m === 'fit'); $('#rs-m-crop').setAttribute('aria-pressed', m === 'crop');
  $('#rs-fit-opts').hidden = m !== 'fit'; $('#rs-crop-opts').hidden = m !== 'crop';
  $('#rs-note').textContent = m === 'fit'
    ? '內容以原本的向量形式放進新頁面，文字仍可選取；原頁面上的超連結和表單欄位不會保留。'
    : '找出每頁有內容的範圍，把四周的空白裁掉。只改變顯示範圍，內容本身不變；全白的頁面會保持原樣。';
  updateRsSummary();
}
$('#rs-m-fit').addEventListener('click', () => setRsMode('fit'));
$('#rs-m-crop').addEventListener('click', () => setRsMode('crop'));
['#rs-size', '#rs-orient', '#rs-scale', '#rs-margin', '#rs-pad'].forEach(s => $(s).addEventListener('change', updateRsSummary));
function rsTarget() { return $('#rs-size').value === 'first' ? rs.first.slice() : PAPERS[$('#rs-size').value].slice(); }
function updateRsSummary() {
  if (!rs.src) return;
  if (rs.mode === 'crop') { $('#rs-summary').textContent = `會裁切 ${rs.n} 頁的白邊`; return; }
  const [w, h] = rsTarget();
  $('#rs-summary').textContent = `${rs.n} 頁都改成 ${paperName(w, h)}（${Math.round(w * 25.4 / 72)} × ${Math.round(h * 25.4 / 72)} mm）`;
}
setRsMode('fit');
function rsProgress(i, n) {
  $('#rs-progress').hidden = false;
  $('#rs-bar').style.width = (i / n * 100) + '%';
  $('#rs-plabel').textContent = i < n ? `處理第 ${i + 1} / ${n} 頁` : `完成 ${n} 頁`;
}
/* A page of another document as a picture-like object in out (a Form XObject, which page.drawPage() draws), the box
   cb of it showing: what out.embedPage() makes, without three costs of it.
   - embedPage() copies each page with a copier of its own, so the pictures and fonts the pages share were copied once
     per page: a 266 KB file of 200 pages came out 4.8 MB. Here one copier serves every page.
   - It copies the whole page, so the page's content went into the file twice (the copy unused), along with its links
     (a link to another page brings that page too), form fields and thumbnail. Only the resources are copied here.
   - It inflates the content and deflates it again with pako. A page whose content is one stream (most) keeps that
     stream's bytes and filters as they are; several are joined, as pdf-lib does, and deflated by the browser. */
async function embedPageForm(out, copier, page, cb) {
  const L = window.PDFLib, N = k => PDFName.of(k), sctx = page.doc.context;
  const { Contents, Resources } = page.node.normalizedEntries(); // Resources inherited from the page tree included
  const dict = { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [cb.x, cb.y, cb.x + cb.width, cb.y + cb.height],
    // The resources on their own (a reference): a stream's dictionary is written out plain, while an object of its own
    // goes into a compressed object stream.
    Matrix: [1, 0, 0, 1, -cb.x, -cb.y], Resources: out.context.register(Resources ? copier.copy(Resources) : out.context.obj({})) };
  const parts = Contents ? Contents.asArray().map(r => sctx.lookup(r)).filter(s => s instanceof L.PDFStream) : [];
  let stream;
  if (parts.length === 1 && parts[0] instanceof PDFRawStream) {
    const s = parts[0];
    for (const k of ['Filter', 'DecodeParms']) { const v = s.dict.get(N(k)); if (v) dict[k] = copier.copy(v); }
    stream = out.context.stream(s.contents, dict);
  } else { // several pieces, or none (a blank page)
    const pieces = parts.map(s => s instanceof PDFRawStream ? L.decodePDFRawStream(s).decode() : s.getUnencodedContents());
    const all = new Uint8Array(pieces.reduce((n, p) => n + p.length + 1, 0)); let o = 0;
    for (const p of pieces) { all.set(p, o); o += p.length; all[o++] = 10; }
    dict.Filter = 'FlateDecode';
    stream = out.context.stream(await deflate(all), dict);
  }
  const ref = out.context.register(stream), w = cb.width, h = cb.height;
  // PDFEmbeddedPage accepts only pdf-lib's own embedder; this one has nothing left to do.
  const e = Object.assign(Object.create(L.PDFPageEmbedder.prototype), { width: w, height: h, embedIntoContext: async () => ref });
  return L.PDFEmbeddedPage.of(ref, out, e);
}
async function resizeFit(check, o) {
  const src = await PDFDocument.load((await fileBytes(rs.src)).bytes), out = await PDFDocument.create();
  markLayers(src, 'r'); // see relinkLayers() in core.js
  const { orient, scaleMode, m } = o;
  const pages = src.getPages(), copier = PDFLib.PDFObjectCopier.for(src.context, out.context);
  for (let i = 0; i < pages.length; i++) {
    check(); rsProgress(i, pages.length);
    const { cb, R, dims: [dw, dh] } = pageDisp(pages[i]), emb = await embedPageForm(out, copier, pages[i], cb);
    let [TW, TH] = o.target;
    const land = orient === 'landscape' || (orient === 'auto' && dw > dh);
    if (land !== TW > TH) [TW, TH] = [TH, TW];
    let s = Math.min((TW - 2 * m) / dw, (TH - 2 * m) / dh);
    if (scaleMode === 'shrink') s = Math.min(1, s); else if (scaleMode === 'none') s = 1;
    // Undo the page's own rotation so the content looks the same as before, then centre its rotated box.
    const theta = -R * Math.PI / 180, c = Math.cos(theta), sn = Math.sin(theta);
    const w = cb.width * s, h = cb.height * s;
    const xs = [0, w * c, w * c - h * sn, -h * sn], ys = [0, w * sn, w * sn + h * c, h * c];
    const x = TW / 2 - (Math.min(...xs) + Math.max(...xs)) / 2, y = TH / 2 - (Math.min(...ys) + Math.max(...ys)) / 2;
    out.addPage([TW, TH]).drawPage(emb, { x, y, xScale: s, yScale: s, rotate: degrees(-R) });
  }
  rsProgress(pages.length, pages.length);
  relinkLayers(out, [['r', src]]); // hidden layers stay hidden
  return out.save({ useObjectStreams: true });
}
/* Where the ink is on a page drawn as RGBA pixels: [x0, y0, x1, y1] (inclusive), or null for a blank page. Rows are
   read from the top and the bottom until one has ink, then each row in between only as far in as the box so far:
   on a page with text the margins are read, not every pixel. */
function inkBox(d, W, H) {
  const ink = o => d[o] < 240 || d[o + 1] < 240 || d[o + 2] < 240;
  const rowHasInk = y => { for (let o = y * W * 4, end = o + W * 4; o < end; o += 4) if (ink(o)) return true; return false; };
  let y0 = 0; while (y0 < H && !rowHasInk(y0)) y0++;
  if (y0 === H) return null;
  let y1 = H - 1; while (y1 > y0 && !rowHasInk(y1)) y1--;
  let x0 = W, x1 = -1;
  for (let y = y0; y <= y1; y++) {
    const r = y * W * 4;
    for (let x = 0; x < x0; x++) if (ink(r + x * 4)) { x0 = x; break; }
    for (let x = W - 1; x > x1; x--) if (ink(r + x * 4)) { x1 = x; break; }
  }
  return [x0, y0, x1, y1];
}
async function resizeCrop(check, o) {
  const { bytes } = await fileBytes(rs.src);
  const opening = openPdfjs(bytes); // both libraries read the file at the same time
  let doc;
  try { doc = await PDFDocument.load(bytes); } catch (e) { opening.then(pj => pj.destroy(), () => {}); throw e; }
  const pj = await opening;
  const pad = o.pad, n = pj.numPages;
  let cropped = 0;
  try {
    // Page i+1 is drawn while page i is read (see pagePipeline() in core.js).
    await pagePipeline(n, async i => {
      const pg = await pj.getPage(i + 1), vp1 = pg.getViewport({ scale: 1 });
      const k = Math.min(2, 700 / Math.max(vp1.width, vp1.height)), vp = pg.getViewport({ scale: k });
      const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      const r = { pg, cv, k, px: cv.width * cv.height };
      try {
        // An ordinary (graphics card) canvas, though its pixels are read once: drawn on the processor instead
        // (willReadFrequently), reading them took 13 ms a page, since the browser draws only when they are read; 200
        // pages took 6.3 s instead of 4.7. Faint, thin lines come out a little differently, so a box can move by 1–2 pt.
        const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      } catch (e) { pg.cleanup(); cv.width = cv.height = 0; throw e; }
      return r;
    }, ({ cv, k }, i) => {
      rsProgress(i, n);
      const box = inkBox(cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
      if (!box) return; // blank page
      const [x0, y0, x1, y1] = box;
      const page = doc.getPage(i), { view, R, dims: [dw, dh] } = pageDisp(page);
      const L = Math.max(0, x0 / k - pad), T = Math.max(0, y0 / k - pad), Rt = Math.min(dw, (x1 + 1) / k + pad), B = Math.min(dh, (y1 + 1) / k + pad);
      if (L < 1 && T < 1 && Rt > dw - 1 && B > dh - 1) return; // nothing to trim
      const [ax, ay] = displayToUser(view, R, L, T), [bx, by] = displayToUser(view, R, Rt, B);
      page.setCropBox(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      cropped++;
    }, ({ pg, cv }) => { pg.cleanup(); cv.width = cv.height = 0; }, check);
    rsProgress(n, n);
  } finally { pj.destroy(); }
  return { bytes: await doc.save({ useObjectStreams: true }), cropped };
}
$('#rs-go').addEventListener('click', e => runJob(e.currentTarget, '處理中…', async check => {
  // The settings as they are now: changing one while this runs must not reach only some of the pages.
  const o = { mode: rs.mode, target: rsTarget(), orient: $('#rs-orient').value, scaleMode: $('#rs-scale').value,
    m: +$('#rs-margin').value, pad: +$('#rs-pad').value }, name = ensurePdf($('#rs-name').value);
  let bytes;
  if (o.mode === 'fit') bytes = await resizeFit(check, o);
  else {
    const r = await resizeCrop(check, o); bytes = r.bytes;
    toast(r.cropped ? `裁掉了 ${r.cropped} 頁的白邊` : '沒有找到可以裁掉的白邊');
  }
  await deliver(pdfFile(bytes, name), 'pdf', 'resize');
}).catch(err => toast('處理失敗：' + err.message, 'err')));
bindInput($('#rs-input'), loadResize);
acceptFiles($('#panel-resize'), $('#rs-drop'), loadResize);
registerTarget('pdf', 'resize', '調整尺寸', loadResize);
$('#rs-change').addEventListener('click', () => $('#rs-input').click());
$('#rs-sample').addEventListener('click', async () => {
  // Three pages of different sizes with generous margins, so both modes have something to do.
  const doc = await PDFDocument.create(), bold = await doc.embedFont(StandardFonts.HelveticaBold), font = await doc.embedFont(StandardFonts.Helvetica);
  const specs = [['A4 portrait', 595.28, 841.89], ['US Letter', 612, 792], ['A5 landscape', 595.28, 419.53]];
  for (const [label, w, h] of specs) {
    const p = doc.addPage([w, h]);
    const bx = w * .22, by = h * .25, bw = w * .56, bh = h * .5;
    p.drawRectangle({ x: bx, y: by, width: bw, height: bh, color: rgb(.93, .96, .95), borderColor: rgb(.04, .48, .42), borderWidth: 1.5 });
    p.drawText(label, { x: bx + 16, y: by + bh - 36, size: 20, font: bold, color: rgb(.1, .13, .17) });
    p.drawText(`${Math.round(w * 25.4 / 72)} x ${Math.round(h * 25.4 / 72)} mm`, { x: bx + 16, y: by + bh - 58, size: 11, font, color: rgb(.4, .45, .5) });
    for (let k = 0; k < 5; k++) p.drawRectangle({ x: bx + 16, y: by + bh - 90 - k * 16, width: bw - 32 - (k % 2) * 40, height: 6, color: rgb(.8, .84, .87) });
  }
  loadResize([pdfFile(await doc.save(), 'mixed-sizes.pdf')]);
});
registerHolder('resize', () => heldBytes(rs.src), () => {
  Object.assign(rs, { name: '', src: null, size: 0, n: 0 });
  $('#rs-empty').hidden = false; $('#rs-work').hidden = true;
});
