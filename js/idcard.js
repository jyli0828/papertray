'use strict';
/* ================= ID CARD COPY =================
   A photo of each side of an ID card is cut out and straightened (the same corner finding and perspective
   correction as 「校正翻拍的文件」), then printed at the card's real size on one A4 page, front above back,
   like a photocopy. An optional note (「僅供 … 使用」) is burned into each card so the copy cannot be reused. */
const idc = { sides: [null, null], token: 0 };
const ID_SIZES = { card: [85.6, 54, 3.18], passport: [125, 88, 2] }; // width, height, corner radius (mm)
const A4_MM = [210, 297];
const MM_PT = 72 / 25.4;
const ID_SIDE_NAMES = ['正面', '反面'];
const ID_THUMB_PX = 600;

/* A picture becomes a side: if the card's edges are found it is cut out and flattened right away; 校正 adjusts it. */
async function loadIdImage(f) {
  const bmp = await createImageBitmap(f); // full size, only while the card is found and cut out
  let it;
  try {
    // The card is shown a few hundred px wide; the photo itself there would stay decoded at full size.
    it = { id: uid(), name: f.name, file: f, size: f.size, url: await listThumb(bmp, ID_THUMB_PX), thumbPx: ID_THUMB_PX,
      w: bmp.width, h: bmp.height, kind: 'other' };
    const quad = detectQuad(bmp);
    if (quad) {
      const out = scanRender(bmp, quad, 'none', 0, 2400);
      const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', .92));
      const file = new File([blob], f.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
      await replaceImgItem(it, file, out, 'jpg', ID_THUMB_PX);
      out.width = out.height = 0;
      it.scan = { src: f, quad, mode: 'none', rot: 0 };
    }
  } finally { bmp.close && bmp.close(); }
  return it;
}
function dropIdSide(i) {
  const it = idc.sides[i]; if (!it) return;
  URL.revokeObjectURL(it.url); if (it.bmp && it.bmp.close) it.bmp.close();
  idc.sides[i] = null;
}
async function setIdSide(i, f) {
  try {
    const it = await loadIdImage(f);
    dropIdSide(i); idc.sides[i] = it;
    if (!it.scan) toast(`${ID_SIDE_NAMES[i]}找不到證件邊緣，請按「校正」手動對準四個角`);
  } catch (e) { toast(`「${f.name}」無法讀取，圖片可能已損壞。`, 'err'); }
}
/* Dropped or pasted on the panel: fill the empty sides in order (front first). */
async function addIdFiles(files) {
  files = (await prepImages(files)).filter(f => {
    if (isImage(f)) return true;
    toast(`「${f.name}」不是支援的圖片格式`, 'err'); return false;
  });
  if (!files.length) return;
  let free = [0, 1].filter(i => !idc.sides[i]);
  if (files.length >= 2) free = [0, 1]; // two new pictures replace both sides
  if (!free.length) { toast('正反面都已有圖片；要換掉哪一面，請拖到那一面上'); return; }
  for (let k = 0; k < Math.min(files.length, free.length); k++) await setIdSide(free[k], files[k]);
  if (files.length > 2) toast('只用了前兩張圖片（正面、反面）');
  renderIdSides();
}
function renderIdSides() {
  document.querySelectorAll('#panel-idcard .id-slot').forEach(slot => {
    const it = idc.sides[+slot.dataset.side];
    slot.querySelector('.id-drop').hidden = !!it;
    slot.querySelector('.id-card').hidden = !it;
    if (it) slot.querySelector('.id-card img').src = it.url;
  });
  const n = idc.sides.filter(Boolean).length;
  setJobButton($('#id-go'), { disabled: !n });
  $('#id-summary').textContent = !n ? '放入證件的正面與反面照片'
    : n === 2 ? '正面 + 反面 → 1 頁 A4' : (idc.sides[0] ? '只有正面' : '只有反面') + ' → 1 頁 A4';
  drawIdPreview();
}

/* ---------- layout (millimetres, top-left origin) ---------- */
function idOpts() {
  return { type: $('#id-type').value, scale: +$('#id-scale').value, arrange: $('#id-arrange').value,
    gray: $('#id-color').value === 'gray', note: $('#id-note').value.trim(), border: $('#id-border').checked };
}
function idLayout(o) {
  const [bw, bh, br] = ID_SIZES[o.type];
  const cards = idc.sides.map(it => {
    if (!it) return null;
    const tall = it.h > it.w; // a card photographed upright stays upright
    const w = (tall ? bh : bw) * o.scale, h = (tall ? bw : bh) * o.scale;
    return { it, w, h, r: br * o.scale };
  }).filter(Boolean);
  const [PW, PH] = A4_MM, gap = 12, M = 10;
  let side = o.arrange === 'side' && cards.length === 2;
  const fitsSide = cards.length < 2 || cards[0].w + gap + cards[1].w <= PW - 2 * M;
  if (side && !fitsSide) side = false;
  // Too big for the page even one above the other (a passport at 200% is wider than A4): shrink to fit.
  let fit = 1;
  if (cards.length) {
    fit = side ? Math.min(1, (PH - 2 * M) / Math.max(...cards.map(c => c.h)))
      : Math.min(1, (PW - 2 * M) / Math.max(...cards.map(c => c.w)), (PH - 2 * M - gap * (cards.length - 1)) / cards.reduce((s, c) => s + c.h, 0));
    if (fit < 1) cards.forEach(c => { c.w *= fit; c.h *= fit; c.r *= fit; });
  }
  if (side) {
    const tw = cards[0].w + gap + cards[1].w, th = Math.max(cards[0].h, cards[1].h);
    let x = (PW - tw) / 2;
    for (const c of cards) { c.x = x; c.y = (PH - th) / 2 + (th - c.h) / 2; x += c.w + gap; }
  } else {
    const th = cards.reduce((s, c) => s + c.h, 0) + gap * (cards.length - 1);
    let y = (PH - th) / 2;
    for (const c of cards) { c.x = (PW - c.w) / 2; c.y = y; y += c.h + gap; }
  }
  return { cards, sideFallback: o.arrange === 'side' && cards.length === 2 && !fitsSide, shrunk: fit < 1 ? Math.round(o.scale * fit * 100) : 0 };
}

/* ---------- one card as a picture ----------
   The photo is decoded at the size it is drawn, never at full resolution (a 12 MP phone photo is 48 MB decoded; a
   card printed at 300 dpi needs about 1000 × 640 px). The small copy for the preview is kept between redraws; the
   one for the PDF is made for the export and closed right after. */
async function idBitmap(it, W, H, keep) {
  if (keep && it.bmp && it.bmpFile === it.file && it.bmp.width === W && it.bmp.height === H) return it.bmp;
  const bmp = await createImageBitmap(it.file, { resizeWidth: W, resizeHeight: H, resizeQuality: 'high' });
  if (!keep) return bmp;
  if (it.bmp && it.bmp.close) it.bmp.close();
  it.bmp = bmp; it.bmpFile = it.file;
  return bmp;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
/* The note runs along the card's diagonal, on one line or two, sized to fit. */
function drawIdNote(ctx, W, H, text) {
  const ang = -Math.atan2(H, W) * .85, span = Math.hypot(W, H) * .78;
  const fit = lines => {
    let size = H * .12; ctx.font = fontStr(size);
    const widest = Math.max(...lines.map(l => ctx.measureText(l).width));
    if (widest > span) size *= span / widest;
    return size;
  };
  let lines = [text], size = fit(lines);
  if (size < H * .07 && text.length > 6) {
    const mid = text.length / 2;
    let cut = -1; // break at the punctuation or space nearest the middle
    for (let k = 0; k < text.length; k++) if (/[\s，,、；;：:。]/.test(text[k]) && (cut < 0 || Math.abs(k - mid) < Math.abs(cut - mid))) cut = k;
    if (cut < text.length * .25 || cut > text.length * .75) cut = Math.round(mid) - 1;
    lines = [text.slice(0, cut + 1).trim(), text.slice(cut + 1).trim()].filter(Boolean);
    size = fit(lines);
  }
  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.rotate(ang);
  ctx.font = fontStr(size); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = size * .16; ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.fillStyle = 'rgba(196,32,32,.72)';
  lines.forEach((l, i) => {
    const y = (i - (lines.length - 1) / 2) * size * 1.25;
    ctx.strokeText(l, 0, y); ctx.fillText(l, 0, y);
  });
  ctx.restore();
}
async function idCardCanvas(c, pxPerMm, o, preview) {
  const W = Math.max(8, Math.round(c.w * pxPerMm)), H = Math.max(8, Math.round(c.h * pxPerMm)), r = c.r * pxPerMm;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); // the corners outside the rounded card stay white (JPEG has no transparency)
  ctx.save(); roundRect(ctx, 0, 0, W, H, r); ctx.clip();
  const bmp = await idBitmap(c.it, W, H, preview);
  ctx.drawImage(bmp, 0, 0, W, H);
  if (!preview && bmp.close) bmp.close();
  ctx.restore();
  if (o.gray) toGray(ctx, W, H);
  if (o.note) { await ensureFont(o.note, 40); drawIdNote(ctx, W, H, o.note); }
  if (o.border) {
    const lw = Math.max(1, .25 * pxPerMm);
    ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(0,0,0,.4)';
    roundRect(ctx, lw / 2, lw / 2, W - lw, H - lw, Math.max(0, r - lw / 2)); ctx.stroke();
  }
  return cv;
}

/* ---------- live preview of the A4 page ---------- */
async function drawIdPreview() {
  // Hidden, it would only measure an empty panel, and measuring forces the browser to lay out the page: at start-up,
  // before the rest of the page is even there, that alone took longer than running all of 紙匣's other code.
  // showTab() draws it when the tab opens.
  if ($('#panel-idcard').hidden) return;
  const token = ++idc.token, o = idOpts(), { cards, sideFallback, shrunk } = idLayout(o);
  const cv = $('#id-canvas'), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = Math.min(340, Math.max(200, $('#panel-idcard .wm-preview').clientWidth - 28)), k = cssW / A4_MM[0] * dpr;
  const parts = [];
  for (const c of cards) parts.push(await idCardCanvas(c, k, o, true));
  if (token !== idc.token) { parts.forEach(p => { p.width = p.height = 0; }); return; }
  cv.width = Math.round(A4_MM[0] * k); cv.height = Math.round(A4_MM[1] * k);
  cv.style.width = cssW + 'px'; cv.style.height = Math.round(cssW * A4_MM[1] / A4_MM[0]) + 'px';
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  if (!cards.length) {
    ctx.strokeStyle = '#c9d1d8'; ctx.setLineDash([6 * dpr, 5 * dpr]); ctx.lineWidth = dpr;
    const [bw, bh] = ID_SIZES[o.type];
    for (const y of [A4_MM[1] / 2 - 6 - bh * o.scale, A4_MM[1] / 2 + 6]) {
      roundRect(ctx, (A4_MM[0] - bw * o.scale) / 2 * k, y * k, bw * o.scale * k, bh * o.scale * k, 3 * k); ctx.stroke();
    }
  }
  cards.forEach((c, i) => { ctx.drawImage(parts[i], c.x * k, c.y * k); parts[i].width = parts[i].height = 0; });
  $('#id-prev-hint').textContent = shrunk ? `放大後超出 A4，已縮小到 ${shrunk}%`
    : sideFallback ? '放大後左右放不下，改成上下排列' : 'A4 預覽';
}

/* ---------- making the PDF ---------- */
$('#id-go').addEventListener('click', e => runJob(e.currentTarget, '產生中…', async check => {
  const o = idOpts(), { cards } = idLayout(o), name = ensurePdf($('#id-name').value);
  if (!cards.length) return;
  const out = await PDFDocument.create();
  const page = out.addPage([A4_MM[0] * MM_PT, A4_MM[1] * MM_PT]);
  const pxPerMm = 300 / 25.4; // 300 dpi
  for (const c of cards) {
    check();
    const cv = await idCardCanvas(c, pxPerMm, o);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .9)); cv.width = cv.height = 0;
    const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    page.drawImage(img, { x: c.x * MM_PT, y: (A4_MM[1] - c.y - c.h) * MM_PT, width: c.w * MM_PT, height: c.h * MM_PT });
  }
  out.setTitle(baseName(name));
  const bytes = await out.save({ useObjectStreams: true });
  await deliver(pdfFile(bytes, name), 'pdf', 'idcard');
}).catch(err => toast('產生失敗：' + err.message, 'err')));

