'use strict';
/* ================= COMPRESS =================
   Two ways, applied to every file in the list:
   - keep: re-encode only the photos inside the PDF (JPEG or 8-bit Flate images); text and vector graphics stay untouched.
   - raster: render every page to a JPEG; smallest for scans, but text can no longer be selected.
   A file that does not get smaller keeps its original bytes.
   With a size limit (「大小上限」) the strength is not chosen by hand: each file is compressed several times, stepping
   through a ladder of settings from best to smallest (binary search), and the best-looking result under the limit wins. */
const comp = { items: [], mode: 'keep', file: { i: 0, n: 0 }, attempt: 0 };
const LEVELS = { light: { dpi: 150, q: .8 }, medium: { dpi: 110, q: .65 }, strong: { dpi: 72, q: .5 } };
const KEEP_LEVELS = { light: { px: 2400, q: .82 }, medium: { px: 1600, q: .68 }, strong: { px: 1100, q: .5 } };
/* black-and-white pages need more dots than JPEG ones to keep small print readable, but each dot is one bit */
const BW_DPI = { light: 300, medium: 200, strong: 150 };
/* settings tried for a size limit, best picture first */
const TARGET_LADDER = {
  keep: [[2400, .82], [2000, .76], [1600, .68], [1400, .6], [1100, .5], [900, .45], [700, .4], [500, .35]].map(([px, q]) => ({ px, q, label: `照片最長邊 ${px} px · JPEG ${Math.round(q * 100)}%` })),
  raster: [[200, .85], [150, .8], [130, .72], [110, .65], [96, .58], [85, .52], [72, .5], [60, .42], [50, .35]].map(([dpi, q]) => ({ dpi, q, label: `${dpi} dpi · JPEG ${Math.round(q * 100)}%` })),
  bw: [300, 250, 200, 170, 150, 120, 100].map(dpi => ({ dpi, label: `黑白 ${dpi} dpi` }))
};
/* The limit in bytes (0 = none). 1 MB is counted as 1,000,000 bytes: upload forms differ, and this stays under both. */
function compTarget() {
  const v = $('#comp-target').value;
  const mb = v === 'custom' ? parseFloat($('#comp-target-custom').value) : +v;
  return mb > 0 ? Math.round(mb * 1e6) : 0;
}
const fmtLimit = b => b >= 1e6 ? `${+(b / 1e6).toFixed(2)} MB` : `${Math.round(b / 1e3)} KB`;
async function loadCompFile(files) {
  // The running job works through this list and reports on every file in it at the end.
  if ($('#comp-go').classList.contains('is-running')) { toast('正在壓縮，請等完成再加入檔案'); return; }
  for (const f of files) {
    if (!isPdf(f)) { toast(`「${f.name}」不是 PDF 檔`, 'err'); continue; }
    const got = await readPdf(f); if (!got) continue; // a password-protected file is unlocked here first
    // Only the file itself is kept (on disk for a picked file); its bytes are read again when compressing.
    const size = got.bytes.length, src = keepFile(f, got);
    let pages, paper;
    try {
      const pj = await openPdfjs(got.bytes, got.owned), vp = (await pj.getPage(1)).getViewport({ scale: 1 });
      pages = pj.numPages; paper = paperName(vp.width, vp.height); pj.destroy();
    } catch (e) { toast(loadErr(f.name, e), 'err'); continue; }
    comp.items.push({ id: uid(), name: f.name, src, size, pages, paper, out: null });
  }
  clearCompResults();
  renderCompList();
}
function clearCompResults() { comp.items.forEach(it => { it.out = null; }); $('#comp-result').hidden = true; $('#comp-progress').hidden = true; }
/* A setting changed: the results so far no longer match it, and a run under way stops (its results are cleared too). */
function compSettingsChanged() {
  const go = $('#comp-go'); if (go._job) go._job.abort();
  clearCompResults(); renderCompList();
}
function renderCompList() {
  const n = comp.items.length;
  $('#comp-empty').hidden = n > 0; $('#comp-work').hidden = !n;
  const list = $('#comp-list'); list.innerHTML = '';
  for (const it of comp.items) {
    const li = document.createElement('li'); li.className = 'file-row'; li.dataset.id = it.id;
    let after = '';
    if (it.out) {
      const o = it.out;
      after = o.under ? ' → 已經在上限以內，保留原檔'
        : o.kept ? ' → 沒有變小，保留原檔'
        : ` → ${fmtSize(o.size)}（−${Math.round((1 - o.size / it.size) * 100)}%）`;
      if (o.label && !o.kept) after += ` · ${o.label}`;
      if (o.fit === false) after += ' · <span class="over">超過上限</span>';
    }
    li.innerHTML = `<span class="doc-ico-sm" aria-hidden="true"></span>
      <div class="file-main"><div class="file-name"></div><div class="file-meta">${it.pages} 頁 · ${fmtSize(it.size)} · ${it.paper}${after}</div></div>
      <div class="row-btns"><button class="icon-btn danger" data-act="remove" aria-label="移除">${ICON.x}</button></div>`;
    li.querySelector('.file-name').textContent = it.name;
    list.append(li);
  }
  const total = comp.items.reduce((s, x) => s + x.size, 0);
  $('#comp-hint').textContent = n > 1 ? `${n} 份 · 共 ${fmtSize(total)}，會用同樣的設定依序壓縮` : '壓縮在你的裝置上進行，頁數多時需要一點時間。';
  setJobButton($('#comp-go'), { text: n > 1 ? `壓縮 ${n} 份` : '開始壓縮' });
}
$('#comp-list').addEventListener('click', e => {
  const b = e.target.closest('[data-act="remove"]'); if (!b || $('#comp-go').classList.contains('is-running')) return;
  comp.items = comp.items.filter(x => x.id !== b.closest('.file-row').dataset.id);
  clearCompResults(); renderCompList();
});
bindInput($('#comp-input'), loadCompFile);
bindInput($('#comp-input-more'), loadCompFile);
acceptFiles($('#panel-compress'), $('#comp-drop'), loadCompFile);
registerTarget('pdf', 'compress', '壓縮', loadCompFile);
$('#comp-sample').addEventListener('click', async e => {
  await busy(e.currentTarget, '產生範例…', async () => loadCompFile([asFile(await makePhotoSample(), 'site-survey-photos.pdf')]));
});
const levelVal = () => document.querySelector('input[name="level"]:checked').value;
function setCompMode(m) {
  comp.mode = m;
  $('#comp-m-keep').setAttribute('aria-pressed', m === 'keep'); $('#comp-m-raster').setAttribute('aria-pressed', m === 'raster');
  const bwOpt = $('#comp-color option[value="bw"]');
  bwOpt.disabled = m === 'keep';
  if (m === 'keep' && $('#comp-color').value === 'bw') $('#comp-color').value = 'gray';
  updateCompSpecs();
  compSettingsChanged();
}
function updateCompSpecs() {
  const bw = comp.mode === 'raster' && $('#comp-color').value === 'bw', target = compTarget();
  $('#comp-target-custom-wrap').hidden = $('#comp-target').value !== 'custom';
  document.querySelector('#panel-compress .levels').classList.toggle('is-off', !!target);
  $('#comp-target-note').hidden = !target;
  $('#comp-target-note').textContent = target ? `會自動試壓幾次，找出不超過 ${fmtLimit(target)}、畫質最好的設定（上面的強度不使用）；比一般壓縮多花幾倍時間。` : '';
  document.querySelectorAll('#panel-compress .spec').forEach(s => { s.textContent = s.dataset[bw ? 'bw' : comp.mode === 'keep' ? 'keep' : 'raster']; });
  $('#comp-note').textContent = comp.mode === 'keep'
    ? '文字、表格和向量圖完全不動，仍可選取和搜尋；只把裡面的照片縮小、重新壓縮。照片多的檔案效果最好。'
    : bw ? '每一頁轉成只有黑與白兩色的圖片，最適合文字掃描檔，通常每頁只要幾十 KB；照片和灰色底紋會變成黑白點，文字無法選取或搜尋。'
      : '每一頁都會轉成圖片再壓縮，完成後文字無法選取或搜尋。適合掃描檔，或「保留文字」壓不下來的檔案。';
}
$('#comp-m-keep').addEventListener('click', () => setCompMode('keep'));
$('#comp-m-raster').addEventListener('click', () => setCompMode('raster'));
document.querySelectorAll('input[name="level"]').forEach(r => r.addEventListener('change', compSettingsChanged));
$('#comp-color').addEventListener('change', () => { updateCompSpecs(); compSettingsChanged(); });
$('#comp-target').addEventListener('change', () => {
  updateCompSpecs(); compSettingsChanged();
  if ($('#comp-target').value === 'custom') $('#comp-target-custom').focus();
});
$('#comp-target-custom').addEventListener('input', () => { updateCompSpecs(); compSettingsChanged(); });

