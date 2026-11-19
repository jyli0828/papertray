'use strict';
/* ================= MERGE ================= */
const merge = { items: [] };
async function addMergeFiles(files, isSample) {
  if (!isSample && merge.items.some(i => i.sample)) merge.items = merge.items.filter(i => !i.sample);
  for (const f of files) {
    if (!isPdf(f)) { toast(`「${f.name}」不是 PDF 檔`, 'err'); continue; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    try {
      const doc = await PDFDocument.load(bytes);
      merge.items.push({ id: uid(), name: f.name, size: bytes.length, bytes, pages: doc.getPageCount(), range: '', sample: !!isSample });
    } catch (e) { toast(loadErr(f.name, e), 'err'); }
  }
  renderMerge();
}
/* Which pages of a file go into the result: blank = all; otherwise ranges like "1-3, 5". */
function mergePicks(it) {
  if (!it.range.trim()) return { idx: Array.from({ length: it.pages }, (_, i) => i) };
  const r = parseRanges(it.range, it.pages);
  if (r.error) return { error: r.error };
  if (!r.ranges.length) return { idx: Array.from({ length: it.pages }, (_, i) => i) };
  const idx = []; r.ranges.forEach(([a, b]) => { for (let i = a; i <= b; i++) idx.push(i - 1); });
  return { idx };
}
function renderMerge() {
  const list = $('#merge-list'); list.innerHTML = '';
  const n = merge.items.length;
  merge.items.forEach((it, i) => {
    const li = document.createElement('li');
    li.className = 'file-row'; li.draggable = true; li.dataset.id = it.id;
    li.innerHTML = `<span class="grip" aria-hidden="true">${ICON.grip}</span><span class="idx">${i + 1}</span>
      <div class="file-main"><div class="file-name"></div>
        <div class="file-meta">${it.pages} 頁 · ${fmtSize(it.size)}${it.sample ? ' <span class="chip">範例</span>' : ''}
          <label class="row-range">取頁 <input type="text" data-range spellcheck="false" placeholder="全部" aria-label="要合併的頁碼"></label></div>
        <div class="row-err" hidden></div></div>
      <div class="row-btns">
        <button class="icon-btn" data-act="up" aria-label="上移" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
        <button class="icon-btn" data-act="down" aria-label="下移" ${i === n - 1 ? 'disabled' : ''}>${ICON.down}</button>
        <button class="icon-btn danger" data-act="remove" aria-label="移除">${ICON.x}</button>
      </div>`;
    li.querySelector('.file-name').textContent = it.name;
    li.querySelector('[data-range]').value = it.range;
    list.append(li);
  });
  $('#merge-empty').hidden = n > 0;
  $('#merge-sample-note').hidden = !merge.items.some(i => i.sample);
  updateMergeSummary();
}
function updateMergeSummary() {
  let pages = 0, bad = false;
  for (const it of merge.items) {
    const r = mergePicks(it), row = $(`#merge-list [data-id="${it.id}"]`);
    if (row) { const er = row.querySelector('.row-err'); er.hidden = !r.error; er.textContent = r.error || ''; }
    if (r.error) bad = true; else pages += r.idx.length;
  }
  const n = merge.items.length, size = merge.items.reduce((s, x) => s + x.size, 0);
  $('#merge-go').disabled = n < 2 || bad;
  $('#merge-summary').textContent = n ? `${n} 個檔案 · 合併後 ${pages} 頁 · 原始共 ${fmtSize(size)}` : '';
}
$('#merge-list').addEventListener('input', e => {
  const inp = e.target.closest('[data-range]'); if (!inp) return;
  const it = merge.items.find(x => x.id === inp.closest('.file-row').dataset.id);
  it.range = inp.value; updateMergeSummary();
});
/* typing in the page field must not start dragging the row */
$('#merge-list').addEventListener('pointerdown', e => { if (e.target.closest('[data-range]')) e.target.closest('.file-row').draggable = false; });
$('#merge-list').addEventListener('focusout', e => { if (e.target.closest('[data-range]')) e.target.closest('.file-row').draggable = true; });
$('#merge-list').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = b.closest('.file-row').dataset.id;
  const i = merge.items.findIndex(x => x.id === id); const a = merge.items;
  if (b.dataset.act === 'up' && i > 0) [a[i - 1], a[i]] = [a[i], a[i - 1]];
  if (b.dataset.act === 'down' && i < a.length - 1) [a[i + 1], a[i]] = [a[i], a[i + 1]];
  if (b.dataset.act === 'remove') a.splice(i, 1);
  renderMerge();
});
makeSortable($('#merge-list'), '.file-row', () => merge.items, renderMerge, false);
bindInput($('#merge-input'), f => addMergeFiles(f));
acceptFiles($('#panel-merge'), $('#merge-drop'), f => addMergeFiles(f));
$('#merge-go').addEventListener('click', e => runJob(e.currentTarget, '合併中…', async check => {
  const out = await PDFDocument.create();
  for (const it of merge.items) {
    check();
    const r = mergePicks(it); if (r.error) throw new Error(`「${it.name}」${r.error}`);
    const src = await PDFDocument.load(it.bytes);
    (await out.copyPages(src, r.idx)).forEach(p => out.addPage(p));
  }
  check();
  const bytes = await out.save({ useObjectStreams: true });
  const name = ensurePdf($('#merge-name').value);
  await saveFile(name, bytes);
  offerNext(pdfFile(bytes, name), 'pdf', 'merge');
}).catch(err => toast('合併失敗：' + err.message, 'err')));
registerTarget('pdf', 'merge', '合併', f => addMergeFiles(f));
