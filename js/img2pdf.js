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
async function addImages(files) {
  for (const f of files) {
    if (!isImage(f)) { toast(`「${f.name}」不是支援的圖片格式`, 'err'); continue; }
    try {
      const bmp = await createImageBitmap(f);
      const buf = await f.arrayBuffer();
      const isJpg = f.type === 'image/jpeg' || /\.jpe?g$/i.test(f.name);
      const isPng = f.type === 'image/png' || /\.png$/i.test(f.name);
      imgs.items.push({ id: uid(), name: f.name, size: f.size, file: f, url: URL.createObjectURL(f), w: bmp.width, h: bmp.height,
        kind: isJpg && jpegOrientation(buf) === 1 ? 'jpg' : isPng ? 'png' : 'other' });
      bmp.close && bmp.close();
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
      <div class="file-main"><div class="file-name"></div><div class="file-meta">${it.w} × ${it.h} px · ${fmtSize(it.size)}</div></div>
      <div class="row-btns">
        <button class="icon-btn" data-act="up" aria-label="上移" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
        <button class="icon-btn" data-act="down" aria-label="下移" ${i === n - 1 ? 'disabled' : ''}>${ICON.down}</button>
        <button class="icon-btn danger" data-act="remove" aria-label="移除">${ICON.x}</button>
      </div>`;
    li.querySelector('img').src = it.url;
    li.querySelector('.file-name').textContent = it.name;
    list.append(li);
  });
  $('#img-empty').hidden = n > 0;
  $('#img-go').disabled = !n;
  $('#img-summary').textContent = n ? `${n} 張圖片 → ${n} 頁 PDF` : '';
}
$('#img-list').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = b.closest('.file-row').dataset.id;
  const a = imgs.items, i = a.findIndex(x => x.id === id);
  if (b.dataset.act === 'up' && i > 0) [a[i - 1], a[i]] = [a[i], a[i - 1]];
  if (b.dataset.act === 'down' && i < a.length - 1) [a[i + 1], a[i]] = [a[i], a[i + 1]];
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
  for (const it of imgs.items) {
    check();
    const { kind, bytes } = await imageBytesFor(it);
    const img = kind === 'png' ? await out.embedPng(bytes) : await out.embedJpg(bytes);
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
  await saveFile(name, bytes);
  offerNext(pdfFile(bytes, name), 'pdf', 'img2pdf');
}).catch(err => toast('轉換失敗：' + err.message, 'err')));
