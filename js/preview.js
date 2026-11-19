'use strict';
/* ================= PAGE PREVIEW =================
   Click a thumbnail to see the page large. ← → (or the arrow buttons) step through pages, Esc closes.
   Each tool supplies get(i) → { page: pdf.js page, rotation, label }. */
const pv = { n: 0, i: 0, get: null, token: 0, task: null };
const pvDlg = $('#pv-dialog');
function openPreview(n, i, get) {
  Object.assign(pv, { n, i, get });
  if (!pvDlg.open) pvDlg.showModal();
  renderPreview();
}
async function renderPreview() {
  const token = ++pv.token;
  if (pv.task) { try { pv.task.cancel(); } catch (e) {} pv.task = null; }
  $('#pv-prev').disabled = pv.i <= 0; $('#pv-next').disabled = pv.i >= pv.n - 1;
  $('#pv-title').textContent = `第 ${pv.i + 1} / ${pv.n} 頁`;
  let info;
  try { info = await pv.get(pv.i); } catch (e) { return; }
  if (token !== pv.token || !info) return;
  if (info.label) $('#pv-title').textContent = info.label;
  const stage = $('#pv-stage');
  const vp1 = info.page.getViewport({ scale: 1, rotation: info.rotation });
  const s = Math.min((stage.clientWidth - 32) / vp1.width, (stage.clientHeight - 32) / vp1.height, 3);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp = info.page.getViewport({ scale: Math.max(.1, s) * dpr, rotation: info.rotation });
  const cv = $('#pv-canvas');
  cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  cv.style.width = vp.width / dpr + 'px'; cv.style.height = vp.height / dpr + 'px';
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  pv.task = info.page.render({ canvasContext: ctx, viewport: vp });
  try { await pv.task.promise; } catch (e) {}
}
function stepPreview(d) { const j = pv.i + d; if (j < 0 || j >= pv.n) return; pv.i = j; renderPreview(); }
$('#pv-prev').addEventListener('click', () => stepPreview(-1));
$('#pv-next').addEventListener('click', () => stepPreview(1));
$('#pv-close').addEventListener('click', () => pvDlg.close());
pvDlg.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') { e.preventDefault(); stepPreview(-1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); stepPreview(1); }
});
/* click on the dark area around the page closes it */
pvDlg.addEventListener('click', e => { if (e.target === pvDlg || e.target.id === 'pv-stage') pvDlg.close(); });
/* Thumbnail clicks open the preview, but not right after a touch drag-sort ended on that card. */
const isThumbClick = e => e.target.closest('.thumb') && !e.target.closest('.sel, input, label, button')
  && !(Date.now() - (e.currentTarget._sortedAt || 0) < 500);
