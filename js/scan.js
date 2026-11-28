'use strict';
/* ================= SCAN: straighten a phone photo of a document =================
   Drag the four corners onto the paper's corners; the picture inside is pulled into a flat rectangle
   (perspective correction), then optionally cleaned up: shadows evened out, paper made white, grey or black & white.
   Used from 「圖片轉 PDF」 (the 校正 button on each picture) and 「證件影印」. The original file is kept so it can be
   adjusted again. openScan(it, done): done() runs after the picture was corrected or restored (default: redraw the
   image list of 圖片轉 PDF). */
const sc = { it: null, bmp: null, quad: null, rot: 0, scale: 1, view: 'edit', token: 0 };
const scDlg = $('#sc-dialog'), scCanvas = $('#sc-canvas'), scSvg = $('#sc-svg');

/* ---------- geometry ---------- */
/* Homography taking the output rectangle (0,0)-(W,H) to the four source corners (TL, TR, BR, BL). */
function homography(W, H, q) {
  const dst = [[0, 0], [W, 0], [W, H], [0, H]], A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = dst[i], [x, y] = q[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  for (let c = 0; c < 8; c++) { // Gaussian elimination with partial pivoting
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    const d = A[c][c] || 1e-12;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / d; if (!f) continue;
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => v / A[i][i]);
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/* Size of the flattened page, from the lengths of the quad's sides, capped to maxLong pixels on the long side. */
function outSize(q, maxLong) {
  let W = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), H = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const k = Math.min(1, maxLong / Math.max(W, H));
  return [Math.max(8, Math.round(W * k)), Math.max(8, Math.round(H * k))];
}
function warp(src, sw, sh, q, W, H) {
  const h = homography(W, H, q), s = src.data, out = new ImageData(W, H), d = out.data;
  for (let v = 0; v < H; v++) {
    const vv = v + .5;
    let nx = h[1] * vv + h[2] + h[0] * .5, ny = h[4] * vv + h[5] + h[3] * .5, dn = h[7] * vv + 1 + h[6] * .5;
    for (let u = 0, o = v * W * 4; u < W; u++, o += 4) {
      let x = nx / dn - .5, y = ny / dn - .5;
      nx += h[0]; ny += h[3]; dn += h[6];
      if (x < 0) x = 0; else if (x > sw - 1) x = sw - 1;
      if (y < 0) y = 0; else if (y > sh - 1) y = sh - 1;
      const x0 = x | 0, y0 = y | 0, x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1), fx = x - x0, fy = y - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const top = s[i00 + c] + (s[i10 + c] - s[i00 + c]) * fx, bot = s[i01 + c] + (s[i11 + c] - s[i01 + c]) * fx;
        d[o + c] = top + (bot - top) * fy;
      }
      d[o + 3] = 255;
    }
  }
  return out;
}

/* ---------- finding the paper ----------
   A small grey copy is split into light and dark (Otsu); the largest light blob is taken as the paper and its
   corners are the points furthest towards each corner of the picture. Works for white paper on a darker table;
   otherwise the corners simply stay at the picture's edges. */
function detectQuad(bmp) {
  const k = 256 / Math.max(bmp.width, bmp.height), w = Math.max(8, Math.round(bmp.width * k)), h = Math.max(8, Math.round(bmp.height * k));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data, n = w * h, g = new Uint8Array(n);
  for (let i = 0; i < n; i++) g[i] = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8;
  const hist = new Array(256).fill(0); g.forEach(v => hist[v]++);
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sb = 0, wb = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wb += hist[i]; if (!wb) continue; const wf = n - wb; if (!wf) break;
    sb += i * hist[i]; const mb = sb / wb, mf = (sum - sb) / wf, between = wb * wf * (mb - mf) ** 2;
    if (between > best) { best = between; t = i; }
  }
  const lab = new Int32Array(n), q = new Int32Array(n); let bestLab = 0, bestSize = 0, cur = 0;
  for (let i = 0; i < n; i++) {
    if (lab[i] || g[i] <= t) continue;
    cur++; let head = 0, tail = 0, size = 0; q[tail++] = i; lab[i] = cur;
    while (head < tail) {
      const p = q[head++], x = p % w; size++;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
      for (const r of nb) if (r >= 0 && r < n && !lab[r] && g[r] > t) { lab[r] = cur; q[tail++] = r; }
    }
    if (size > bestSize) { bestSize = size; bestLab = cur; }
  }
  cv.width = cv.height = 0;
  if (bestSize < n * .15 || bestSize > n * .97) return null;
  let tl = [0, 0, Infinity], tr = [0, 0, -Infinity], br = [0, 0, -Infinity], bl = [0, 0, Infinity];
  for (let i = 0; i < n; i++) {
    if (lab[i] !== bestLab) continue;
    const x = i % w, y = (i / w) | 0, s = x + y, d = x - y;
    if (s < tl[2]) tl = [x, y, s]; if (s > br[2]) br = [x, y, s];
    if (d > tr[2]) tr = [x, y, d]; if (d < bl[2]) bl = [x, y, d];
  }
  const quad = [tl, tr, br, bl].map(([x, y]) => [(x + .5) / w, (y + .5) / h]);
  // reject a sliver (all four corners close together or on one line)
  const area = Math.abs(quad.reduce((a, p, i) => { const r = quad[(i + 1) % 4]; return a + p[0] * r[1] - r[0] * p[1]; }, 0)) / 2;
  return area > .12 ? quad : null;
}
const FULL_QUAD = () => [[0, 0], [1, 0], [1, 1], [0, 1]];

