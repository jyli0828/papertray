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
/* ---------- keyboard ----------
   Ctrl+Z / Ctrl+Y undo and redo; the rest act on the selected pages:
   Delete remove · R rotate right (Shift+R left) · D duplicate · ← → move · Ctrl+A select all · Esc clear selection */
document.addEventListener('keydown', e => {
  if ($('#panel-edit').hidden || $('#edit-work').hidden || document.querySelector('dialog[open]')) return;
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey, a = edit.pages, sel = a.filter(p => p.selected);
  const act = fn => { e.preventDefault(); fn(); renderEdit(); };
  if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undoEdit(); }
  else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redoEdit(); }
  else if (mod && k === 'a') act(() => a.forEach(p => { p.selected = true; }));
  else if (mod || e.altKey) return;
  else if (k === 'escape' && sel.length) act(() => a.forEach(p => { p.selected = false; }));
  else if (!sel.length) { if (['delete', 'backspace', 'r', 'd', 'arrowleft', 'arrowright'].includes(k)) toast('先勾選要處理的頁面'); }
  else if (k === 'delete' || k === 'backspace') act(() => { pushUndo(); edit.pages = a.filter(p => !p.selected); toast(`已刪除 ${sel.length} 頁，可按 Ctrl+Z 復原`); });
  else if (k === 'r') act(() => { pushUndo(); sel.forEach(p => { p.rot = (p.rot + (e.shiftKey ? 270 : 90)) % 360; }); });
  else if (k === 'd') act(() => {
    pushUndo();
    for (let i = a.length - 1; i >= 0; i--) if (a[i].selected) a.splice(i + 1, 0, { ...a[i], id: uid(), selected: false, annots: a[i].annots.map(x => ({ ...x, id: uid() })) });
    toast(`已複製 ${sel.length} 頁`);
  });
  else if (k === 'arrowleft' || k === 'arrowright') {
    const left = k === 'arrowleft';
    if (left ? a[0].selected : a[a.length - 1].selected) { e.preventDefault(); return; } // already at the edge
    act(() => {
      pushUndo();
      if (left) { for (let i = 1; i < a.length; i++) if (a[i].selected && !a[i - 1].selected) [a[i - 1], a[i]] = [a[i], a[i - 1]]; }
      else { for (let i = a.length - 2; i >= 0; i--) if (a[i].selected && !a[i + 1].selected) [a[i + 1], a[i]] = [a[i], a[i + 1]]; }
    });
  }
});

