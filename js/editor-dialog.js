'use strict';
/* ---------- text & signature editor dialog ---------- */
const te = { page: null, R: 0, scale: 1, sel: null, renderTask: null, mode: 'text' };
const dlg = $('#te-dialog'), overlay = $('#te-overlay');
function setTeMode(m) {
  te.mode = m;
  $('#te-mode-text').setAttribute('aria-pressed', m === 'text');
  $('#te-mode-sig').setAttribute('aria-pressed', m === 'sig');
  $('#te-text-panel').hidden = m !== 'text'; $('#te-sig-panel').hidden = m !== 'sig';
  if (m === 'sig') renderSigLists();
}
$('#te-mode-text').addEventListener('click', () => setTeMode('text'));
$('#te-mode-sig').addEventListener('click', () => setTeMode('sig'));
async function openTextEditor(p, mode) {
  te.page = p; te.sel = null; te.R = (p.baseRot + p.rot) % 360;
  setTeMode(mode || te.mode);
  $('#te-title').textContent = `第 ${edit.pages.indexOf(p) + 1} 頁`;
  overlay.innerHTML = '';
  if (!dlg.open) dlg.showModal();
  syncFields();
  const pj = edit.docs[p.docId].pj;
  const pg = await pj.getPage(p.index + 1);
  const vp1 = pg.getViewport({ scale: 1, rotation: te.R });
  const stage = $('#te-stage');
  const availW = Math.max(240, stage.clientWidth - 36);
  const availH = Math.max(300, (window.innerWidth <= 760 ? window.innerHeight * .58 : window.innerHeight - 60) - 36);
  te.scale = Math.min(availW / vp1.width, availH / vp1.height, 2);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp = pg.getViewport({ scale: te.scale * dpr, rotation: te.R });
  const cv = $('#te-canvas');
  cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  const cssW = vp1.width * te.scale, cssH = vp1.height * te.scale;
  cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
  $('#te-page').style.width = cssW + 'px'; $('#te-page').style.height = cssH + 'px';
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  if (te.renderTask) { try { te.renderTask.cancel(); } catch (e) {} }
  te.renderTask = pg.render({ canvasContext: ctx, viewport: vp });
  try { await te.renderTask.promise; } catch (e) {}
  if (te.page !== p) return; // closed or switched page while rendering
  renderAnnots();
}
function annotTopLeft(a) {
  const [dx, dy] = userToDisplay(te.page.view, te.R, a.ux, a.uy);
  return [dx, dy - a.hPt];
}
function setTopLeft(a, left, top) {
  a.rot = te.R;
  [a.ux, a.uy] = displayToUser(te.page.view, te.R, left, top + a.hPt);
}
function renderAnnots() {
  overlay.innerHTML = '';
  const s = te.scale;
  for (const a of te.page.annots) {
    const [dx, dy] = userToDisplay(te.page.view, te.R, a.ux, a.uy);
    const d = document.createElement('div');
    d.className = 'annot' + (a.type === 'img' ? ' is-img' : '') + (a === te.sel ? ' is-sel' : '');
    d.dataset.id = a.id;
    Object.assign(d.style, {
      left: dx * s + 'px', top: (dy - a.hPt) * s + 'px',
      width: a.wPt * s + 'px', height: a.hPt * s + 'px',
      transformOrigin: '0 100%', transform: `rotate(${(te.R - a.rot + 360) % 360}deg)`
    });
    if (a.type === 'img') {
      const im = document.createElement('img'); im.src = a.src; im.alt = ''; im.draggable = false; d.append(im);
      if (a === te.sel) { const h = document.createElement('span'); h.className = 'annot-handle'; h.title = '拖曳縮放'; d.append(h); }
    } else {
      d.textContent = a.text;
      Object.assign(d.style, { fontSize: a.size * s + 'px', color: a.color, paddingLeft: s + 'px' });
    }
    overlay.append(d);
  }
  $('#te-del').disabled = !te.sel;
}
function syncFields() {
  if (te.sel && te.sel.type !== 'img') { $('#te-text').value = te.sel.text; $('#te-size').value = te.sel.size; $('#te-color').value = te.sel.color; }
}
function localPt(e) { const r = overlay.getBoundingClientRect(); return [(e.clientX - r.left) / te.scale, (e.clientY - r.top) / te.scale]; }
function uprightKeepAnchor(a) { if (a.rot !== te.R) { const [dx, dy] = userToDisplay(te.page.view, te.R, a.ux, a.uy); setTopLeft(a, dx, dy - a.hPt); } }
overlay.addEventListener('pointerdown', async e => {
  if (!te.page) return;
  const box = e.target.closest('.annot');
  if (!box) {
    const [x, y] = localPt(e);
    if (te.mode === 'sig') {
      const sg = sigs.list[sigs.sel];
      if (!sg) { toast('先在右側選一個簽名，或新增一個'); return; }
      const w = Math.min(160, (te.page.view[2] - te.page.view[0]) * .4);
      const a = { id: uid(), type: 'img', src: sg.src, wPt: w, hPt: w * sg.h / sg.w };
      setTopLeft(a, x - a.wPt / 2, y - a.hPt / 2);
      te.page.annots.push(a); te.sel = a; renderAnnots();
      return;
    }
    const text = $('#te-text').value;
    if (!text.trim()) { toast('先在右側輸入要放的文字'); return; }
    const a = { id: uid(), type: 'text', text, size: Math.max(6, Math.min(144, +$('#te-size').value || 18)), color: $('#te-color').value };
    await ensureFont(text, a.size);
    measureAnnot(a);
    setTopLeft(a, x, y - a.hPt / 2);
    te.page.annots.push(a); te.sel = a; renderAnnots();
    return;
  }
  const a = te.page.annots.find(x => x.id === box.dataset.id); if (!a) return;
  e.preventDefault();
  const resizing = !!e.target.closest('.annot-handle');
  uprightKeepAnchor(a);
  te.sel = a; syncFields();
  if (a.type !== 'img' && te.mode !== 'text') setTeMode('text'); // show the fields for the text just picked
  renderAnnots();
  const el = overlay.querySelector(`[data-id="${a.id}"]`);
  const [sx, sy] = localPt(e); const [l0, t0] = annotTopLeft(a);
  const w0 = a.wPt, ratio = a.hPt / a.wPt;
  try { el.setPointerCapture(e.pointerId); } catch (_) {}
  const move = ev => {
    const [x, y] = localPt(ev);
    if (resizing) {
      const w = Math.max(16, w0 + (x - sx));
      el.style.width = w * te.scale + 'px'; el.style.height = w * ratio * te.scale + 'px';
    } else { el.style.left = (l0 + x - sx) * te.scale + 'px'; el.style.top = (t0 + y - sy) * te.scale + 'px'; }
  };
  const up = ev => {
    el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    const [x, y] = localPt(ev);
    if (resizing) { a.wPt = Math.max(16, w0 + (x - sx)); a.hPt = a.wPt * ratio; setTopLeft(a, l0, t0); }
    else setTopLeft(a, l0 + x - sx, t0 + y - sy);
    renderAnnots();
  };
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
});
async function updateSel() {
  const a = te.sel; if (!a || a.type === 'img') return;
  const [l, t] = annotTopLeft(a);
  a.text = $('#te-text').value || ' ';
  a.size = Math.max(6, Math.min(144, +$('#te-size').value || a.size));
  a.color = $('#te-color').value;
  await ensureFont(a.text, a.size);
  measureAnnot(a); setTopLeft(a, l, t); renderAnnots();
}
$('#te-text').addEventListener('input', updateSel);
$('#te-size').addEventListener('input', updateSel);
$('#te-color').addEventListener('input', updateSel);
document.querySelectorAll('.swatch').forEach(b => b.addEventListener('click', () => { $('#te-color').value = b.dataset.c; updateSel(); }));
function deleteSel() { if (!te.sel) return; te.page.annots = te.page.annots.filter(x => x !== te.sel); te.sel = null; renderAnnots(); }
$('#te-del').addEventListener('click', deleteSel);
dlg.addEventListener('keydown', e => { if ((e.key === 'Delete') && te.sel && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'INPUT') deleteSel(); });
$('#te-done').addEventListener('click', () => dlg.close());
dlg.addEventListener('close', () => {
  if (te.page) te.page.annots = te.page.annots.filter(a => a.type === 'img' || a.text.trim());
  te.page = null; te.sel = null; renderEdit();
});
