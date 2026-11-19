'use strict';
/* ================= EDIT ================= */
const edit = { docs: {}, pages: [], meta: {} };
let renderQueued = false;
function scheduleEditRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderEdit(); }); }

/* Thumbnail, size and rotation per source page, shared by every copy of that page (duplicates, undo restores). */
const metaKey = p => p.docId + ':' + p.index;
function fillMeta(p) {
  if (p.view) return true;
  const m = edit.meta[metaKey(p)]; if (!m) return false;
  Object.assign(p, m); return true;
}

/* ---------- undo / redo ---------- */
const editHist = { undo: [], redo: [] };
const snapEdit = () => edit.pages.map(p => ({ p, rot: p.rot, selected: p.selected, annots: p.annots.map(a => ({ ...a })) }));
function restoreSnap(s) {
  edit.pages = s.map(x => { x.p.rot = x.rot; x.p.selected = x.selected; x.p.annots = x.annots.map(a => ({ ...a })); return x.p; });
}
function pushUndo(snap) {
  editHist.undo.push(snap || snapEdit()); if (editHist.undo.length > 60) editHist.undo.shift();
  editHist.redo = []; updateUndoButtons();
}
function undoEdit() {
  if (!editHist.undo.length) return;
  editHist.redo.push(snapEdit()); restoreSnap(editHist.undo.pop()); renderEdit(); toast('已復原');
}
function redoEdit() {
  if (!editHist.redo.length) return;
  editHist.undo.push(snapEdit()); restoreSnap(editHist.redo.pop()); renderEdit(); toast('已重做');
}
function updateUndoButtons() { $('#edit-undo').disabled = !editHist.undo.length; $('#edit-redo').disabled = !editHist.redo.length; }
$('#edit-undo').addEventListener('click', undoEdit);
$('#edit-redo').addEventListener('click', redoEdit);
document.addEventListener('keydown', e => {
  if ($('#panel-edit').hidden || document.querySelector('dialog[open]')) return;
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undoEdit(); }
  else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redoEdit(); }
});