function progress(i, n, unit = '頁') {
  const f = comp.file, pre = (f.n > 1 ? `第 ${f.i + 1} / ${f.n} 份 · ` : '') + (comp.attempt ? `第 ${comp.attempt} 次試壓 · ` : '');
  $('#comp-progress').hidden = false;
  $('#comp-bar').style.width = ((f.i + (n ? Math.min(i, n) / n : 1)) / Math.max(1, f.n) * 100) + '%';
  $('#comp-plabel').textContent = pre + (i < n ? `處理第 ${i + 1} / ${n} ${unit}` : (n ? `完成 ${n} ${unit}` : '完成'));
}
/* The canvas drawn over itself through a grayscale filter: the browser does it where the picture lives (often the
   graphics card), where reading the pixels out to turn them one by one took a copy of the whole picture and a loop. */
function toGray(ctx, w, h) {
  if (typeof ctx.filter === 'string') {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'copy'; ctx.filter = 'grayscale(1)';
    ctx.drawImage(ctx.canvas, 0, 0, w, h, 0, 0, w, h);
    ctx.restore();
    return;
  }
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let k = 0; k < d.length; k += 4) { const y = d[k] * .299 + d[k + 1] * .587 + d[k + 2] * .114; d[k] = d[k + 1] = d[k + 2] = y; }
  ctx.putImageData(img, 0, 0);
}
async function compressRaster(bytes, lv, gray, check) {
  const pj = await openPdfjs(bytes);
  const out = await PDFDocument.create();
  try {
    // Page i + 1 is drawn while page i is encoded (see pagePipeline() in core.js).
    await pagePipeline(pj.numPages, async i => {
      const pg = await pj.getPage(i + 1);
      const vp1 = pg.getViewport({ scale: 1 });
      let scale = lv.dpi / 72;
      const maxPx = 16e6; if (vp1.width * vp1.height * scale * scale > maxPx) scale = Math.sqrt(maxPx / (vp1.width * vp1.height));
      const vp = pg.getViewport({ scale });
      const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      const r = { pg, cv, vp1, px: cv.width * cv.height };
      try {
        const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        await pg.render({ canvasContext: ctx, viewport: vp }).promise;
        if (gray) toGray(ctx, cv.width, cv.height);
      } catch (e) { dropRaster(r); throw e; }
      return r;
    }, async ({ cv, vp1 }, i) => {
      progress(i, pj.numPages);
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', lv.q));
      const jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const page = out.addPage([vp1.width, vp1.height]);
      page.drawImage(jpg, { x: 0, y: 0, width: vp1.width, height: vp1.height });
    }, dropRaster, check);
    progress(pj.numPages, pj.numPages);
  } finally { pj.destroy(); }
  return { bytes: await out.save({ useObjectStreams: true }) };
}
function dropRaster(r) { r.pg.cleanup(); r.cv.width = r.cv.height = 0; }

