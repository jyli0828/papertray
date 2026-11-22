'use strict';
/* ================= OCR (文字辨識) =================
   Reads the words in scanned pages and photos with Tesseract (繁體中文 + English), entirely in the browser.
   The engine (about 4 MB) and the language data (繁中 1.7 MB, English 3 MB) load the first time OCR is used. The
   engine runs in a background worker that holds well over 100 MB, so it is shut down after a minute without work.
   Used by the 文字辨識 tab (searchable PDF or text), PDF 轉圖片 → 文字 TXT, 遮蔽個資 → 自動尋找, and 比較.
   tools/build.py points these paths at jsdelivr in the bundled pages. */
const OCR_LIB = {
  worker: 'lib/tesseract/worker.min.js',
  core: 'lib/tesseract/tesseract-core-simd-lstm.wasm.js',
  lang: 'lib/tesseract/lang' // in the bundles: a CDN address, and Tesseract then fetches each language from its own package
};
const OCR_LANGS = 'chi_tra+eng';
const ocrEng = { worker: null, langs: '', idle: 0, onProgress: null };
let ocrQueue = Promise.resolve();
const normRot = r => ((r % 360) + 360) % 360;
const ocrUrl = p => new URL(p, location.href).href;
function ocrProgressText(m) {
  if (!m || !m.status) return '準備中…';
  if (m.status === 'recognizing text') return `辨識中 ${Math.round((m.progress || 0) * 100)}%`;
  return '載入文字辨識引擎（第一次約 8 MB）…';
}
async function ocrStart(langs) {
  if (ocrEng.worker && ocrEng.langs === langs) return ocrEng.worker;
  ocrStop();
  if (location.protocol === 'file:') throw new Error('直接開啟 index.html 時，瀏覽器不允許文字辨識需要的背景程式。請照說明用本機伺服器開啟紙匣');
  if (!window.Tesseract) await loadScript('tesseract');
  const remote = /^https?:/.test(OCR_LIB.lang);
  let w;
  try {
    w = await Tesseract.createWorker(langs.split('+'), 1, {
      workerPath: ocrUrl(OCR_LIB.worker), corePath: ocrUrl(OCR_LIB.core),
      langPath: remote ? undefined : ocrUrl(OCR_LIB.lang), gzip: true,
      cacheMethod: remote ? 'write' : 'none', // local files are as fast as the browser's cache, and need no second copy
      logger: m => { if (ocrEng.onProgress) ocrEng.onProgress(m); }
    });
    await w.setParameters({ user_defined_dpi: '300', preserve_interword_spaces: '1' });
  } catch (e) {
    if (w) w.terminate().catch(() => {});
    throw new Error('文字辨識引擎載入失敗' + (remote ? '，請檢查網路連線後再試一次' : ''));
  }
  ocrEng.worker = w; ocrEng.langs = langs;
  return w;
}
function ocrStop() {
  clearTimeout(ocrEng.idle);
  const w = ocrEng.worker; ocrEng.worker = null; ocrEng.langs = '';
  if (w) w.terminate().catch(() => {});
}
/* One picture at a time: jobs from different tools wait their turn. pdf = true also returns a one-page PDF that holds
   only the invisible text (Tesseract's own text layer), to lay over the original page. */
function ocrRecognize(image, { langs = OCR_LANGS, pdf = false, onProgress } = {}) {
  const job = ocrQueue.then(async () => {
    clearTimeout(ocrEng.idle);
    ocrEng.onProgress = onProgress || null;
    try {
      const w = await ocrStart(langs);
      const { data } = await w.recognize(image, pdf ? { pdfTitle: 'OCR', pdfTextOnly: true } : {}, { text: true, blocks: true, pdf });
      return data;
    } finally {
      ocrEng.onProgress = null;
      ocrEng.idle = setTimeout(ocrStop, 60000);
    }
  });
  ocrQueue = job.catch(() => {});
  return job;
}

/* Text from Tesseract's blocks, with a box for every character. Tesseract puts a space between every "word", which in
   Chinese is wrong, so words are joined without one when both sides are CJK. */
