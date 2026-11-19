'use strict';
/* ---------- page editor dialog: text, signatures, markup, redaction ----------
   Every item on a page is a box: (ux, uy) is its bottom-left corner in PDF user space, wPt × hPt its size in
   points, rot the page rotation it was drawn under. Types:
     text    a.text, a.size, a.color
     img     a.src (signature PNG)
     shape   a.kind = highlight | rect | arrow | ink, a.color, a.lw, a.pts (arrow/ink: points as fractions of the box)
     redact  a black box; on export the whole page is flattened to an image so the content underneath is gone */
const te = { page: null, R: 0, scale: 1, sel: null, renderTask: null, mode: 'text', tool: 'highlight' };
const dlg = $('#te-dialog'), overlay = $('#te-overlay');
const TE_MODES = ['text', 'sig', 'mark', 'redact'];
const modeOf = a => a.type === 'img' ? 'sig' : a.type === 'shape' ? 'mark' : a.type === 'redact' ? 'redact' : 'text';
function setTeMode(m) {
  te.mode = m;
  for (const k of TE_MODES) {
    $('#te-mode-' + k).setAttribute('aria-pressed', m === k);
    $('#te-' + k + '-panel').hidden = m !== k;
  }
  overlay.classList.toggle('is-draw', m === 'mark' || m === 'redact');
  if (m === 'sig') renderSigLists();
}
TE_MODES.forEach(k => $('#te-mode-' + k).addEventListener('click', () => setTeMode(k)));

/* markup tool settings: each tool remembers its own colour */
const toolColor = { highlight: '#ffd84d', rect: '#c2362b', arrow: '#c2362b', ink: '#1d4fb8' };
function setTool(t) {
  te.tool = t;
  document.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t));
  $('#te-mcolor').value = toolColor[t];
  $('#te-mwidth-row').hidden = t === 'highlight';
}
document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
setTool('highlight');

async function openTextEditor(p, mode) {
  te.page = p; te.sel = null; te.R = (p.baseRot + p.rot) % 360;
  setTeMode(mode || te.mode);
  $('#te-title').textContent = `第 ${edit.pages.indexOf(p) + 1} 頁`;
  overlay.innerHTML = '';
  if (!dlg.open) { te.snap = snapEdit(); te.sig0 = annotSig(); dlg.showModal(); }
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

/* Draw a shape in its own box. The context is scaled so one unit is one point. Used on screen and for export. */
function drawShape(ctx, a) {
  const w = a.wPt, h = a.hPt;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.strokeStyle = ctx.fillStyle = a.color; ctx.lineWidth = a.lw || 3;
  if (a.kind === 'highlight') { ctx.fillRect(0, 0, w, h); return; }
  if (a.kind === 'rect') { const i = (a.lw || 3) / 2; ctx.strokeRect(i, i, w - 2 * i, h - 2 * i); return; }
  const pts = a.pts.map(([fx, fy]) => [fx * w, fy * h]);
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
  if (a.kind === 'arrow' && pts.length >= 2) {
    const [x1, y1] = pts[pts.length - 1], [x0, y0] = pts[pts.length - 2];
    const ang = Math.atan2(y1 - y0, x1 - x0), L = Math.max(9, (a.lw || 3) * 4), spread = .45;
    ctx.beginPath(); ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - L * Math.cos(ang - spread), y1 - L * Math.sin(ang - spread));
    ctx.lineTo(x1 - L * Math.cos(ang + spread), y1 - L * Math.sin(ang + spread));
    ctx.closePath(); ctx.fill();
  }
}

