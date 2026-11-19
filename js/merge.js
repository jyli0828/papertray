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
      merge.items.push({ id: uid(), name: f.name, size: bytes.length, bytes, pages: doc.getPageCount(), sample: !!isSample });
    } catch (e) { toast(loadErr(f.name, e), 'err'); }
  }
  renderMerge();
}
function renderMerge() {
  const list = $('#merge-list'); list.innerHTML = '';
  const n = merge.items.length;
  merge.items.forEach((it, i) => {
    const li = document.createElement('li');
    li.className = 'file-row'; li.draggable = true; li.dataset.id = it.id;
    li.innerHTML = `<span class="grip" aria-hidden="true">${ICON.grip}</span><span class="idx">${i + 1}</span>
      <div class="file-main"><div class="file-name"></div><div class="file-meta">${it.pages} 頁 · ${fmtSize(it.size)}${it.sample ? ' <span class="chip">範例</span>' : ''}</div></div>
      <div class="row-btns">
        <button class="icon-btn" data-act="up" aria-label="上移" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
        <button class="icon-btn" data-act="down" aria-label="下移" ${i === n - 1 ? 'disabled' : ''}>${ICON.down}</button>
        <button class="icon-btn danger" data-act="remove" aria-label="移除">${ICON.x}</button>
      </div>`;
    li.querySelector('.file-name').textContent = it.name;
    list.append(li);
  });
  const pages = merge.items.reduce((s, x) => s + x.pages, 0);
  const size = merge.items.reduce((s, x) => s + x.size, 0);
  $('#merge-empty').hidden = n > 0;
  $('#merge-sample-note').hidden = !merge.items.some(i => i.sample);
  $('#merge-go').disabled = n < 2;
  $('#merge-summary').textContent = n ? `${n} 個檔案 · 共 ${pages} 頁 · ${fmtSize(size)}` : '';
}
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
$('#merge-go').addEventListener('click', e => busy(e.currentTarget, '合併中…', async () => {
  const out = await PDFDocument.create();
  for (const it of merge.items) {
    const src = await PDFDocument.load(it.bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach(p => out.addPage(p));
  }
  const bytes = await out.save({ useObjectStreams: true });
  await saveFile(ensurePdf($('#merge-name').value), bytes);
}).catch(err => toast('合併失敗：' + err.message, 'err')));