const isCjk = ch => /[⺀-鿿豈-﫿　-〿＀-￯]/.test(ch || '');
function ocrText(blocks, toBox) {
  let text = ''; const boxes = [];
  const put = (ch, b) => { text += ch; for (let k = 0; k < ch.length; k++) boxes.push(b); };
  for (const bl of blocks || []) for (const pa of bl.paragraphs || []) {
    if (text && !text.endsWith('\n\n')) put('\n', null); // a blank line between paragraphs
    for (const ln of pa.lines || []) {
      let prev = '', started = false;
      for (const w of ln.words || []) {
        if (!w.text || !w.text.trim() || w.confidence < 10) continue; // specks on the paper come back as junk "words"
        const syms = w.symbols && w.symbols.length ? w.symbols : [{ text: w.text, bbox: w.bbox }];
        const first = [...(syms[0].text || ' ')][0];
        if (started && !(isCjk(prev) && isCjk(first))) put(' ', null);
        for (const sy of syms) {
          const chars = [...(sy.text || '')]; if (!chars.length) continue;
          const b = sy.bbox, step = (b.x1 - b.x0) / chars.length;
          chars.forEach((ch, k) => put(fixCjk(ch), toBox(b.x0 + step * k, b.y0, b.x0 + step * (k + 1), b.y1)));
          prev = chars[chars.length - 1];
        }
        started = true;
      }
      if (started) put('\n', null);
    }
  }
  while (text.endsWith('\n')) { text = text.slice(0, -1); boxes.pop(); }
  return { text, boxes, ocr: true };
}
/* OCR one pdf.js page, drawn upright as it is shown (rotation R) at about 300 dpi. Boxes are in PDF user space. */
async function ocrPage(pg, R, opts = {}) {
  const view = pg.view, vp1 = pg.getViewport({ scale: 1, rotation: R });
  let s = 300 / 72; if (vp1.width * vp1.height * s * s > 16e6) s = Math.sqrt(16e6 / (vp1.width * vp1.height));
  const vp = pg.getViewport({ scale: s, rotation: R });
  const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await pg.render({ canvasContext: ctx, viewport: vp }).promise;
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  pg.cleanup(); cv.width = cv.height = 0;
  const data = await ocrRecognize(blob, opts);
  const toBox = (x0, y0, x1, y1) => {
    const [ax, ay] = displayToUser(view, R, x0 / s, y0 / s), [bx, by] = displayToUser(view, R, x1 / s, y1 / s);
    return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
  };
  const out = ocrText(data.blocks, toBox);
  out.segs = ocrSegments(data.blocks, s);
  if (opts.pdf && data.pdf) out.pdf = data.pdf instanceof Uint8Array ? data.pdf : new Uint8Array(data.pdf);
  return out;
}

/* ---------- searchable PDF: an invisible text layer ----------
   Tesseract can write a text layer itself, but it puts a space after every "word", and a Chinese "word" is often
   one or two characters: searching the PDF for 管理委員會 would not find 「管理 委員 會」. So the layer is written
   here, with Tesseract's invisible font (GlyphLessFont: every character code is its Unicode value and every glyph
   an empty box 0.5 em wide). Chinese words next to each other become one run of text, stretched (Tz) from where the
   first starts to where the last ends; words in other scripts keep a space between them. */