/* ---------- black and white: one bit per dot, Flate-compressed ----------
   The threshold is chosen per page (Otsu's method) so light scans and dark scans both come out clean. */
function otsu(hist, total) {
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; t = i; }
  }
  return t;
}
async function compressBW(bytes, dpi, check) {
  const pj = await openPdfjs(bytes);
  const out = await PDFDocument.create();
  try {
    // Page i + 1 is drawn while page i is turned into black and white (see pagePipeline() in core.js); only the
    // pixels are kept from the drawing.
    await pagePipeline(pj.numPages, async i => {
      const pg = await pj.getPage(i + 1);
      const vp1 = pg.getViewport({ scale: 1 });
      let scale = dpi / 72;
      const maxPx = 30e6; if (vp1.width * vp1.height * scale * scale > maxPx) scale = Math.sqrt(maxPx / (vp1.width * vp1.height));
      const vp = pg.getViewport({ scale });
      const W = Math.ceil(vp.width), H = Math.ceil(vp.height);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      try {
        // An ordinary (graphics card) canvas: the pixels are read once, and drawn on the processor (willReadFrequently)
        // a 300 dpi page took about a third longer.
        const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
        await pg.render({ canvasContext: ctx, viewport: vp }).promise;
        return { d: ctx.getImageData(0, 0, W, H).data, W, H, vp1, px: W * H };
      } finally { pg.cleanup(); cv.width = cv.height = 0; }
    }, async ({ d, W, H, vp1 }, i) => {
      progress(i, pj.numPages);
      const lum = new Uint8Array(W * H), hist = new Uint32Array(256);
      for (let k = 0, j = 0; k < lum.length; k++, j += 4) { const y = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8; lum[k] = y; hist[y]++; }
      const t = Math.min(200, Math.max(60, otsu(hist, lum.length)));
      const rowBytes = Math.ceil(W / 8), bits = new Uint8Array(rowBytes * H);
      // 1 = white. Eight dots make a byte in one go, twice as fast as setting each bit on its own.
      for (let y = 0; y < H; y++) {
        let k = y * W, o = y * rowBytes, x = 0;
        for (; x + 8 <= W; x += 8, k += 8) {
          bits[o++] = (lum[k] > t) << 7 | (lum[k + 1] > t) << 6 | (lum[k + 2] > t) << 5 | (lum[k + 3] > t) << 4
            | (lum[k + 4] > t) << 3 | (lum[k + 5] > t) << 2 | (lum[k + 6] > t) << 1 | (lum[k + 7] > t);
        }
        if (x < W) { let v = 0; for (let b = 0; x < W; x++, b++, k++) if (lum[k] > t) v |= 0x80 >> b; bits[o] = v; }
      }
      const img = out.context.register(out.context.stream(await deflate(bits), {
        Type: 'XObject', Subtype: 'Image', Width: W, Height: H, ColorSpace: 'DeviceGray', BitsPerComponent: 1, Filter: 'FlateDecode'
      }));
      const page = out.addPage([vp1.width, vp1.height]);
      const name = page.node.newXObject('Im', img);
      page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.concatTransformationMatrix(vp1.width, 0, 0, vp1.height, 0, 0), PDFLib.drawObject(name), PDFLib.popGraphicsState());
    }, () => {}, check);
    progress(pj.numPages, pj.numPages);
  } finally { pj.destroy(); }
  return { bytes: await out.save({ useObjectStreams: true }) };
}

