'use strict';
/* ================= IMAGES -> PDF ================= */
const imgs = { items: [] };
function jpegOrientation(buf) {
  try {
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xFFD8) return 1;
    let o = 2;
    while (o < v.byteLength - 4) {
      const m = v.getUint16(o);
      if (m === 0xFFE1) {
        if (v.getUint32(o + 4) !== 0x45786966) return 1;
        const t = o + 10, le = v.getUint16(t) === 0x4949;
        const ifd = t + v.getUint32(t + 4, le), n = v.getUint16(ifd, le);
        for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le); }
        return 1;
      }
      if ((m & 0xFF00) !== 0xFF00 || m === 0xFFDA) return 1;
      o += 2 + v.getUint16(o + 2);
    }
  } catch (e) {}
  return 1;
}
/* A PNG can carry the same EXIF orientation as a JPEG, in an eXIf chunk; browsers show the picture turned. */
function pngOrientation(buf) {
  try {
    const v = new DataView(buf);
    for (let o = 8; o + 8 <= v.byteLength;) {
      const len = v.getUint32(o), type = v.getUint32(o + 4);
      if (type === 0x65584966) { // eXIf: a TIFF header and its first directory
        const t = o + 8, le = v.getUint16(t) === 0x4949, ifd = t + v.getUint32(t + 4, le), n = v.getUint16(ifd, le);
        for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le); }
        return 1;
      }
      if (type === 0x49454E44) break; // IEND
      o += 12 + len;
    }
  } catch (e) {}
  return 1;
}
/* Pictures that go into the PDF as they are: JPEGs and PNGs that need no turning; the rest is re-encoded the way the
   browser shows it. Told by the content, not the name: a WebP or PNG saved as .jpg (common for pictures from the
   web) would not embed as a JPEG. */
function directKind(buf) {
  const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return jpegOrientation(buf) === 1 ? 'jpg' : 'other';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return pngOrientation(buf) === 1 ? 'png' : 'other';
  return 'other';
}
/* What a file-list row shows of a picture: { url (its small picture, see listThumb()), w, h, kind (directKind) }.
   A picture that needs no turning (most photos) is decoded straight to the small size: decoding a 12 MP photo whole
   (48 MB) only to shrink it made adding photos take about 1.4 times as long. A turned one is decoded whole, as the
   browser shows it. */
