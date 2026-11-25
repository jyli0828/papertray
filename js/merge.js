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
      let pages = f.pages, marks = 0;
      if (!pages) {
        const pj = await openPdfjs(got.bytes, got.owned); pages = pj.numPages;
        const count = list => (list || []).reduce((n, o) => n + 1 + count(o.items), 0);
        try { marks = count(await pj.getOutline()); } catch (e) {}
        pj.destroy();
      }
      merge.items.push({ id: uid(), name: f.name, size, src, pages, marks, range: '', sample: !!isSample, fromImage });
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
        <div class="file-meta">${it.pages} 頁 · ${fmtSize(it.size)}${it.marks ? ` · ${it.marks} 個書籤` : ''}${it.sample ? ' <span class="chip">範例</span>' : ''}${it.fromImage ? ' <span class="chip soft">圖片轉成 A4</span>' : ''}
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
    else if (bad) { hint.textContent = '取頁的頁碼有誤，修正後會顯示交錯的順序。'; hint.classList.add('warn'); }
    else {
      const [a, b] = merge.items.map(it => mergePicks(it).idx.length);
      const show = mergeZipOrder().slice(0, 6).map(([k, i]) => (k ? '反' : '正') + (i + 1)).join('、');
      hint.textContent = `順序：${show}${a + b > 6 ? '…' : ''}（數字是各檔案裡的頁碼）` + (a !== b ? `。正面 ${a} 頁、反面 ${b} 頁，數量不同，多出來的頁面接在最後；請確認沒有漏掃。` : '');
    }
  }
  setJobButton($('#merge-go'), { disabled: n < 2 || bad || (zip && n !== 2) });
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
  if ($('#merge-go').classList.contains('is-running')) { toast('正在合併，請等完成（或按「取消」）再調整清單'); return; }
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
/* ---------- bookmarks ----------
   pdf-lib copies pages, not a document's bookmarks (its outline). Each file's bookmarks are read here and written into
   the merged file pointing at the new pages; with 「每份檔案加一個書籤」 each file also gets a bookmark with its name at
   its first page, its own bookmarks under it. A bookmark to a page left out (取頁) goes to its first sub-bookmark still
   in, or is dropped when there is none. */
function readOutline(src) {
  const L = window.PDFLib, N = k => PDFName.of(k), ctx = src.context, cat = src.catalog;
  const root = cat.lookupMaybe(N('Outlines'), PDFDict); if (!root) return [];
  const pageAt = new Map(src.getPages().map((p, i) => [p.ref.toString(), i]));
  const text = o => o && o.decodeText ? o.decodeText() : '';
  const destOf = item => {
    let d = item.get(N('Dest'));
    const a = item.lookupMaybe(N('A'), PDFDict);
    if (!d && a && a.get(N('S')) === N('GoTo')) d = a.get(N('D'));
    d = ctx.lookup(d);
    if (d && !(d instanceof PDFArray) && !(d instanceof PDFDict)) d = namedDest(src, d); // a name or a string (core.js)
    if (d instanceof PDFDict) d = d.lookup(N('D'));
    if (!(d instanceof PDFArray) || !d.size() || !(d.get(0) instanceof L.PDFRef)) return null;
    const page = pageAt.get(d.get(0).toString());
    return page === undefined ? null : { page, rest: d.asArray().slice(1).filter(v => !(v instanceof L.PDFRef)) };
  };
  const uriOf = item => {
    const a = item.lookupMaybe(N('A'), PDFDict);
    return a && a.get(N('S')) === N('URI') ? a.lookup(N('URI')) || null : null;
  };
  const seen = new Set();
  const walk = (ref, depth) => {
    const out = [];
    while (ref instanceof L.PDFRef && !seen.has(ref.toString()) && depth < 50) { // a broken outline may loop
      seen.add(ref.toString());
      const item = ctx.lookup(ref); if (!(item instanceof PDFDict)) break;
      const count = item.lookup(N('Count'));
      out.push({ title: text(item.lookup(N('Title'))), dest: destOf(item), uri: uriOf(item),
        open: count instanceof PDFNumber && count.asNumber() > 0, kids: walk(item.get(N('First')), depth + 1) });
      ref = item.get(N('Next'));
    }
    return out;
  };
  return walk(root.get(N('First')), 0);
}
/* nodes: [{ title, page (new PDFPage), rest (the destination's view: /XYZ left top zoom …), uri, open, kids }] */
function writeOutline(out, nodes) {
  if (!nodes.length) return;
  const L = window.PDFLib, N = k => PDFName.of(k), ctx = out.context;
  const shown = n => n.open ? below(n) : 0, below = n => n.kids.reduce((s, k) => s + 1 + shown(k), 0);
  const put = (list, parent) => {
    const refs = list.map(() => ctx.nextRef());
    list.forEach((n, i) => {
      const d = { Title: L.PDFHexString.fromText(n.title || '（無標題）'), Parent: parent };
      if (i > 0) d.Prev = refs[i - 1];
      if (i < list.length - 1) d.Next = refs[i + 1];
      if (n.kids.length) { const kids = put(n.kids, refs[i]); d.First = kids[0]; d.Last = kids[kids.length - 1]; d.Count = n.open ? below(n) : -below(n); }
      if (n.page) d.Dest = ctx.obj([n.page.ref, ...(n.rest && n.rest.length ? n.rest : [N('XYZ'), L.PDFNull, L.PDFNull, L.PDFNull])]);
      else if (n.uri) d.A = ctx.obj({ S: 'URI', URI: n.uri });
      ctx.assign(refs[i], ctx.obj(d));
    });
    return refs;
  };
  const root = ctx.nextRef(), top = put(nodes, root);
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: top[0], Last: top[top.length - 1], Count: nodes.reduce((s, n) => s + 1 + shown(n), 0) }));
  out.catalog.set(N('Outlines'), root);
  out.catalog.set(N('PageMode'), N('UseOutlines')); // open with the bookmarks showing
}
/* A file's bookmarks pointed at its new pages (pageFor(source index) → new PDFPage or nothing). */
function placeOutline(items, pageFor) {
  return items.map(it => {
    const kids = placeOutline(it.kids, pageFor), page = it.dest && pageFor(it.dest.page);
    const first = kids.find(k => k.page);
    if (!page && !it.uri && !first) return null;
    return { title: it.title, page: page || (!it.uri && first ? first.page : null), rest: page ? it.dest.rest : null, uri: page ? null : it.uri, open: it.open, kids };
  }).filter(Boolean);
}
$('#merge-how').addEventListener('change', () => { $('#merge-bm-wrap').hidden = $('#merge-how').value === 'zip'; });

