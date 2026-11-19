'use strict';
/* ================= WATERMARK REMOVER ================= */
const um = { name: '', mime: 'image/png', w: 0, h: 0, scale: 1, mode: 'paint', history: [], drawing: false, last: null };
const umImg = $('#um-img'), umMask = $('#um-mask'), umOrig = $('#um-orig'), umWrap = $('#um-wrap'), umCursor = $('#um-cursor');
const uctx = umImg.getContext('2d', { willReadFrequently: true });
const mctxU = umMask.getContext('2d', { willReadFrequently: true });
async function loadUm(files) {
  const f = files[0];
  if (!isImage(f)) { toast(`「${f.name}」不是支援的圖片格式`, 'err'); return; }
  let bmp;
  try { bmp = await createImageBitmap(f); } catch (e) { toast(`「${f.name}」無法讀取，圖片可能已損壞。`, 'err'); return; }
  let w = bmp.width, h = bmp.height;
  const ow = w, oh = h;
  const maxPx = 24e6; if (w * h > maxPx) { const s = Math.sqrt(maxPx / (w * h)); w = Math.round(w * s); h = Math.round(h * s); }
  Object.assign(um, { name: f.name, w, h, history: [], token: (um.token || 0) + 1 });
  um.mime = /jpe?g/i.test(f.type) || /\.jpe?g$/i.test(f.name) ? 'image/jpeg' : 'image/png';
  [umImg, umMask, umOrig].forEach(c => { c.width = w; c.height = h; });
  uctx.drawImage(bmp, 0, 0, w, h);
  umOrig.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close && bmp.close();
  mctxU.clearRect(0, 0, w, h);
  $('#um-name').value = f.name.replace(/\.[^.]+$/, '') + '-去浮水印.' + (um.mime === 'image/jpeg' ? 'jpg' : 'png');
  $('#um-meta').textContent = w === ow ? `${w} × ${h} px` : `${w} × ${h} px（原圖 ${ow} × ${oh}，已縮小以便處理）`;
  $('#um-empty').hidden = true; $('#um-work').hidden = false;
  updateUmButtons(); fitUm();
}
function fitUm() {
  if (!um.w || $('#panel-unmark').hidden) return;
  const box = $('#um-stagebox');
  const avail = Math.max(120, box.clientWidth - 24);
  const maxH = Math.max(260, window.innerHeight * .68);
  um.scale = Math.min(avail / um.w, maxH / um.h, 1.5);
  umWrap.style.width = um.w * um.scale + 'px'; umWrap.style.height = um.h * um.scale + 'px';
  setCursorSize();
}
window.addEventListener('resize', fitUm);
function setCursorSize() { const s = +$('#um-size').value; umCursor.style.width = umCursor.style.height = s + 'px'; }
function updateUmButtons() { $('#um-undo').disabled = !um.history.length; $('#um-compare').disabled = !um.history.length; }
function setUmMode(m) { um.mode = m; $('#um-paint').setAttribute('aria-pressed', m === 'paint'); $('#um-erase').setAttribute('aria-pressed', m === 'erase'); }
$('#um-paint').addEventListener('click', () => setUmMode('paint'));
$('#um-erase').addEventListener('click', () => setUmMode('erase'));
$('#um-size').addEventListener('input', () => { $('#um-size-v').textContent = $('#um-size').value; setCursorSize(); });
$('#um-clear').addEventListener('click', () => mctxU.clearRect(0, 0, um.w, um.h));
const umPt = e => { const r = umMask.getBoundingClientRect(); return [(e.clientX - r.left) / um.scale, (e.clientY - r.top) / um.scale, e.clientX - r.left, e.clientY - r.top]; };
function umStroke(a, b) {
  mctxU.save();
  mctxU.globalCompositeOperation = um.mode === 'erase' ? 'destination-out' : 'source-over';
  mctxU.strokeStyle = mctxU.fillStyle = '#ff2a4a';
  mctxU.lineWidth = +$('#um-size').value / um.scale; mctxU.lineCap = mctxU.lineJoin = 'round';
  mctxU.beginPath(); mctxU.moveTo(a[0], a[1]); mctxU.lineTo(b[0] + .01, b[1]); mctxU.stroke();
  mctxU.restore();
}
umMask.addEventListener('pointerdown', e => { e.preventDefault(); if (um.busy) { toast('正在處理，請等完成再塗抹'); return; } try { umMask.setPointerCapture(e.pointerId); } catch (_) {} um.drawing = true; const p = umPt(e); um.last = p; umStroke(p, p); });
umMask.addEventListener('pointermove', e => {
  const p = umPt(e);
  umCursor.hidden = false; umCursor.style.left = p[2] + 'px'; umCursor.style.top = p[3] + 'px';
  if (!um.drawing) return;
  umStroke(um.last, p); um.last = p;
});
const umEnd = () => { um.drawing = false; };
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
let umWorker = null;
try {
  const code = `const A=(${umAlgoFactory.toString()})();self.onmessage=e=>{const d=e.data;try{A.fillRegion(d.px,d.mask,d.W,d.H);self.postMessage({ok:true,px:d.px},[d.px.buffer]);}catch(err){self.postMessage({ok:false,msg:String(err&&err.message||err)});}};`;
  umWorker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
} catch (e) { umWorker = null; }
function runFill(px, mask, W, H) {
  const local = () => { umAlgoFactory().fillRegion(px, mask, W, H); return px; };
  if (!umWorker) return new Promise(r => setTimeout(() => r(local()), 30));
  const copy = px.slice();
  return new Promise((resolve, reject) => {
    umWorker.onmessage = e => e.data.ok ? resolve(e.data.px) : reject(new Error(e.data.msg));
    umWorker.onerror = () => { umWorker = null; px.set(copy); resolve(local()); };
    umWorker.postMessage({ px, mask, W, H }, [px.buffer]);
  });
}
async function removeMarked() {
  const W = um.w, H = um.h;
  const md = mctxU.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (md[(y * W + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) { toast('先用筆刷塗抹要去除的區域'); return false; }
  const pad = Math.max(48, Math.round(Math.max(x1 - x0, y1 - y0) * .75));
  const cx0 = Math.max(0, x0 - pad), cy0 = Math.max(0, y0 - pad), cx1 = Math.min(W - 1, x1 + pad), cy1 = Math.min(H - 1, y1 + pad);
  const cw = cx1 - cx0 + 1, chh = cy1 - cy0 + 1;
  let mask = new Uint8Array(cw * chh);
  for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) if (md[((y + cy0) * W + x + cx0) * 4 + 3] > 24) mask[y * cw + x] = 1;
  mask = dilateMask(mask, cw, chh, 2);
  // Undo keeps only the region that changes, not the whole picture (a 24 MP photo is ~96 MB per full copy).
  const before = uctx.getImageData(cx0, cy0, cw, chh);
  const sub = uctx.getImageData(cx0, cy0, cw, chh);
  const token = um.token;
  um.busy = true;
  try {
    const out = await runFill(sub.data, mask, cw, chh);
    if (token !== um.token) return false; // a different image was loaded meanwhile
    uctx.putImageData(new ImageData(out, cw, chh), cx0, cy0);
    um.history.push({ x: cx0, y: cy0, data: before }); if (um.history.length > 8) um.history.shift();
    mctxU.clearRect(0, 0, W, H);
  } finally { um.busy = false; }
  updateUmButtons();
  return true;
}
$('#um-go').addEventListener('click', e => busy(e.currentTarget, '處理中…', async () => {
  if (await removeMarked()) toast('已移除，不滿意可以按「復原」');
}).catch(err => toast('處理失敗：' + err.message, 'err')));
$('#um-undo').addEventListener('click', () => { const s = um.history.pop(); if (s) uctx.putImageData(s.data, s.x, s.y); updateUmButtons(); });
const showOrig = on => { umOrig.hidden = !on; };
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
}).catch(err => toast('下載失敗：' + err.message, 'err')));
bindInput($('#um-input'), loadUm);
acceptFiles($('#panel-unmark'), $('#um-drop'), loadUm);
$('#um-change').addEventListener('click', () => $('#um-input').click());
$('#um-sample').addEventListener('click', async () => {
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
  loadUm([new File([blob], 'landscape.jpg', { type: 'image/jpeg' })]);
});