/* ---------- clean-up filters ----------
   The paper's own brightness (with shadows and colour cast) is estimated from a tiny copy where text has been
   removed (each pixel takes the brightest of its neighbours), blurred and scaled back up. Dividing by it evens out
   shadows and makes the paper white. */
function cleanUp(img, mode) {
  if (mode === 'none') return img;
  const W = img.width, H = img.height, d = img.data;
  const sw = Math.max(4, Math.round(W / 24)), sh = Math.max(4, Math.round(H / 24));
  const full = document.createElement('canvas'); full.width = W; full.height = H;
  full.getContext('2d').putImageData(img, 0, 0);
  let cur = full, cw = W, ch = H; // halve step by step so the small copy is a true average
  while (cw / 2 > sw && ch / 2 > sh) {
    const nx = document.createElement('canvas'); nx.width = Math.round(cw / 2); nx.height = Math.round(ch / 2);
    nx.getContext('2d').drawImage(cur, 0, 0, nx.width, nx.height);
    if (cur !== full) cur.width = cur.height = 0;
    cur = nx; cw = nx.width; ch = nx.height;
  }
  const small = document.createElement('canvas'); small.width = sw; small.height = sh;
  const sctx = small.getContext('2d', { willReadFrequently: true }); sctx.drawImage(cur, 0, 0, sw, sh);
  if (cur !== full) cur.width = cur.height = 0;
  full.width = full.height = 0;
  const sm = sctx.getImageData(0, 0, sw, sh), a = sm.data;
  const pass = (fn, r) => { // max (fn = Math.max) or mean (fn = null) over a (2r+1)² window, per channel
    const b = new Uint8ClampedArray(a);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) for (let c = 0; c < 3; c++) {
      let m = 0, cnt = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= sh) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= sw) continue;
          const v = b[(yy * sw + xx) * 4 + c];
          if (fn) { if (v > m) m = v; } else { m += v; cnt++; }
        }
      }
      a[(y * sw + x) * 4 + c] = fn ? m : m / cnt;
    }
  };
  pass(Math.max, 2); pass(null, 2);
  sctx.putImageData(sm, 0, 0);
  const big = document.createElement('canvas'); big.width = W; big.height = H;
  const bctx = big.getContext('2d', { willReadFrequently: true }); bctx.imageSmoothingQuality = 'high'; bctx.drawImage(small, 0, 0, W, H);
  const bg = bctx.getImageData(0, 0, W, H).data; big.width = big.height = 0; small.width = small.height = 0;
  const lo = 30, hi = 232, span = 255 / (hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    let r = (d[i] * 255 / Math.max(bg[i], 40) - lo) * span, g = (d[i + 1] * 255 / Math.max(bg[i + 1], 40) - lo) * span, b = (d[i + 2] * 255 / Math.max(bg[i + 2], 40) - lo) * span;
    if (mode === 'enhance') { d[i] = r; d[i + 1] = g; d[i + 2] = b; continue; }
    const L = .299 * r + .587 * g + .114 * b;
    const v = mode === 'bw' ? (L < 175 ? 0 : 255) : L;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  return img;
}
function rotateImage(img, rot) {
  const cv = document.createElement('canvas');
  const t = document.createElement('canvas'); t.width = img.width; t.height = img.height; t.getContext('2d').putImageData(img, 0, 0);
  const side = rot % 180 !== 0;
  cv.width = side ? img.height : img.width; cv.height = side ? img.width : img.height;
  const ctx = cv.getContext('2d');
  ctx.translate(cv.width / 2, cv.height / 2); ctx.rotate(rot * Math.PI / 180); ctx.drawImage(t, -img.width / 2, -img.height / 2);
  t.width = t.height = 0;
  return cv;
}
/* The corrected picture as a canvas, from the source bitmap; maxLong caps the long side (smaller for the preview). */
function scanRender(bmp, quadN, mode, rot, maxLong) {
  const k = Math.min(1, 4000 / Math.max(bmp.width, bmp.height)); // the source is read at most 4000 px
  const sw = Math.round(bmp.width * k), sh = Math.round(bmp.height * k);
  const q = quadN.map(([x, y]) => [x * sw, y * sh]);
  const [W0, H0] = outSize(q, 1e9), lim = Math.min(1, maxLong / Math.max(W0, H0));
  // Read the source only as large as the output needs: a small preview does not decode 12 megapixels.
  const r = Math.min(1, lim * 1.5), rw = Math.max(8, Math.round(sw * r)), rh = Math.max(8, Math.round(sh * r));
  const cv = document.createElement('canvas'); cv.width = rw; cv.height = rh;
  const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bmp, 0, 0, rw, rh);
  const src = ctx.getImageData(0, 0, rw, rh); cv.width = cv.height = 0;
  const qq = quadN.map(([x, y]) => [x * rw, y * rh]);
  const [W, H] = outSize(qq, maxLong);
  const out = cleanUp(warp(src, rw, rh, qq, W, H), mode);
  if (rot) return rotateImage(out, rot);
  const c2 = document.createElement('canvas'); c2.width = W; c2.height = H; c2.getContext('2d').putImageData(out, 0, 0);
  return c2;
}