async function listPicture(f, px = 96) {
  const kind = directKind(await f.arrayBuffer());
  if (kind !== 'other') {
    const { w, h } = await imageSize(f), k = Math.min(1, px / Math.min(w, h));
    const bmp = await createImageBitmap(f, { resizeWidth: Math.max(1, Math.round(w * k)), resizeHeight: Math.max(1, Math.round(h * k)), resizeQuality: 'high' });
    try { return { url: await listThumb(bmp, px), w, h, kind }; } finally { bmp.close && bmp.close(); }
  }
  const bmp = await createImageBitmap(f);
  try { return { url: await listThumb(bmp, px), w: bmp.width, h: bmp.height, kind }; } finally { bmp.close && bmp.close(); }
}
async function addImages(files) {
  files = await prepImages(files);
  for (const f of files) {
    if (!isImage(f)) { toast(`「${f.name}」不是支援的圖片格式`, 'err'); continue; }
    try {
      const { url, w, h, kind } = await listPicture(f);
      imgs.items.push({ id: uid(), name: f.name, size: f.size, file: f, url, w, h, kind });
    } catch (e) { toast(`「${f.name}」無法讀取，圖片可能已損壞。`, 'err'); }
  }
  if (imgs.items.length && $('#img-name').value === '圖片.pdf') $('#img-name').value = baseName(imgs.items[0].name.replace(/\.[^.]+$/, '')) + '.pdf';
  renderImgs();
}
function renderImgs() {
  const list = $('#img-list'); list.innerHTML = '';
  const n = imgs.items.length;
  imgs.items.forEach((it, i) => {
    const li = document.createElement('li');
    li.className = 'file-row'; li.draggable = true; li.dataset.id = it.id;
    li.innerHTML = `<img class="img-thumb" alt="" draggable="false">
      <span class="idx">${i + 1}</span>
      <div class="file-main"><div class="file-name"></div><div class="file-meta">${it.w} × ${it.h} px · ${fmtSize(it.size)}${it.scan ? ' <span class="chip soft">已校正</span>' : ''}</div></div>
      <div class="row-btns">
        <button class="btn mini-btn" data-act="scan" title="拉正翻拍的文件、去陰影、轉黑白">${ICON.scan}校正</button>
        <button class="icon-btn" data-act="up" aria-label="上移" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
        <button class="icon-btn" data-act="down" aria-label="下移" ${i === n - 1 ? 'disabled' : ''}>${ICON.down}</button>
        <button class="icon-btn danger" data-act="remove" aria-label="移除">${ICON.x}</button>
      </div>`;
    li.querySelector('img').src = it.url;
    li.querySelector('.file-name').textContent = it.name;
    list.append(li);
  });
  $('#img-empty').hidden = n > 0;
  setJobButton($('#img-go'), { disabled: !n });
  $('#img-summary').textContent = n ? `${n} 張圖片 → ${n} 頁 PDF` : '';
}
$('#img-list').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  if ($('#img-go').classList.contains('is-running')) { toast('正在轉換，請等完成（或按「取消」）再調整清單'); return; }
  const id = b.closest('.file-row').dataset.id;
  const a = imgs.items, i = a.findIndex(x => x.id === id);
  if (b.dataset.act === 'up' && i > 0) [a[i - 1], a[i]] = [a[i], a[i - 1]];
  if (b.dataset.act === 'down' && i < a.length - 1) [a[i + 1], a[i]] = [a[i], a[i + 1]];
  if (b.dataset.act === 'scan') { openScan(a[i]); return; }
  if (b.dataset.act === 'remove') { URL.revokeObjectURL(a[i].url); a.splice(i, 1); }
  renderImgs();
});
makeSortable($('#img-list'), '.file-row', () => imgs.items, renderImgs, false);
bindInput($('#img-input'), addImages);
registerTarget('image', 'img2pdf', '圖片轉 PDF', addImages);
acceptFiles($('#panel-img2pdf'), $('#img-drop'), addImages);
$('#img-sample').addEventListener('click', async () => {
  const files = [];
  const specs = [['#0b7a6b', '#ffd84d', 1600, 1200], ['#1d4fb8', '#f2a65a', 1200, 1600], ['#7a2e4a', '#9fd8cb', 1600, 1000]];
  for (let i = 0; i < specs.length; i++) {
    const [a, b, w, h] = specs[i];
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d'); const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, a); g.addColorStop(1, b); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `700 ${Math.round(w / 9)}px sans-serif`;
    ctx.fillText(`Photo ${i + 1}`, w * .08, h * .85);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .9));
    files.push(new File([blob], `photo-${i + 1}.jpg`, { type: 'image/jpeg' }));
  }
  addImages(files);
});
async function imageBytesFor(it) {
  if (it.kind === 'jpg' || it.kind === 'png') return { kind: it.kind, bytes: new Uint8Array(await it.file.arrayBuffer()) };
  const bmp = await createImageBitmap(it.file);
  const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(bmp, 0, 0);
  bmp.close && bmp.close();
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .92));
  cv.width = cv.height = 0;
  return { kind: 'jpg', bytes: new Uint8Array(await blob.arrayBuffer()) };
}
$('#img-go').addEventListener('click', e => runJob(e.currentTarget, '轉換中…', async check => {
  const sizeOpt = $('#img-size').value, orient = $('#img-orient').value, margin = +$('#img-margin').value;
  const PAPER = { a4: [595.28, 841.89], letter: [612, 792] };
  const out = await PDFDocument.create();
  for (const it of imgs.items.slice()) { // the list as it was when the button was pressed
    check();
    const { kind, bytes } = await imageBytesFor(it);
    const img = kind === 'png' ? await embedPngFast(out, bytes) : await out.embedJpg(bytes);
    let pw, ph;
    if (sizeOpt === 'fit') { pw = it.w * .75 + margin * 2; ph = it.h * .75 + margin * 2; }
    else {
      [pw, ph] = PAPER[sizeOpt];
      const land = orient === 'landscape' || (orient === 'auto' && it.w > it.h);
      if (land) [pw, ph] = [ph, pw];
    }
    const page = out.addPage([pw, ph]);
    const bw = pw - margin * 2, bh = ph - margin * 2;
    const s = Math.min(bw / it.w, bh / it.h);
    const w = it.w * s, h = it.h * s;
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  const bytes = await out.save({ useObjectStreams: true });
  const name = ensurePdf($('#img-name').value);
  await deliver(pdfFile(bytes, name), 'pdf', 'img2pdf');
}).catch(err => toast('轉換失敗：' + err.message, 'err')));
registerHolder('img2pdf', () => imgs.items.reduce((n, it) => n + it.size + (it.scan ? it.scan.src.size : 0), 0), () => {
  imgs.items.forEach(it => URL.revokeObjectURL(it.url)); imgs.items = []; renderImgs();
});
