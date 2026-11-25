'use strict';
/* ================= ID PHOTO LAYOUT =================
   One portrait photo is framed to an ID photo size (drag, zoom, straighten, with guide lines for where the top of the
   head and the chin go) and repeated over a 4×6 photo print or an A4 page, with thin lines to cut along.
   Placement is kept in millimetres and photo pixels, so the small frame on screen, the sheet preview and the
   300 dpi print all draw the same crop: (cx, cy) is the photo pixel at the frame's centre, k is millimetres per pixel. */
const PH_SPECS = {
  tw2: { w: 35, h: 45, label: '2吋', guide: { top: 4, min: 32, max: 36 } },
  tw1: { w: 28, h: 35, label: '1吋', guide: { top: 3, min: 21, max: 25 } },
  us: { w: 51, h: 51, label: '美國簽證', guide: { top: 5, min: 25, max: 35 } },
  custom: { w: 30, h: 40, label: '自訂', guide: null }
};
/* margins and gaps leave room to cut while a 4×6 print still holds 8 photos of 2 吋 or 12 of 1 吋 */
const PH_PAPER = { '4x6': { w: 101.6, h: 152.4, margin: 2.5, gap: 1.5, name: '4×6 相紙' }, a4: { w: 210, h: 297, margin: 10, gap: 3, name: 'A4' } };
const ph = { file: null, bmp: null, cx: 0, cy: 0, k: 1, k0: 1, rot: 0, bright: 0, token: 0 };
const PH_MAX_PX = 2400;

function phSpec() {
  const key = $('#ph-spec').value, s = PH_SPECS[key];
  if (key !== 'custom') return s;
  const v = (sel, d, lo, hi) => Math.min(hi, Math.max(lo, +$(sel).value || d));
  return { ...s, w: v('#ph-cw', 30, 15, 100), h: v('#ph-ch', 40, 15, 120) };
}
/* Photos side by side in rows; the paper is turned whichever way holds more. */
function phSheet() {
  const s = phSpec(), P = PH_PAPER[$('#ph-paper').value];
  const fit = (W, H) => {
    const cols = Math.floor((W - 2 * P.margin + P.gap) / (s.w + P.gap)), rows = Math.floor((H - 2 * P.margin + P.gap) / (s.h + P.gap));
    return { W, H, cols: Math.max(0, cols), rows: Math.max(0, rows) };
  };
  const a = fit(P.w, P.h), b = fit(P.h, P.w);
  // A4 stays upright (it goes through a home printer); a photo print turns either way.
  const L = $('#ph-paper').value === 'a4' || a.cols * a.rows > b.cols * b.rows ? a : b;
  const tw = L.cols * s.w + (L.cols - 1) * P.gap, th = L.rows * s.h + (L.rows - 1) * P.gap;
  const cells = [];
  for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++)
    cells.push({ x: (L.W - tw) / 2 + c * (s.w + P.gap), y: (L.H - th) / 2 + r * (s.h + P.gap) });
  return { W: L.W, H: L.H, s, cells, paper: P };
}

/* ---------- the photo ---------- */
async function loadPh(files) {
  const [f] = (await prepImages(files)).filter(isImage);
  if (!f) { toast('請放入一張照片（JPG、PNG、HEIC）', 'err'); return; }
  // Decoded at most 2400 px on the long side, kept for the whole session (a 12 MP phone photo would be 48 MB, this
  // about 17 MB). A 2 吋 photo printed at 300 dpi is 413 × 531 px, so a head framed the usual way still has three
  // times the pixels it needs.
  let bmp;
  try {
    // A photo that needs no turning (see directKind() in img2pdf.js) gives its size without being decoded; a turned
    // one is decoded once to learn its size as shown, then again at the smaller size.
    const plain = directKind(await f.arrayBuffer()) !== 'other';
    const full = plain ? null : await createImageBitmap(f), { w: W, h: H } = plain ? await imageSize(f) : { w: full.width, h: full.height };
    const k = PH_MAX_PX / Math.max(W, H);
    if (k < 1) {
      if (full) full.close();
      bmp = await createImageBitmap(f, { resizeWidth: Math.round(W * k), resizeHeight: Math.round(H * k), resizeQuality: 'high' });
    } else bmp = full || await createImageBitmap(f);
  } catch (e) { toast(`「${f.name}」無法讀取，圖片可能已損壞。`, 'err'); return; }
  if (ph.bmp && ph.bmp.close) ph.bmp.close();
  Object.assign(ph, { file: f, bmp });
  phReset();
  $('#ph-drop').hidden = true; $('#ph-sample-row').hidden = true; $('#ph-edit').hidden = false;
  setJobButton($('#ph-go'), { disabled: false });
  drawPhAll();
}
/* A first guess for a typical portrait: the face is a little above the middle and the frame takes about two thirds
   of the photo's height. The guide lines are there for the real fit. */
