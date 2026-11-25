'use strict';
/* ================= SPLIT ================= */
const GROUP_COLORS = ['#0b7a6b', '#c2662b', '#3a5fc8', '#a3407a', '#6b8a12', '#7a55c8'];
const split = { name: '', pj: null, pages: [] };
async function loadSplit(files) {
  const f = files[0];
  if (!isPdf(f)) { toast(`「${f.name}」不是 PDF 檔`, 'err'); return; }
  const got = await readPdf(f); if (!got) return; // a password-protected file is unlocked here first
  const { bytes, owned } = got, size = bytes.length;
  let pj;
  try { pj = await openPdfjs(bytes, owned); } catch (e) { toast(loadErr(f.name, e), 'err'); return; }
  // Page sizes are quick to read; thumbnails are drawn only when their card comes near the screen. The file shown so
  // far stays open until the new one is read, so its cards (and 拆分) keep working meanwhile.
  const pages = [];
  let broken = false;
  await eachPage(pj, (pg, i) => {
    if (!pg) { broken = true; return; }
    const vp = pg.getViewport({ scale: 1 });
    pages.push({ id: uid(), index: i, thumb: null, tw: 1, th: 1, w: vp.width, h: vp.height });
  }, { stop: () => broken });
  if (broken) { pj.destroy(); toast(loadErr(f.name, null), 'err'); return; }
  if (split.pj) split.pj.destroy();
  releaseThumbs(split.pages);
  Object.assign(split, { name: f.name, pj, pages, size });
  $('#split-fname').textContent = f.name;
  $('#split-fmeta').textContent = `${pj.numPages} 頁 · ${fmtSize(size)}`;
  const half = Math.ceil(pj.numPages / 2);
  $('#split-ranges').value = pj.numPages > 1 ? `1-${half}, ${half + 1}-` : '1';
  $('#split-empty').hidden = true; $('#split-work').hidden = false;
  renderSplit();
}
async function loadSplitThumb(p) {
  if (p.thumb || p.loading) return;
  const pj = split.pj; p.loading = true;
  try { Object.assign(p, await renderThumb(await pj.getPage(p.index + 1))); } catch (e) { return; } finally { p.loading = false; }
  if (split.pj === pj) setCardThumb($(`#split-grid [data-id="${p.id}"]`), p.thumb, p.tw, p.th, 0);
}
function splitGroups() {
  const n = split.pages.length, mode = document.querySelector('input[name="split-mode"]:checked').value;
  if (mode === 'single') return { groups: split.pages.map((_, i) => [i]) };
  if (mode === 'every') {
    const k = Math.max(1, Math.floor(+$('#split-every').value || 1)), groups = [];
    for (let i = 0; i < n; i += k) groups.push(Array.from({ length: Math.min(k, n - i) }, (_, j) => i + j));
    return { groups };
  }
  const r = parseRanges($('#split-ranges').value, n);
  if (r.error) return { error: r.error, groups: [] };
  if (!r.ranges.length) return { error: '請輸入要拆出的頁碼範圍', groups: [] };
  return { groups: r.ranges.map(([a, b]) => Array.from({ length: b - a + 1 }, (_, j) => a - 1 + j)) };
}
const groupLabel = g => g.length === 1 ? `${g[0] + 1}` : `${g[0] + 1}–${g[g.length - 1] + 1}`;
function renderSplit() {
  const { groups, error } = splitGroups();
  $('#split-err').hidden = !error; $('#split-err').textContent = error || '';
  const owner = new Map();
  groups.forEach((g, gi) => g.forEach(i => { if (!owner.has(i)) owner.set(i, gi); }));
  const grid = $('#split-grid'); forgetCards(grid); grid.innerHTML = '';
  for (const p of split.pages) {
    const gi = owner.get(p.index);
    const card = document.createElement('div');
    card.className = 'page-card static split-card' + (gi === undefined ? ' excluded' : ''); card.dataset.id = p.id;
    if (gi !== undefined) card.style.setProperty('--g', GROUP_COLORS[gi % GROUP_COLORS.length]);
    card.innerHTML = `<div class="thumb">${p.thumb ? '<img alt="" draggable="false">' : '<span class="thumb-loading"></span>'}</div>
      <div class="meta"><span class="mid"><span class="pno">${p.index + 1}</span><span class="psize">${p.w ? paperName(p.w, p.h) : ''}</span></span>
      ${gi !== undefined ? `<span class="gchip">第 ${gi + 1} 份</span>` : '<span class="psize">不輸出</span>'}</div>`;
    if (p.thumb) { const img = card.querySelector('img'); img.src = p.thumb; sizeThumbImg(img, p.tw, p.th, 0); }
    else whenVisible(card, () => loadSplitThumb(p));
    grid.append(card);
  }
  const shown = groups.slice(0, 8).map(groupLabel).join('、') + (groups.length > 8 ? '…' : '');
  $('#split-summary').textContent = groups.length ? `會產生 ${groups.length} 份 PDF：第 ${shown} 頁` : '';
  setJobButton($('#split-go'), { disabled: !groups.length, text: groups.length > 1 ? `拆成 ${groups.length} 份` : '拆分' });
}
document.querySelectorAll('input[name="split-mode"]').forEach(r => r.addEventListener('change', renderSplit));
$('#split-ranges').addEventListener('input', renderSplit);
$('#split-every').addEventListener('input', renderSplit);
$('#split-ranges').addEventListener('focus', () => { document.querySelector('input[name="split-mode"][value="range"]').checked = true; renderSplit(); });
$('#split-every').addEventListener('focus', () => { document.querySelector('input[name="split-mode"][value="every"]').checked = true; renderSplit(); });
$('#split-go').addEventListener('click', e => runJob(e.currentTarget, '拆分中…', async check => {
  const { groups, error } = splitGroups();
  if (error || !groups.length) { toast(error || '沒有要輸出的頁面'); return; }
  const base = baseName(split.name);
  const lib = await PDFDocument.load(await split.pj.getData()); // parsed only for the export, then dropped
  markLayers(lib, 's'); // see relinkLayers() in core.js
  // Several files go into the zip as each is made, so their bytes are not all held at once.
  const zip = groups.length > 1 ? zipWriter() : null;
  for (const g of groups) {
    check();
    const out = await PDFDocument.create();
    const undo = unlinkDests(lib, g, 's'), copied = await out.copyPages(lib, g); undo(); // see unlinkDests()
    copied.forEach(pg => out.addPage(pg));
    relinkDests(out, (tag, i) => copied[g.indexOf(i)]);
    relinkFormFields(out, [lib]); // keep form fields fillable
    relinkLayers(out, [['s', lib]]); // hidden layers stay hidden
    const name = `${base}-第${groupLabel(g).replace('–', '-')}頁.pdf`, bytes = await out.save({ useObjectStreams: true });
    if (!zip) { await deliver(pdfFile(bytes, name), 'pdf', 'split'); return; }
    await zip.add(name, bytes);
  }
  await deliver(new File([zip.blob()], `${base}-拆分.zip`, { type: 'application/zip' }), 'zip', 'split');
}).catch(err => toast('拆分失敗：' + err.message, 'err')));
$('#split-grid').addEventListener('click', e => {
  if (!isThumbClick(e)) return;
  const i0 = split.pages.findIndex(x => x.id === e.target.closest('.page-card').dataset.id);
  openPreview(split.pages.length, i0, async i => { const page = await split.pj.getPage(i + 1); return { page, rotation: page.rotate }; });
});
bindInput($('#split-input'), loadSplit);
acceptFiles($('#panel-split'), $('#split-drop'), loadSplit);
$('#split-change').addEventListener('click', () => $('#split-input').click());
registerTarget('pdf', 'split', '拆分', loadSplit);
$('#split-sample').addEventListener('click', async () => loadSplit([asFile(await makeSample('Quarterly Report', 6, [.04, .48, .42]), 'quarterly-report.pdf')]));
registerHolder('split', () => split.pj ? split.size : 0, () => {
  split.pj.destroy(); releaseThumbs(split.pages);
  forgetCards($('#split-grid')); $('#split-grid').innerHTML = '';
  Object.assign(split, { name: '', pj: null, pages: [], size: 0 });
  $('#split-empty').hidden = false; $('#split-work').hidden = true;
});