/* ---------- loading ---------- */
/* insertAt: position in the page list for the new pages (default: the end). */
async function loadEditFiles(files, onFirst, insertAt) {
  let at = insertAt == null ? null : insertAt;
  for (const f of files) {
    if (!isPdf(f)) { toast(`「${f.name}」不是 PDF 檔`, 'err'); continue; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    let lib, pj;
    try { lib = await PDFDocument.load(bytes); pj = await openPdfjs(bytes); }
    catch (e) { toast(loadErr(f.name, e), 'err'); continue; }
    const docId = uid();
    edit.docs[docId] = { name: f.name, lib, pj };
    if (!edit.pages.length) $('#edit-name').value = baseName(f.name) + '-編輯.pdf';
    const fresh = [];
    for (let i = 0; i < pj.numPages; i++) fresh.push({ id: uid(), docId, index: i, baseRot: 0, rot: 0, annots: [], selected: false, view: null, thumb: null, tw: 1, th: 1 });
    if (at == null) edit.pages.push(...fresh); else { edit.pages.splice(at, 0, ...fresh); at += fresh.length; }
    renderEdit();
    for (const p of fresh) {
      const m = { baseRot: 0, view: [0, 0, 595, 842], thumb: null, tw: 1, th: 1 };
      try {
        const pg = await pj.getPage(p.index + 1);
        m.baseRot = ((pg.rotate % 360) + 360) % 360; m.view = pg.view.slice();
        Object.assign(m, await renderThumb(pg));
      } catch (e) {}
      edit.meta[metaKey(p)] = m; Object.assign(p, m);
      scheduleEditRender();
      if (onFirst) { const cb = onFirst; onFirst = null; cb(p); }
    }
  }
}
const selCount = () => edit.pages.filter(p => p.selected).length;
/* New pages go right after the last selected page, or at the end when nothing is selected. */
function insertPos() { let last = -1; edit.pages.forEach((p, i) => { if (p.selected) last = i; }); return last < 0 ? edit.pages.length : last + 1; }

function renderEdit() {
  const has = edit.pages.length > 0;
  $('#edit-empty').hidden = has; $('#edit-work').hidden = !has;
  const grid = $('#edit-grid'); grid.innerHTML = '';
  const n = edit.pages.length;
  edit.pages.forEach((p, i) => {
    fillMeta(p);
    const card = document.createElement('div');
    card.className = 'page-card' + (p.selected ? ' is-selected' : '');
    card.draggable = true; card.dataset.id = p.id;
    const R = (p.baseRot + p.rot) % 360;
    let size = '';
    if (p.view) { const W = p.view[2] - p.view[0], H = p.view[3] - p.view[1]; size = paperName(R % 180 ? H : W, R % 180 ? W : H); }
    card.innerHTML = `
      <div class="thumb">${p.thumb ? '<img alt="" draggable="false">' : '<span class="thumb-loading"></span>'}
        <label class="sel"><input type="checkbox" data-act="sel" ${p.selected ? 'checked' : ''} aria-label="選取第 ${i + 1} 頁"></label>
        ${p.annots.length ? `<span class="badge" title="已加 ${p.annots.length} 個文字或簽名">${ICON.text}${p.annots.length}</span>` : ''}
      </div>
      <div class="meta">
        <button class="icon-btn mini" data-act="left" aria-label="往前移" ${i === 0 ? 'disabled' : ''}>${ICON.left}</button>
        <span class="mid"><span class="pno">${i + 1}</span><span class="psize">${size}</span></span>
        <button class="icon-btn mini" data-act="right" aria-label="往後移" ${i === n - 1 ? 'disabled' : ''}>${ICON.right}</button>
      </div>
      <div class="actions">
        <button class="icon-btn" data-act="rotl" title="向左轉" aria-label="向左轉">${ICON.rotl}</button>
        <button class="icon-btn" data-act="rotr" title="向右轉" aria-label="向右轉">${ICON.rotr}</button>
        <button class="icon-btn" data-act="text" title="加文字或簽名" aria-label="加文字或簽名">${ICON.pen}</button>
        <button class="icon-btn" data-act="dup" title="複製這一頁" aria-label="複製這一頁">${ICON.copy}</button>
        <button class="icon-btn danger" data-act="del" title="刪除此頁" aria-label="刪除此頁">${ICON.trash}</button>
      </div>`;
    if (p.thumb) {
      const img = card.querySelector('img'); img.src = p.thumb;
      sizeThumbImg(img, p.tw, p.th, p.rot);
    }
    grid.append(card);
  });
  const s = selCount();
  $('#edit-stat').textContent = `${n} 頁` + (s ? ` · 已選 ${s}` : '');
  $('#edit-rot-sel').disabled = !s; $('#edit-del-sel').disabled = !s;
  $('#edit-selall').textContent = s === n && n ? '取消全選' : '全選';
  const xs = $('#edit-export-sel'); xs.hidden = !s || s === n; xs.textContent = `只匯出選取的 ${s} 頁`;
  $('#edit-insert-hint').textContent = s ? '插入到選取頁之後' : '插入到最後';
  updateUndoButtons();
}
$('#edit-grid').addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const id = t.closest('.page-card').dataset.id;
  const i = edit.pages.findIndex(x => x.id === id); const p = edit.pages[i]; const a = edit.pages;
  const act = t.dataset.act;
  if (act === 'sel') { p.selected = t.checked; renderEdit(); return; }
  if (act === 'text') { if (!fillMeta(p)) { toast('這頁還在載入'); return; } openTextEditor(p); return; }
  pushUndo();
  switch (act) {
    case 'left': if (i > 0) [a[i - 1], a[i]] = [a[i], a[i - 1]]; break;
    case 'right': if (i < a.length - 1) [a[i + 1], a[i]] = [a[i], a[i + 1]]; break;
    case 'rotl': p.rot = (p.rot + 270) % 360; break;
    case 'rotr': p.rot = (p.rot + 90) % 360; break;
    case 'dup': a.splice(i + 1, 0, { ...p, id: uid(), selected: false, annots: p.annots.map(x => ({ ...x, id: uid() })) }); toast(`已複製第 ${i + 1} 頁`); break;
    case 'del': a.splice(i, 1); toast(`已刪除第 ${i + 1} 頁，可按「復原」`); break;
  }
  renderEdit();
});
makeSortable($('#edit-grid'), '.page-card', () => edit.pages, renderEdit, true, () => pushUndo());
bindInput($('#edit-input'), loadEditFiles);
bindInput($('#edit-input-more'), files => { pushUndo(); loadEditFiles(files, null, insertPos()); });
acceptFiles($('#panel-edit'), $('#edit-drop'), files => { if (edit.pages.length) pushUndo(); loadEditFiles(files, null, edit.pages.length ? insertPos() : null); });
$('#edit-blank').addEventListener('click', async () => {
  const pos = insertPos(), ref = edit.pages[pos - 1] || edit.pages[pos];
  let size = [595.28, 841.89];
  if (ref && fillMeta(ref)) size = dispSize(ref.view, (ref.baseRot + ref.rot) % 360);
  const doc = await PDFDocument.create(); doc.addPage(size);
  pushUndo();
  await loadEditFiles([pdfFile(await doc.save(), '空白頁.pdf')], null, pos);
  toast('已插入空白頁');
});
$('#edit-sample').addEventListener('click', async () => {
  loadEditFiles([asFile(await makeSample('Quarterly Report', 4, [.04, .48, .42]), 'quarterly-report.pdf')]);
});
$('#edit-selall').addEventListener('click', () => {
  const all = selCount() === edit.pages.length; edit.pages.forEach(p => { p.selected = !all; }); renderEdit();
});
$('#edit-rot-sel').addEventListener('click', () => { pushUndo(); edit.pages.forEach(p => { if (p.selected) p.rot = (p.rot + 90) % 360; }); renderEdit(); });
$('#edit-del-sel').addEventListener('click', () => {
  pushUndo();
  const s = selCount(); edit.pages = edit.pages.filter(p => !p.selected); toast(`已刪除 ${s} 頁，可按「復原」`); renderEdit();
});
$('#edit-clear').addEventListener('click', e => {
  const b = e.currentTarget;
  if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '再按一次確認清空'; setTimeout(() => { b.dataset.armed = ''; b.textContent = '清空重來'; }, 3000); return; }
  b.dataset.armed = ''; b.textContent = '清空重來';
  Object.values(edit.docs).forEach(d => d.pj.destroy());
  edit.docs = {}; edit.pages = []; edit.meta = {}; editHist.undo = []; editHist.redo = []; renderEdit();
});