function phReset() {
  const s = phSpec(), { width: w, height: h } = ph.bmp;
  ph.k0 = Math.max(s.w / w, s.h / h);
  ph.k = Math.max(ph.k0, s.h / (h * .66));
  ph.cx = w / 2; ph.cy = h * .45; ph.rot = 0; ph.bright = 0;
  $('#ph-zoom').value = Math.round(Math.log2(ph.k / ph.k0) * 100); $('#ph-rot').value = 0; $('#ph-bright').value = 0;
}
/* The framed photo, w × h millimetres at pxPerMm, onto ctx at (x, y) px. */
function drawPhPhoto(ctx, x, y, s, pxPerMm) {
  const W = s.w * pxPerMm, H = s.h * pxPerMm;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, W, H); ctx.clip();
  ctx.fillStyle = '#fff'; ctx.fillRect(x, y, W, H);
  ctx.translate(x + W / 2, y + H / 2); ctx.rotate(ph.rot * Math.PI / 180);
  const sc = ph.k * pxPerMm; ctx.scale(sc, sc); ctx.translate(-ph.cx, -ph.cy);
  if (ph.bright) ctx.filter = `brightness(${100 + ph.bright}%)`;
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(ph.bmp, 0, 0);
  ctx.restore();
}
function phTile(s, pxPerMm) {
  const cv = document.createElement('canvas'); cv.width = Math.round(s.w * pxPerMm); cv.height = Math.round(s.h * pxPerMm);
  drawPhPhoto(cv.getContext('2d'), 0, 0, s, cv.width / s.w);
  return cv;
}

/* ---------- the frame on screen, with guide lines ---------- */
function drawPhFrame() {
  if (!ph.bmp) return;
  const s = phSpec(), cv = $('#ph-frame'), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = Math.min(240, ($('#ph-edit').clientWidth || 480) * .5), cssH = cssW * s.h / s.w;
  cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
  cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
  const ctx = cv.getContext('2d'), m = cv.width / s.w; // px per mm
  drawPhPhoto(ctx, 0, 0, s, m);
  if (!$('#ph-guides').checked) return;
  ctx.save();
  ctx.lineWidth = Math.max(1, dpr); ctx.setLineDash([5 * dpr, 4 * dpr]);
  ctx.strokeStyle = 'rgba(11,122,107,.95)';
  ctx.beginPath(); ctx.moveTo(cv.width / 2, 0); ctx.lineTo(cv.width / 2, cv.height); ctx.stroke(); // centre line
  const g = s.guide;
  if (g) {
    ctx.fillStyle = 'rgba(255,216,77,.28)';
    ctx.fillRect(0, (g.top + g.min) * m, cv.width, (g.max - g.min) * m); // where the chin goes
    ctx.strokeStyle = 'rgba(214,48,36,.95)';
    for (const y of [g.top, g.top + g.min, g.top + g.max]) { ctx.beginPath(); ctx.moveTo(0, y * m); ctx.lineTo(cv.width, y * m); ctx.stroke(); }
    ctx.setLineDash([]); ctx.font = `600 ${11 * dpr}px ${getComputedStyle(document.body).fontFamily}`;
    const label = (t, y) => { ctx.lineWidth = 3 * dpr; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(t, 4 * dpr, y); ctx.fillStyle = '#b3261e'; ctx.fillText(t, 4 * dpr, y); };
    label('頭頂', g.top * m - 3 * dpr);
    label('下巴', (g.top + g.max) * m + 13 * dpr);
  }
  ctx.restore();
}
/* ---------- the whole sheet, small ---------- */
async function drawPhSheet() {
  const token = ++ph.token, L = phSheet(), cv = $('#ph-sheet'), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const box = $('#panel-idphoto .wm-preview').clientWidth - 28;
  const cssW = Math.min(L.W > L.H ? 360 : 300, Math.max(180, box || 300)), k = cssW / L.W * dpr;
  cv.width = Math.round(L.W * k); cv.height = Math.round(L.H * k);
  cv.style.width = cssW + 'px'; cv.style.height = Math.round(cssW * L.H / L.W) + 'px';
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  if (ph.bmp) {
    const tile = phTile(L.s, k * 1.5);
    if (token !== ph.token) return;
    for (const c of L.cells) ctx.drawImage(tile, c.x * k, c.y * k, L.s.w * k, L.s.h * k);
    tile.width = tile.height = 0;
  } else {
    ctx.fillStyle = '#e4e9ed';
    for (const c of L.cells) ctx.fillRect(c.x * k, c.y * k, L.s.w * k, L.s.h * k);
  }
  if ($('#ph-cut').checked) phCutLines(ctx, L, k);
  $('#ph-sheet-hint').textContent = `${L.paper.name} · ${L.cells.length} 張`;
  updatePhSummary(L);
}
function phCutLines(ctx, L, k) {
  ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = Math.max(1, .1 * k);
  for (const c of L.cells) ctx.strokeRect(c.x * k, c.y * k, L.s.w * k, L.s.h * k);
  ctx.restore();
}
function updatePhSummary(L) {
  const s = L.s;
  $('#ph-summary').textContent = !L.cells.length ? '這個尺寸放不進這張紙'
    : `${s.label} ${s.w / 10} × ${s.h / 10} cm · ${L.paper.name}排 ${L.cells.length} 張`;
  setJobButton($('#ph-go'), { disabled: !ph.bmp || !L.cells.length, text: $('#ph-paper').value === 'a4' ? '產生 PDF' : '產生 JPG' });
  const name = $('#ph-name'), ext = $('#ph-paper').value === 'a4' ? '.pdf' : '.jpg';
  if (/^證件照-.*\.(jpg|pdf)$/.test(name.value) || !name.value.trim()) name.value = `證件照-${s.label}${ext}`;
  else name.value = name.value.replace(/\.(jpg|jpeg|pdf)$/i, '') + ext;
}
let phFrameQueued = false;
function drawPhAll() {
  if (phFrameQueued) return; phFrameQueued = true;
  requestAnimationFrame(() => { phFrameQueued = false; drawPhFrame(); drawPhSheet(); });
}

