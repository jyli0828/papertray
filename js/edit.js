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
/* insertAt: position in the page list for the new pages (default: the end). replace: the first file that opens
   takes the place of whatever the editor held (signing a new PDF must not carry the last one along);
   the old files are only closed once the new one has opened, so a cancelled password prompt loses nothing.
   undoable: adding the pages is one undo step, recorded only once a file has really opened (a file that is not a
   PDF, or a cancelled password prompt, leaves nothing to undo). */
async function loadEditFiles(files, onFirst, insertAt, replace, undoable) {
  let at = insertAt == null ? null : insertAt;
  for (let f of files) {
    if (!isPdf(f) && isImage(f)) { // a picture is inserted as an A4 page
      try { const [img] = await prepImages([f]); if (!img) continue; f = await imagesToPdf([img]); }
      catch (e) { toast(`「${f.name}」無法讀取，圖片可能已損壞。`, 'err'); continue; }
    }
    if (!isPdf(f)) { toast(`「${f.name}」不是 PDF 或圖片`, 'err'); continue; }
    const got = await readPdf(f); if (!got) continue; // a password-protected file is unlocked here first
    const { bytes, owned } = got, size = bytes.length; // read now: pdf.js may take the bytes over
    // pdf.js keeps the only copy of the file; export asks it for the bytes back (pj.getData()).
    let pj;
    try { pj = await openPdfjs(bytes, owned); }
    catch (e) { toast(loadErr(f.name, e), 'err'); continue; }
    if (replace) {
      replace = false;
      if (edit.pages.length || editHist.undo.length) { clearEdit(); toast(`已關閉之前的檔案，改為處理「${f.name}」`); }
    }
    if (undoable) { pushUndo(); undoable = false; }
    const docId = uid();
    edit.docs[docId] = { name: f.name, pj, size };
    if (!edit.pages.length) { $('#edit-name').value = baseName(f.name) + '-編輯.pdf'; fillDocInfo(pj); }
    const fresh = [];
    for (let i = 0; i < pj.numPages; i++) fresh.push({ id: uid(), docId, index: i, baseRot: 0, rot: 0, annots: [], selected: false, view: null, thumb: null, tw: 1, th: 1 });
    if (at == null) edit.pages.push(...fresh); else { edit.pages.splice(at, 0, ...fresh); at += fresh.length; }
    renderEdit();
    // Sizes and rotation are quick to read; thumbnails are drawn later, only for cards near the screen.
    await eachPage(pj, (pg, k) => {
      const p = fresh[k], m = { baseRot: 0, view: [0, 0, 595, 842], thumb: null, tw: 1, th: 1 };
      if (pg) { m.baseRot = ((pg.rotate % 360) + 360) % 360; m.view = pg.view.slice(); }
      edit.meta[metaKey(p)] = m; Object.assign(p, m);
    }, { batch: () => {
      scheduleEditRender();
      if (onFirst) { const cb = onFirst; onFirst = null; cb(fresh[0]); }
    } });
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
    const card = $(`#edit-grid [data-id="${p.id}"]`);
    if (card) { setCardThumb(card, m.thumb, m.tw, m.th, p.rot); card._shown = `${m.thumb}|${p.rot}`; }
  }
}
const selCount = () => edit.pages.filter(p => p.selected).length;
/* New pages go right after the last selected page, or at the end when nothing is selected. */
function insertPos() { let last = -1; edit.pages.forEach((p, i) => { if (p.selected) last = i; }); return last < 0 ? edit.pages.length : last + 1; }

/* Cards are kept from one render to the next: a card is built again only when its badges change; its number, size,
   tick, arrows, thumbnail and turn are updated in place. Rebuilding all of them on every click made each click on a
   2000-page document take half a second, and opening it built every card twice (again once its size was read). */