/* ---------- loading ---------- */
/* insertAt: position in the page list for the new pages (default: the end). */
async function loadEditFiles(files, onFirst, insertAt) {
  let at = insertAt == null ? null : insertAt;
  for (const f of files) {
    if (!isPdf(f)) { toast(`「${f.name}」不是 PDF 檔`, 'err'); continue; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    let pj;
    // Parse with pdf-lib only to check the file; the parsed copy is dropped and rebuilt at export time.
    try { await PDFDocument.load(bytes); pj = await openPdfjs(bytes); }
    catch (e) { toast(loadErr(f.name, e), 'err'); continue; }
    const docId = uid();
    edit.docs[docId] = { name: f.name, bytes, pj };
    if (!edit.pages.length) $('#edit-name').value = baseName(f.name) + '-編輯.pdf';
    const fresh = [];
    for (let i = 0; i < pj.numPages; i++) fresh.push({ id: uid(), docId, index: i, baseRot: 0, rot: 0, annots: [], selected: false, view: null, thumb: null, tw: 1, th: 1 });
    if (at == null) edit.pages.push(...fresh); else { edit.pages.splice(at, 0, ...fresh); at += fresh.length; }
    renderEdit();
    // Sizes and rotation are quick to read; thumbnails are drawn later, only for cards near the screen.
    for (let k = 0; k < fresh.length; k++) {
      const p = fresh[k], m = { baseRot: 0, view: [0, 0, 595, 842], thumb: null, tw: 1, th: 1 };
      try {
        const pg = await pj.getPage(p.index + 1);
        m.baseRot = ((pg.rotate % 360) + 360) % 360; m.view = pg.view.slice();
      } catch (e) {}
      edit.meta[metaKey(p)] = m; Object.assign(p, m);
      if (k % 40 === 39 || k === fresh.length - 1) scheduleEditRender();
      if (onFirst) { const cb = onFirst; onFirst = null; cb(p); }
    }
  }
}
async function loadEditThumb(key) {
  const m = edit.meta[key]; if (!m || m.thumb || m.loading) return;
  const cut = key.lastIndexOf(':'), d = edit.docs[key.slice(0, cut)]; if (!d) return;
  m.loading = true;
  try { Object.assign(m, await renderThumb(await d.pj.getPage(+key.slice(cut + 1) + 1))); }
  catch (e) { return; } finally { m.loading = false; }
  for (const p of edit.pages) if (metaKey(p) === key) {
    Object.assign(p, { thumb: m.thumb, tw: m.tw, th: m.th });
    setCardThumb($(`#edit-grid [data-id="${p.id}"]`), m.thumb, m.tw, m.th, p.rot);
  }
}
const selCount = () => edit.pages.filter(p => p.selected).length;
/* New pages go right after the last selected page, or at the end when nothing is selected. */
function insertPos() { let last = -1; edit.pages.forEach((p, i) => { if (p.selected) last = i; }); return last < 0 ? edit.pages.length : last + 1; }

function renderEdit() {
  // Keep the workspace (and its 復原 button) after every page was deleted, as long as that can be undone.
  const has = edit.pages.length > 0 || editHist.undo.length > 0;
  $('#edit-empty').hidden = has; $('#edit-work').hidden = !has;
  const grid = $('#edit-grid'); forgetCards(grid); grid.innerHTML = '';
  const n = edit.pages.length;
  edit.pages.forEach((p, i) => {
    fillMeta(p);
    const m = edit.meta[metaKey(p)];
    if (!p.thumb && m && m.thumb) Object.assign(p, { thumb: m.thumb, tw: m.tw, th: m.th });
    const card = document.createElement('div');
    card.className = 'page-card' + (p.selected ? ' is-selected' : '');
    card.draggable = true; card.dataset.id = p.id;
    const R = (p.baseRot + p.rot) % 360;
    let size = '';
    if (p.view) { const W = p.view[2] - p.view[0], H = p.view[3] - p.view[1]; size = paperName(R % 180 ? H : W, R % 180 ? W : H); }
    card.innerHTML = `
      <div class="thumb">${p.thumb ? '<img alt="" draggable="false">' : '<span class="thumb-loading"></span>'}
        <label class="sel"><input type="checkbox" data-act="sel" ${p.selected ? 'checked' : ''} aria-label="選取第 ${i + 1} 頁"></label>
        ${isRedacted(p) ? '<span class="badge redact" title="這頁有遮蔽範圍，匯出時會整頁轉成圖片">遮蔽</span>' : ''}
        ${p.annots.filter(a => a.type !== 'redact').length ? `<span class="badge" title="已加 ${p.annots.filter(a => a.type !== 'redact').length} 個文字、簽名或標註">${ICON.text}${p.annots.filter(a => a.type !== 'redact').length}</span>` : ''}
      </div>
      <div class="meta">
        <button class="icon-btn mini" data-act="left" aria-label="往前移" ${i === 0 ? 'disabled' : ''}>${ICON.left}</button>
        <span class="mid"><span class="pno">${i + 1}</span><span class="psize">${size}</span></span>
        <button class="icon-btn mini" data-act="right" aria-label="往後移" ${i === n - 1 ? 'disabled' : ''}>${ICON.right}</button>
      </div>
      <div class="actions">
        <button class="icon-btn" data-act="rotl" title="向左轉" aria-label="向左轉">${ICON.rotl}</button>
        <button class="icon-btn" data-act="rotr" title="向右轉" aria-label="向右轉">${ICON.rotr}</button>
        <button class="icon-btn" data-act="text" title="加文字、簽名、標註或遮蔽" aria-label="加文字、簽名、標註或遮蔽">${ICON.pen}</button>
        <button class="icon-btn" data-act="dup" title="複製這一頁" aria-label="複製這一頁">${ICON.copy}</button>
        <button class="icon-btn danger" data-act="del" title="刪除此頁" aria-label="刪除此頁">${ICON.trash}</button>
      </div>`;
    if (p.thumb) {
      const img = card.querySelector('img'); img.src = p.thumb;
      sizeThumbImg(img, p.tw, p.th, p.rot);
    } else if (p.view) whenVisible(card, () => loadEditThumb(metaKey(p)));
    grid.append(card);
  });
  if (has && !n) grid.innerHTML = '<p class="hint grid-empty">所有頁面都刪掉了。按「復原」（Ctrl+Z）可以找回來，或用「插入 PDF」加入新的頁面。</p>';
  const s = selCount();
  $('#edit-stat').textContent = `${n} 頁` + (s ? ` · 已選 ${s}` : '');
  $('#edit-rot-sel').disabled = !s; $('#edit-del-sel').disabled = !s;
  $('#edit-selall').textContent = s === n && n ? '取消全選' : '全選';
  const xs = $('#edit-export-sel'); xs.hidden = !s || s === n; xs.textContent = `只匯出選取的 ${s} 頁`;
  $('#edit-insert-hint').textContent = s ? '插入到選取頁之後' : '插入到最後';
  updateUndoButtons();
}
$('#edit-grid').addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t) {
    if (!isThumbClick(e)) return;
    const i0 = edit.pages.findIndex(x => x.id === e.target.closest('.page-card').dataset.id);
    openPreview(edit.pages.length, i0, async i => {
      const p = edit.pages[i];
      return { page: await edit.docs[p.docId].pj.getPage(p.index + 1), rotation: (p.baseRot + p.rot) % 360 };
    });
    return;
  }
  const id = t.closest('.page-card').dataset.id;
  const i = edit.pages.findIndex(x => x.id === id); const p = edit.pages[i]; const a = edit.pages;
  const act = t.dataset.act;
  if (act === 'sel') {
    // Shift+click ticks or clears every page between the last clicked box and this one.
    const j = edit.pages.findIndex(x => x.id === edit.anchor);
    if (e.shiftKey && j >= 0) for (let k = Math.min(i, j); k <= Math.max(i, j); k++) a[k].selected = t.checked;
    else p.selected = t.checked;
    edit.anchor = p.id; renderEdit(); return;
  }
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
  Object.values(edit.docs).forEach(d => d.pj.destroy()); releaseThumbs(Object.values(edit.meta));
  edit.docs = {}; edit.pages = []; edit.meta = {}; editHist.undo = []; editHist.redo = []; renderEdit();
});