/* ---------- moving the photo in the frame ---------- */
function phNudge(dxMm, dyMm) { // a move of the frame's content, in millimetres on the frame
  const a = -ph.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  ph.cx -= (dxMm * c - dyMm * s) / ph.k; ph.cy -= (dxMm * s + dyMm * c) / ph.k;
  drawPhAll();
}
(() => {
  const cv = $('#ph-frame'); let drag = null;
  cv.addEventListener('pointerdown', e => { if (!ph.bmp) return; drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); e.preventDefault(); });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    const mmPerCss = phSpec().w / cv.clientWidth;
    phNudge((e.clientX - drag.x) * mmPerCss, (e.clientY - drag.y) * mmPerCss);
    drag = { x: e.clientX, y: e.clientY };
  });
  const end = () => { drag = null; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', e => {
    if (!ph.bmp) return; e.preventDefault();
    const z = $('#ph-zoom'); z.value = Math.max(+z.min, Math.min(+z.max, +z.value - Math.sign(e.deltaY) * 8));
    z.dispatchEvent(new Event('input'));
  }, { passive: false });
  cv.addEventListener('keydown', e => {
    const step = e.shiftKey ? 2 : .4, d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d && ph.bmp) { e.preventDefault(); phNudge(d[0], d[1]); }
  });
})();
$('#ph-zoom').addEventListener('input', e => { if (ph.bmp) { ph.k = ph.k0 * Math.pow(2, +e.target.value / 100); drawPhAll(); } });
$('#ph-rot').addEventListener('input', e => { ph.rot = +e.target.value; drawPhAll(); });
$('#ph-bright').addEventListener('input', e => { ph.bright = +e.target.value; drawPhAll(); });
$('#ph-reset').addEventListener('click', () => { if (ph.bmp) { phReset(); drawPhAll(); } });
$('#ph-change').addEventListener('click', () => $('#ph-input').click());
$('#ph-spec').addEventListener('change', () => {
  $('#ph-custom').hidden = $('#ph-spec').value !== 'custom';
  if (ph.bmp) { // keep the zoom the user chose, measured against the new size
    const s = phSpec(); ph.k0 = Math.max(s.w / ph.bmp.width, s.h / ph.bmp.height);
    ph.k = Math.max(ph.k, ph.k0 * .5); $('#ph-zoom').value = Math.round(Math.log2(ph.k / ph.k0) * 100);
  }
  drawPhAll();
});
['#ph-paper', '#ph-guides', '#ph-cut'].forEach(s => $(s).addEventListener('change', drawPhAll));
['#ph-cw', '#ph-ch'].forEach(s => $(s).addEventListener('input', drawPhAll));
window.addEventListener('resize', () => { if (!$('#panel-idphoto').hidden) drawPhAll(); });