$('#merge-go').addEventListener('click', e => runJob(e.currentTarget, '合併中…', async check => {
  // The list as it is now: moving or removing a file while this runs must not change which pages go in, or which
  // file each bookmark is named after.
  const items = merge.items.slice(), how = $('#merge-how').value, perFile = $('#merge-bm').checked && how !== 'zip';
  const name = ensurePdf($('#merge-name').value);
  const picks = items.map(it => mergePicks(it)), bad = picks.findIndex(r => r.error);
  if (bad >= 0) throw new Error(`「${items[bad].name}」${picks[bad].error}`);
  const order = how === 'zip' && items.length === 2 ? mergeZipOrder() : null;
  const out = await PDFDocument.create();
  // A parsed file takes several times its size, so each one is let go as soon as its pages are in: what the steps at
  // the end need from it (form settings, layers, bookmarks) is taken right after copying. Holding them all until the
  // end made merging twenty big files take gigabytes.
  const forms = [], layers = [], outlines = [];
  // Internal links are cut before copying and joined again to the new pages (see unlinkDests() in core.js).
  const placed = new Map(), copy = async (k, src, idx) => {
    markLayers(src, k); // see relinkLayers() in core.js
    const undo = unlinkDests(src, idx, k), pages = await out.copyPages(src, idx); undo();
    idx.forEach((i, j) => { if (!placed.has(`${k}:${i}`)) placed.set(`${k}:${i}`, pages[j]); });
    forms[k] = formDefaults(out, src, pages);
    layers[k] = layerPart(out, k, src);
    try { outlines[k] = readOutline(src); } catch (err) { outlines[k] = []; } // a broken outline is left out
    return pages;
  };
  const load = async it => PDFDocument.load((await fileBytes(it.src)).bytes);
  if (order) {
    const copied = [];
    for (const k of [0, 1]) { check(); copied.push(await copy(k, await load(items[k]), order.filter(o => o[0] === k).map(o => o[1]))); }
    const next = [0, 0];
    for (const [k] of order) out.addPage(copied[k][next[k]++]);
  } else for (let k = 0; k < items.length; k++) {
    check();
    (await copy(k, await load(items[k]), picks[k].idx)).forEach(p => out.addPage(p));
  }
  check();
  relinkDests(out, (k, i) => placed.get(`${k}:${i}`));
  relinkFormFields(out, forms); // keep form fields fillable
  writeLayers(out, layers); // hidden layers stay hidden
  // Bookmarks: each file's own, and (when merging in order) one per file holding them.
  writeOutline(out, items.flatMap((it, k) => {
    let own = [];
    try { own = placeOutline(outlines[k] || [], i => placed.get(`${k}:${i}`)); } catch (err) { own = []; }
    if (!perFile) return own;
    const first = placed.get(`${k}:${picks[k].idx[0]}`);
    return first ? [{ title: baseName(it.name), page: first, open: true, kids: own }] : [];
  }));
  const bytes = await out.save({ useObjectStreams: true });
  await deliver(pdfFile(bytes, name), 'pdf', 'merge');
}).catch(err => toast('合併失敗：' + err.message, 'err')));
registerTarget('pdf', 'merge', '合併', f => addMergeFiles(f));
registerHolder('merge', () => merge.items.reduce((n, it) => n + (it.sample ? 0 : heldBytes(it.src)), 0),
  () => { merge.items = []; renderMerge(); });
