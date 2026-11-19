'use strict';
/* ================= IMAGE TOOLS: compress, resize, convert ================= */
const itool = { items: [] };
const IT_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
async function addImgTool(files) {
  for (const f of files) {
    if (!isImage(f)) { toast(`「${f.name}」不是支援的圖片格式`, 'err'); continue; }
    try {
      const bmp = await createImageBitmap(f);
      itool.items.push({ id: uid(), name: f.name, file: f, size: f.size, w: bmp.width, h: bmp.height, url: URL.createObjectURL(f), out: null });
      bmp.close && bmp.close();
    } catch (e) { toast(`「${f.name}」無法讀取，圖片可能已損壞。`, 'err'); }
  }
  renderImgTool();
}
function itOutMime(it) {
  const f = $('#it-fmt').value;
  if (f === 'jpg') return 'image/jpeg';
  if (f === 'png') return 'image/png';
  if (f === 'webp') return 'image/webp';
  const t = it.file.type;
  return t === 'image/jpeg' || t === 'image/webp' ? t : /\.jpe?g$/i.test(it.name) ? 'image/jpeg' : 'image/png';
}
function itTargetSize(it) {
  const mode = $('#it-size').value, v = Math.max(1, +$('#it-size-v').value || 0);
  let k = 1;
  if (mode === 'long') k = Math.min(1, v / Math.max(it.w, it.h));
  else if (mode === 'pct') k = Math.min(1, v / 100);
  return [Math.max(1, Math.round(it.w * k)), Math.max(1, Math.round(it.h * k))];
}
function renderImgTool() {
  const list = $('#it-list'); list.innerHTML = '';
  itool.items.forEach(it => {
    const li = document.createElement('li'); li.className = 'file-row'; li.dataset.id = it.id;
    const [tw, th] = itTargetSize(it);
    const after = it.out ? ` → ${it.out.w} × ${it.out.h} · ${fmtSize(it.out.size)}（${it.out.size < it.size ? '−' + Math.round((1 - it.out.size / it.size) * 100) + '%' : '沒有變小'}）`
      : (tw !== it.w ? ` → ${tw} × ${th}` : '');
    li.innerHTML = `<img class="img-thumb" alt="" draggable="false"><span></span>
      <div class="file-main"><div class="file-name"></div><div class="file-meta">${it.w} × ${it.h} px · ${fmtSize(it.size)}${after}</div></div>
      <div class="row-btns"><button class="icon-btn danger" data-act="remove" aria-label="移除">${ICON.x}</button></div>`;
    li.querySelector('img').src = it.url; li.querySelector('.file-name').textContent = it.name;
    list.append(li);
  });
  const n = itool.items.length;
  $('#it-empty').hidden = n > 0; $('#it-go').disabled = !n;
  $('#it-zip-field').hidden = n < 2;
  $('#it-summary').textContent = n ? `${n} 張 · 共 ${fmtSize(itool.items.reduce((s, x) => s + x.size, 0))}` : '';
  const mode = $('#it-size').value;
  $('#it-size-wrap').hidden = mode === 'orig';
  $('#it-size-label').textContent = mode === 'pct' ? '縮放比例（%）' : '最長邊（px）';
  const allPng = $('#it-fmt').value === 'png' || ($('#it-fmt').value === 'keep' && itool.items.length && itool.items.every(it => itOutMime(it) === 'image/png'));
  $('#it-q-wrap').style.opacity = allPng ? .45 : 1; $('#it-q').disabled = allPng;
}
$('#it-list').addEventListener('click', e => {
  const b = e.target.closest('[data-act="remove"]'); if (!b) return;
  const i = itool.items.findIndex(x => x.id === b.closest('.file-row').dataset.id);
  URL.revokeObjectURL(itool.items[i].url); itool.items.splice(i, 1); renderImgTool();
});
['#it-fmt', '#it-q', '#it-size', '#it-size-v'].forEach(s => $(s).addEventListener('input', () => { itool.items.forEach(it => { it.out = null; }); renderImgTool(); }));
$('#it-size').addEventListener('change', () => { $('#it-size-v').value = $('#it-size').value === 'pct' ? 50 : 1920; renderImgTool(); });
async function processImage(it) {
  const mime = itOutMime(it), [w, h] = itTargetSize(it);
  const bmp = await createImageBitmap(it.file);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  if (mime === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); } // JPEG has no transparency
  ctx.drawImage(bmp, 0, 0, w, h); bmp.close && bmp.close();
  const blob = await new Promise(r => cv.toBlob(r, mime, +$('#it-q').value));
  cv.width = cv.height = 0;
  if (!blob) throw new Error(`「${it.name}」無法輸出`);
  // A browser without WebP encoding silently hands back PNG; name the file by what we really got.
  const ext = IT_EXT[blob.type] || 'png';
  return { blob, w, h, size: blob.size, name: it.name.replace(/\.[^.]+$/, '') + '.' + ext };
}
$('#it-go').addEventListener('click', e => runJob(e.currentTarget, '處理中…', async check => {
  const outs = [];
  for (const it of itool.items) { check(); it.out = await processImage(it); outs.push(it.out); renderImgTool(); }
  if ($('#it-fmt').value === 'webp' && outs.some(o => !/\.webp$/.test(o.name))) toast('這個瀏覽器不支援輸出 WebP，已改存成 PNG');
  if (outs.length === 1) {
    await deliver(new File([outs[0].blob], outs[0].name, { type: outs[0].blob.type }), 'image', 'imgtool');
    return;
  }
  const zip = await newZip(), used = new Set();
  outs.forEach(o => { let n = o.name, k = 2; while (used.has(n)) n = o.name.replace(/(\.\w+)$/, `-${k++}$1`); used.add(n); zip.file(n, o.blob); });
  let zipName = ($('#it-zip').value || '圖片').trim(); if (!/\.zip$/i.test(zipName)) zipName += '.zip';
  await deliver(new File([await zip.generateAsync({ type: 'blob', compression: 'STORE' })], zipName, { type: 'application/zip' }), 'zip', 'imgtool');
}).catch(err => toast('處理失敗：' + err.message, 'err')));
bindInput($('#it-input'), addImgTool);
acceptFiles($('#panel-imgtool'), $('#it-drop'), addImgTool);
registerTarget('image', 'imgtool', '圖片工具', addImgTool);
$('#it-sample').addEventListener('click', async () => {
  const files = [];
  for (let i = 0; i < 2; i++) {
    const w = i ? 3000 : 4000, h = i ? 4000 : 3000, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d'), g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, i ? '#1d4fb8' : '#0b7a6b'); g.addColorStop(1, i ? '#f2a65a' : '#ffd84d'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    const img = c.getImageData(0, 0, w, h), d = img.data;
    for (let p = 0; p < d.length; p += 4) { const n = (Math.random() - .5) * 30; d[p] += n; d[p + 1] += n; d[p + 2] += n; }
    c.putImageData(img, 0, 0);
    c.fillStyle = 'rgba(255,255,255,.85)'; c.font = `700 ${w / 10}px sans-serif`; c.fillText(`Photo ${i + 1}`, w * .08, h * .88);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .95));
    files.push(new File([blob], `IMG_00${i + 1}.jpg`, { type: 'image/jpeg' }));
  }
  addImgTool(files);
});
