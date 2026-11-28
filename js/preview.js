'use strict';
/* ================= PAGE PREVIEW =================
   Click a thumbnail to see the page large, or look at a finished result before downloading it.
   ← → (or the arrow buttons) step through pages, Esc closes.
   get(i) → { page: pdf.js page, rotation, label }, { image: ImageBitmap, label } or { text, label }.
   opts.download shows a 下載 button, opts.copy a 複製全部 button; opts.onClose runs when the preview closes (to free a
   result's resources). */
const pv = { n: 0, i: 0, get: null, token: 0, task: null, opts: {} };
const pvDlg = $('#pv-dialog');
function openPreview(n, i, get, opts = {}) {
  if (pvDlg.open) closePreviewResources();
  Object.assign(pv, { n, i, get, opts });
  $('#pv-download').hidden = !opts.download;
  $('#pv-copy').hidden = !opts.copy;
  if (!pvDlg.open) pvDlg.showModal();
  renderPreview();
}
async function renderPreview() {
  const token = ++pv.token;
  if (pv.task) { try { pv.task.cancel(); } catch (e) {} pv.task = null; }
  $('#pv-prev').disabled = pv.i <= 0; $('#pv-next').disabled = pv.i >= pv.n - 1;
  $('#pv-prev').hidden = $('#pv-next').hidden = pv.n < 2;
  $('#pv-title').textContent = `第 ${pv.i + 1} / ${pv.n} 頁`;
  let info;
  try { info = await pv.get(pv.i); } catch (e) { return; }
  if (token !== pv.token || !info) return;
  if (info.label) $('#pv-title').textContent = info.label;
  const stage = $('#pv-stage'), cv = $('#pv-canvas'), ta = $('#pv-text');
  ta.hidden = info.text === undefined; cv.hidden = !ta.hidden;
  if (!ta.hidden) { ta.value = info.text; ta.scrollTop = 0; return; }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const fit = (w, h) => Math.max(.05, Math.min((stage.clientWidth - 32) / w, (stage.clientHeight - 32) / h, 3));
  if (info.image) {
    const im = info.image, s = Math.min(1, fit(im.width, im.height));
    cv.width = Math.round(im.width * s * dpr); cv.height = Math.round(im.height * s * dpr);
    cv.style.width = im.width * s + 'px'; cv.style.height = im.height * s + 'px';
    const ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(im, 0, 0, cv.width, cv.height);
    return;
  }
  const vp1 = info.page.getViewport({ scale: 1, rotation: info.rotation });
  const vp = info.page.getViewport({ scale: fit(vp1.width, vp1.height) * dpr, rotation: info.rotation });
  cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  cv.style.width = vp.width / dpr + 'px'; cv.style.height = vp.height / dpr + 'px';
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  pv.task = info.page.render({ canvasContext: ctx, viewport: vp });
  try { await pv.task.promise; } catch (e) {}
  if (token === pv.token) info.page.cleanup();
}
function stepPreview(d) { const j = pv.i + d; if (j < 0 || j >= pv.n) return; pv.i = j; renderPreview(); }
$('#pv-prev').addEventListener('click', () => stepPreview(-1));
$('#pv-next').addEventListener('click', () => stepPreview(1));
$('#pv-close').addEventListener('click', () => pvDlg.close());
$('#pv-download').addEventListener('click', e => { if (pv.opts.download) busy(e.currentTarget, '準備中…', pv.opts.download); });
$('#pv-copy').addEventListener('click', () => { if (pv.opts.copy) pv.opts.copy(); });
/* The big picture (and a result's own decoded copy) is only needed while the preview is open. */
function closePreviewResources() {
  pv.token++;
  const cv = $('#pv-canvas'); cv.width = cv.height = 0; $('#pv-text').value = '';
  const done = pv.opts.onClose; pv.opts = {};
  if (done) { try { done(); } catch (e) {} }
}
pvDlg.addEventListener('close', closePreviewResources);
pvDlg.addEventListener('cancel', closePreviewResources);
$('#pv-close').addEventListener('click', closePreviewResources);
pvDlg.addEventListener('keydown', e => {
  if (e.target.id === 'pv-text') return; // arrow keys move the cursor in the text
  if (e.key === 'ArrowLeft') { e.preventDefault(); stepPreview(-1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); stepPreview(1); }
});
/* click on the dark area around the page closes it */
pvDlg.addEventListener('click', e => { if (e.target === pvDlg || e.target.id === 'pv-stage') { closePreviewResources(); pvDlg.close(); } });
/* Thumbnail clicks open the preview, but not right after a touch drag-sort ended on that card. */
const isThumbClick = e => e.target.closest('.thumb') && !e.target.closest('.sel, input, label, button')
  && !(Date.now() - (e.currentTarget._sortedAt || 0) < 500);

