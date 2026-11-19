'use strict';
/* ================= COMPRESS =================
   Two ways:
   - keep: re-encode only the photos inside the PDF (JPEG or 8-bit Flate images); text and vector graphics stay untouched.
   - raster: render every page to a JPEG; smallest for scans, but text can no longer be selected. */
const comp = { name: '', bytes: null, pages: 0, result: null, mode: 'keep' };
const LEVELS = { light: { dpi: 150, q: .8 }, medium: { dpi: 110, q: .65 }, strong: { dpi: 72, q: .5 } };
const KEEP_LEVELS = { light: { px: 2400, q: .82 }, medium: { px: 1600, q: .68 }, strong: { px: 1100, q: .5 } };
async function loadCompFile(files) {
  const f = files[0];
  if (!isPdf(f)) { toast(`「${f.name}」不是 PDF 檔`, 'err'); return; }
  const bytes = new Uint8Array(await f.arrayBuffer());
  let doc;
  try { doc = await PDFDocument.load(bytes); } catch (e) { toast(loadErr(f.name, e), 'err'); return; }
  const first = doc.getPage(0).getSize();
  Object.assign(comp, { name: f.name, bytes, pages: doc.getPageCount(), result: null });
  $('#comp-fname').textContent = f.name;
  $('#comp-fmeta').textContent = `${comp.pages} 頁 · ${fmtSize(bytes.length)} · ${paperName(first.width, first.height)}`;
  $('#comp-name').value = baseName(f.name) + '-壓縮.pdf';
  $('#comp-empty').hidden = true; $('#comp-work').hidden = false;
  $('#comp-result').hidden = true; $('#comp-progress').hidden = true;
}
bindInput($('#comp-input'), loadCompFile);
acceptFiles($('#panel-compress'), $('#comp-drop'), loadCompFile);
registerTarget('pdf', 'compress', '壓縮', loadCompFile);
$('#comp-change').addEventListener('click', () => $('#comp-input').click());
$('#comp-sample').addEventListener('click', async e => {
  await busy(e.currentTarget, '產生範例…', async () => loadCompFile([asFile(await makePhotoSample(), 'site-survey-photos.pdf')]));
});
const levelVal = () => document.querySelector('input[name="level"]:checked').value;
function setCompMode(m) {
  comp.mode = m;
  $('#comp-m-keep').setAttribute('aria-pressed', m === 'keep'); $('#comp-m-raster').setAttribute('aria-pressed', m === 'raster');
  document.querySelectorAll('#panel-compress .spec').forEach(s => { s.textContent = s.dataset[m === 'keep' ? 'keep' : 'raster']; });
  $('#comp-note').textContent = m === 'keep'
    ? '文字、表格和向量圖完全不動，仍可選取和搜尋；只把裡面的照片縮小、重新壓縮。照片多的檔案效果最好。'
    : '每一頁都會轉成圖片再壓縮，完成後文字無法選取或搜尋。適合掃描檔，或「保留文字」壓不下來的檔案。';
  $('#comp-result').hidden = true;
}
$('#comp-m-keep').addEventListener('click', () => setCompMode('keep'));
$('#comp-m-raster').addEventListener('click', () => setCompMode('raster'));
setCompMode('keep');
document.querySelectorAll('input[name="level"]').forEach(r => r.addEventListener('change', () => { $('#comp-result').hidden = true; }));
$('#comp-gray').addEventListener('change', () => { $('#comp-result').hidden = true; });