/* ---------- keep-text mode: work on the image objects themselves ---------- */
const N = s => PDFName.of(s);
function imageInfo(ctx, dict) {
  const look = k => ctx.lookup(dict.get(N(k)));
  if (look('Subtype') !== N('Image') || look('ImageMask') || dict.get(N('Decode')) || dict.get(N('Mask'))) return null;
  const f = look('Filter');
  const filters = f instanceof PDFArray ? f.asArray().map(x => ctx.lookup(x)) : f ? [f] : [];
  if (filters.length !== 1) return null;
  const kind = filters[0] === N('DCTDecode') ? 'jpeg' : filters[0] === N('FlateDecode') ? 'flate' : null;
  if (!kind) return null;
  let cs = look('ColorSpace'), comps = 0;
  if (cs === N('DeviceRGB')) comps = 3;
  else if (cs === N('DeviceGray')) comps = 1;
  else if (cs instanceof PDFArray && ctx.lookup(cs.get(0)) === N('ICCBased')) {
    const icc = ctx.lookup(cs.get(1)); const n = icc && icc.dict ? ctx.lookup(icc.dict.get(N('N'))) : null;
    comps = n instanceof PDFNumber ? n.asNumber() : 0;
  }
  if (comps !== 1 && comps !== 3) return null; // CMYK, indexed, spot colours: leave alone
  const num = k => { const v = look(k); return v instanceof PDFNumber ? v.asNumber() : 0; };
  const w = num('Width'), h = num('Height'), bpc = num('BitsPerComponent') || 8;
  if (!w || !h || w * h > 40e6 || bpc !== 8) return null;
  let predictor = 1, colors = comps, columns = w;
  const dp = look('DecodeParms');
  if (dp instanceof PDFDict) {
    const g = k => { const v = ctx.lookup(dp.get(N(k))); return v instanceof PDFNumber ? v.asNumber() : null; };
    predictor = g('Predictor') || 1; colors = g('Colors') || comps; columns = g('Columns') || w;
  } else if (dp) return null;
  if (kind === 'flate' && (predictor === 2 || (predictor > 1 && predictor < 10))) return null;
  return { kind, comps, w, h, predictor, colors, columns };
}
function pngUnfilter(data, w, h, bpp) {
  const stride = w * bpp, out = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const ft = data[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const raw = data[src + x], a = x >= bpp ? out[dst + x - bpp] : 0, b = y ? out[dst - stride + x] : 0, c = x >= bpp && y ? out[dst - stride + x - bpp] : 0;
      let v;
      switch (ft) {
        case 1: v = raw + a; break;
        case 2: v = raw + b; break;
        case 3: v = raw + ((a + b) >> 1); break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: v = raw;
      }
      out[dst + x] = v & 255;
    }
  }
  return out;
}
/* A JPEG's EXIF orientation is for photo viewers; a PDF shows the pixels as stored, but browsers turn the picture
   when they decode it (a phone photo put into a PDF as it is would come out turned and squashed). So a copy with the
   orientation set to 1, "as stored", is decoded instead. Also put into the photo workers' code. */