/* ---------- preview a finished result (the file in the result bar) ---------- */
async function openResultPreview() {
  if (!lastResult) return;
  const { file, kind } = lastResult;
  if (file.lent) await file.lent; // still being handed back from a preview that just closed
  const download = () => saveFile(file.name, file);
  if (kind === 'text') {
    const text = (await file.text()).replace(/^\ufeff/, '');
    openPreview(1, 0, async () => ({ text, label: `${file.name} · ${text.replace(/\s/g, '').length} 字` }), { download, copy: () => copyText(text) });
    return;
  }
  if (kind === 'image') {
    const bmp = await createImageBitmap(file);
    openPreview(1, 0, async () => ({ image: bmp, label: `${file.name} · ${bmp.width} × ${bmp.height} px` }), { download, onClose: () => bmp.close && bmp.close() });
    return;
  }
  const { bytes, owned } = await fileBytes(file);
  const pj = await openPdfjs(bytes, owned);
  const pages = i => pj.getPage(i + 1).then(page => ({ page, rotation: page.rotate, label: `${file.name} · 第 ${i + 1} / ${pj.numPages} 頁` }));
  if (!inMemory(file)) { openPreview(pj.numPages, 0, pages, { download, onClose: () => pj.loadingTask.destroy() }); return; }
  // pdf.js now has its own copy, so the page lets go of the result's bytes while the preview is open: the file is held
  // once, not twice. They come back from pdf.js when the preview closes; until then file.lent makes readers wait.
  let back; file.lent = new Promise(r => { back = r; }); file.bytes = null;
  const giveBack = async () => {
    try { file.bytes = new Uint8Array(await pj.getData()); }
    finally { pj.loadingTask.destroy(); file.lent = null; back(); }
  };
  openPreview(pj.numPages, 0, pages, {
    download: async () => saveFile(file.name, new Blob([await pj.getData()], { type: 'application/pdf' })),
    onClose: giveBack
  });
}
$('#handoff-preview').addEventListener('click', e => busy(e.currentTarget, '開啟中…', openResultPreview).catch(failToast('無法預覽')));
$('#handoff-download').addEventListener('click', e => { if (lastResult) busy(e.currentTarget, '準備中…', () => saveFile(lastResult.file.name, lastResult.file)); });
$('#auto-dl').checked = autoDownload;
$('#auto-dl').addEventListener('change', e => {
  autoDownload = e.target.checked;
  try { localStorage.setItem('papertray.autodl', autoDownload ? '1' : '0'); } catch (err) {}
  toast(autoDownload ? '完成後會直接下載' : '完成後會先開啟預覽，不會自動下載');
});
/* Copy to the clipboard; older browsers (or a page without clipboard permission) fall back to selecting the text. */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('已複製到剪貼簿'); return; } catch (e) {}
  const ta = $('#pv-text');
  if (!ta.hidden) { ta.focus(); ta.select(); }
  try { if (document.execCommand('copy')) { toast('已複製到剪貼簿'); return; } } catch (e) {}
  toast('無法自動複製，文字已選取，請按 Ctrl+C');
}