const editCardLook = p => String(p.annots.length);
function newEditCard(p, size) {
  const card = document.createElement('div');
  card.className = 'page-card'; card.draggable = true; card.dataset.id = p.id;
  const notes = p.annots.length;
  card.innerHTML = `
      <div class="thumb">${p.thumb ? '<img alt="" draggable="false">' : '<span class="thumb-loading"></span>'}
        <label class="sel"><input type="checkbox" data-act="sel"></label>
        ${notes ? `<span class="badge" title="已加 ${notes} 個文字、簽名或標註">${ICON.text}${notes}</span>` : ''}
      </div>
      <div class="meta">
        <button class="icon-btn mini" data-act="left" aria-label="往前移">${ICON.left}</button>
        <span class="mid"><span class="pno"></span><span class="psize">${size}</span></span>
        <button class="icon-btn mini" data-act="right" aria-label="往後移">${ICON.right}</button>
      </div>
      <div class="actions">
        <button class="icon-btn" data-act="rotl" title="向左轉" aria-label="向左轉">${ICON.rotl}</button>
        <button class="icon-btn" data-act="rotr" title="向右轉" aria-label="向右轉">${ICON.rotr}</button>
        <button class="icon-btn" data-act="text" title="加文字、簽名或標註" aria-label="加文字、簽名或標註">${ICON.pen}</button>
        <button class="icon-btn" data-act="dup" title="複製這一頁" aria-label="複製這一頁">${ICON.copy}</button>
        <button class="icon-btn danger" data-act="del" title="刪除此頁" aria-label="刪除此頁">${ICON.trash}</button>
      </div>`;
  if (p.thumb) {
    const img = card.querySelector('img'); img.src = p.thumb;
    sizeThumbImg(img, p.tw, p.th, p.rot);
  } else if (p.view) whenVisible(card, () => loadEditThumb(metaKey(p)));
  card._watch = !!p.view; card._size = size; card._psize = card.querySelector('.psize');
  card._look = editCardLook(p); card._at = ''; card._shown = p.thumb ? `${p.thumb}|${p.rot}` : '';
  card._sel = card.querySelector('[data-act="sel"]'); card._pno = card.querySelector('.pno');
  card._left = card.querySelector('[data-act="left"]'); card._right = card.querySelector('[data-act="right"]');
  return card;
}
const dropCard = c => { stopThumb(c); c.remove(); };
function renderEdit() {
  // Keep the workspace (and its 復原 button) after every page was deleted, as long as that can be undone.
  const has = edit.pages.length > 0 || editHist.undo.length > 0;
  $('#edit-empty').hidden = has; $('#edit-work').hidden = !has;
  const grid = $('#edit-grid'), n = edit.pages.length, old = new Map();
  for (const c of [...grid.children]) if (c.classList.contains('page-card')) old.set(c.dataset.id, c); else c.remove();
  const cards = edit.pages.map((p, i) => {
    fillMeta(p);
    const m = edit.meta[metaKey(p)];
    if (!p.thumb && m && m.thumb) Object.assign(p, { thumb: m.thumb, tw: m.tw, th: m.th });
    const R = (p.baseRot + p.rot) % 360;
    let size = '';
    if (p.view) { const W = p.view[2] - p.view[0], H = p.view[3] - p.view[1]; size = paperName(R % 180 ? H : W, R % 180 ? W : H); }
    let card = old.get(p.id); old.delete(p.id);
    if (card && card._look !== editCardLook(p)) { const fresh = newEditCard(p, size); card.replaceWith(fresh); stopThumb(card); card = fresh; }
    else if (!card) card = newEditCard(p, size);
    // The size arrives after the card is first shown (a long file lists its pages first): filled in, not rebuilt.
    if (card._size !== size) { card._size = size; card._psize.textContent = size; }
    if (!card._watch && p.view && !p.thumb) { card._watch = true; whenVisible(card, () => loadEditThumb(metaKey(p))); }
    const shown = p.thumb ? `${p.thumb}|${p.rot}` : '';
    if (shown && card._shown !== shown) { card._shown = shown; setCardThumb(card, p.thumb, p.tw, p.th, p.rot); }
    const at = `${i}/${n}/${p.selected}`;
    if (card._at !== at) { // its place in the list, and its tick
      card._at = at;
      card.classList.toggle('is-selected', p.selected);
      card._sel.checked = p.selected; card._sel.setAttribute('aria-label', `選取第 ${i + 1} 頁`);
      card._pno.textContent = i + 1; card._left.disabled = i === 0; card._right.disabled = i === n - 1;
    }
    return card;
  });
  for (const c of old.values()) dropCard(c); // pages deleted
  // Put the cards in order. Cards already in place stay; only those that moved (or are new) are inserted.
  let next = grid.firstElementChild;
  for (const card of cards) {
    if (card === next) next = next.nextElementSibling;
    else grid.insertBefore(card, next);
  }
  if (has && !n) grid.innerHTML = '<p class="hint grid-empty">所有頁面都刪掉了。按「復原」（Ctrl+Z）可以找回來，或用「插入 PDF」加入新的頁面。</p>';
  const s = selCount();
  $('#edit-stat').textContent = `${n} 頁` + (s ? ` · 已選 ${s}` : '');
  $('#edit-rot-sel').disabled = !s; $('#edit-del-sel').disabled = !s;
  $('#edit-selall').textContent = s === n && n ? '取消全選' : '全選';
  setJobButton($('#edit-export-sel'), { hidden: !s || s === n, text: `只匯出選取的 ${s} 頁` });
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
bindInput($('#edit-input-more'), files => loadEditFiles(files, null, insertPos(), false, true));
acceptFiles($('#panel-edit'), $('#edit-drop'), files => loadEditFiles(files, null, edit.pages.length ? insertPos() : null, false, edit.pages.length > 0));
$('#edit-blank').addEventListener('click', async () => {
  const pos = insertPos(), ref = edit.pages[pos - 1] || edit.pages[pos];
  let size = [595.28, 841.89];
  if (ref && fillMeta(ref)) size = dispSize(ref.view, (ref.baseRot + ref.rot) % 360);
  const doc = await PDFDocument.create(); doc.addPage(size);
  await loadEditFiles([pdfFile(await doc.save(), '空白頁.pdf')], null, pos, false, true);
  toast('已插入空白頁');
});
onSample($('#edit-sample'), async () => {
  await loadEditFiles([asFile(await makeSample('Quarterly Report', 4, [.04, .48, .42]), 'quarterly-report.pdf')]);
});
$('#edit-selall').addEventListener('click', () => {
  const all = selCount() === edit.pages.length; edit.pages.forEach(p => { p.selected = !all; }); renderEdit();
});
/* ---------- blank pages ----------
   Ticks the pages that look empty, such as the blank backs of a double-sided scan, so they can be checked and
   deleted. A page with real text is never blank. Otherwise a picture of it is drawn without the outer 6% (scan
   edges, punch holes, a page number in the margin) and cut into 16 px cells; a cell has ink when it holds several
   pixels clearly darker than the paper itself. Grey paper, noise and faint show-through from the other side are not
   dark enough, a speck of dust fills only a cell or two, and even one short line of text fills a dozen. */
async function pageLooksBlank(pg) {
  const tc = await pg.getTextContent();
  const text = tc.items.map(it => it.str || '').join('').replace(/\s+/g, '');
  if (text && !/^[\d\s\-–—./|·()第頁页PpageofOF]{1,12}$/.test(text)) return false; // only a page number does not count
  const vp1 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: 1000 / Math.max(vp1.width, vp1.height) });
  const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await pg.render({ canvasContext: ctx, viewport: vp }).promise;
  const mx = Math.round(cv.width * .06), my = Math.round(cv.height * .06), W = cv.width - mx * 2, H = cv.height - my * 2;
  const { data } = ctx.getImageData(mx, my, W, H);
  pg.cleanup(); cv.width = cv.height = 0;
  const lum = new Uint8Array(W * H), hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) hist[lum[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8]++;
  let acc = 0, paper = 255;
  for (let l = 0; l < 256; l++) { acc += hist[l]; if (acc >= lum.length / 2) { paper = l; break; } }
  if (paper < 150) return false; // a dark or full-colour page (a cover, a photo) is not an empty one
  const C = 16, cw = Math.ceil(W / C), cells = new Uint16Array(cw * Math.ceil(H / C)), cut = paper - 50;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (lum[y * W + x] < cut) cells[((y / C) | 0) * cw + ((x / C) | 0)]++;
  let inked = 0; for (const c of cells) if (c >= 6) inked++;
  return inked <= 4;
}
$('#edit-find-blank').addEventListener('click', e => {
  const btn = e.currentTarget;
  if (!edit.pages.every(fillMeta)) { toast('頁面還在載入，請稍候'); return; }
  runJob(btn, '檢查中…', async check => {
    const keys = [...new Set(edit.pages.map(metaKey))];
    for (let i = 0; i < keys.length; i++) {
      check();
      const m = edit.meta[keys[i]]; if (m.blank !== undefined) continue;
      $('#edit-stat').textContent = `檢查第 ${i + 1} / ${keys.length} 頁`;
      const cut = keys[i].lastIndexOf(':'), d = edit.docs[keys[i].slice(0, cut)];
      try { m.blank = await pageLooksBlank(await d.pj.getPage(+keys[i].slice(cut + 1) + 1)); } catch (err) { m.blank = false; }
    }
    // Something added on the page (a signature, text, a box) makes it not blank any more.
    const blank = edit.pages.filter(p => edit.meta[metaKey(p)].blank && !p.annots.length);
    edit.pages.forEach(p => { p.selected = blank.includes(p); });
    if (!blank.length) toast('沒有找到空白頁');
    else toast(`找到 ${blank.length} 頁空白頁，已勾選。確認沒有選錯後，按「刪除選取」或 Delete。`);
  }).catch(err => toast('檢查失敗：' + err.message, 'err')).finally(renderEdit);
});
$('#edit-rot-sel').addEventListener('click', () => { pushUndo(); edit.pages.forEach(p => { if (p.selected) p.rot = (p.rot + 90) % 360; }); renderEdit(); });
$('#edit-del-sel').addEventListener('click', () => {
  pushUndo();
  const s = selCount(); edit.pages = edit.pages.filter(p => !p.selected); toast(`已刪除 ${s} 頁，可按「復原」`); renderEdit();
});
/* Exporting and finding blank pages read the open files until they finish; closing them under way breaks the job. */
function editBusy() {
  if (!['#edit-export', '#edit-export-sel', '#edit-find-blank'].some(s => $(s).classList.contains('is-running'))) return false;
  toast('「編輯」正在處理這份檔案，請等完成（或按取消）再換檔案');
  return true;
}
$('#edit-clear').addEventListener('click', e => {
  if (editBusy()) return;
  const b = e.currentTarget;
  if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '再按一次確認清空'; setTimeout(() => { b.dataset.armed = ''; b.textContent = '清空重來'; }, 3000); return; }
  b.dataset.armed = ''; b.textContent = '清空重來';
  clearEdit();
});
function clearEdit() {
  Object.values(edit.docs).forEach(d => d.pj.destroy()); releaseThumbs(Object.values(edit.meta));
  edit.docs = {}; edit.pages = []; edit.meta = {}; editHist.undo = []; editHist.redo = []; renderEdit();
  MD_FIELDS.forEach(k => { $('#md-' + k).value = ''; });
}
registerHolder('edit', () => Object.values(edit.docs).reduce((n, d) => n + (d.size || 0), 0), clearEdit);