function jpegAsStored(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || v.getUint16(0) !== 0xFFD8) return bytes;
  for (let o = 2; o + 4 <= bytes.length;) {
    const m = v.getUint16(o); if ((m & 0xFF00) !== 0xFF00 || m === 0xFFDA) break;
    if (m === 0xFFE1 && o + 10 <= bytes.length && v.getUint32(o + 4) === 0x45786966) { // APP1 "Exif"
      try {
        const t = o + 10, le = v.getUint16(t) === 0x4949, ifd = t + v.getUint32(t + 4, le), n = v.getUint16(ifd, le);
        for (let i = 0; i < n; i++) {
          const e = ifd + 2 + i * 12;
          if (v.getUint16(e, le) === 0x0112 && v.getUint16(e + 8, le) !== 1) {
            const out = bytes.slice(); new DataView(out.buffer).setUint16(e + 8, 1, le); return out;
          }
        }
      } catch (e) {}
      return bytes;
    }
    o += 2 + v.getUint16(o + 2);
  }
  return bytes;
}
async function decodeToCanvas(info, stream) {
  if (info.kind === 'jpeg') {
    const bmp = await createImageBitmap(new Blob([jpegAsStored(stream.contents)], { type: 'image/jpeg' }));
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    cv.getContext('2d').drawImage(bmp, 0, 0); bmp.close && bmp.close();
    return cv;
  }
  let px = await inflate(stream.contents);
  if (info.predictor >= 10) px = pngUnfilter(px, info.w, info.h, info.comps);
  if (px.length < info.w * info.h * info.comps) return null;
  const cv = document.createElement('canvas'); cv.width = info.w; cv.height = info.h;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(info.w, info.h), d = img.data;
  for (let i = 0, j = 0; i < info.w * info.h; i++) {
    if (info.comps === 3) { d[i * 4] = px[j++]; d[i * 4 + 1] = px[j++]; d[i * 4 + 2] = px[j++]; }
    else { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = px[j++]; }
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
/* ---------- photos are re-encoded in background workers, several at once ----------
   Each worker decodes one photo (JPEG, or Flate pixels), shrinks it and writes a JPEG with OffscreenCanvas, so the
   page stays responsive and a multi-core machine handles several photos at the same time. Browsers without
   OffscreenCanvas in workers fall back to doing the same work on the page, one photo at a time.
   The function below is self-contained (apart from jpegAsStored(), which is put next to it): it is turned into the
   workers' source code. */
function photoWorkerMain() {
  async function inflate(bytes) {
    const ds = new DecompressionStream('deflate');
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
  }
  function pngUnfilter(data, w, h, bpp) {
    const stride = w * bpp, out = new Uint8Array(stride * h);
    for (let y = 0; y < h; y++) {
      const ft = data[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
      for (let x = 0; x < stride; x++) {
        const raw = data[src + x], a = x >= bpp ? out[dst + x - bpp] : 0, b = y ? out[dst - stride + x] : 0, c = x >= bpp && y ? out[dst - stride + x - bpp] : 0;
        let v;
        switch (ft) {
          case 1: v = raw + a; break;
          case 2: v = raw + b; break;
          case 3: v = raw + ((a + b) >> 1); break;
          case 4: { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
          default: v = raw;
        }
        out[dst + x] = v & 255;
      }
    }
    return out;
  }
  async function reencode(t) {
    const { info } = t;
    let src, w, h;
    if (info.kind === 'jpeg') {
      src = await createImageBitmap(new Blob([jpegAsStored(t.contents)], { type: 'image/jpeg' })); w = src.width; h = src.height;
    } else {
      let px = await inflate(t.contents);
      if (info.predictor >= 10) px = pngUnfilter(px, info.w, info.h, info.comps);
      w = info.w; h = info.h;
      if (px.length < w * h * info.comps) return null;
      const img = new ImageData(w, h), d = img.data;
      for (let i = 0, j = 0; i < w * h; i++) {
        if (info.comps === 3) { d[i * 4] = px[j++]; d[i * 4 + 1] = px[j++]; d[i * 4 + 2] = px[j++]; }
        else { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = px[j++]; }
        d[i * 4 + 3] = 255;
      }
      src = new OffscreenCanvas(w, h); src.getContext('2d').putImageData(img, 0, 0);
    }
    const k = Math.min(1, t.px / Math.max(w, h)), ow = Math.max(1, Math.round(w * k)), oh = Math.max(1, Math.round(h * k));
    const cv = new OffscreenCanvas(ow, oh), ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, 0, ow, oh);
    if (src.close) src.close();
    if (t.gray || info.comps === 1) {
      const img = ctx.getImageData(0, 0, ow, oh), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const y = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114; d[i] = d[i + 1] = d[i + 2] = y; }
      ctx.putImageData(img, 0, 0);
    }
    const blob = await cv.convertToBlob({ type: 'image/jpeg', quality: t.q });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), w: ow, h: oh };
  }
  self.onmessage = async e => {
    let out = null;
    try { out = await reencode(e.data); } catch (err) { out = null; }
    self.postMessage({ id: e.data.id, out }, out ? [out.bytes.buffer] : []);
  };
}
const workersCanDraw = () => typeof OffscreenCanvas !== 'undefined' && 'convertToBlob' in OffscreenCanvas.prototype && typeof Worker !== 'undefined';
function photoPool(size) {
  const url = URL.createObjectURL(new Blob([`${jpegAsStored.toString()}\n(${photoWorkerMain.toString()})()`], { type: 'text/javascript' }));
  const workers = [], waiting = new Map(); let seq = 0;
  for (let i = 0; i < size; i++) {
    const w = new Worker(url);
    w.onmessage = e => { const r = waiting.get(e.data.id); waiting.delete(e.data.id); w.busy = false; r && r.resolve(e.data.out); };
    w.onerror = () => { const r = waiting.get(w.current); waiting.delete(w.current); w.busy = false; r && r.resolve(null); }; // a failed photo is just left as it was
    workers.push(w);
  }
  URL.revokeObjectURL(url);
  return {
    size,
    run(task, worker) {
      const id = ++seq;
      return new Promise((resolve, reject) => { waiting.set(id, { resolve, reject }); worker.busy = true; worker.current = id; worker.postMessage({ ...task, id }, [task.contents.buffer]); });
    },
    idle() { return workers.find(w => !w.busy); },
    close() { workers.forEach(w => w.terminate()); waiting.forEach(r => r.reject(new Cancelled())); waiting.clear(); }
  };
}
/* page fallback: the same steps on the page, for browsers without OffscreenCanvas in workers */
async function reencodeOnPage(info, obj, lv, gray) {
  let cv;
  try { cv = await decodeToCanvas(info, obj); } catch (e) { cv = null; }
  if (!cv) return null;
  const k = Math.min(1, lv.px / Math.max(cv.width, cv.height));
  let outCv = cv;
  if (k < 1) {
    outCv = document.createElement('canvas'); outCv.width = Math.max(1, Math.round(cv.width * k)); outCv.height = Math.max(1, Math.round(cv.height * k));
    const c2 = outCv.getContext('2d'); c2.imageSmoothingQuality = 'high'; c2.drawImage(cv, 0, 0, outCv.width, outCv.height);
  }
  if (gray || info.comps === 1) toGray(outCv.getContext('2d'), outCv.width, outCv.height);
  const blob = await new Promise(r => outCv.toBlob(r, 'image/jpeg', lv.q));
  const out = blob && { bytes: new Uint8Array(await blob.arrayBuffer()), w: outCv.width, h: outCv.height };
  cv.width = cv.height = 0; if (outCv !== cv) { outCv.width = outCv.height = 0; }
  return out;
}
async function compressKeepText(bytes, lv, gray, check, signal) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const cands = [], masks = new Set();
  // A picture's transparency (/SMask, or /Mask as a picture) is a grey picture of its own; made into a colour JPEG it
  // is no longer a valid mask and the photo it belongs to disappears. Masks are left as they are.
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    for (const k of ['SMask', 'Mask']) { const m = obj.dict.get(N(k)); if (m instanceof PDFLib.PDFRef) masks.add(m.toString()); }
  }
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || masks.has(ref.toString())) continue;
    const info = imageInfo(ctx, obj.dict);
    // Small Flate images are usually logos or line art; JPEG would blur them, so leave them alone.
    if (info && (info.kind === 'jpeg' || info.w * info.h >= 250000)) cands.push({ ref, obj, info });
  }
  let changed = 0, done = 0;
  const apply = (c, out) => {
    done++; progress(done, cands.length, '張照片');
    if (!out || out.bytes.length > c.obj.contents.length * .9) return; // not worth it
    const ns = ctx.stream(out.bytes, { Type: 'XObject', Subtype: 'Image', Width: out.w, Height: out.h, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' });
    for (const key of ['SMask', 'Intent', 'Interpolate', 'Metadata', 'OC']) { const v = c.obj.dict.get(N(key)); if (v) ns.dict.set(N(key), v); }
    ctx.assign(c.ref, ns);
    changed++;
  };
  progress(0, cands.length, '張照片');
  if (cands.length > 1 && workersCanDraw()) {
    // Feed photos to the idle workers; at most one photo per worker is in memory at a time.
    const pool = photoPool(Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1, cands.length)));
    const stop = () => pool.close();
    if (signal) signal.addEventListener('abort', stop, { once: true });
    try {
      let next = 0; const running = new Set();
      while (next < cands.length || running.size) {
        check();
        let w;
        while (next < cands.length && (w = pool.idle())) {
          const c = cands[next++];
          const job = pool.run({ info: c.info, contents: c.obj.contents.slice(), px: lv.px, q: lv.q, gray }, w).then(out => { running.delete(job); apply(c, out); });
          job.catch(() => {}); // a cancelled run rejects the others too; only the first one matters
          running.add(job);
        }
        if (running.size) await Promise.race(running);
      }
    } finally { if (signal) signal.removeEventListener('abort', stop); pool.close(); }
  } else {
    for (const c of cands) { check(); apply(c, await reencodeOnPage(c.info, c.obj, lv, gray)); }
  }
  check();
  progress(cands.length, cands.length, '張照片');
  return { bytes: await doc.save({ useObjectStreams: true }), changed, found: cands.length };
}