/* ---------- redaction ----------
   A redacted page is re-made from a picture of itself with the boxes painted black, so nothing under them survives
   (no text, no image data). Pages without redaction are copied as they are. */
const isRedacted = p => p.annots.some(a => a.type === 'redact');
function annotUserBox(a, view) {
  const [dx, dy] = userToDisplay(view, a.rot, a.ux, a.uy);
  const [ax, ay] = displayToUser(view, a.rot, dx, dy - a.hPt), [bx, by] = displayToUser(view, a.rot, dx + a.wPt, dy);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}
async function flattenRedacted(out, p) {
  const [x0, y0, x1, y1] = p.view, W = x1 - x0, H = y1 - y0;
  const pg = await edit.docs[p.docId].pj.getPage(p.index + 1);
  let s = 200 / 72; if (W * H * s * s > 30e6) s = Math.sqrt(30e6 / (W * H));
  const vp = pg.getViewport({ scale: s, rotation: 0 }); // unrotated: the new page gets the rotation back below
  const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await pg.render({ canvasContext: ctx, viewport: vp }).promise;
  ctx.fillStyle = '#000';
  for (const a of p.annots) if (a.type === 'redact') {
    const [ax, ay, bx, by] = annotUserBox(a, p.view);
    ctx.fillRect(Math.floor((ax - x0) * s) - 1, Math.floor((y1 - by) * s) - 1, Math.ceil((bx - ax) * s) + 2, Math.ceil((by - ay) * s) + 2);
  }
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .9));
  pg.cleanup(); cv.width = cv.height = 0;
  const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
  const page = out.addPage([W, H]);
  page.drawImage(img, { x: 0, y: 0, width: W, height: H });
  return page;
}
async function renderShapePng(a) {
  const k = 4, c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(a.wPt * k)); c.height = Math.max(1, Math.ceil(a.hPt * k));
  const ctx = c.getContext('2d'); ctx.scale(k, k); drawShape(ctx, a);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

