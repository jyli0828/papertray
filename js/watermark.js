'use strict';
/* ================= WATERMARK ================= */
const wm = { name: '', bytes: null, pj: null, n: 0, cur: 0, type: 'text', img: null, disp: [595, 842] };
async function loadWm(files) {
  const f = files[0];
  if (!isPdf(f)) { toast(`「${f.name}」不是 PDF 檔`, 'err'); return; }
  const bytes = new Uint8Array(await f.arrayBuffer());
  let pj;
  try { await PDFDocument.load(bytes); pj = await openPdfjs(bytes); } catch (e) { toast(loadErr(f.name, e), 'err'); return; }
  if (wm.pj) wm.pj.destroy();
  Object.assign(wm, { name: f.name, bytes, pj, n: pj.numPages, cur: 0 });
  $('#wm-fname').textContent = f.name;
  $('#wm-fmeta').textContent = `${pj.numPages} 頁 · ${fmtSize(bytes.length)}`;
  $('#wm-name').value = baseName(f.name) + '-浮水印.pdf';
  $('#wm-empty').hidden = true; $('#wm-work').hidden = false;
  await renderWmPage();
}
const wmFont = size => `700 ${size}px "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif`;
const wmFontAsked = new Set();
/* The bold web font loads per character on demand; draw again once it arrives so preview and export use the same face. */
function wmFontReady(font, text) {
  const key = font.replace(/^\S+ \S+ /, '') + '|' + text;
  if (wmFontAsked.has(key)) return;
  wmFontAsked.add(key);
  document.fonts.load(font, text).then(() => drawWmOverlay()).catch(() => {});
}
function wmTextMark() {
  const text = $('#wm-text').value.trim() || ' ';
  const size = Math.max(8, Math.min(300, +$('#wm-size').value || 64)), k = 4;
  const font = wmFont(size);
  wmFontReady(font, text);
  mctx.font = font;
  const wPt = mctx.measureText(text).width + size * .2, hPt = size * 1.3;
  const cv = document.createElement('canvas'); cv.width = Math.ceil(wPt * k); cv.height = Math.ceil(hPt * k);
  const ctx = cv.getContext('2d'); ctx.scale(k, k); ctx.font = font; ctx.fillStyle = $('#wm-color').value;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText(text, wPt / 2, hPt / 2);
  return { canvas: cv, wPt, hPt, key: 'text' };
}
function wmMark(dispW) {
  if (wm.type === 'img') {
    if (!wm.img) return null;
    const wPt = dispW * (+$('#wm-imgw').value / 100);
    return { canvas: wm.img.canvas, wPt, hPt: wPt * wm.img.h / wm.img.w, key: 'img' };
  }
  return wmTextMark();
}
function wmLayout(dw, dh, w, h, deg, pos) {
  const t = deg * Math.PI / 180, c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
  const bw = w * c + h * s, bh = w * s + h * c, m = 30;
  switch (pos) {
    case 'tl': return [[m + bw / 2, m + bh / 2]];
    case 'tr': return [[dw - m - bw / 2, m + bh / 2]];
    case 'bl': return [[m + bw / 2, dh - m - bh / 2]];
    case 'br': return [[dw - m - bw / 2, dh - m - bh / 2]];
    case 'tile': {
      const sx = bw + Math.max(36, w * .25), sy = bh + Math.max(36, h * 1.2), pts = [];
      let row = 0;
      for (let y = sy / 2; y < dh + sy / 2; y += sy, row++) for (let x = row % 2 ? 0 : sx / 2; x < dw + sx / 2; x += sx) pts.push([x, y]);
      return pts;
    }
    default: return [[dw / 2, dh / 2]];
  }
}
async function renderWmPage() {
  // Rapid page flips or resizes must not start two renders on the same canvas (pdf.js refuses that).
  const token = wm.renderToken = (wm.renderToken || 0) + 1;
  if (wm.task) { try { wm.task.cancel(); } catch (e) {} wm.task = null; }
  const pg = await wm.pj.getPage(wm.cur + 1);
  if (token !== wm.renderToken) return;
  const vp1 = pg.getViewport({ scale: 1 });
  wm.disp = [vp1.width, vp1.height];
  const box = $('#wm-page').parentElement;
  const scale = Math.min(Math.max(200, box.clientWidth - 28) / vp1.width, 560 / vp1.height, 1.6);
  wm.scale = scale;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp = pg.getViewport({ scale: scale * dpr });
  for (const cv of [$('#wm-canvas'), $('#wm-over')]) {
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    cv.style.width = vp1.width * scale + 'px'; cv.style.height = vp1.height * scale + 'px';
  }
  const ctx = $('#wm-canvas').getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, vp.width, vp.height);
  wm.task = pg.render({ canvasContext: ctx, viewport: vp });
  try { await wm.task.promise; } catch (e) { if (token !== wm.renderToken) return; }
  if (token !== wm.renderToken) return;
  wm.task = null;
  $('#wm-pno').textContent = `${wm.cur + 1} / ${wm.n}`;
  $('#wm-prev').disabled = wm.cur === 0; $('#wm-next').disabled = wm.cur >= wm.n - 1;
  drawWmOverlay();
}
function wmTargets() {
  const txt = $('#wm-pages').value.trim();
  if (!txt) return { set: null };
  const r = parseRanges(txt, wm.n);
  if (r.error) return { error: r.error };
  const set = new Set(); r.ranges.forEach(([a, b]) => { for (let i = a; i <= b; i++) set.add(i - 1); });
  return { set };
}
function drawWmOverlay() {
  if (!wm.pj) return;
  const cv = $('#wm-over'), ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const tg = wmTargets();
  $('#wm-err').hidden = !tg.error; $('#wm-err').textContent = tg.error || '';
  const count = tg.error ? 0 : tg.set ? tg.set.size : wm.n;
  $('#wm-summary').textContent = tg.error ? '' : `會套用到 ${count} 頁` + (tg.set && !tg.set.has(wm.cur) ? '（目前預覽的這頁不套用）' : '');
  $('#wm-go').disabled = !!tg.error || (wm.type === 'img' && !wm.img);
  if (tg.error || (tg.set && !tg.set.has(wm.cur))) return;
  const [dw, dh] = wm.disp, mark = wmMark(dw); if (!mark) return;
  const k = cv.width / dw, deg = +$('#wm-angle').value;
  ctx.globalAlpha = +$('#wm-opacity').value / 100;
  for (const [x, y] of wmLayout(dw, dh, mark.wPt, mark.hPt, deg, $('#wm-pos').value)) {
    ctx.save(); ctx.translate(x * k, y * k); ctx.rotate(-deg * Math.PI / 180);
    ctx.drawImage(mark.canvas, -mark.wPt / 2 * k, -mark.hPt / 2 * k, mark.wPt * k, mark.hPt * k);
    ctx.restore();
  }
}
function setWmType(t) {
  wm.type = t;
  $('#wm-t-text').setAttribute('aria-pressed', t === 'text'); $('#wm-t-img').setAttribute('aria-pressed', t === 'img');
  $('#wm-text-opts').hidden = t !== 'text'; $('#wm-img-opts').hidden = t !== 'img';
  drawWmOverlay();
}
$('#wm-t-text').addEventListener('click', () => setWmType('text'));
$('#wm-t-img').addEventListener('click', () => setWmType('img'));
['#wm-text', '#wm-size', '#wm-color', '#wm-pos', '#wm-angle', '#wm-opacity', '#wm-imgw', '#wm-pages'].forEach(s => {
  $(s).addEventListener('input', () => { $('#wm-op-v').textContent = $('#wm-opacity').value + '%'; $('#wm-imgw-v').textContent = $('#wm-imgw').value; drawWmOverlay(); });
  $(s).addEventListener('change', drawWmOverlay);
});
$('#wm-prev').innerHTML = ICON.left; $('#wm-next').innerHTML = ICON.right;
$('#wm-prev').addEventListener('click', () => { if (wm.cur > 0) { wm.cur--; renderWmPage(); } });
$('#wm-next').addEventListener('click', () => { if (wm.cur < wm.n - 1) { wm.cur++; renderWmPage(); } });
bindInput($('#wm-img-input'), async files => {
  const f = files[0];
  if (!isImage(f)) { toast(`「${f.name}」不是支援的圖片格式`, 'err'); return; }
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close && bmp.close();
    wm.img = { canvas: cv, w: cv.width, h: cv.height };
    $('#wm-img-name').textContent = f.name;
    drawWmOverlay();
  } catch (e) { toast('這張圖片無法讀取', 'err'); }
});
$('#wm-go').addEventListener('click', e => busy(e.currentTarget, '處理中…', async () => {
  const tg = wmTargets(); if (tg.error) { toast(tg.error, 'err'); return; }
  if (wm.type === 'text') { try { await document.fonts.load(wmFont(64), $('#wm-text').value.trim() || ' '); } catch (e) {} }
  const out = await PDFDocument.load(wm.bytes);
  const deg = +$('#wm-angle').value, opacity = +$('#wm-opacity').value / 100, pos = $('#wm-pos').value;
  const cache = new Map();
  const embedMark = async mark => {
    if (cache.has(mark.key)) return cache.get(mark.key);
    const blob = await new Promise(r => mark.canvas.toBlob(r, 'image/png'));
    const img = await out.embedPng(new Uint8Array(await blob.arrayBuffer()));
    cache.set(mark.key, img); return img;
  };
  let done = 0;
  for (let i = 0; i < out.getPageCount(); i++) {
    if (tg.set && !tg.set.has(i)) continue;
    const page = out.getPage(i);
    const R = ((page.getRotation().angle % 360) + 360) % 360;
    const cb = page.getCropBox(), view = [cb.x, cb.y, cb.x + cb.width, cb.y + cb.height];
    const [dw, dh] = dispSize(view, R);
    const mark = wmMark(dw); if (!mark) break;
    const img = await embedMark(mark);
    const phi = (R + deg) * Math.PI / 180, cs = Math.cos(phi), sn = Math.sin(phi);
    const ox = mark.wPt / 2 * cs - mark.hPt / 2 * sn, oy = mark.wPt / 2 * sn + mark.hPt / 2 * cs;
    for (const [cx, cy] of wmLayout(dw, dh, mark.wPt, mark.hPt, deg, pos)) {
      const [ux, uy] = displayToUser(view, R, cx, cy);
      page.drawImage(img, { x: ux - ox, y: uy - oy, width: mark.wPt, height: mark.hPt, rotate: degrees(R + deg), opacity });
    }
    done++;
  }
  const bytes = await out.save({ useObjectStreams: true });
  await saveFile(ensurePdf($('#wm-name').value), bytes);
}).catch(err => toast('加浮水印失敗：' + err.message, 'err')));
bindInput($('#wm-input'), loadWm);
acceptFiles($('#panel-watermark'), $('#wm-drop'), loadWm);
$('#wm-change').addEventListener('click', () => $('#wm-input').click());
$('#wm-sample').addEventListener('click', async () => loadWm([asFile(await makeSample('Quarterly Report', 3, [.04, .48, .42]), 'quarterly-report.pdf')]));
let wmResizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(wmResizeTimer);
  wmResizeTimer = setTimeout(() => { if (wm.pj && !$('#panel-watermark').hidden) renderWmPage(); }, 150);
});