/* ---------- export options: page numbers, header and footer, document info ---------- */
const MD_FIELDS = ['title', 'author', 'subject', 'keywords'];
/* The first file's own title, author… are offered as the starting values (a new PDF would otherwise lose them). */
async function fillDocInfo(pj) {
  if (MD_FIELDS.some(k => $('#md-' + k).value.trim())) return;
  try {
    const { info } = await pj.getMetadata();
    const v = { title: info.Title, author: info.Author, subject: info.Subject, keywords: info.Keywords };
    MD_FIELDS.forEach(k => { if (typeof v[k] === 'string') $('#md-' + k).value = v[k].trim(); });
  } catch (e) {}
  updateOptsSummary();
}
function updateOptsSummary() {
  const parts = [];
  if ($('#edit-numbers').checked) parts.push('頁碼');
  if ($('#hf-head').value.trim()) parts.push('頁首');
  if ($('#hf-foot').value.trim()) parts.push('頁尾');
  if (MD_FIELDS.some(k => $('#md-' + k).value.trim())) parts.push('文件資訊');
  $('#edit-opts-sum').textContent = parts.length ? '已設定：' + parts.join('、') : '';
}
$('#edit-opts').addEventListener('input', updateOptsSummary);
$('#edit-opts').addEventListener('change', updateOptsSummary);
const PN_FMT = {
  n: (n) => `${n}`, nN: (n, N) => `${n} / ${N}`, zh: (n) => `第 ${n} 頁`, zhN: (n, N) => `第 ${n} 頁，共 ${N} 頁`,
  dash: (n) => `- ${n} -`, en: (n, N) => `Page ${n} of ${N}`
};
function stampOptions() {
  const size = Math.max(6, Math.min(36, +$('#pn-size').value || 10));
  return {
    size,
    num: $('#edit-numbers').checked ? { fmt: PN_FMT[$('#pn-fmt').value] || PN_FMT.nN, pos: $('#pn-pos').value,
      start: $('#pn-start').value.trim() === '' ? 1 : Math.max(0, Math.round(+$('#pn-start').value || 0)), skip: $('#pn-skip').checked } : null,
    head: $('#hf-head').value.trim() ? { text: $('#hf-head').value.trim(), pos: 't' + $('#hf-head-pos').value } : null,
    foot: $('#hf-foot').value.trim() ? { text: $('#hf-foot').value.trim(), pos: 'b' + $('#hf-foot-pos').value } : null
  };
}
/* Pictures put on many pages (a header in Chinese, page numbers, the same note or signature on every page) are
   embedded once and drawn wherever they are needed. A picture per page made a 1000-page file with a Chinese header
   take 8 s to export and 8 MB more. pictures(key, make) → the embedded picture of what make() draws. */