function progress(i, n, unit = '頁') {
  $('#comp-progress').hidden = false;
  $('#comp-bar').style.width = (n ? i / n * 100 : 100) + '%';
  $('#comp-plabel').textContent = i < n ? `處理第 ${i + 1} / ${n} ${unit}` : (n ? `完成 ${n} ${unit}` : '完成');
}
function toGray(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let k = 0; k < d.length; k += 4) { const y = d[k] * .299 + d[k + 1] * .587 + d[k + 2] * .114; d[k] = d[k + 1] = d[k + 2] = y; }
  ctx.putImageData(img, 0, 0);
}
async function compressRaster(lv, gray, check) {
  const pj = await openPdfjs(comp.bytes);
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
async function compressKeepText(lv, gray, check) {
  const doc = await PDFDocument.load(comp.bytes);
  const ctx = doc.context;
  const cands = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const info = imageInfo(ctx, obj.dict);
    // Small Flate images are usually logos or line art; JPEG would blur them, so leave them alone.
    if (info && (info.kind === 'jpeg' || info.w * info.h >= 250000)) cands.push({ ref, obj, info });
  }
  let changed = 0;
  for (let i = 0; i < cands.length; i++) {
    check();
    progress(i, cands.length, '張照片');
    const { ref, obj, info } = cands[i];
    let cv;
    try { cv = await decodeToCanvas(info, obj); } catch (e) { cv = null; }
    if (!cv) continue;
    const k = Math.min(1, lv.px / Math.max(cv.width, cv.height));
    let outCv = cv;
    if (k < 1) {
      outCv = document.createElement('canvas'); outCv.width = Math.max(1, Math.round(cv.width * k)); outCv.height = Math.max(1, Math.round(cv.height * k));
      const c2 = outCv.getContext('2d'); c2.imageSmoothingQuality = 'high'; c2.drawImage(cv, 0, 0, outCv.width, outCv.height);
    }
    if (gray || info.comps === 1) toGray(outCv.getContext('2d'), outCv.width, outCv.height);
    const blob = await new Promise(r => outCv.toBlob(r, 'image/jpeg', lv.q));
    cv.width = cv.height = 0; if (outCv !== cv) { outCv.width = outCv.height = 0; }
    if (!blob) continue;
    const nb = new Uint8Array(await blob.arrayBuffer());
    if (nb.length > obj.contents.length * .9) continue; // not worth it
    const ns = ctx.stream(nb, {
      Type: 'XObject', Subtype: 'Image', Width: Math.round(info.w * k) || 1, Height: Math.round(info.h * k) || 1,
      ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode'
    });
    // Width/Height must match the JPEG we just wrote.
    const bmpSize = await createImageBitmap(blob).then(b => { const s = [b.width, b.height]; b.close && b.close(); return s; });
    ns.dict.set(N('Width'), PDFNumber.of(bmpSize[0])); ns.dict.set(N('Height'), PDFNumber.of(bmpSize[1]));
    for (const key of ['SMask', 'Intent', 'Interpolate', 'Metadata', 'OC']) { const v = obj.dict.get(N(key)); if (v) ns.dict.set(N(key), v); }
    ctx.assign(ref, ns);
    changed++;
  }
  progress(cands.length, cands.length, '張照片');
  return { bytes: await doc.save({ useObjectStreams: true }), changed, found: cands.length };
}

$('#comp-go').addEventListener('click', e => runJob(e.currentTarget, '壓縮中…', async check => {
  $('#comp-result').hidden = true;
  const lv = levelVal(), gray = $('#comp-gray').checked, keep = comp.mode === 'keep';
  const res = keep ? await compressKeepText(KEEP_LEVELS[lv], gray, check) : await compressRaster(LEVELS[lv], gray, check);
  const bytes = res.bytes;
  comp.result = bytes;
  const before = comp.bytes.length, after = bytes.length;
  const max = Math.max(before, after);
  $('#bar-before').style.width = (before / max * 100) + '%';
  $('#bar-after').style.width = (after / max * 100) + '%';
  $('#v-before').textContent = fmtSize(before); $('#v-after').textContent = fmtSize(after);
  const pct = Math.round((1 - after / before) * 100);
  const big = $('#comp-pct'), warn = $('#comp-warn');
  const extra = keep ? `，重新壓縮 ${res.changed} 張照片` : '';
  if (after < before) {
    big.textContent = `−${pct}%`; big.classList.remove('worse');
    $('#comp-pct-label').textContent = `省下 ${fmtSize(before - after)}${extra}`;
    warn.hidden = !(keep && pct < 10);
    warn.textContent = '這份檔案的照片不多，縮減有限。如果是掃描檔，改用「整頁轉成圖片」會小很多。';
  } else {
    big.textContent = `+${Math.abs(pct)}%`; big.classList.add('worse');
    $('#comp-pct-label').textContent = '檔案沒有變小' + extra;
    warn.hidden = false;
    warn.textContent = keep
      ? '這份檔案裡沒有可以再壓縮的照片。如果是掃描檔，改用「整頁轉成圖片」會有明顯效果；否則建議保留原檔。'
      : '這份檔案主要是文字和向量圖形，原本就很小，轉成圖片反而變大。建議保留原檔，或改用「保留文字」。';
  }
  $('#comp-result').hidden = false;
  if (after < before) offerNext(pdfFile(bytes, $('#comp-name').value), 'pdf', 'compress');
}).catch(err => toast('壓縮失敗：' + err.message, 'err')));
$('#comp-save').addEventListener('click', () => { if (comp.result) saveFile(ensurePdf($('#comp-name').value), comp.result); });