function renderAnnots() {
  overlay.innerHTML = '';
  const s = te.scale, dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const a of te.page.annots) {
    const [dx, dy] = userToDisplay(te.page.view, te.R, a.ux, a.uy);
    const d = document.createElement('div');
    d.className = 'annot is-' + a.type + (a.type === 'shape' ? ' is-' + a.kind : '') + (a === te.sel ? ' is-sel' : '');
    d.dataset.id = a.id;
    Object.assign(d.style, {
      left: dx * s + 'px', top: (dy - a.hPt) * s + 'px',
      width: a.wPt * s + 'px', height: a.hPt * s + 'px',
      transformOrigin: '0 100%', transform: `rotate(${(te.R - a.rot + 360) % 360}deg)`
    });
    if (a.type === 'img') {
      const im = document.createElement('img'); im.src = a.src; im.alt = ''; im.draggable = false; d.append(im);
    } else if (a.type === 'shape') {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(a.wPt * s * dpr)); c.height = Math.max(1, Math.ceil(a.hPt * s * dpr));
      const cx = c.getContext('2d'); cx.scale(s * dpr, s * dpr); drawShape(cx, a);
      d.append(c);
    } else if (a.type === 'text') {
      d.textContent = a.text;
      Object.assign(d.style, { fontSize: a.size * s + 'px', color: a.color, paddingLeft: s + 'px' });
    }
    if (a === te.sel && a.type !== 'text') { const h = document.createElement('span'); h.className = 'annot-handle'; h.title = '拖曳縮放'; d.append(h); }
    overlay.append(d);
  }
  $('#te-del').disabled = !te.sel;
  $('#te-apply').hidden = !te.sel || edit.pages.length < 2;
}
function syncFields() {
  const a = te.sel; if (!a) return;
  if (a.type === 'text') { $('#te-text').value = a.text; $('#te-size').value = a.size; $('#te-color').value = a.color; }
  if (a.type === 'shape') { setTool(a.kind); $('#te-mcolor').value = a.color; $('#te-mwidth').value = a.lw || 3; }
}
function localPt(e) { const r = overlay.getBoundingClientRect(); return [(e.clientX - r.left) / te.scale, (e.clientY - r.top) / te.scale]; }
function uprightKeepAnchor(a) { if (a.rot !== te.R) { const [dx, dy] = userToDisplay(te.page.view, te.R, a.ux, a.uy); setTopLeft(a, dx, dy - a.hPt); } }