/* ---------- dialog ---------- */
async function openScan(it, done) {
  const token = ++sc.token;
  const src = it.scan ? it.scan.src : it.file;
  let bmp; try { bmp = await createImageBitmap(src); } catch (e) { toast('這張圖片無法讀取', 'err'); return; }
  if (token !== sc.token) { bmp.close && bmp.close(); return; }
  if (sc.bmp && sc.bmp.close) sc.bmp.close();
  Object.assign(sc, { it, bmp, view: 'edit', rot: it.scan ? it.scan.rot : 0, done: done || renderImgs });
  $('#sc-filter').value = it.scan ? it.scan.mode : ($('#sc-filter').dataset.last || 'enhance');
  sc.quad = it.scan ? it.scan.quad.map(p => p.slice()) : (detectQuad(bmp) || FULL_QUAD());
  $('#sc-reset').hidden = !it.scan;
  if (!scDlg.open) scDlg.showModal();
  setScView('edit');
}
function setScView(v) {
  sc.view = v;
  $('#sc-preview').textContent = v === 'edit' ? '預覽結果' : '調整四個角';
  $('#sc-hint').textContent = v === 'edit' ? '拖曳四個圓點，對準文件的四個角。' : '這是套用後的樣子。滿意就按「套用」。';
  scSvg.style.display = v === 'edit' ? '' : 'none';
  drawScan();
}
function scFit(w, h) {
  const stage = $('#sc-stage');
  const availW = Math.max(240, stage.clientWidth - 36);
  const availH = Math.max(300, (window.innerWidth <= 760 ? window.innerHeight * .55 : window.innerHeight - 80) - 36);
  return Math.min(availW / w, availH / h, 1.5);
}
function drawScan() {
  const { bmp } = sc; if (!bmp) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2), ctx = scCanvas.getContext('2d');
  if (sc.view === 'preview') {
    const out = scanRender(bmp, sc.quad, $('#sc-filter').value, sc.rot, 1400);
    const s = scFit(out.width, out.height), cw = Math.round(out.width * s), ch = Math.round(out.height * s);
    scCanvas.width = out.width; scCanvas.height = out.height;
    scCanvas.style.width = cw + 'px'; scCanvas.style.height = ch + 'px';
    ctx.drawImage(out, 0, 0); out.width = out.height = 0;
    $('#sc-wrap').style.width = cw + 'px'; $('#sc-wrap').style.height = ch + 'px';
    return;
  }
  const s = scFit(bmp.width, bmp.height); sc.scale = s;
  const cw = Math.round(bmp.width * s), ch = Math.round(bmp.height * s);
  scCanvas.width = Math.round(cw * dpr); scCanvas.height = Math.round(ch * dpr);
  scCanvas.style.width = cw + 'px'; scCanvas.style.height = ch + 'px';
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bmp, 0, 0, scCanvas.width, scCanvas.height);
  $('#sc-wrap').style.width = cw + 'px'; $('#sc-wrap').style.height = ch + 'px';
  scSvg.setAttribute('viewBox', `0 0 ${cw} ${ch}`); scSvg.setAttribute('width', cw); scSvg.setAttribute('height', ch);
  drawQuad();
}
function drawQuad() {
  const cw = +scSvg.getAttribute('width'), ch = +scSvg.getAttribute('height');
  const pts = sc.quad.map(([x, y]) => [x * cw, y * ch]);
  const poly = pts.map(p => p.join(',')).join(' ');
  scSvg.innerHTML = `<path class="sc-shade" fill-rule="evenodd" d="M0 0H${cw}V${ch}H0Z M${pts.map(p => p.join(' ')).join(' L')}Z"/>
    <polygon class="sc-edge" points="${poly}"/>
    ${pts.map(([x, y], i) => `<g class="sc-handle" data-i="${i}"><circle class="sc-hit" cx="${x}" cy="${y}" r="22"/><circle class="sc-dot" cx="${x}" cy="${y}" r="9"/></g>`).join('')}`;
}
scSvg.addEventListener('pointerdown', e => {
  const h = e.target.closest('.sc-handle'); if (!h) return;
  e.preventDefault();
  const i = +h.dataset.i, r = scSvg.getBoundingClientRect();
  try { scSvg.setPointerCapture(e.pointerId); } catch (_) {}
  const move = ev => {
    sc.quad[i] = [Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))];
    drawQuad();
  };
  const up = () => { scSvg.removeEventListener('pointermove', move); scSvg.removeEventListener('pointerup', up); scSvg.removeEventListener('pointercancel', up); };
  scSvg.addEventListener('pointermove', move); scSvg.addEventListener('pointerup', up); scSvg.addEventListener('pointercancel', up);
});
$('#sc-auto').addEventListener('click', () => {
  const q = detectQuad(sc.bmp);
  if (!q) { toast('找不到明顯的紙張邊緣，請手動拖曳四個角'); return; }
  sc.quad = q; setScView('edit');
});
$('#sc-full').addEventListener('click', () => { sc.quad = FULL_QUAD(); setScView('edit'); });
$('#sc-preview').addEventListener('click', () => setScView(sc.view === 'edit' ? 'preview' : 'edit'));
$('#sc-filter').addEventListener('change', () => { $('#sc-filter').dataset.last = $('#sc-filter').value; if (sc.view === 'preview') drawScan(); });
$('#sc-rotl').addEventListener('click', () => { sc.rot = (sc.rot + 270) % 360; setScView('preview'); });
$('#sc-rotr').addEventListener('click', () => { sc.rot = (sc.rot + 90) % 360; setScView('preview'); });
function closeScan() {
  if (scDlg.open) scDlg.close();
  sc.token++; if (sc.bmp && sc.bmp.close) sc.bmp.close();
  sc.bmp = null; sc.it = null; scCanvas.width = scCanvas.height = 0;
}
$('#sc-cancel').addEventListener('click', closeScan);
scDlg.addEventListener('cancel', e => { e.preventDefault(); closeScan(); });
/* Put a new picture in place of an image-list item (after correcting or restoring it). pic: the new picture, decoded
   (an ImageBitmap or canvas), for the small picture the item shows; thumbPx: its size (see listThumb()). */