function ocrSegments(blocks, s) {
  const out = [];
  for (const bl of blocks || []) for (const pa of bl.paragraphs || []) for (const ln of pa.lines || []) {
    const segs = [];
    for (const w of ln.words || []) {
      if (!w.text || !w.text.trim() || w.confidence < 10) continue;
      const t = fixCjk(w.text.trim()), last = segs[segs.length - 1], h = w.bbox.y1 - w.bbox.y0;
      if (last && isCjk(last.text[last.text.length - 1]) && isCjk(t[0])) { last.text += t; last.x1 = w.bbox.x1; last.h = Math.max(last.h, h); }
      else segs.push({ text: t, x0: w.bbox.x0, x1: w.bbox.x1, h });
    }
    if (!segs.length) continue;
    const b = ln.baseline, hasBase = b && b.x1 > b.x0;
    const baseAt = x => hasBase ? b.y0 + (b.y1 - b.y0) * (x - b.x0) / (b.x1 - b.x0) : ln.bbox.y1 - (ln.bbox.y1 - ln.bbox.y0) * .2;
    const size = Math.max(...segs.map(g => g.h)) / s;
    segs.forEach((g, k) => {
      const next = segs[k + 1];
      out.push({ text: next ? g.text + ' ' : g.text, x: g.x0 / s, base: baseAt(g.x0) / s, w: ((next ? next.x0 : g.x1) - g.x0) / s, size });
    });
  }
  return out;
}
/* The font, copied once per document from a page Tesseract wrote. */
async function ocrFontInto(doc, tessPdf) {
  const src = await PDFDocument.load(tessPdf);
  const fonts = src.getPage(0).node.Resources().lookup(PDFName.of('Font'), PDFDict);
  return doc.context.register(PDFLib.PDFObjectCopier.for(src.context, doc.context).copy(fonts.lookup(fonts.keys()[0])));
}
function addOcrText(page, view, R, segs, fontRef) {
  const P = window.PDFLib, key = page.node.newFontDictionary('OCR', fontRef);
  const c = Math.round(Math.cos(R * Math.PI / 180)), sn = Math.round(Math.sin(R * Math.PI / 180));
  const ops = [P.pushGraphicsState(), P.beginText(), P.setTextRenderingMode(P.TextRenderingMode.Invisible)];
  for (const g of segs) {
    if (!g.text || g.w <= 0 || g.size <= 0) continue;
    let hex = ''; for (let i = 0; i < g.text.length; i++) hex += g.text.charCodeAt(i).toString(16).padStart(4, '0');
    const [ux, uy] = displayToUser(view, R, g.x, g.base);
    ops.push(P.setFontAndSize(key, g.size), P.setTextMatrix(c, sn, -sn, c, ux, uy),
      P.setCharacterSqueeze(100 * g.w / (g.text.length * .5 * g.size)), P.showText(P.PDFHexString.of(hex)));
  }
  ops.push(P.endText(), P.popGraphicsState());
  page.pushOperators(...ops);
}
/* Text of one page with the box (PDF user space) of every character: { text, boxes, ocr }. boxes[i] is null for the
   spaces and line breaks put between runs. Pages without a text layer are read with OCR when opts.ocr is set. */
async function pageChars(pg, opts = {}) {
  const { text, map, items } = await pageTextMap(pg);
  if (text.trim() || !opts.ocr) {
    const per = new Map();
    const boxes = map.map(at => {
      if (!at) return null;
      if (!per.has(at[0])) per.set(at[0], itemCharBoxes(items[at[0]]));
      return per.get(at[0])[at[1]] || null;
    });
    return { text, boxes, ocr: false };
  }
  return ocrPage(pg, opts.rotation == null ? normRot(pg.rotate) : opts.rotation, opts);
}
/* Boxes covering characters i0..i1-1, one per line: a run of boxes breaks at a line break, or where the next
   character is not on the same line as the run (text items can jump around the page). */
function spanBoxes(text, boxes, i0, i1, pad = 0) {
  const ov = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
  const sameRow = (p, q) => {
    const h = Math.min(p[3] - p[1], q[3] - q[1]), w = Math.min(p[2] - p[0], q[2] - q[0]);
    return (ov(p[1], p[3], q[1], q[3]) > h * .5 && ov(p[0], p[2], q[0], q[2]) > -h * 3)
      || (ov(p[0], p[2], q[0], q[2]) > w * .5 && ov(p[1], p[3], q[1], q[3]) > -w * 3); // text running up or down the page
  };
  const out = []; let cur = null;
  for (let i = i0; i < i1; i++) {
    const b = boxes[i];
    if (!b) { if (text[i] === '\n') cur = null; continue; }
    if (cur && sameRow(cur, b)) { cur[0] = Math.min(cur[0], b[0]); cur[1] = Math.min(cur[1], b[1]); cur[2] = Math.max(cur[2], b[2]); cur[3] = Math.max(cur[3], b[3]); }
    else { cur = b.slice(); out.push(cur); }
  }
  return pad ? out.map(b => [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad]) : out;
}
/* Make OCR text read like the page: no spaces between Chinese characters, none before Chinese punctuation. */
const tidyOcr = s => s.replace(/([⺀-鿿　-〿＀-￯]) +(?=[⺀-鿿　-〿＀-￯])/g, '$1');

/* ================= 文字辨識 tab =================
   A PDF (or photos, which become A4 pages first) goes in; out comes the same PDF with an invisible text layer on the
   pages that had none (the pages themselves are untouched, so nothing gets blurrier or bigger than the text), or the
   text as a .txt file. */