/* ---------- drawing a new box, arrow or line (markup and redaction modes) ---------- */
function startDraw(e) {
  const tool = te.mode === 'redact' ? 'redact' : te.tool;
  const start = localPt(e), pts = [start];
  const pv = document.createElement('canvas'), dpr = Math.min(window.devicePixelRatio || 1, 2);
  pv.className = 'draw-preview'; pv.width = overlay.clientWidth * dpr; pv.height = overlay.clientHeight * dpr;
  overlay.append(pv);
  const pctx = pv.getContext('2d');
  const color = $('#te-mcolor').value, lw = +$('#te-mwidth').value;
  const box = () => { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
  const paint = () => {
    pctx.setTransform(1, 0, 0, 1, 0, 0); pctx.clearRect(0, 0, pv.width, pv.height);
    pctx.setTransform(te.scale * dpr, 0, 0, te.scale * dpr, 0, 0);
    if (tool === 'redact') { const [x0, y0, x1, y1] = box(); pctx.fillStyle = 'rgba(0,0,0,.8)'; pctx.fillRect(x0, y0, x1 - x0, y1 - y0); return; }
    if (tool === 'highlight' || tool === 'rect') {
      const [x0, y0, x1, y1] = box();
      pctx.save(); pctx.translate(x0, y0); drawShape(pctx, { kind: tool, color: tool === 'highlight' ? color + '73' : color, lw, wPt: x1 - x0, hPt: y1 - y0 }); pctx.restore();
      return;
    }
    pctx.strokeStyle = color; pctx.lineWidth = lw; pctx.lineCap = pctx.lineJoin = 'round';
    const line = tool === 'arrow' ? [pts[0], pts[pts.length - 1]] : pts;
    pctx.beginPath(); pctx.moveTo(line[0][0], line[0][1]); line.forEach(p => pctx.lineTo(p[0], p[1])); pctx.stroke();
  };
  try { overlay.setPointerCapture(e.pointerId); } catch (_) {}
  const move = ev => {
    const p = localPt(ev);
    if (tool === 'ink') { const q = pts[pts.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 1.2) pts.push(p); }
    else pts[1] = p;
    paint();
  };
  const up = () => {
    overlay.removeEventListener('pointermove', move); overlay.removeEventListener('pointerup', up); overlay.removeEventListener('pointercancel', up);
    pv.remove();
    let a = null;
    if (tool === 'redact' || tool === 'highlight' || tool === 'rect') {
      const [x0, y0, x1, y1] = box();
      if (x1 - x0 < 4 || y1 - y0 < 4) { if (pts.length < 2) toast('在頁面上按住拖曳，框出範圍'); return; }
      a = tool === 'redact' ? { type: 'redact', wPt: x1 - x0, hPt: y1 - y0 } : { type: 'shape', kind: tool, color, lw, wPt: x1 - x0, hPt: y1 - y0 };
      a.id = uid(); setTopLeft(a, x0, y0);
    } else {
      const line = tool === 'arrow' ? [pts[0], pts[pts.length - 1]] : pts;
      if (line.length < 2 || Math.hypot(line[line.length - 1][0] - line[0][0], line[line.length - 1][1] - line[0][1]) < 5) return;
      const pad = lw * 2 + (tool === 'arrow' ? Math.max(9, lw * 4) : 0);
      const xs = line.map(p => p[0]), ys = line.map(p => p[1]);
      const bx = Math.min(...xs) - pad, by = Math.min(...ys) - pad, bw = Math.max(...xs) - Math.min(...xs) + pad * 2, bh = Math.max(...ys) - Math.min(...ys) + pad * 2;
      a = { id: uid(), type: 'shape', kind: tool, color, lw, wPt: bw, hPt: bh, pts: line.map(([x, y]) => [(x - bx) / bw, (y - by) / bh]) };
      setTopLeft(a, bx, by);
    }
    te.page.annots.push(a); te.sel = a; renderAnnots();
  };
  overlay.addEventListener('pointermove', move); overlay.addEventListener('pointerup', up); overlay.addEventListener('pointercancel', up);
  paint();
}

overlay.addEventListener('pointerdown', async e => {
  if (!te.page) return;
  const box = e.target.closest('.annot');
  if (!box) {
    e.preventDefault();
    if (te.mode === 'mark' || te.mode === 'redact') { te.sel = null; renderAnnots(); startDraw(e); return; }
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
  te.sel = a;
  if (modeOf(a) !== te.mode) setTeMode(modeOf(a)); // show the settings for what was just picked
  syncFields();
  renderAnnots();
  const el = overlay.querySelector(`[data-id="${a.id}"]`);
  const [sx, sy] = localPt(e); const [l0, t0] = annotTopLeft(a);
  const w0 = a.wPt, h0 = a.hPt, keepRatio = a.type === 'img';
  const newSize = (x, y) => {
    const w = Math.max(8, w0 + (x - sx));
    return [w, keepRatio ? w * h0 / w0 : Math.max(8, h0 + (y - sy))];
  };
  try { el.setPointerCapture(e.pointerId); } catch (_) {}
  const move = ev => {
    const [x, y] = localPt(ev);
    if (resizing) { const [w, h] = newSize(x, y); el.style.width = w * te.scale + 'px'; el.style.height = h * te.scale + 'px'; }
    else { el.style.left = (l0 + x - sx) * te.scale + 'px'; el.style.top = (t0 + y - sy) * te.scale + 'px'; }
  };
  const up = ev => {
    el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    const [x, y] = localPt(ev);
    if (resizing) { [a.wPt, a.hPt] = newSize(x, y); setTopLeft(a, l0, t0); }
    else setTopLeft(a, l0 + x - sx, t0 + y - sy);
    renderAnnots();
  };
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
});

async function updateSel() {
  const a = te.sel; if (!a || a.type !== 'text') return;
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
document.querySelectorAll('.swatch[data-c]').forEach(b => b.addEventListener('click', () => { $('#te-color').value = b.dataset.c; updateSel(); }));
function updateShape() {
  toolColor[te.tool] = $('#te-mcolor').value;
  const a = te.sel; if (!a || a.type !== 'shape') return;
  a.color = $('#te-mcolor').value; a.lw = +$('#te-mwidth').value; renderAnnots();
}
$('#te-mcolor').addEventListener('input', updateShape);
$('#te-mwidth').addEventListener('input', updateShape);
document.querySelectorAll('.swatch[data-mc]').forEach(b => b.addEventListener('click', () => { $('#te-mcolor').value = b.dataset.mc; updateShape(); }));

function deleteSel() { if (!te.sel) return; te.page.annots = te.page.annots.filter(x => x !== te.sel); te.sel = null; renderAnnots(); }
$('#te-del').addEventListener('click', deleteSel);
dlg.addEventListener('keydown', e => { if ((e.key === 'Delete') && te.sel && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'INPUT') deleteSel(); });
/* Runs once per visit, from whichever happens first: 完成, Esc, or the dialog's own close event
   (that event is not delivered reliably in every embedded view, so nothing may depend on it alone). */
function finishEditor() {
  if (!te.page) return;
  te.page.annots = te.page.annots.filter(a => a.type !== 'text' || a.text.trim());
  if (te.snap && annotSig() !== te.sig0) pushUndo(te.snap); // the whole visit to the editor is one undo step
  te.snap = null; te.page = null; te.sel = null; renderEdit();
}
$('#te-done').addEventListener('click', () => { finishEditor(); dlg.close(); });
dlg.addEventListener('cancel', finishEditor);
dlg.addEventListener('close', finishEditor);

/* A cheap fingerprint of every annotation, to tell whether the editor changed anything. */
const annotSig = () => edit.pages.map(p => p.annots.map(a => [a.id, a.ux, a.uy, a.wPt, a.hPt, a.text, a.size, a.color, a.lw].join(',')).join(';')).join('|');

/* ---------- copy the selected item to other pages ----------
   It keeps its distance from the nearest page edges, so a bottom-right signature stays bottom-right on other page sizes. */
$('#te-apply-to').addEventListener('change', () => { $('#te-apply-pages').hidden = $('#te-apply-to').value !== 'custom'; });
$('#te-apply-go').addEventListener('click', () => {
  const a = te.sel; if (!a) return;
  const n = edit.pages.length, cur = edit.pages.indexOf(te.page), mode = $('#te-apply-to').value;
  let targets = [];
  if (mode === 'custom') {
    const r = parseRanges($('#te-apply-pages').value, n);
    if (r.error) { toast(r.error, 'err'); return; }
    if (!r.ranges.length) { toast('請輸入要套用的頁碼'); return; }
    const set = new Set(); r.ranges.forEach(([x, y]) => { for (let i = x; i <= y; i++) set.add(i - 1); });
    targets = [...set];
  } else targets = edit.pages.map((_, i) => i).filter(i => mode === 'all' || (mode === 'odd' ? i % 2 === 0 : i % 2 === 1));
  targets = targets.filter(i => i !== cur);
  if (!targets.length) { toast('沒有其他符合的頁面'); return; }
  uprightKeepAnchor(a);
  const [l, t] = annotTopLeft(a), [dw, dh] = dispSize(te.page.view, te.R);
  const right = l + a.wPt / 2 > dw / 2, bottom = t + a.hPt / 2 > dh / 2;
  const mx = right ? dw - (l + a.wPt) : l, my = bottom ? dh - (t + a.hPt) : t;
  let done = 0, skipped = 0;
  for (const i of targets) {
    const p = edit.pages[i];
    if (!fillMeta(p)) { skipped++; continue; }
    const R = (p.baseRot + p.rot) % 360, [w2, h2] = dispSize(p.view, R);
    const L = Math.max(0, right ? w2 - mx - a.wPt : mx), T = Math.max(0, bottom ? h2 - my - a.hPt : my);
    const c = { ...a, id: uid(), rot: R, pts: a.pts && a.pts.map(q => q.slice()) };
    [c.ux, c.uy] = displayToUser(p.view, R, L, T + a.hPt);
    p.annots.push(c); done++;
  }
  toast(`已套用到 ${done} 頁` + (skipped ? `，${skipped} 頁還在載入所以略過` : ''));
});

/* ---------- today's date, next to a signature ---------- */
function todayText(fmt) {
  const d = new Date(), y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate(), p2 = n => String(n).padStart(2, '0');
  switch (fmt) {
    case 'dash': return `${y}-${p2(m)}-${p2(day)}`;
    case 'zh': return `${y}年${m}月${day}日`;
    case 'roc': return `民國${y - 1911}年${m}月${day}日`;
    case 'rocs': return `${y - 1911}/${p2(m)}/${p2(day)}`;
    default: return `${y}/${p2(m)}/${p2(day)}`;
  }
}
document.querySelectorAll('#te-datefmt option').forEach(o => { o.textContent = todayText(o.value); }); // show the real date in each format
try { const f = localStorage.getItem('papertray.datefmt'); if (f && $(`#te-datefmt option[value="${f}"]`)) $('#te-datefmt').value = f; } catch (e) {}
$('#te-datefmt').addEventListener('change', () => { try { localStorage.setItem('papertray.datefmt', $('#te-datefmt').value); } catch (e) {} });
$('#te-text-date').addEventListener('click', () => { $('#te-text').value = todayText($('#te-datefmt').value); updateSel(); });
$('#te-date').addEventListener('click', async () => {
  const text = todayText($('#te-datefmt').value), sig = te.sel && te.sel.type === 'img' ? te.sel : null;
  if (!sig) { // no signature picked: hand over to the text tool, the next click on the page places the date
    $('#te-text').value = text; setTeMode('text'); toast('點頁面上要放日期的位置'); return;
  }
  uprightKeepAnchor(sig);
  const [l, t] = annotTopLeft(sig), [dw] = dispSize(te.page.view, te.R);
  const a = { id: uid(), type: 'text', text, size: Math.round(Math.max(9, Math.min(16, sig.hPt * .32))), color: '#111111' };
  await ensureFont(text, a.size); measureAnnot(a);
  // to the right of the signature, middle-aligned; below it when there is no room on the right
  if (l + sig.wPt + 8 + a.wPt <= dw - 6) setTopLeft(a, l + sig.wPt + 8, t + sig.hPt / 2 - a.hPt / 2);
  else setTopLeft(a, l, t + sig.hPt + 4);
  te.page.annots.push(a); te.sel = a; renderAnnots();
});