/* Binary search down the ladder for the first (best) setting whose result fits under the limit. Sizes shrink
   (almost always) as the settings get stronger, so about log2(steps) + 1 tries are enough. */
async function compressToTarget(bytes, target, color, check, signal) {
  const keep = comp.mode === 'keep', gray = color !== 'color';
  const ladder = keep ? TARGET_LADDER.keep : color === 'bw' ? TARGET_LADDER.bw : TARGET_LADDER.raster;
  const run = st => keep ? compressKeepText(bytes, st, gray, check, signal)
    : color === 'bw' ? compressBW(bytes, st.dpi, check) : compressRaster(bytes, st, gray, check);
  let lo = 0, hi = ladder.length - 1, best = null, smallest = null;
  comp.attempt = 0;
  while (lo <= hi) {
    check();
    const mid = (lo + hi) >> 1; comp.attempt++;
    const r = await run(ladder[mid]); r.label = ladder[mid].label;
    if (!smallest || r.bytes.length < smallest.bytes.length) smallest = r;
    if (r.bytes.length <= target) { best = r; hi = mid - 1; } else lo = mid + 1;
    if (keep && !r.found) break; // no photos to shrink: every setting gives the same file
  }
  comp.attempt = 0;
  return { ...(best || smallest), fit: !!best };
}