/* ---------- wiring ---------- */
acceptFiles($('#panel-idcard'), null, addIdFiles); // first: Ctrl+V and drops outside the two boxes
document.querySelectorAll('#panel-idcard .id-slot').forEach(slot => {
  const i = +slot.dataset.side;
  const one = async files => {
    files = (await prepImages(files)).filter(isImage);
    if (!files.length) { toast('請放入圖片（JPG、PNG、HEIC）', 'err'); return; }
    await setIdSide(i, files[0]); renderIdSides();
  };
  acceptFiles(slot, slot.querySelector('.id-drop'), one);
  bindInput(slot.querySelector('input[type="file"]'), one);
  slot.querySelector('[data-act="scan"]').insertAdjacentHTML('afterbegin', ICON.scan);
  slot.querySelector('[data-act="remove"]').innerHTML = ICON.x;
  slot.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    if (b.dataset.act === 'scan' && idc.sides[i]) openScan(idc.sides[i], renderIdSides);
    if (b.dataset.act === 'remove') { dropIdSide(i); renderIdSides(); }
  });
});
['#id-type', '#id-scale', '#id-arrange', '#id-color', '#id-border'].forEach(s => $(s).addEventListener('change', drawIdPreview));
let idNoteTimer;
$('#id-note').addEventListener('input', () => {
  clearTimeout(idNoteTimer); idNoteTimer = setTimeout(drawIdPreview, 200);
  try { localStorage.setItem('papertray.idnote', $('#id-note').value); } catch (e) {}
});
try { $('#id-note').value = localStorage.getItem('papertray.idnote') || ''; } catch (e) {}
$('#id-note-date').addEventListener('click', () => {
  const el = $('#id-note'), d = todayText($('#te-datefmt').value);
  if (!el.value.includes(d)) el.value = (el.value.trim() ? el.value.trim() + ' ' : '') + d;
  el.dispatchEvent(new Event('input'));
});
registerTarget('image', 'idcard', '證件影印', addIdFiles);
window.addEventListener('resize', () => { if (!$('#panel-idcard').hidden) drawIdPreview(); });

