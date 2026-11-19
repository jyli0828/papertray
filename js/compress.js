'use strict';
/* ================= COMPRESS =================
   Two ways, applied to every file in the list:
   - keep: re-encode only the photos inside the PDF (JPEG or 8-bit Flate images); text and vector graphics stay untouched.
   - raster: render every page to a JPEG; smallest for scans, but text can no longer be selected.
   A file that does not get smaller keeps its original bytes. */
const comp = { items: [], mode: 'keep', file: { i: 0, n: 0 } };
const LEVELS = { light: { dpi: 150, q: .8 }, medium: { dpi: 110, q: .65 }, strong: { dpi: 72, q: .5 } };
const KEEP_LEVELS = { light: { px: 2400, q: .82 }, medium: { px: 1600, q: .68 }, strong: { px: 1100, q: .5 } };
/* black-and-white pages need more dots than JPEG ones to keep small print readable, but each dot is one bit */
const BW_DPI = { light: 300, medium: 200, strong: 150 };
async function loadCompFile(files) {
  for (const f of files) {
    if (!isPdf(f)) { toast(`「${f.name}」不是 PDF 檔`, 'err'); continue; }
    const { bytes } = await fileBytes(f);
    if (hasEncrypt(bytes)) { toast(encryptedMsg(f.name), 'err'); continue; }
    let pages, paper;
    try {
      const pj = await openPdfjs(bytes), vp = (await pj.getPage(1)).getViewport({ scale: 1 });
      pages = pj.numPages; paper = paperName(vp.width, vp.height); pj.destroy();
    } catch (e) { toast(loadErr(f.name, e), 'err'); continue; }
    comp.items.push({ id: uid(), name: f.name, bytes, pages, paper, out: null });
  }
  clearCompResults();
  renderCompList();
}
function clearCompResults() { comp.items.forEach(it => { it.out = null; }); $('#comp-result').hidden = true; $('#comp-progress').hidden = true; }
function renderCompList() {
  const n = comp.items.length;
  $('#comp-empty').hidden = n > 0; $('#comp-work').hidden = !n;
  const list = $('#comp-list'); list.innerHTML = '';
  for (const it of comp.items) {
    const li = document.createElement('li'); li.className = 'file-row'; li.dataset.id = it.id;
    let after = '';
    if (it.out) after = it.out.kept ? ' → 沒有變小，保留原檔' : ` → ${fmtSize(it.out.bytes.length)}（−${Math.round((1 - it.out.bytes.length / it.bytes.length) * 100)}%）`;
    li.innerHTML = `<span class="doc-ico-sm" aria-hidden="true"></span>
      <div class="file-main"><div class="file-name"></div><div class="file-meta">${it.pages} 頁 · ${fmtSize(it.bytes.length)} · ${it.paper}${after}</div></div>
      <div class="row-btns"><button class="icon-btn danger" data-act="remove" aria-label="移除">${ICON.x}</button></div>`;
    li.querySelector('.file-name').textContent = it.name;
    list.append(li);
  }
  const total = comp.items.reduce((s, x) => s + x.bytes.length, 0);
  $('#comp-hint').textContent = n > 1 ? `${n} 份 · 共 ${fmtSize(total)}，會用同樣的設定依序壓縮` : '壓縮在你的裝置上進行，頁數多時需要一點時間。';
  $('#comp-go').textContent = n > 1 ? `壓縮 ${n} 份` : '開始壓縮';
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
  clearCompResults(); renderCompList();
}
function updateCompSpecs() {
  const bw = comp.mode === 'raster' && $('#comp-color').value === 'bw';
  document.querySelectorAll('#panel-compress .spec').forEach(s => { s.textContent = s.dataset[bw ? 'bw' : comp.mode === 'keep' ? 'keep' : 'raster']; });
  $('#comp-note').textContent = comp.mode === 'keep'
    ? '文字、表格和向量圖完全不動，仍可選取和搜尋；只把裡面的照片縮小、重新壓縮。照片多的檔案效果最好。'
    : bw ? '每一頁轉成只有黑與白兩色的圖片，最適合文字掃描檔，通常每頁只要幾十 KB；照片和灰色底紋會變成黑白點，文字無法選取或搜尋。'
      : '每一頁都會轉成圖片再壓縮，完成後文字無法選取或搜尋。適合掃描檔，或「保留文字」壓不下來的檔案。';
}
$('#comp-m-keep').addEventListener('click', () => setCompMode('keep'));
$('#comp-m-raster').addEventListener('click', () => setCompMode('raster'));
document.querySelectorAll('input[name="level"]').forEach(r => r.addEventListener('change', () => { clearCompResults(); renderCompList(); }));
$('#comp-color').addEventListener('change', () => { updateCompSpecs(); clearCompResults(); renderCompList(); });

