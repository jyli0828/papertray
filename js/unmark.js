'use strict';
/* ================= WATERMARK REMOVER ================= */
const um = { name: '', mime: 'image/png', w: 0, h: 0, scale: 1, fit: 1, zoom: 1, mode: 'paint', history: [], drawing: false, last: null };
const umImg = $('#um-img'), umMask = $('#um-mask'), umOrig = $('#um-orig'), umWrap = $('#um-wrap'), umCursor = $('#um-cursor');
const uctx = umImg.getContext('2d', { willReadFrequently: true });
const mctxU = umMask.getContext('2d', { willReadFrequently: true });
async function loadUm(files) {
  const [f] = await prepImages(files.slice(0, 1)); if (!f) return;
  if (!isImage(f)) { toast(`「${f.name}」不是支援的圖片格式`, 'err'); return; }
  let bmp;
  try { bmp = await createImageBitmap(f); } catch (e) { toast(`「${f.name}」無法讀取，圖片可能已損壞。`, 'err'); return; }
  let w = bmp.width, h = bmp.height;
  const ow = w, oh = h;
  const maxPx = 24e6; if (w * h > maxPx) { const s = Math.sqrt(maxPx / (w * h)); w = Math.round(w * s); h = Math.round(h * s); }
  Object.assign(um, { name: f.name, w, h, history: [], token: (um.token || 0) + 1 });
  um.mime = /jpe?g/i.test(f.type) || /\.jpe?g$/i.test(f.name) ? 'image/jpeg' : 'image/png';
  // Memory: the photo itself is the only full-size canvas. The brush mask is stored at most 2000 px wide
  // (strokes are wide and get dilated anyway), and the "看原圖" copy is decoded from the file only while shown.
  um.ms = Math.min(1, 2000 / Math.max(w, h)); um.file = f;
  umImg.width = w; umImg.height = h;
  umMask.width = Math.max(1, Math.round(w * um.ms)); umMask.height = Math.max(1, Math.round(h * um.ms));
  umOrig.width = umOrig.height = 0; um.origReady = false;
  uctx.drawImage(bmp, 0, 0, w, h);
  bmp.close && bmp.close();
  mctxU.clearRect(0, 0, umMask.width, umMask.height);
  $('#um-name').value = f.name.replace(/\.[^.]+$/, '') + '-去浮水印.' + (um.mime === 'image/jpeg' ? 'jpg' : 'png');
  $('#um-meta').textContent = w === ow ? `${w} × ${h} px` : `${w} × ${h} px（原圖 ${ow} × ${oh}，已縮小以便處理）`;
  $('#um-empty').hidden = true; $('#um-work').hidden = false;
  um.zoom = 1; updateUmButtons(); fitUm();
}
/* Zoom: 1 = the whole picture fits the box. Above that the box scrolls; the 「移動」 tool or holding Space drags it. */
function fitUm() {
  if (!um.w || $('#panel-unmark').hidden) return;
  const box = $('#um-stagebox');
  const avail = Math.max(120, box.clientWidth - 24);
  const maxH = Math.max(260, window.innerHeight * .68);
  um.fit = Math.min(avail / um.w, maxH / um.h, 1.5);
  applyZoom();
}
function applyZoom(anchor) {
  const box = $('#um-stagebox');
  let ix, iy;
  if (anchor) { ix = (box.scrollLeft + anchor[0]) / um.scale; iy = (box.scrollTop + anchor[1]) / um.scale; }
  um.scale = um.fit * um.zoom;
  umWrap.style.width = um.w * um.scale + 'px'; umWrap.style.height = um.h * um.scale + 'px';
  box.classList.toggle('is-zoomed', um.zoom > 1);
  if (anchor) { box.scrollLeft = ix * um.scale - anchor[0]; box.scrollTop = iy * um.scale - anchor[1]; }
  $('#um-zoom-v').textContent = Math.round(um.zoom * 100) + '%';
  $('#um-zoom-out').disabled = um.zoom <= 1; $('#um-zoom-in').disabled = um.zoom >= 8;
  setCursorSize();
}
function setZoom(z, anchor) {
  um.zoom = Math.max(1, Math.min(8, z));
  if (!anchor) { const box = $('#um-stagebox'); anchor = [box.clientWidth / 2, box.clientHeight / 2]; }
  applyZoom(anchor);
}
$('#um-zoom-in').addEventListener('click', () => setZoom(um.zoom * 1.5));
$('#um-zoom-out').addEventListener('click', () => setZoom(um.zoom / 1.5));
$('#um-zoom-fit').addEventListener('click', () => setZoom(1));
$('#um-stagebox').addEventListener('wheel', e => {
  if (!um.w || !(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  const r = $('#um-stagebox').getBoundingClientRect();
  setZoom(um.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), [e.clientX - r.left, e.clientY - r.top]);
}, { passive: false });
let umSpace = false;
document.addEventListener('keydown', e => {
  if ($('#panel-unmark').hidden || e.code !== 'Space' || (e.target.closest && e.target.closest('input, textarea, select, button'))) return;
  e.preventDefault(); if (!umSpace) { umSpace = true; umMask.classList.add('is-pan'); }
});
document.addEventListener('keyup', e => { if (e.code === 'Space' && umSpace) { umSpace = false; umMask.classList.toggle('is-pan', um.mode === 'pan'); } });
window.addEventListener('resize', fitUm);
function setCursorSize() { const s = +$('#um-size').value; umCursor.style.width = umCursor.style.height = s + 'px'; }
function updateUmButtons() { $('#um-undo').disabled = !um.history.length; $('#um-compare').disabled = !um.history.length; }
function setUmMode(m) {
  um.mode = m;
  for (const k of ['paint', 'erase', 'pan']) $('#um-' + k).setAttribute('aria-pressed', m === k);
  umMask.classList.toggle('is-pan', m === 'pan');
}
$('#um-paint').addEventListener('click', () => setUmMode('paint'));
$('#um-erase').addEventListener('click', () => setUmMode('erase'));
$('#um-pan').addEventListener('click', () => setUmMode('pan'));
$('#um-size').addEventListener('input', () => { $('#um-size-v').textContent = $('#um-size').value; setCursorSize(); });
$('#um-clear').addEventListener('click', () => mctxU.clearRect(0, 0, umMask.width, umMask.height));
const umPt = e => { const r = umMask.getBoundingClientRect(); return [(e.clientX - r.left) / um.scale, (e.clientY - r.top) / um.scale, e.clientX - r.left, e.clientY - r.top]; };
function umStroke(a, b) {
  mctxU.save();
  mctxU.setTransform(um.ms, 0, 0, um.ms, 0, 0); // draw in picture coordinates
  mctxU.globalCompositeOperation = um.mode === 'erase' ? 'destination-out' : 'source-over';
  mctxU.strokeStyle = mctxU.fillStyle = '#ff2a4a';
  mctxU.lineWidth = +$('#um-size').value / um.scale; mctxU.lineCap = mctxU.lineJoin = 'round';
  mctxU.beginPath(); mctxU.moveTo(a[0], a[1]); mctxU.lineTo(b[0] + .01, b[1]); mctxU.stroke();
  mctxU.restore();
}
umMask.addEventListener('pointerdown', e => {
  e.preventDefault();
  try { umMask.setPointerCapture(e.pointerId); } catch (_) {}
  if (um.mode === 'pan' || umSpace) { const box = $('#um-stagebox'); um.pan = { x: e.clientX, y: e.clientY, l: box.scrollLeft, t: box.scrollTop }; return; }
  if (um.busy) { toast('正在處理，請等完成再塗抹'); return; }
  um.drawing = true; const p = umPt(e); um.last = p; umStroke(p, p);
});
umMask.addEventListener('pointermove', e => {
  if (um.pan) { const box = $('#um-stagebox'); box.scrollLeft = um.pan.l - (e.clientX - um.pan.x); box.scrollTop = um.pan.t - (e.clientY - um.pan.y); return; }
  const p = umPt(e);
  umCursor.hidden = um.mode === 'pan' || umSpace; umCursor.style.left = p[2] + 'px'; umCursor.style.top = p[3] + 'px';
  if (!um.drawing) return;
  umStroke(um.last, p); um.last = p;
});
const umEnd = () => { um.drawing = false; um.pan = null; };
umMask.addEventListener('pointerup', umEnd); umMask.addEventListener('pointercancel', umEnd);
umMask.addEventListener('pointerleave', () => { umCursor.hidden = true; });

function dilateMask(mask, W, H, r) {
  let cur = mask;
  for (let k = 0; k < r; k++) {
    const nx = cur.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (cur[i]) continue;
      if ((x > 0 && cur[i - 1]) || (x < W - 1 && cur[i + 1]) || (y > 0 && cur[i - W]) || (y < H - 1 && cur[i + W])) nx[i] = 1;
    }
    cur = nx;
  }
  return cur;
}
function makeUmWorker() {
  try {
    const code = `const A=(${umAlgoFactory.toString()})();self.onmessage=e=>{const d=e.data;try{A.fillRegion(d.px,d.mask,d.W,d.H);self.postMessage({ok:true,px:d.px},[d.px.buffer]);}catch(err){self.postMessage({ok:false,msg:String(err&&err.message||err)});}};`;
    return new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
  } catch (e) { return null; }
}
let umWorker; // created the first time something is removed
/* Cancelling stops the worker outright and starts a fresh one for next time. */
function runFill(px, mask, W, H, signal) {
  const local = a => { umAlgoFactory().fillRegion(a, mask, W, H); return a; };
  if (umWorker === undefined) umWorker = makeUmWorker();
  if (!umWorker) return new Promise(r => setTimeout(() => r(local(px)), 30));
  // px goes to the worker (and is gone from here); this copy is filled on the page instead if the worker dies.
  const copy = px.slice(), w = umWorker;
  return new Promise((resolve, reject) => {
    const onAbort = () => { w.terminate(); umWorker = undefined; reject(new Cancelled()); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    w.onmessage = e => { signal && signal.removeEventListener('abort', onAbort); e.data.ok ? resolve(e.data.px) : reject(new Error(e.data.msg)); };
    w.onerror = () => {
      signal && signal.removeEventListener('abort', onAbort);
      try { w.terminate(); } catch (e) {}
      umWorker = null; // from now on, always on the page
      setTimeout(() => { try { resolve(local(copy)); } catch (e) { reject(e); } }, 0);
    };
    w.postMessage({ px, mask, W, H }, [px.buffer]);
  });
}
async function removeMarked(signal) {
  const W = um.w, H = um.h, MW = umMask.width, MH = umMask.height, ms = um.ms;
  const md = mctxU.getImageData(0, 0, MW, MH).data;
  let mx0 = MW, my0 = MH, mx1 = -1, my1 = -1;
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (md[(y * MW + x) * 4 + 3] > 24) { if (x < mx0) mx0 = x; if (x > mx1) mx1 = x; if (y < my0) my0 = y; if (y > my1) my1 = y; }
  if (mx1 < 0) { toast('先用筆刷塗抹要去除的區域'); return false; }
  const x0 = Math.max(0, Math.floor(mx0 / ms)), y0 = Math.max(0, Math.floor(my0 / ms));
  const x1 = Math.min(W - 1, Math.ceil((mx1 + 1) / ms)), y1 = Math.min(H - 1, Math.ceil((my1 + 1) / ms));
  const pad = Math.max(48, Math.round(Math.max(x1 - x0, y1 - y0) * .75));
  const cx0 = Math.max(0, x0 - pad), cy0 = Math.max(0, y0 - pad), cx1 = Math.min(W - 1, x1 + pad), cy1 = Math.min(H - 1, y1 + pad);
  const cw = cx1 - cx0 + 1, chh = cy1 - cy0 + 1;
  let mask = new Uint8Array(cw * chh);
  for (let y = 0; y < chh; y++) {
    const row = Math.min(MH - 1, Math.floor((y + cy0) * ms)) * MW;
    for (let x = 0; x < cw; x++) if (md[(row + Math.min(MW - 1, Math.floor((x + cx0) * ms))) * 4 + 3] > 24) mask[y * cw + x] = 1;
  }
  mask = dilateMask(mask, cw, chh, 2);
  // Undo keeps only the region that changes, not the whole picture (a 24 MP photo is ~96 MB per full copy).
  const before = uctx.getImageData(cx0, cy0, cw, chh);
  const sub = uctx.getImageData(cx0, cy0, cw, chh);
  const token = um.token;
  um.busy = true;
  try {
    const out = await runFill(sub.data, mask, cw, chh, signal);
    if (token !== um.token) return false; // a different image was loaded meanwhile
    uctx.putImageData(new ImageData(out, cw, chh), cx0, cy0);
    um.history.push({ x: cx0, y: cy0, data: before }); if (um.history.length > 8) um.history.shift();
    mctxU.clearRect(0, 0, MW, MH);
  } finally { um.busy = false; }
  updateUmButtons();
  return true;
}
$('#um-go').addEventListener('click', e => runJob(e.currentTarget, '處理中…', async (check, signal) => {
  if (await removeMarked(signal)) toast('已移除，不滿意可以按「復原」');
}).catch(err => toast('處理失敗：' + err.message, 'err')));
$('#um-undo').addEventListener('click', () => {
  // The removal under way read its pixels before this; finishing, it would paint the undone change back.
  if (um.busy) { toast('正在處理，請等完成再復原'); return; }
  const s = um.history.pop(); if (s) uctx.putImageData(s.data, s.x, s.y); updateUmButtons();
});
async function showOrig(on) {
  um.showingOrig = on;
  if (!on) { umOrig.hidden = true; umOrig.width = umOrig.height = 0; um.origReady = false; return; }
  if (!um.origReady) {
    const token = um.token, bmp = await createImageBitmap(um.file);
    if (token !== um.token || !um.showingOrig) { bmp.close && bmp.close(); return; }
    umOrig.width = um.w; umOrig.height = um.h;
    umOrig.getContext('2d').drawImage(bmp, 0, 0, um.w, um.h); bmp.close && bmp.close();
    um.origReady = true;
  }
  umOrig.hidden = !um.showingOrig;
}
$('#um-compare').addEventListener('pointerdown', () => showOrig(true));
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => $('#um-compare').addEventListener(ev, () => showOrig(false)));
$('#um-compare').addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') showOrig(true); });
$('#um-compare').addEventListener('keyup', () => showOrig(false));
$('#um-save').addEventListener('click', e => busy(e.currentTarget, '準備中…', async () => {
  const blob = await new Promise(r => umImg.toBlob(r, um.mime, .93));
  if (!blob) throw new Error('圖片太大，瀏覽器無法輸出');
  let name = ($('#um-name').value || 'image').trim();
  const ext = um.mime === 'image/jpeg' ? 'jpg' : 'png';
  if (!new RegExp('\\.' + ext + '$', 'i').test(name)) name = name.replace(/\.(jpe?g|png|webp|bmp|gif)$/i, '') + '.' + ext;
  await saveFile(name, blob);
  offerNext(new File([blob], name, { type: um.mime }), 'image', 'unmark');
}).catch(err => toast('下載失敗：' + err.message, 'err')));
bindInput($('#um-input'), loadUm);
registerTarget('image', 'unmark', '去浮水印', loadUm);
acceptFiles($('#panel-unmark'), $('#um-drop'), loadUm);
$('#um-change').addEventListener('click', () => $('#um-input').click());
onSample($('#um-sample'), async () => {
  const W = 1600, H = 1067, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const sky = c.createLinearGradient(0, 0, 0, H * .62); sky.addColorStop(0, '#7fb2d9'); sky.addColorStop(1, '#f1d3a6');
  c.fillStyle = sky; c.fillRect(0, 0, W, H);
  c.fillStyle = '#f7e2b8'; c.beginPath(); c.arc(1180, 330, 70, 0, 7); c.fill();
  const hill = (col, base, amp, f) => { c.fillStyle = col; c.beginPath(); c.moveTo(0, H); for (let x = 0; x <= W; x += 20) c.lineTo(x, base + Math.sin(x * f) * amp + Math.sin(x * f * 2.7) * amp * .3); c.lineTo(W, H); c.fill(); };
  hill('#6f8fa8', 600, 60, .004); hill('#4f6e5a', 700, 45, .006); hill('#2f4a36', 820, 35, .009);
  const img = c.getImageData(0, 0, W, H), d = img.data;
  for (let p = 0; p < d.length; p += 4) { const n = (Math.random() - .5) * 18; d[p] += n; d[p + 1] += n; d[p + 2] += n; }
  c.putImageData(img, 0, 0);
  c.save(); c.translate(W / 2, H / 2); c.rotate(-.18);
  c.font = '700 120px sans-serif'; c.textAlign = 'center'; c.fillStyle = 'rgba(255,255,255,.55)'; c.fillText('© SAMPLE PHOTO', 0, 40);
  c.restore();
  c.font = '600 44px monospace'; c.fillStyle = '#ff8a1e'; c.fillText('2026 11 19', W - 330, H - 50);
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .92));
  await loadUm([new File([blob], 'landscape.jpg', { type: 'image/jpeg' })]);
});
registerHolder('unmark', () => um.w ? um.w * um.h * 4 + umMask.width * umMask.height * 4 + umOrig.width * umOrig.height * 4
  + um.history.reduce((n, h) => n + h.data.data.length, 0) : 0, () => {
  um.token = (um.token || 0) + 1;
  for (const c of [umImg, umMask, umOrig]) c.width = c.height = 0;
  Object.assign(um, { name: '', w: 0, h: 0, history: [], file: null, origReady: false });
  updateUmButtons();
  $('#um-empty').hidden = false; $('#um-work').hidden = true;
});