async function exportEdit(onlySel, btn) {
  const pages = onlySel ? edit.pages.filter(p => p.selected) : edit.pages.slice();
  if (!pages.length) { toast('沒有可匯出的頁面'); return; }
  if (!pages.every(fillMeta)) { toast('頁面還在載入，請稍候再匯出'); return; }
  await runJob(btn, '產生中…', async check => {
    const out = await PDFDocument.create();
    // Copy pages per source file. A page used twice (duplicated) needs its own copy, so repeats go in later rounds.
    const copied = new Map(), byDoc = new Map();
    pages.forEach(p => { if (!byDoc.has(p.docId)) byDoc.set(p.docId, []); byDoc.get(p.docId).push(p); });
    for (const [docId, list] of byDoc) {
      let rest = list;
      while (rest.length) {
        const seen = new Set(), round = [], later = [];
        rest.forEach(p => (seen.has(p.index) ? later : (seen.add(p.index), round)).push(p));
        const res = await out.copyPages(edit.docs[docId].lib, round.map(p => p.index));
        round.forEach((p, k) => copied.set(p, res[k]));
        rest = later;
      }
    }
    const numbering = $('#edit-numbers').checked;
    const font = numbering ? await out.embedFont(StandardFonts.Helvetica) : null;
    const sigCache = new Map();
    for (let i = 0; i < pages.length; i++) {
      check();
      const p = pages[i]; const page = copied.get(p);
      out.addPage(page);
      const R = (p.baseRot + p.rot) % 360;
      page.setRotation(degrees(R));
      for (const a of p.annots) {
        let png;
        if (a.type === 'img') {
          if (!sigCache.has(a.src)) sigCache.set(a.src, await out.embedPng(Uint8Array.from(atob(a.src.split(',')[1]), c => c.charCodeAt(0))));
          png = sigCache.get(a.src);
        } else {
          if (!a.text.trim()) continue;
          png = await out.embedPng(await renderTextPng(a));
        }
        page.drawImage(png, { x: a.ux, y: a.uy, width: a.wPt, height: a.hPt, rotate: degrees(a.rot) });
      }
      if (font) {
        const label = `${i + 1} / ${pages.length}`, size = 10;
        const tw = font.widthOfTextAtSize(label, size);
        const cb = page.getCropBox(); const view = [cb.x, cb.y, cb.x + cb.width, cb.y + cb.height];
        const [dw, dh] = dispSize(view, R);
        const [ux, uy] = displayToUser(view, R, dw / 2 - tw / 2, dh - 22);
        page.drawText(label, { x: ux, y: uy, size, font, color: rgb(.33, .36, .4), rotate: degrees(R) });
      }
    }
    check();
    const bytes = await out.save({ useObjectStreams: true });
    const name = ensurePdf($('#edit-name').value);
    await saveFile(name, bytes);
    offerNext(pdfFile(bytes, name), 'pdf', 'edit');
  }).catch(err => toast('匯出失敗：' + err.message, 'err'));
}
$('#edit-export').addEventListener('click', e => exportEdit(false, e.currentTarget));
$('#edit-export-sel').addEventListener('click', e => exportEdit(true, e.currentTarget));
registerTarget('pdf', 'edit', '編輯', loadEditFiles);
