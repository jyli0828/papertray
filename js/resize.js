'use strict';
/* ================= RESIZE =================
   fit:  every page goes onto a new page of one paper size; the original page is embedded as vector content
         (text stays selectable), scaled and centred. Links and form fields of the original page are not carried over.
   crop: render each page small, find where the ink is, and set the crop box around it. Nothing is re-drawn. */
const PAPERS = { a4: [595.28, 841.89], a3: [841.89, 1190.55], a5: [419.53, 595.28], b5: [515.91, 728.5], letter: [612, 792], legal: [612, 1008] };
const rs = { name: '', bytes: null, n: 0, mode: 'fit', first: [595.28, 841.89] };
const pageDisp = page => {
  const cb = page.getCropBox(), R = ((page.getRotation().angle % 360) + 360) % 360;
  return { cb, R, view: [cb.x, cb.y, cb.x + cb.width, cb.y + cb.height], dims: R % 180 ? [cb.height, cb.width] : [cb.width, cb.height] };
};
async function loadResize(files) {
  const f = files[0];
  if (!isPdf(f)) { toast(`「${f.name}」不是 PDF 檔`, 'err'); return; }
  const { bytes } = await fileBytes(f);
  if (hasEncrypt(bytes)) { toast(encryptedMsg(f.name), 'err'); return; }
  let doc;
  try { doc = await PDFDocument.load(bytes); } catch (e) { toast(loadErr(f.name, e), 'err'); return; }
  const counts = new Map();
  doc.getPages().forEach((pg, i) => {
    const [w, h] = pageDisp(pg).dims;
    if (i === 0) rs.first = [w, h];
    const key = paperName(w, h) + (w > h ? ' 橫' : '');
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  Object.assign(rs, { name: f.name, bytes, n: doc.getPageCount() });
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
  if (!rs.bytes) return;
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
async function resizeFit(check) {
  const src = await PDFDocument.load(rs.bytes), out = await PDFDocument.create();
  const orient = $('#rs-orient').value, scaleMode = $('#rs-scale').value, m = +$('#rs-margin').value;
  const pages = src.getPages();
  for (let i = 0; i < pages.length; i++) {
    check(); rsProgress(i, pages.length);
    const { cb, R, dims: [dw, dh] } = pageDisp(pages[i]);
    const emb = await out.embedPage(pages[i], { left: cb.x, bottom: cb.y, right: cb.x + cb.width, top: cb.y + cb.height });
    let [TW, TH] = rsTarget();
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
  return out.save({ useObjectStreams: true });
}
async function resizeCrop(check) {
  const doc = await PDFDocument.load(rs.bytes), pj = await openPdfjs(rs.bytes);
  const pad = +$('#rs-pad').value;
  let cropped = 0;
  try {
    for (let i = 0; i < pj.numPages; i++) {
      check(); rsProgress(i, pj.numPages);
      const pg = await pj.getPage(i + 1), vp1 = pg.getViewport({ scale: 1 });
      const k = Math.min(2, 700 / Math.max(vp1.width, vp1.height)), vp = pg.getViewport({ scale: k });
      const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let x0 = cv.width, y0 = cv.height, x1 = -1, y1 = -1;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
        const o = (y * cv.width + x) * 4;
        if (d[o] < 240 || d[o + 1] < 240 || d[o + 2] < 240) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      pg.cleanup(); cv.width = cv.height = 0;
      if (x1 < 0) continue; // blank page
      const page = doc.getPage(i), { view, R, dims: [dw, dh] } = pageDisp(page);
      const L = Math.max(0, x0 / k - pad), T = Math.max(0, y0 / k - pad), Rt = Math.min(dw, (x1 + 1) / k + pad), B = Math.min(dh, (y1 + 1) / k + pad);
      if (L < 1 && T < 1 && Rt > dw - 1 && B > dh - 1) continue; // nothing to trim
      const [ax, ay] = displayToUser(view, R, L, T), [bx, by] = displayToUser(view, R, Rt, B);
      page.setCropBox(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      cropped++;
    }
    rsProgress(pj.numPages, pj.numPages);
  } finally { pj.destroy(); }
  return { bytes: await doc.save({ useObjectStreams: true }), cropped };
}
$('#rs-go').addEventListener('click', e => runJob(e.currentTarget, '處理中…', async check => {
  let bytes;
  if (rs.mode === 'fit') bytes = await resizeFit(check);
  else {
    const r = await resizeCrop(check); bytes = r.bytes;
    toast(r.cropped ? `裁掉了 ${r.cropped} 頁的白邊` : '沒有找到可以裁掉的白邊');
  }
  const name = ensurePdf($('#rs-name').value);
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
registerHolder('resize', () => rs.bytes ? rs.bytes.length : 0, () => {
  Object.assign(rs, { name: '', bytes: null, n: 0 });
  $('#rs-empty').hidden = false; $('#rs-work').hidden = true;
});