/* ---------- output: a 300 dpi JPG for photo printing, or an A4 PDF ---------- */
/* A canvas JPEG says 72 dpi (or nothing); set 300 in its JFIF header so photo software prints it at the real size. */
function setJpegDpi(bytes, dpi) {
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF && bytes[3] === 0xE0 && String.fromCharCode(...bytes.slice(6, 10)) === 'JFIF') {
    bytes[13] = 1; bytes[14] = dpi >> 8; bytes[15] = dpi & 255; bytes[16] = dpi >> 8; bytes[17] = dpi & 255;
  }
  return bytes;
}
$('#ph-go').addEventListener('click', e => runJob(e.currentTarget, '產生中…', async () => {
  const L = phSheet(), pxPerMm = 300 / 25.4, name = $('#ph-name').value.trim() || 'id-photo';
  if (!ph.bmp || !L.cells.length) return;
  const tile = phTile(L.s, pxPerMm);
  if ($('#ph-paper').value === 'a4') {
    const blob = await new Promise(r => tile.toBlob(r, 'image/jpeg', .95)); tile.width = tile.height = 0;
    const out = await PDFDocument.create(), page = out.addPage([L.W * MM_PT, L.H * MM_PT]);
    const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    for (const c of L.cells) {
      const x = c.x * MM_PT, y = (L.H - c.y - L.s.h) * MM_PT, w = L.s.w * MM_PT, h = L.s.h * MM_PT;
      page.drawImage(img, { x, y, width: w, height: h });
      if ($('#ph-cut').checked) page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(.6, .6, .6), borderWidth: .3 });
    }
    out.setTitle(baseName(ensurePdf(name)));
    await deliver(pdfFile(await out.save(), name.replace(/\.(jpe?g)$/i, '')), 'pdf', 'idphoto');
    return;
  }
  const cv = document.createElement('canvas'); cv.width = Math.round(L.W * pxPerMm); cv.height = Math.round(L.H * pxPerMm);
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  for (const c of L.cells) ctx.drawImage(tile, Math.round(c.x * pxPerMm), Math.round(c.y * pxPerMm));
  tile.width = tile.height = 0;
  if ($('#ph-cut').checked) phCutLines(ctx, L, pxPerMm);
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .95)); cv.width = cv.height = 0;
  const bytes = setJpegDpi(new Uint8Array(await blob.arrayBuffer()), 300);
  await deliver(new File([bytes], name.replace(/\.(jpe?g|pdf)$/i, '') + '.jpg', { type: 'image/jpeg' }), 'image', 'idphoto');
  toast('列印時請選「4×6 相片」、「原尺寸／不要縮放」，印出來才是正確大小');
}).catch(err => toast('產生失敗：' + err.message, 'err')));

/* ---------- wiring ---------- */
bindInput($('#ph-input'), loadPh);
acceptFiles($('#panel-idphoto'), $('#ph-drop'), loadPh);
registerTarget('image', 'idphoto', '證件照', loadPh);
registerHolder('idphoto', () => ph.bmp ? ph.bmp.width * ph.bmp.height * 4 + ph.file.size : 0, () => {
  if (ph.bmp && ph.bmp.close) ph.bmp.close();
  Object.assign(ph, { file: null, bmp: null });
  $('#ph-drop').hidden = false; $('#ph-sample-row').hidden = false; $('#ph-edit').hidden = true;
  drawPhAll();
});
/* sample: a drawn portrait on a pale background, framed a little loosely so there is something to adjust */
$('#ph-sample').addEventListener('click', async () => {
  const W = 1200, H = 1600, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#f1f4f6'); bg.addColorStop(1, '#dfe5ea');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#2f4058'; ctx.beginPath(); ctx.ellipse(W / 2, H * .98, 470, 330, 0, Math.PI, 0); ctx.fill(); // shoulders
  ctx.fillStyle = '#e8bf9c'; ctx.fillRect(W / 2 - 85, H * .58, 170, 170); // neck
  ctx.beginPath(); ctx.ellipse(W / 2, H * .45, 215, 280, 0, 0, Math.PI * 2); ctx.fill(); // face
  ctx.fillStyle = '#2a2320'; ctx.beginPath(); ctx.ellipse(W / 2, H * .34, 240, 190, 0, Math.PI, 0); ctx.fill(); // hair
  ctx.beginPath(); ctx.ellipse(W / 2 - 205, H * .4, 45, 120, .1, 0, Math.PI * 2); ctx.ellipse(W / 2 + 205, H * .4, 45, 120, -.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2a2320';
  for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(W / 2 + sx * 85, H * .45, 22, 15, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(W / 2 + sx * 85 - 45, H * .415, 90, 10); }
  ctx.strokeStyle = '#b67f63'; ctx.lineWidth = 9; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(W / 2, H * .47); ctx.lineTo(W / 2 - 18, H * .52); ctx.lineTo(W / 2 + 8, H * .525); ctx.stroke();
  ctx.beginPath(); ctx.arc(W / 2, H * .53, 70, .2 * Math.PI, .8 * Math.PI); ctx.stroke();
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .9)); cv.width = cv.height = 0;
  await loadPh([new File([blob], 'portrait-sample.jpg', { type: 'image/jpeg' })]);
});
drawPhAll();