function progress(i, n, unit = '頁') {
  const f = comp.file, pre = f.n > 1 ? `第 ${f.i + 1} / ${f.n} 份 · ` : '';
  $('#comp-progress').hidden = false;
  $('#comp-bar').style.width = ((f.i + (n ? Math.min(i, n) / n : 1)) / Math.max(1, f.n) * 100) + '%';
  $('#comp-plabel').textContent = pre + (i < n ? `處理第 ${i + 1} / ${n} ${unit}` : (n ? `完成 ${n} ${unit}` : '完成'));
}
function toGray(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let k = 0; k < d.length; k += 4) { const y = d[k] * .299 + d[k + 1] * .587 + d[k + 2] * .114; d[k] = d[k + 1] = d[k + 2] = y; }
  ctx.putImageData(img, 0, 0);
}
async function compressRaster(bytes, lv, gray, check) {
  const pj = await openPdfjs(bytes);
  const out = await PDFDocument.create();
  try {
    for (let i = 0; i < pj.numPages; i++) {
      check();
      progress(i, pj.numPages);
      const pg = await pj.getPage(i + 1);
      const vp1 = pg.getViewport({ scale: 1 });
      let scale = lv.dpi / 72;
      const maxPx = 16e6; if (vp1.width * vp1.height * scale * scale > maxPx) scale = Math.sqrt(maxPx / (vp1.width * vp1.height));
      const vp = pg.getViewport({ scale });
      const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      if (gray) toGray(ctx, cv.width, cv.height);
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', lv.q));
      const jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const page = out.addPage([vp1.width, vp1.height]);
      page.drawImage(jpg, { x: 0, y: 0, width: vp1.width, height: vp1.height });
      pg.cleanup(); cv.width = cv.height = 0;
    }
    progress(pj.numPages, pj.numPages);
  } finally { pj.destroy(); }
  return { bytes: await out.save({ useObjectStreams: true }) };
}

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
async function deflate(bytes) {
  const cs = new CompressionStream('deflate');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer());
}
async function compressBW(bytes, dpi, check) {
  const pj = await openPdfjs(bytes);
  const out = await PDFDocument.create();
  try {
    for (let i = 0; i < pj.numPages; i++) {
      check();
      progress(i, pj.numPages);
      const pg = await pj.getPage(i + 1);
      const vp1 = pg.getViewport({ scale: 1 });
      let scale = dpi / 72;
      const maxPx = 30e6; if (vp1.width * vp1.height * scale * scale > maxPx) scale = Math.sqrt(maxPx / (vp1.width * vp1.height));
      const vp = pg.getViewport({ scale });
      const W = Math.ceil(vp.width), H = Math.ceil(vp.height);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      const d = ctx.getImageData(0, 0, W, H).data;
      pg.cleanup(); cv.width = cv.height = 0;
      const lum = new Uint8Array(W * H), hist = new Uint32Array(256);
      for (let k = 0, j = 0; k < lum.length; k++, j += 4) { const y = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8; lum[k] = y; hist[y]++; }
      const t = Math.min(200, Math.max(60, otsu(hist, lum.length)));
      const rowBytes = Math.ceil(W / 8), bits = new Uint8Array(rowBytes * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (lum[y * W + x] > t) bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7); // 1 = white
      const img = out.context.register(out.context.stream(await deflate(bits), {
        Type: 'XObject', Subtype: 'Image', Width: W, Height: H, ColorSpace: 'DeviceGray', BitsPerComponent: 1, Filter: 'FlateDecode'
      }));
      const page = out.addPage([vp1.width, vp1.height]);
      const name = page.node.newXObject('Im', img);
      page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.concatTransformationMatrix(vp1.width, 0, 0, vp1.height, 0, 0), PDFLib.drawObject(name), PDFLib.popGraphicsState());
    }
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
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: v = raw;
      }
      out[dst + x] = v & 255;
    }
  }
  return out;
}
async function decodeToCanvas(info, stream) {
  if (info.kind === 'jpeg') {
    const bmp = await createImageBitmap(new Blob([stream.contents], { type: 'image/jpeg' }));
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
   The function below is self-contained: it is turned into the workers' source code. */
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
      src = await createImageBitmap(new Blob([t.contents], { type: 'image/jpeg' })); w = src.width; h = src.height;
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
  const url = URL.createObjectURL(new Blob([`(${photoWorkerMain.toString()})()`], { type: 'text/javascript' }));
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
  const cands = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
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

$('#comp-go').addEventListener('click', e => runJob(e.currentTarget, '壓縮中…', async (check, signal) => {
  clearCompResults(); renderCompList();
  const lvKey = levelVal(), color = $('#comp-color').value, gray = color !== 'color', keep = comp.mode === 'keep';
  comp.file.n = comp.items.length;
  let changed = 0;
  for (let i = 0; i < comp.items.length; i++) {
    check();
    comp.file.i = i;
    const it = comp.items[i];
    const res = keep ? await compressKeepText(it.bytes, KEEP_LEVELS[lvKey], gray, check, signal)
      : color === 'bw' ? await compressBW(it.bytes, BW_DPI[lvKey], check)
      : await compressRaster(it.bytes, LEVELS[lvKey], gray, check);
    const kept = res.bytes.length >= it.bytes.length;
    it.out = { bytes: kept ? it.bytes : res.bytes, kept };
    changed += res.changed || 0;
    renderCompList();
  }
  comp.file.i = comp.items.length - 1; progress(1, 1);
  const before = comp.items.reduce((s, x) => s + x.bytes.length, 0), after = comp.items.reduce((s, x) => s + x.out.bytes.length, 0);
  const max = Math.max(before, after, 1);
  $('#bar-before').style.width = (before / max * 100) + '%';
  $('#bar-after').style.width = (after / max * 100) + '%';
  $('#v-before').textContent = fmtSize(before); $('#v-after').textContent = fmtSize(after);
  const pct = Math.round((1 - after / before) * 100), multi = comp.items.length > 1;
  const big = $('#comp-pct'), warn = $('#comp-warn'), keptN = comp.items.filter(x => x.out.kept).length;
  big.textContent = after < before ? `−${pct}%` : '±0%'; big.classList.toggle('worse', after >= before);
  $('#comp-pct-label').textContent = (after < before ? `省下 ${fmtSize(before - after)}` : '沒有變小') + (keep ? `，重新壓縮 ${changed} 張照片` : '');
  warn.hidden = !keptN && !(keep && pct < 10);
  warn.textContent = keptN
    ? (multi ? `${keptN} 份壓縮後沒有變小，下載時會保留原檔。` : '壓縮後沒有變小，下載的會是原檔。')
      + (keep ? '如果是掃描檔，改用「整頁轉成圖片」會有明顯效果。' : '這類檔案主要是文字和向量圖形，改用「保留文字」或保留原檔即可。')
    : '這份檔案的照片不多，縮減有限。如果是掃描檔，改用「整頁轉成圖片」會小很多。';
  $('#comp-name-label').textContent = multi ? '壓縮檔名' : '檔名';
  $('#comp-name').value = multi ? '壓縮後的 PDF.zip' : baseName(comp.items[0].name) + '-壓縮.pdf';
  $('#comp-save').textContent = multi ? `下載全部 ${comp.items.length} 份（ZIP）` : '下載壓縮檔';
  $('#comp-result').hidden = false;
  if (!multi && !comp.items[0].out.kept) await deliver(pdfFile(comp.items[0].out.bytes, $('#comp-name').value), 'pdf', 'compress');
}).catch(err => toast('壓縮失敗：' + err.message, 'err')));
$('#comp-save').addEventListener('click', e => busy(e.currentTarget, '準備中…', async () => {
  const done = comp.items.filter(x => x.out); if (!done.length) return;
  if (done.length === 1) { await saveFile(ensurePdf($('#comp-name').value), done[0].out.bytes); return; }
  const zip = await newZip(), used = new Set();
  for (const it of done) {
    let n = baseName(it.name) + '-壓縮.pdf', k = 2;
    while (used.has(n)) n = baseName(it.name) + `-壓縮-${k++}.pdf`;
    used.add(n); zip.file(n, it.out.bytes);
  }
  let name = ($('#comp-name').value || '壓縮後的 PDF').trim(); if (!/\.zip$/i.test(name)) name += '.zip';
  await saveFile(name, await zip.generateAsync({ type: 'blob', compression: 'STORE' }));
}).catch(err => toast('下載失敗：' + err.message, 'err')));
setCompMode('keep');