/* sample: two phone-style photos of a made-up card lying slightly askew on a dark desk */
onSample($('#id-sample'), async () => {
  const files = [];
  for (let s = 0; s < 2; s++) {
    const cv = document.createElement('canvas'); cv.width = 1600; cv.height = 1200;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#34393e'; ctx.fillRect(0, 0, 1600, 1200);
    for (let k = 0; k < 2200; k++) { ctx.fillStyle = `rgba(255,255,255,${Math.random() * .05})`; ctx.fillRect(Math.random() * 1600, Math.random() * 1200, 3, 3); }
    ctx.translate(800, 600); ctx.rotate((s ? 4 : -6) * Math.PI / 180);
    const W = 1100, H = W * 54 / 85.6;
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 30;
    const g = ctx.createLinearGradient(-W / 2, -H / 2, W / 2, H / 2);
    g.addColorStop(0, s ? '#eef3f6' : '#f6efe2'); g.addColorStop(1, s ? '#d9e6ee' : '#ead9c2');
    ctx.fillStyle = g; roundRect(ctx, -W / 2, -H / 2, W, H, 40); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = '#2d4a63'; ctx.font = '700 54px sans-serif'; ctx.fillText(s ? 'SAMPLE CARD · BACK' : 'SAMPLE CARD', -W / 2 + 60, -H / 2 + 95);
    if (!s) {
      ctx.fillStyle = '#b9c4cc'; ctx.fillRect(W / 2 - 330, -H / 2 + 150, 260, 320);
      ctx.fillStyle = '#8796a2'; ctx.beginPath(); ctx.arc(W / 2 - 200, -H / 2 + 260, 70, 0, 7); ctx.fill();
      ctx.fillRect(W / 2 - 300, -H / 2 + 350, 200, 120);
    } else {
      for (let k = 0; k < 60; k++) { ctx.fillStyle = '#222'; ctx.fillRect(-W / 2 + 60 + k * 15, H / 2 - 150, k % 3 ? 6 : 10, 90); }
    }
    ctx.fillStyle = '#6d7b86';
    for (let k = 0; k < 5; k++) ctx.fillRect(-W / 2 + 60, -H / 2 + 170 + k * 58, (s ? 900 : 560) - k * 40, 22);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .9));
    files.push(new File([blob], s ? 'card-back.jpg' : 'card-front.jpg', { type: 'image/jpeg' }));
  }
  await addIdFiles(files);
});
renderIdSides();
registerHolder('idcard', () => idc.sides.reduce((n, it) => n + (it ? it.size + (it.scan ? it.scan.src.size : 0) + (it.bmp ? it.bmp.width * it.bmp.height * 4 : 0) : 0), 0),
  () => { dropIdSide(0); dropIdSide(1); renderIdSides(); });