function pictureCache(out) {
  const done = new Map();
  return (key, make) => {
    if (!done.has(key)) done.set(key, (async () => embedPngFast(out, await make()))());
    return done.get(key);
  };
}
/* A label drawn as pictures goes in pieces: each digit on its own and the text between digits whole, every piece at
   the place it has in the whole label, so 「第 1 頁」…「第 1000 頁」 share a dozen pictures. Only for text that is drawn
   letter by letter (Chinese, Japanese, Korean, Latin, digits, punctuation): right-to-left text and scripts whose
   letters join stay one picture. */
const PIECEWISE = /^[\x20-\x7e\xa0-\xff -⁯⺀-⿟　-ヿ㄀-ㄯ㐀-䶿一-鿿豈-﫿＀-￯]*$/;
function labelPieces(text) {
  if (!PIECEWISE.test(text)) return [{ s: text, at: 0 }];
  return [...text.matchAll(/\d|\D+/g)].map(m => ({ s: m[0], at: m.index }));
}
/* Draw one line of small grey text in a page corner or edge (pos: t/b + l/c/r), upright on the page as shown.
   Plain Latin text is drawn as real text (Helvetica); Chinese and other text as a sharp picture, like 加文字. */
async function drawLabel(out, page, text, pos, size, font, R, pictures) {
  const view = visibleBox(page);
  const [dw, dh] = dispSize(view, R), m = 24;
  const base = pos[0] === 't' ? m + size * .75 : dh - m + 2; // baseline, in the page's display space
  const place = w => pos[1] === 'l' ? m : pos[1] === 'r' ? dw - m - w : (dw - w) / 2;
  let tw = null; try { tw = font.widthOfTextAtSize(text, size); } catch (e) { tw = null; }
  if (tw != null) {
    const [ux, uy] = displayToUser(view, R, place(tw), base);
    page.drawText(text, { x: ux, y: uy, size, font, color: rgb(.33, .36, .4), rotate: degrees(R) });
    return;
  }
  const a = { text, size, color: '#545c66' };
  await ensureFont(text, size); measureAnnot(a);
  const x0 = place(a.wPt), y = base + size * .3;
  for (const { s, at } of labelPieces(text)) {
    if (!s.trim()) continue;
    const piece = { text: s, size, color: a.color }; measureAnnot(piece);
    // Where the piece starts in the whole label (measureAnnot set the font)
    const dx = at ? mctx.measureText(text.slice(0, at)).width : 0;
    const png = await pictures(`label|${size}|${s}`, () => renderTextPng(piece));
    const [ux, uy] = displayToUser(view, R, x0 + dx, y);
    page.drawImage(png, { x: ux, y: uy, width: piece.wPt, height: piece.hPt, rotate: degrees(R) });
  }
}