async function exportEdit(onlySel, btn) {
  const pages = onlySel ? edit.pages.filter(p => p.selected) : edit.pages.slice();
  if (!pages.length) { toast('沒有可匯出的頁面'); return; }
  if (!pages.every(fillMeta)) { toast('頁面還在載入，請稍候再匯出'); return; }
  await runJob(btn, '產生中…', async check => {
    const out = await PDFDocument.create();
    // Copy pages per source file. A page used twice (duplicated) needs its own copy, so repeats go in later rounds.
    // Redacted pages are rebuilt from an image instead, so they are not copied.
    const copied = new Map(), byDoc = new Map();
    pages.filter(p => !isRedacted(p)).forEach(p => { if (!byDoc.has(p.docId)) byDoc.set(p.docId, []); byDoc.get(p.docId).push(p); });
    const libs = {};
    for (const docId of byDoc.keys()) libs[docId] = await PDFDocument.load(edit.docs[docId].bytes);
    for (const [docId, list] of byDoc) {
      let rest = list;
      while (rest.length) {
        const seen = new Set(), round = [], later = [];
        rest.forEach(p => (seen.has(p.index) ? later : (seen.add(p.index), round)).push(p));
        const res = await out.copyPages(libs[docId], round.map(p => p.index));
        round.forEach((p, k) => copied.set(p, res[k]));
        rest = later;
      }
    }
    const numbering = $('#edit-numbers').checked;
    const font = numbering ? await out.embedFont(StandardFonts.Helvetica) : null;
    const sigCache = new Map();
    for (let i = 0; i < pages.length; i++) {
      check();
      const p = pages[i], R = (p.baseRot + p.rot) % 360;
      let page, ox = 0, oy = 0;
      if (isRedacted(p)) { page = await flattenRedacted(out, p); ox = p.view[0]; oy = p.view[1]; }
      else { page = copied.get(p); out.addPage(page); }
      page.setRotation(degrees(R));
      for (const a of p.annots) {
        let png, extra = {};
        if (a.type === 'redact') continue; // already burnt into the page image
        if (a.type === 'img') {
          if (!sigCache.has(a.src)) sigCache.set(a.src, await out.embedPng(Uint8Array.from(atob(a.src.split(',')[1]), c => c.charCodeAt(0))));
          png = sigCache.get(a.src);
        } else if (a.type === 'shape') {
          png = await out.embedPng(await renderShapePng(a));
          if (a.kind === 'highlight') extra = { opacity: .45, blendMode: BlendMode.Multiply };
        } else {
          if (!a.text.trim()) continue;
          png = await out.embedPng(await renderTextPng(a));
        }
        page.drawImage(png, { x: a.ux - ox, y: a.uy - oy, width: a.wPt, height: a.hPt, rotate: degrees(a.rot), ...extra });
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
    await deliver(pdfFile(bytes, name), 'pdf', 'edit');
  }).catch(err => toast('匯出失敗：' + err.message, 'err'));
}
$('#edit-export').addEventListener('click', e => exportEdit(false, e.currentTarget));
$('#edit-export-sel').addEventListener('click', e => exportEdit(true, e.currentTarget));
registerTarget('pdf', 'edit', '編輯', loadEditFiles);