async function replaceImgItem(it, file, pic, kind, thumbPx) {
  const url = await listThumb(pic, thumbPx);
  URL.revokeObjectURL(it.url);
  Object.assign(it, { file, size: file.size, url, w: pic.width, h: pic.height, kind });
}
$('#sc-reset').addEventListener('click', async () => {
  const it = sc.it; if (!it || !it.scan) return;
  const src = it.scan.src; delete it.scan;
  const bmp = await createImageBitmap(src);
  try { await replaceImgItem(it, src, bmp, directKind(await src.arrayBuffer()), it.thumbPx); }
  finally { bmp.close && bmp.close(); }
  const done = sc.done; closeScan(); done(); toast('已還原成原圖');
});
$('#sc-apply').addEventListener('click', e => busy(e.currentTarget, '處理中…', async () => {
  const it = sc.it; if (!it) return;
  await new Promise(r => setTimeout(r, 30)); // let the spinner show before the heavy work
  const mode = $('#sc-filter').value;
  const out = scanRender(sc.bmp, sc.quad, mode, sc.rot, 3200);
  const png = mode === 'bw'; // black and white compresses far better as PNG
  const blob = await canvasBlob(out, png ? 'image/png' : 'image/jpeg', .9);
  const src = it.scan ? it.scan.src : it.file;
  const file = new File([blob], stemName(src.name) + (png ? '.png' : '.jpg'), { type: png ? 'image/png' : 'image/jpeg' });
  await replaceImgItem(it, file, out, png ? 'png' : 'jpg', it.thumbPx); out.width = out.height = 0;
  it.scan = { src, quad: sc.quad.map(p => p.slice()), mode, rot: sc.rot };
  const done = sc.done; closeScan(); done(); toast('已校正');
}).catch(failToast('校正失敗')));
window.addEventListener('resize', () => { if (scDlg.open) drawScan(); });