async function renderShapePng(a) {
  const k = 4, c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(a.wPt * k)); c.height = Math.max(1, Math.ceil(a.hPt * k));
  const ctx = c.getContext('2d'); ctx.scale(k, k); drawShape(ctx, a);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

async function exportEdit(onlySel, btn) {
  const list = onlySel ? edit.pages.filter(p => p.selected) : edit.pages.slice();
  if (btn._job) { runJob(btn); return; } // a second click cancels
  if (!list.length) { toast('沒有可匯出的頁面'); return; }
  if (!list.every(fillMeta)) { toast('頁面還在載入，請稍候再匯出'); return; }
  // The pages and settings as they are now: turning a page or changing a setting while this runs must not end up
  // in part of the file.
  const pages = list.map(p => ({ ...p, annots: p.annots.map(a => ({ ...a })) }));
  const st = stampOptions(), name = ensurePdf($('#edit-name').value), dateFmt = $('#te-datefmt').value;
  const md = Object.fromEntries(MD_FIELDS.map(k => [k, $('#md-' + k).value.trim()])), strip = $('#md-strip').checked;
  await runJob(btn, '產生中…', async check => {
    const out = await PDFDocument.create({ updateMetadata: false });
    // Copy pages per source file. A page used twice (duplicated) needs its own copy, so repeats go in later rounds.
    const copied = new Map(), byDoc = new Map();
    pages.forEach(p => { if (!byDoc.has(p.docId)) byDoc.set(p.docId, []); byDoc.get(p.docId).push(p); });
    const libs = {};
    for (const docId of byDoc.keys()) {
      libs[docId] = await PDFDocument.load(await edit.docs[docId].pj.getData());
      markLayers(libs[docId], docId); // see relinkLayers() in core.js
    }
    for (const [docId, list] of byDoc) {
      let rest = list;
      while (rest.length) {
        const seen = new Set(), round = [], later = [];
        rest.forEach(p => (seen.has(p.index) ? later : (seen.add(p.index), round)).push(p));
        const idx = round.map(p => p.index), undo = unlinkDests(libs[docId], idx, docId); // see unlinkDests() in core.js
        const res = await out.copyPages(libs[docId], idx); undo();
        round.forEach((p, k) => copied.set(p, res[k]));
        rest = later;
      }
    }
    const font = st.num || st.head || st.foot ? await out.embedFont(StandardFonts.Helvetica) : null;
    const numbered = st.num ? pages.length - (st.num.skip ? 1 : 0) : 0, lastNo = st.num ? st.num.start + numbered - 1 : 0;
    // Replaced by functions: a string replacement reads $& or $$ in a file name as a pattern, not as text.
    const fill = t => t.replace(/\{總頁\}/g, () => pages.length).replace(/\{日期\}/g, () => todayText(dateFmt))
      .replace(/\{檔名\}/g, () => baseName(name));
    const pictures = pictureCache(out), placed = new Map(); // source page → its first new page, for internal links
    for (let i = 0; i < pages.length; i++) {
      check();
      const p = pages[i], R = (p.baseRot + p.rot) % 360;
      const page = copied.get(p); out.addPage(page);
      if (!placed.has(metaKey(p))) placed.set(metaKey(p), page);
      page.setRotation(degrees(R));
      for (const a of p.annots) {
        let png, extra = {};
        // A signature's data: URL is its own key (no other key starts with "data:").
        if (a.type === 'img') png = await pictures(a.src, async () => Uint8Array.from(atob(a.src.split(',')[1]), c => c.charCodeAt(0)));
        else if (a.type === 'shape') {
          png = await pictures('shape|' + JSON.stringify([a.kind, a.color, a.lw, a.wPt, a.hPt, a.pts]), () => renderShapePng(a));
          if (a.kind === 'highlight') extra = { opacity: .45, blendMode: BlendMode.Multiply };
        } else {
          if (!a.text.trim()) continue;
          png = await pictures('text|' + JSON.stringify([a.text, a.size, a.color, a.wPt, a.hPt]), () => renderTextPng(a));
        }
        page.drawImage(png, { x: a.ux, y: a.uy, width: a.wPt, height: a.hPt, rotate: degrees(a.rot), ...extra });
      }
      if (st.num && !(st.num.skip && i === 0)) {
        const n = st.num.start + i - (st.num.skip ? 1 : 0);
        await drawLabel(out, page, st.num.fmt(n, lastNo), st.num.pos, st.size, font, R, pictures);
      }
      for (const hf of [st.head, st.foot]) if (hf) await drawLabel(out, page, fill(hf.text).replace(/\{頁\}/g, i + 1), hf.pos, st.size, font, R, pictures);
    }
    check();
    relinkDests(out, (docId, i) => placed.get(docId + ':' + i));
    relinkFormFields(out, Object.values(libs)); // keep form fields fillable
    relinkLayers(out, Object.entries(libs)); // hidden layers stay hidden
    if (md.title) out.setTitle(md.title, { showInWindowTitleBar: true });
    if (md.author) out.setAuthor(md.author);
    if (md.subject) out.setSubject(md.subject);
    if (md.keywords) out.setKeywords(md.keywords.split(/[,，、;；]+/).map(s => s.trim()).filter(Boolean));
    if (!strip) { const now = new Date(); out.setCreator('紙匣'); out.setProducer('紙匣'); out.setCreationDate(now); out.setModificationDate(now); }
    const bytes = await out.save({ useObjectStreams: true });
    await deliver(pdfFile(bytes, name), 'pdf', 'edit');
  }).catch(err => toast('匯出失敗：' + err.message, 'err'));
}
$('#edit-export').addEventListener('click', e => exportEdit(false, e.currentTarget));
$('#edit-export-sel').addEventListener('click', e => exportEdit(true, e.currentTarget));
registerTarget('pdf', 'edit', '編輯', loadEditFiles);
