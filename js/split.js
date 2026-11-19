'use strict';
/* ================= SPLIT ================= */
const GROUP_COLORS = ['#0b7a6b', '#c2662b', '#3a5fc8', '#a3407a', '#6b8a12', '#7a55c8'];
const split = { name: '', lib: null, pj: null, pages: [] };
async function loadSplit(files) {
  const f = files[0];
  if (!isPdf(f)) { toast(`「${f.name}」不是 PDF 檔`, 'err'); return; }
  const bytes = new Uint8Array(await f.arrayBuffer());
  let lib, pj;
  try { lib = await PDFDocument.load(bytes); pj = await openPdfjs(bytes); } catch (e) { toast(loadErr(f.name, e), 'err'); return; }
  if (split.pj) split.pj.destroy();
  Object.assign(split, { name: f.name, lib, pj, pages: Array.from({ length: pj.numPages }, (_, i) => ({ id: uid(), index: i, thumb: null, tw: 1, th: 1, w: 0, h: 0 })) });
  $('#split-fname').textContent = f.name;
  $('#split-fmeta').textContent = `${pj.numPages} 頁 · ${fmtSize(bytes.length)}`;
  const half = Math.ceil(pj.numPages / 2);
  $('#split-ranges').value = pj.numPages > 1 ? `1-${half}, ${half + 1}-` : '1';
  $('#split-empty').hidden = true; $('#split-work').hidden = false;
  renderSplit();
  for (const p of split.pages) {
    if (split.pj !== pj) return;
    try { const pg = await pj.getPage(p.index + 1); const vp = pg.getViewport({ scale: 1 }); p.w = vp.width; p.h = vp.height; Object.assign(p, await renderThumb(pg)); } catch (e) {}
    renderSplit();
  }
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
  const grid = $('#split-grid'); grid.innerHTML = '';
  for (const p of split.pages) {
    const gi = owner.get(p.index);
    const card = document.createElement('div');
    card.className = 'page-card static split-card' + (gi === undefined ? ' excluded' : '');
    if (gi !== undefined) card.style.setProperty('--g', GROUP_COLORS[gi % GROUP_COLORS.length]);
    card.innerHTML = `<div class="thumb">${p.thumb ? '<img alt="" draggable="false">' : '<span class="thumb-loading"></span>'}</div>
      <div class="meta"><span class="mid"><span class="pno">${p.index + 1}</span><span class="psize">${p.w ? paperName(p.w, p.h) : ''}</span></span>
      ${gi !== undefined ? `<span class="gchip">第 ${gi + 1} 份</span>` : '<span class="psize">不輸出</span>'}</div>`;
    if (p.thumb) { const img = card.querySelector('img'); img.src = p.thumb; sizeThumbImg(img, p.tw, p.th, 0); }
    grid.append(card);
  }
  const shown = groups.slice(0, 8).map(groupLabel).join('、') + (groups.length > 8 ? '…' : '');
  $('#split-summary').textContent = groups.length ? `會產生 ${groups.length} 份 PDF：第 ${shown} 頁` : '';
  $('#split-go').disabled = !groups.length;
  $('#split-go').textContent = groups.length > 1 ? `拆成 ${groups.length} 份並下載（ZIP）` : '拆分並下載';
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
  const files = [];
  for (const g of groups) {
    check();
    const out = await PDFDocument.create();
    (await out.copyPages(split.lib, g)).forEach(pg => out.addPage(pg));
    files.push({ name: `${base}-第${groupLabel(g).replace('–', '-')}頁.pdf`, bytes: await out.save({ useObjectStreams: true }) });
  }
  if (files.length === 1) { await saveFile(files[0].name, files[0].bytes); offerNext(pdfFile(files[0].bytes, files[0].name), 'pdf', 'split'); return; }
  const zip = new JSZip(); const used = new Set();
  files.forEach(f => { let n = f.name, k = 2; while (used.has(n)) n = f.name.replace(/\.pdf$/, `-${k++}.pdf`); used.add(n); zip.file(n, f.bytes); });
  await saveFile(`${base}-拆分.zip`, await zip.generateAsync({ type: 'blob', compression: 'STORE' }));
}).catch(err => toast('拆分失敗：' + err.message, 'err')));
bindInput($('#split-input'), loadSplit);
acceptFiles($('#panel-split'), $('#split-drop'), loadSplit);
$('#split-change').addEventListener('click', () => $('#split-input').click());
registerTarget('pdf', 'split', '拆分', loadSplit);
$('#split-sample').addEventListener('click', async () => loadSplit([asFile(await makeSample('Quarterly Report', 6, [.04, .48, .42]), 'quarterly-report.pdf')]));