const ocrTab = { name: '', pj: null, size: 0, n: 0, hasText: [] };
async function loadOcr(files) {
  let f = files[0];
  if (!f) return;
  if (!isPdf(f)) {
    const imgs = await prepImages(files.filter(isImage));
    if (!imgs.length) { toast(`「${f.name}」不是 PDF 或圖片`, 'err'); return; }
    try { f = await imagesToPdf(imgs, imgs[0].name.replace(/\.[^.]+$/, '') + '.pdf'); }
    catch (e) { toast('圖片無法讀取，可能已損壞。', 'err'); return; }
  }
  const got = await readPdf(f); if (!got) return; // a password-protected file is unlocked here first
  const { bytes, owned } = got, size = bytes.length;
  let pj;
  try { pj = await openPdfjs(bytes, owned); } catch (e) { toast(loadErr(f.name, e), 'err'); return; }
  if (ocrTab.pj) ocrTab.pj.destroy();
  Object.assign(ocrTab, { name: f.name, pj, size, n: pj.numPages, hasText: [] });
  $('#ocr-fname').textContent = f.name;
  $('#ocr-fmeta').textContent = `${pj.numPages} 頁 · ${fmtSize(size)} · 檢查文字中…`;
  $('#ocr-name').value = baseName(f.name) + '-可搜尋.pdf';
  $('#ocr-empty').hidden = true; $('#ocr-work').hidden = false; $('#ocr-progress').hidden = true;
  updateOcrSummary();
  for (let i = 0; i < pj.numPages; i++) {
    if (ocrTab.pj !== pj) return;
    try {
      const pg = await pj.getPage(i + 1), tc = await pg.getTextContent();
      ocrTab.hasText[i] = tc.items.some(it => it.str && it.str.trim());
    } catch (e) { ocrTab.hasText[i] = false; }
  }
  const scans = ocrTab.hasText.filter(t => !t).length;
  $('#ocr-fmeta').textContent = `${pj.numPages} 頁 · ${fmtSize(size)} · ` +
    (!scans ? '每一頁都已經有文字' : scans === pj.numPages ? '全部是掃描的圖片（沒有文字）' : `${scans} 頁沒有文字`);
  updateOcrSummary();
}
function ocrTargets() {
  const all = $('#ocr-scope').value === 'all';
  return Array.from({ length: ocrTab.n }, (_, i) => i).filter(i => all || ocrTab.hasText[i] === false);
}
function updateOcrSummary() {
  const txt = $('#ocr-out').value === 'txt', checking = ocrTab.hasText.length < ocrTab.n, k = ocrTargets().length;
  const nameEl = $('#ocr-name');
  if (txt && /\.pdf$/i.test(nameEl.value)) nameEl.value = nameEl.value.replace(/(-可搜尋)?\.pdf$/i, '.txt');
  if (!txt && /\.txt$/i.test(nameEl.value)) nameEl.value = nameEl.value.replace(/\.txt$/i, '-可搜尋.pdf');
  $('#ocr-summary').textContent = checking ? '檢查哪些頁面需要辨識…'
    : !k ? (txt ? `${ocrTab.n} 頁都有文字，直接抽出` : '每一頁都已經有文字，可以直接搜尋')
    : `要辨識 ${k} 頁，每頁約 5–20 秒`;
  $('#ocr-go').disabled = checking || (!txt && !k);
  $('#ocr-go').textContent = txt ? '辨識並抽出文字' : '辨識文字';
}
['#ocr-out', '#ocr-scope', '#ocr-lang'].forEach(s => $(s).addEventListener('change', updateOcrSummary));
function ocrProgress(k, n, msg) {
  $('#ocr-progress').hidden = false;
  const part = msg && msg.status === 'recognizing text' ? msg.progress || 0 : 0;
  $('#ocr-bar').style.width = ((k + part) / Math.max(1, n) * 100) + '%';
  $('#ocr-plabel').textContent = k < n ? `第 ${k + 1} / ${n} 頁 · ${ocrProgressText(msg)}` : `完成 ${n} 頁`;
}
$('#ocr-go').addEventListener('click', e => {
  const txt = $('#ocr-out').value === 'txt', langs = $('#ocr-lang').value, pj = ocrTab.pj;
  const targets = new Set(ocrTargets());
  runJob(e.currentTarget, '辨識中…', async check => {
    const lib = txt ? null : await PDFDocument.load(await pj.getData(), { updateMetadata: false });
    const parts = []; let k = 0, found = 0, fontRef = null;
    ocrProgress(0, targets.size);
    for (let i = 0; i < ocrTab.n; i++) {
      check();
      const pg = await pj.getPage(i + 1);
      let text = '';
      if (targets.has(i)) {
        const R = normRot(pg.rotate);
        // Tesseract writes a PDF page only until its invisible font has been taken from one.
        const res = await ocrPage(pg, R, { langs, pdf: !txt && !fontRef, onProgress: m => ocrProgress(k, targets.size, m) });
        check();
        text = tidyOcr(res.text);
        if (text.trim()) found++;
        if (lib && res.segs.length) {
          if (!fontRef && res.pdf) fontRef = await ocrFontInto(lib, res.pdf);
          if (fontRef) addOcrText(lib.getPage(i), pg.view, R, res.segs, fontRef);
        }
        ocrProgress(++k, targets.size);
      } else if (txt) {
        text = runsToText((await pg.getTextContent()).items, pg.getViewport({ scale: 1 }));
        pg.cleanup();
      }
      if (txt) parts.push(ocrTab.n > 1 ? `──── 第 ${i + 1} 頁 ────\n\n${text || '（這一頁辨識不出文字）'}` : text);
    }
    if (targets.size && !found) { toast('辨識不出任何文字。照片太模糊、太暗，或字太小時會這樣；可以先用「圖片轉 PDF」的校正功能拉正、調亮再試。', 'err'); return; }
    if (txt) {
      const name = $('#ocr-name').value.trim().replace(/\.txt$/i, '') + '.txt';
      await deliver(new File(['﻿' + parts.join('\n\n\n')], name, { type: 'text/plain;charset=utf-8' }), 'text', 'ocr');
    } else {
      const bytes = await lib.save({ useObjectStreams: true });
      await deliver(pdfFile(bytes, $('#ocr-name').value), 'pdf', 'ocr');
      toast(`已辨識 ${found} 頁，文字可以搜尋、選取和複製`);
    }
  }).catch(err => toast('辨識失敗：' + err.message, 'err'));
});
bindInput($('#ocr-input'), loadOcr);
acceptFiles($('#panel-ocr'), $('#ocr-drop'), loadOcr);
$('#ocr-change').addEventListener('click', () => $('#ocr-input').click());
registerTarget('pdf', 'ocr', '文字辨識', loadOcr);
registerTarget('image', 'ocr', '文字辨識', loadOcr);
registerHolder('ocr', () => ocrTab.pj ? ocrTab.size : 0, () => {
  ocrTab.pj.destroy(); Object.assign(ocrTab, { name: '', pj: null, size: 0, n: 0, hasText: [] });
  $('#ocr-empty').hidden = false; $('#ocr-work').hidden = true;
});
/* A made-up page of meeting minutes, drawn as a slightly crooked, slightly grey scan: there is no text layer, only a picture. */
$('#ocr-sample').addEventListener('click', async e => {
  await busy(e.currentTarget, '產生中…', async () => {
    const W = 1240, H = 1754, cv = document.createElement('canvas'); cv.width = W; cv.height = H; // A4 at 150 dpi
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#f3f1ec'; ctx.fillRect(0, 0, W, H);
    const lines = [
      [46, '社區管理委員會　會議紀錄'], [0, ''],
      [28, '時間：2026 年 11 月 3 日（星期二）晚上 7 點'], [28, '地點：社區活動中心 2 樓'],
      [28, '出席：主任委員王大明、財務委員陳美玲等 9 人'], [0, ''],
      [28, '一、上月收支：管理費收入 486,500 元，支出 412,300 元。'], [28, '二、電梯保養合約明年到期，請三家廠商報價後再議。'],
      [28, '三、停車場照明換成 LED 燈，預算 38,000 元，全數通過。'], [28, '四、垃圾分類問題，將在公布欄張貼宣導海報。'], [0, ''],
      [28, '聯絡電話：02-2345-6789　Email：office@example.com'], [28, 'Next meeting: December 1, 2026']
    ];
    await ensureFont(lines.map(l => l[1]).join(''), 28);
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(.006); ctx.translate(-W / 2, -H / 2);
    ctx.fillStyle = '#23262b'; ctx.textBaseline = 'alphabetic';
    let y = 190;
    for (const [size, t] of lines) {
      if (!size) { y += 26; continue; }
      ctx.font = (size > 30 ? '700 ' : '400 ') + fontStr(size).replace(/^\d+ /, '');
      ctx.fillText(t, 120, y); y += size * 2.1;
    }
    ctx.restore();
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    for (let p = 0; p < d.length; p += 4) { const n = (Math.random() - .5) * 18; d[p] += n; d[p + 1] += n; d[p + 2] += n; }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .85)); cv.width = cv.height = 0;
    await loadOcr([await imagesToPdf([new File([blob], '範例掃描檔.jpg', { type: 'image/jpeg' })], '範例掃描檔.pdf')]);
  });
});
