'use strict';
/* ================= MERGE ================= */
const merge = { items: [] };
async function addMergeFiles(files, isSample) {
  if (!isSample && merge.items.some(i => i.sample)) merge.items = merge.items.filter(i => !i.sample);
  for (let f of files) {
    let fromImage = false;
    if (!isPdf(f) && isImage(f)) {
      // A picture (an ID card photo next to a form, say) becomes a one-page A4 PDF in the list.
      try { const [img] = await prepImages([f]); if (!img) continue; f = await imagesToPdf([img]); fromImage = true; }
      catch (e) { toast(`「${f.name}」無法讀取，圖片可能已損壞。`, 'err'); continue; }
    }
    if (!isPdf(f)) { toast(`「${f.name}」不是 PDF 或圖片`, 'err'); continue; }
    const got = await readPdf(f); if (!got) continue; // a password-protected file is unlocked here first
    // The list keeps the file itself (on disk for a picked file), not its bytes; they are read again when merging.
    const size = got.bytes.length, src = keepFile(f, got);
    try {
      // Only the page count is needed now; pdf.js reads just the page tree. The full parse happens once, when merging.
      let pages = f.pages;
      if (!pages) { const pj = await openPdfjs(got.bytes, got.owned); pages = pj.numPages; pj.destroy(); }
      merge.items.push({ id: uid(), name: f.name, size, src, pages, range: '', sample: !!isSample, fromImage });
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
        <div class="file-meta">${it.pages} 頁 · ${fmtSize(it.size)}${it.sample ? ' <span class="chip">範例</span>' : ''}${it.fromImage ? ' <span class="chip soft">圖片轉成 A4</span>' : ''}
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
  const n = merge.items.length, size = merge.items.reduce((s, x) => s + x.size, 0), zip = $('#merge-how').value === 'zip';
  $('#merge-rev-wrap').hidden = !zip;
  const hint = $('#merge-how-hint'); hint.hidden = !zip; hint.classList.toggle('warn', zip && n !== 2);
  if (zip) {
    if (n !== 2) hint.textContent = `交錯合併要剛好兩份檔案：先放正面，再放反面（目前 ${n} 份）。`;
    else if (!bad) {
      const [a, b] = merge.items.map(it => mergePicks(it).idx.length);
      const show = mergeZipOrder().slice(0, 6).map(([k, i]) => (k ? '反' : '正') + (i + 1)).join('、');
      hint.textContent = `順序：${show}${a + b > 6 ? '…' : ''}（數字是各檔案裡的頁碼）` + (a !== b ? `。正面 ${a} 頁、反面 ${b} 頁，數量不同，多出來的頁面接在最後；請確認沒有漏掃。` : '');
    }
  }
  $('#merge-go').disabled = n < 2 || bad || (zip && n !== 2);
  $('#merge-summary').textContent = n ? `${n} 個檔案 · 合併後 ${pages} 頁 · 原始共 ${fmtSize(size)}` : '';
}
/* Two-sided scanning on a one-sided feeder: the fronts as one file, then the stack turned over for the backs, which
   come out last page first. The result takes front 1, back 1, front 2, back 2 …; [file, page] pairs, 0-based. */
function mergeZipOrder() {
  const [fa, fb] = merge.items.map(it => mergePicks(it).idx);
  const back = $('#merge-rev').checked ? fb.slice().reverse() : fb;
  const out = [];
  for (let i = 0; i < Math.max(fa.length, back.length); i++) {
    if (i < fa.length) out.push([0, fa[i]]);
    if (i < back.length) out.push([1, back[i]]);
  }
  return out;
}
$('#merge-how').addEventListener('change', updateMergeSummary);
$('#merge-rev').addEventListener('change', updateMergeSummary);
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
  if ($('#merge-how').value === 'zip' && merge.items.length === 2) {
    const srcs = [], order = mergeZipOrder();
    for (const it of merge.items) { check(); srcs.push(await PDFDocument.load((await fileBytes(it.src)).bytes)); }
    const copied = [];
    for (const k of [0, 1]) copied.push(await out.copyPages(srcs[k], order.filter(o => o[0] === k).map(o => o[1])));
    const next = [0, 0];
    for (const [k] of order) out.addPage(copied[k][next[k]++]);
  } else for (const it of merge.items) {
    check();
    const r = mergePicks(it); if (r.error) throw new Error(`「${it.name}」${r.error}`);
    const src = await PDFDocument.load((await fileBytes(it.src)).bytes);
    (await out.copyPages(src, r.idx)).forEach(p => out.addPage(p));
  }
  check();
  const bytes = await out.save({ useObjectStreams: true });
  const name = ensurePdf($('#merge-name').value);
  await deliver(pdfFile(bytes, name), 'pdf', 'merge');
}).catch(err => toast('合併失敗：' + err.message, 'err')));
registerTarget('pdf', 'merge', '合併', f => addMergeFiles(f));
registerHolder('merge', () => merge.items.reduce((n, it) => n + (it.sample ? 0 : heldBytes(it.src)), 0),
  () => { merge.items = []; renderMerge(); });
