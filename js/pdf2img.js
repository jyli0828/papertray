'use strict';
/* ================= PDF -> IMAGES ================= */
const p2i = { name: '', pj: null, pages: [] };
async function loadP2i(files) {
  const f = files[0];
  if (!isPdf(f)) { toast(`「${f.name}」不是 PDF 檔`, 'err'); return; }
  const bytes = new Uint8Array(await f.arrayBuffer());
  let pj;
  try { pj = await openPdfjs(bytes); } catch (e) { toast(loadErr(f.name, e), 'err'); return; }
  if (p2i.pj) p2i.pj.destroy();
  p2i.name = f.name; p2i.pj = pj;
  p2i.pages = Array.from({ length: pj.numPages }, (_, i) => ({ id: uid(), index: i, selected: true, thumb: null, tw: 1, th: 1, w: 0, h: 0 }));
  $('#p2i-fname').textContent = f.name;
  $('#p2i-fmeta').textContent = `${pj.numPages} 頁 · ${fmtSize(bytes.length)}`;
  $('#p2i-empty').hidden = true; $('#p2i-work').hidden = false; $('#p2i-progress').hidden = true;
  // Page sizes first (fast), so the summary is right; thumbnails come as cards scroll near the screen.
  for (const p of p2i.pages) {
    if (p2i.pj !== pj) return;
    try { const vp = (await pj.getPage(p.index + 1)).getViewport({ scale: 1 }); p.w = vp.width; p.h = vp.height; } catch (e) {}
  }
  renderP2i();
}
async function loadP2iThumb(p) {
  if (p.thumb || p.loading) return;
  const pj = p2i.pj; p.loading = true;
  try { Object.assign(p, await renderThumb(await pj.getPage(p.index + 1))); } catch (e) { return; } finally { p.loading = false; }
  if (p2i.pj === pj) setCardThumb($(`#p2i-grid [data-id="${p.id}"]`), p.thumb, p.tw, p.th, 0);
}
function renderP2i() {
  const grid = $('#p2i-grid'); forgetCards(grid); grid.innerHTML = '';
  p2i.pages.forEach(p => {
    const card = document.createElement('div');
    card.className = 'page-card static'; card.dataset.id = p.id;
    grid.append(card); renderP2iCard(p);
  });
  updateP2iSummary();
}
function renderP2iCard(p) {
  const card = $(`#p2i-grid [data-id="${p.id}"]`); if (!card) return;
  card.classList.toggle('is-selected', p.selected);
  card.innerHTML = `
    <div class="thumb">${p.thumb ? '<img alt="" draggable="false">' : '<span class="thumb-loading"></span>'}
      <label class="sel"><input type="checkbox" data-act="sel" ${p.selected ? 'checked' : ''} aria-label="選取第 ${p.index + 1} 頁"></label>
    </div>
    <div class="meta">
      <span class="mid"><span class="pno">${p.index + 1}</span><span class="psize">${p.w ? paperName(p.w, p.h) : ''}</span></span>
      <button class="icon-btn mini" data-act="one" title="只下載這一頁" aria-label="只下載第 ${p.index + 1} 頁"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg></button>
    </div>`;
  if (p.thumb) { const img = card.querySelector('img'); img.src = p.thumb; sizeThumbImg(img, p.tw, p.th, 0); }
  else whenVisible(card, () => loadP2iThumb(p));
}
function p2iOpts() {
  const fmt = $('#p2i-fmt').value;
  return { fmt, dpi: +$('#p2i-dpi').value, q: +$('#p2i-q').value, mime: fmt === 'png' ? 'image/png' : 'image/jpeg' };
}
function updateP2iSummary() {
  const sel = p2i.pages.filter(p => p.selected);
  const n = p2i.pages.length, { fmt, dpi } = p2iOpts();
  $('#p2i-stat').textContent = `${n} 頁 · 已選 ${sel.length}`;
  $('#p2i-selall').textContent = sel.length === n ? '取消全選' : '全選';
  const first = sel.find(p => p.w);
  const px = first ? ` · 每張約 ${Math.round(first.w * dpi / 72)} × ${Math.round(first.h * dpi / 72)} px` : '';
  $('#p2i-summary').textContent = sel.length ? `${sel.length} 張 ${fmt.toUpperCase()}${px}` : '請至少選一頁';
  const go = $('#p2i-go');
  go.disabled = !sel.length;
  go.textContent = sel.length > 1 ? `下載 ${sel.length} 張（ZIP）` : '下載圖片';
  $('#p2i-q-wrap').style.opacity = fmt === 'png' ? .45 : 1; $('#p2i-q').disabled = fmt === 'png';
}
['#p2i-fmt', '#p2i-dpi', '#p2i-q'].forEach(s => $(s).addEventListener('change', updateP2iSummary));
async function pageToBlob(index, o) {
  const pg = await p2i.pj.getPage(index + 1);
  const vp1 = pg.getViewport({ scale: 1 });
  let scale = o.dpi / 72;
  const maxPx = 40e6; if (vp1.width * vp1.height * scale * scale > maxPx) scale = Math.sqrt(maxPx / (vp1.width * vp1.height));
  const vp = pg.getViewport({ scale });
  const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await pg.render({ canvasContext: ctx, viewport: vp }).promise;
  const blob = await new Promise(r => cv.toBlob(r, o.mime, o.q));
  pg.cleanup(); cv.width = cv.height = 0;
  return blob;
}
const p2iFileName = (index, o) => `${baseName(p2i.name)}-${String(index + 1).padStart(String(p2i.pages.length).length, '0')}.${o.fmt}`;
function p2iProgress(i, n) {
  $('#p2i-progress').hidden = false;
  $('#p2i-bar').style.width = (i / n * 100) + '%';
  $('#p2i-plabel').textContent = i < n ? `轉換第 ${i + 1} / ${n} 張` : `完成 ${n} 張`;
}
async function exportP2i(pages, btn) {
  const o = p2iOpts();
  const mini = btn.classList.contains('mini');
  await (mini ? busy(btn, '', () => go(() => {})) : runJob(btn, '轉換中…', go)).catch(err => toast('轉換失敗：' + err.message, 'err'));
  async function go(check) {
    if (pages.length === 1) {
      p2iProgress(0, 1);
      const blob = await pageToBlob(pages[0].index, o);
      p2iProgress(1, 1);
      const name = p2iFileName(pages[0].index, o);
      await saveFile(name, blob);
      offerNext(new File([blob], name, { type: o.mime }), 'image', 'pdf2img');
      return;
    }
    const zip = new JSZip();
    for (let i = 0; i < pages.length; i++) {
      check();
      p2iProgress(i, pages.length);
      zip.file(p2iFileName(pages[i].index, o), await pageToBlob(pages[i].index, o));
    }
    p2iProgress(pages.length, pages.length);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    await saveFile(`${baseName(p2i.name)}-${o.fmt}.zip`, blob);
  }
}
$('#p2i-grid').addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t) {
    if (!isThumbClick(e)) return;
    const i0 = p2i.pages.findIndex(x => x.id === e.target.closest('.page-card').dataset.id);
    openPreview(p2i.pages.length, i0, async i => { const page = await p2i.pj.getPage(i + 1); return { page, rotation: page.rotate }; });
    return;
  }
  const p = p2i.pages.find(x => x.id === t.closest('.page-card').dataset.id);
  if (t.dataset.act === 'sel') {
    const i = p2i.pages.indexOf(p), j = p2i.pages.findIndex(x => x.id === p2i.anchor);
    if (e.shiftKey && j >= 0) { for (let k = Math.min(i, j); k <= Math.max(i, j); k++) p2i.pages[k].selected = t.checked; renderP2i(); }
    else { p.selected = t.checked; t.closest('.page-card').classList.toggle('is-selected', p.selected); updateP2iSummary(); }
    p2i.anchor = p.id;
  }
  if (t.dataset.act === 'one') exportP2i([p], t);
});
$('#p2i-selall').addEventListener('click', () => {
  const all = p2i.pages.every(p => p.selected); p2i.pages.forEach(p => { p.selected = !all; }); renderP2i();
});
$('#p2i-go').addEventListener('click', e => exportP2i(p2i.pages.filter(p => p.selected), e.currentTarget));
bindInput($('#p2i-input'), loadP2i);
registerTarget('pdf', 'pdf2img', '轉成圖片', loadP2i);
acceptFiles($('#panel-pdf2img'), $('#p2i-drop'), loadP2i);
$('#p2i-change').addEventListener('click', () => $('#p2i-input').click());
$('#p2i-sample').addEventListener('click', async () => {
  loadP2i([asFile(await makeSample('Quarterly Report', 3, [.04, .48, .42]), 'quarterly-report.pdf')]);
});
