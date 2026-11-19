'use strict';
/* ================= COMPRESS ================= */
const comp = { name: '', bytes: null, pages: 0, result: null };
const LEVELS = { light: { dpi: 150, q: .8 }, medium: { dpi: 110, q: .65 }, strong: { dpi: 72, q: .5 } };
async function loadCompFile(files) {
  const f = files[0];
  if (!isPdf(f)) { toast(`「${f.name}」不是 PDF 檔`, 'err'); return; }
  const bytes = new Uint8Array(await f.arrayBuffer());
  let doc;
  try { doc = await PDFDocument.load(bytes); } catch (e) { toast(loadErr(f.name, e), 'err'); return; }
  const first = doc.getPage(0).getSize();
  Object.assign(comp, { name: f.name, bytes, pages: doc.getPageCount(), result: null });
  $('#comp-fname').textContent = f.name;
  $('#comp-fmeta').textContent = `${comp.pages} 頁 · ${fmtSize(bytes.length)} · ${paperName(first.width, first.height)}`;
  $('#comp-name').value = baseName(f.name) + '-壓縮.pdf';
  $('#comp-empty').hidden = true; $('#comp-work').hidden = false;
  $('#comp-result').hidden = true; $('#comp-progress').hidden = true;
}
bindInput($('#comp-input'), loadCompFile);
acceptFiles($('#panel-compress'), $('#comp-drop'), loadCompFile);
$('#comp-change').addEventListener('click', () => $('#comp-input').click());
$('#comp-sample').addEventListener('click', async e => {
  await busy(e.currentTarget, '產生範例…', async () => loadCompFile([asFile(await makePhotoSample(), 'site-survey-photos.pdf')]));
});
const levelVal = () => document.querySelector('input[name="level"]:checked').value;
document.querySelectorAll('input[name="level"]').forEach(r => r.addEventListener('change', () => {
  const lossless = levelVal() === 'lossless';
  $('#comp-gray').disabled = lossless; $('#comp-gray').closest('label').style.opacity = lossless ? .45 : 1;
  $('#comp-result').hidden = true;
}));
$('#comp-gray').addEventListener('change', () => { $('#comp-result').hidden = true; });

function progress(i, n) {
  $('#comp-progress').hidden = false;
  $('#comp-bar').style.width = (n ? i / n * 100 : 0) + '%';
  $('#comp-plabel').textContent = i < n ? `處理第 ${i + 1} / ${n} 頁` : `完成 ${n} 頁`;
}
async function compressRaster(lv, gray) {
  const pj = await openPdfjs(comp.bytes);
  const out = await PDFDocument.create();
  try {
    for (let i = 0; i < pj.numPages; i++) {
      progress(i, pj.numPages);
      const pg = await pj.getPage(i + 1);
      const vp1 = pg.getViewport({ scale: 1 });
      let scale = lv.dpi / 72;
      const maxPx = 16e6; if (vp1.width * vp1.height * scale * scale > maxPx) scale = Math.sqrt(maxPx / (vp1.width * vp1.height));
      const vp = pg.getViewport({ scale });
      const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      if (gray) {
        const img = ctx.getImageData(0, 0, cv.width, cv.height); const d = img.data;
        for (let k = 0; k < d.length; k += 4) { const y = d[k] * .299 + d[k + 1] * .587 + d[k + 2] * .114; d[k] = d[k + 1] = d[k + 2] = y; }
        ctx.putImageData(img, 0, 0);
      }
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', lv.q));
      const jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const page = out.addPage([vp1.width, vp1.height]);
      page.drawImage(jpg, { x: 0, y: 0, width: vp1.width, height: vp1.height });
      pg.cleanup(); cv.width = cv.height = 0;
    }
    progress(pj.numPages, pj.numPages);
  } finally { pj.destroy(); }
  return out.save({ useObjectStreams: true });
}
async function compressLossless() {
  progress(0, 1);
  const doc = await PDFDocument.load(comp.bytes);
  const bytes = await doc.save({ useObjectStreams: true });
  progress(1, 1);
  return bytes;
}
$('#comp-go').addEventListener('click', e => busy(e.currentTarget, '壓縮中…', async () => {
  $('#comp-result').hidden = true;
  const lv = levelVal();
  const bytes = lv === 'lossless' ? await compressLossless() : await compressRaster(LEVELS[lv], $('#comp-gray').checked);
  comp.result = bytes;
  const before = comp.bytes.length, after = bytes.length;
  const max = Math.max(before, after);
  $('#bar-before').style.width = (before / max * 100) + '%';
  $('#bar-after').style.width = (after / max * 100) + '%';
  $('#v-before').textContent = fmtSize(before); $('#v-after').textContent = fmtSize(after);
  const pct = Math.round((1 - after / before) * 100);
  const big = $('#comp-pct'), warn = $('#comp-warn');
  if (after < before) {
    big.textContent = `−${pct}%`; big.classList.remove('worse');
    $('#comp-pct-label').textContent = `省下 ${fmtSize(before - after)}`;
    warn.hidden = true;
  } else {
    big.textContent = `+${Math.abs(pct)}%`; big.classList.add('worse');
    $('#comp-pct-label').textContent = '檔案反而變大';
    warn.hidden = false;
    warn.textContent = lv === 'lossless'
      ? '這份檔案的結構已經很精簡。如果裡面有照片或掃描頁，改用「標準」或「強力」會有明顯效果。'
      : '這份檔案主要是文字和向量圖形，原本就很小，轉成圖片反而變大。建議保留原檔，或改用「無損最佳化」。';
  }
  $('#comp-result').hidden = false;
}).catch(err => toast('壓縮失敗：' + err.message, 'err')));
$('#comp-save').addEventListener('click', () => { if (comp.result) saveFile(ensurePdf($('#comp-name').value), comp.result); });