$('#comp-go').addEventListener('click', e => runJob(e.currentTarget, '壓縮中…', async (check, signal) => {
  clearCompResults(); renderCompList();
  const lvKey = levelVal(), color = $('#comp-color').value, gray = color !== 'color', keep = comp.mode === 'keep';
  const target = compTarget();
  comp.file.n = comp.items.length; comp.attempt = 0;
  const single = comp.items.length === 1;
  let changed = 0;
  try {
    for (let i = 0; i < comp.items.length; i++) {
      check();
      comp.file.i = i;
      const it = comp.items[i];
      if (target && it.size <= target) { it.out = { src: it.src, size: it.size, kept: true, under: true }; renderCompList(); continue; }
      const { bytes } = await fileBytes(it.src); // read now, let go after this file
      const res = target ? await compressToTarget(bytes, target, color, check, signal)
        : keep ? await compressKeepText(bytes, KEEP_LEVELS[lvKey], gray, check, signal)
        : color === 'bw' ? await compressBW(bytes, BW_DPI[lvKey], check)
        : await compressRaster(bytes, LEVELS[lvKey], gray, check);
      const kept = res.bytes.length >= it.size;
      // A lone result goes to the result bar as it is; results of a batch wait for the ZIP as Blobs, outside the page.
      const out = kept ? it.src : single ? pdfFile(res.bytes, baseName(it.name) + '-壓縮.pdf') : new Blob([res.bytes], { type: 'application/pdf' });
      it.out = { src: out, size: kept ? it.size : res.bytes.length, kept, label: res.label };
      if (target) it.out.fit = it.out.size <= target;
      changed += res.changed || 0;
      renderCompList();
    }
  } finally { comp.attempt = 0; }
  check(); // a setting changed during the last file: its results were cleared
  comp.file.i = comp.items.length - 1; progress(1, 1);
  const before = comp.items.reduce((s, x) => s + x.size, 0), after = comp.items.reduce((s, x) => s + x.out.size, 0);
  const max = Math.max(before, after, 1);
  $('#bar-before').style.width = (before / max * 100) + '%';
  $('#bar-after').style.width = (after / max * 100) + '%';
  $('#v-before').textContent = fmtSize(before); $('#v-after').textContent = fmtSize(after);
  const pct = Math.round((1 - after / before) * 100), multi = comp.items.length > 1;
  const big = $('#comp-pct'), warn = $('#comp-warn');
  const keptN = comp.items.filter(x => x.out.kept && !x.out.under).length, overN = comp.items.filter(x => x.out.fit === false).length;
  big.textContent = after < before ? `−${pct}%` : '±0%'; big.classList.toggle('worse', after >= before);
  $('#comp-pct-label').textContent = (after < before ? `省下 ${fmtSize(before - after)}` : '沒有變小') + (keep ? `，重新壓縮 ${changed} 張照片` : '');
  warn.hidden = !overN && !keptN && !(keep && pct < 10 && !target);
  warn.textContent = overN
    ? (multi ? `${overN} 份` : '這份檔案') + `壓到最小仍超過 ${fmtLimit(target)}。`
      + (keep ? '改用「整頁轉成圖片」可以再小很多（文字會無法選取）。'
        : color === 'color' ? '改用灰階或黑白會再小一些；或先用「拆分」分成幾份再上傳。'
        : '可以先用「拆分」分成幾份再上傳。')
    : keptN
    ? (multi ? `${keptN} 份壓縮後沒有變小，下載時會保留原檔。` : '壓縮後沒有變小，下載的會是原檔。')
      + (keep ? '如果是掃描檔，改用「整頁轉成圖片」會有明顯效果。' : '這類檔案主要是文字和向量圖形，改用「保留文字」或保留原檔即可。')
    : '這份檔案的照片不多，縮減有限。如果是掃描檔，改用「整頁轉成圖片」會小很多。';
  $('#comp-name-label').textContent = multi ? '壓縮檔名' : '檔名';
  $('#comp-name').value = multi ? '壓縮後的 PDF.zip' : baseName(comp.items[0].name) + '-壓縮.pdf';
  $('#comp-save').textContent = multi ? `下載全部 ${comp.items.length} 份（ZIP）` : '下載壓縮檔';
  $('#comp-result').hidden = false;
  if (!multi && !comp.items[0].out.kept) {
    const f = comp.items[0].out.src; f.name = ensurePdf($('#comp-name').value);
    await deliver(f, 'pdf', 'compress');
  }
}).catch(err => toast('壓縮失敗：' + err.message, 'err')));
$('#comp-save').addEventListener('click', e => busy(e.currentTarget, '準備中…', async () => {
  const done = comp.items.filter(x => x.out); if (!done.length) return;
  if (done.length === 1) { await saveFile(ensurePdf($('#comp-name').value), done[0].out.src); return; }
  const zip = zipWriter();
  for (const it of done) await zip.add(baseName(it.name) + '-壓縮.pdf', it.out.src instanceof Blob ? it.out.src : (await fileBytes(it.out.src)).bytes);
  let name = ($('#comp-name').value || '壓縮後的 PDF').trim(); if (!/\.zip$/i.test(name)) name += '.zip';
  await saveFile(name, zip.blob());
}).catch(err => toast('下載失敗：' + err.message, 'err')));
setCompMode('keep');
registerHolder('compress', () => comp.items.reduce((n, it) => n + heldBytes(it.src) + (it.out && it.out.src !== it.src ? heldBytes(it.out.src) : 0), 0),
  () => { comp.items = []; clearCompResults(); renderCompList(); });
