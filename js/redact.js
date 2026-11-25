'use strict';
/* ================= REDACT (entry point; boxes are drawn in the page editor, flattening happens on export) ================= */
async function startRedacting(files) {
  if (editBusy()) return; // redacting replaces the editor's files
  await loadEditFiles(files, p => {
    showTab('edit'); try { history.replaceState(null, '', '#edit'); } catch (e) {}
    openTextEditor(p, 'redact');
  }, null, true);
}
bindInput($('#redact-input'), startRedacting);
acceptFiles($('#redact-drop'), $('#redact-drop'), startRedacting);
registerTarget('pdf', 'redact', '遮蔽', startRedacting);
$('#redact-sample').addEventListener('click', async () => {
  // A made-up application form, so there is something obviously private to cover.
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold), font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595.28, 841.89]);
  p.drawRectangle({ x: 0, y: 770, width: 595.28, height: 72, color: rgb(.04, .48, .42) });
  p.drawText('Account Application (sample)', { x: 50, y: 795, size: 22, font: bold, color: rgb(1, 1, 1) });
  const rows = [['Full name', 'Lin Ya-Ting'], ['ID number', 'A123456789'], ['Date of birth', '1990-04-12'], ['Phone', '0912-345-678'],
    ['Address', 'No. 10, Example Rd., Taipei'], ['Bank account', '012-3456-7890-12']];
  rows.forEach(([k, v], i) => {
    const y = 700 - i * 44;
    p.drawText(k, { x: 50, y, size: 12, font, color: rgb(.4, .45, .5) });
    p.drawText(v, { x: 200, y, size: 15, font: bold, color: rgb(.1, .13, .17) });
    p.drawLine({ start: { x: 50, y: y - 12 }, end: { x: 545, y: y - 12 }, thickness: .6, color: rgb(.85, .87, .9) });
  });
  p.drawText('Signature: ______________________', { x: 50, y: 360, size: 12, font, color: rgb(.4, .45, .5) });
  startRedacting([pdfFile(await doc.save(), 'application-form.pdf')]);
});

/* ---------- find and redact ----------
   Searches the text layer of the pages (pdf.js) for ID numbers, phone numbers, e-mail addresses and the user's own
   words, and adds a redaction box over each hit. Scanned pages have no text layer; with 「OCR」 ticked their words
   are read from the picture first (js/ocr.js). */
const RF_PATTERNS = {
  id: { label: '身分證', re: /(?<![A-Za-z0-9])[A-Z](?:[1289]|[A-D])\d{8}(?!\d)/g },
  mobile: { label: '手機', re: /(?<!\d)(?:\+?886[-\s]?|0)9\d{2}[-\s]?\d{3}[-\s]?\d{3}(?!\d)/g },
  // 7–8 digit numbers (02-2345-6789), and the 5–6 digit ones of 苗栗 037, 台東 089, 金門 082, 馬祖 0836 (037-559999)
  phone: { label: '市話', re: /(?<!\d)(?:(?:\(0\d{1,2}\)\s?|0\d{1,2}[-\s])\d{3,4}[-\s]?\d{4}|(?:\(0[2-8]\d{1,2}\)\s?|0[2-8]\d{1,2}[-\s])\d{5,6})(?:\s?(?:#|轉|ext\.?)\s?\d{1,5})?(?!\d)/g },
  email: { label: 'Email', re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  card: { label: '卡號', re: /(?<!\d)(?:\d{4}[-\s]?){3}\d{4}(?!\d)/g },
  birth: { label: '日期', re: /(?<!\d)(?:(?:19|20)\d{2}|\d{2,3})\s?[/\-.年]\s?\d{1,2}\s?[/\-.月]\s?\d{1,2}日?(?!\d)/g }
};
/* Page text as one string, plus where each character came from (item, position in it). Items on different lines
   are joined by a line break and items with a gap between them by a space, so patterns do not run together. */
async function pageTextMap(pg, read) { // read: the page's text content, when already asked for
  const tc = await (read || pg.getTextContent());
  let text = ''; const map = []; let prev = null;
  tc.items.forEach((it, k) => {
    if (typeof it.str !== 'string' || !it.str) { if (it.hasEOL && prev) { text += '\n'; map.push(null); prev = null; } return; }
    if (prev) {
      // Measured in the text's own direction (sideways text runs up or down the page).
      const fh = Math.hypot(it.transform[2], it.transform[3]) || 10;
      const a = textAxes(it.transform, it.transform), b = textAxes(prev.transform, it.transform);
      const dy = Math.abs(a.y - b.y), gap = a.x - (b.x + prev.width);
      if (dy > fh * .5) { text += '\n'; map.push(null); }
      else if (gap > fh * .15) { text += ' '; map.push(null); }
    }
    // fixCjk() keeps every character one character, so the whole run at once gives what each character alone does.
    text += fixCjk(it.str);
    for (let i = 0; i < it.str.length; i++) map.push([k, i]);
    if (it.hasEOL) { text += '\n'; map.push(null); prev = null; } else prev = it;
  });
  return { text, map, items: tc.items };
}
/* A character's width in a generic 10px font, measured once: every page repeats the same few hundred characters,
   and measuring each one again made reading a 1000-page file for 比較 or 自動尋找 take seconds. */
const charWidths = new Map();
function charWidth(ch) {
  let w = charWidths.get(ch);
  if (w === undefined) { mctx.font = '10px sans-serif'; charWidths.set(ch, w = mctx.measureText(ch).width); }
  return w;
}
/* Box (PDF user space) around each character of one text item, as [x0, y0, x1, y1] at 4 × i in a Float32Array,
   indexed like it.str. Character widths are estimated with a generic font and scaled to the item's real width, so a
   wide Chinese character gets more room than a digit. */
function itemCharBoxes(it) {
  const [a, b, c, d, e, f] = it.transform, n = Math.hypot(a, b) || 1, fh = Math.hypot(c, d) || n;
  const s = it.str, len = s.length, ws = new Float64Array(len);
  let total = 0;
  for (let i = 0; i < len; i++) total += ws[i] = charWidth(s[i]);
  total = total || 1;
  const k = (it.width || total) / total, ux = a / n, uy = b / n, vx = -uy, vy = ux, pad = 1.5;
  // The corners are every pairing of two places along the text (t) and two across it (lo, hi): x and y each add a
  // term of one and a term of the other, so their smallest and largest come from the smaller and larger of each.
  const lo = -.28 * fh, hi = .98 * fh;
  const sx0 = Math.min(vx * lo, vx * hi), sx1 = Math.max(vx * lo, vx * hi), sy0 = Math.min(vy * lo, vy * hi), sy1 = Math.max(vy * lo, vy * hi);
  const out = new Float32Array(len * 4); let t0 = 0;
  for (let i = 0; i < len; i++) {
    const t1 = t0 + ws[i] * k, ta = t0 - pad, tb = t1 + pad;
    out[i * 4] = e + Math.min(ux * ta, ux * tb) + sx0; out[i * 4 + 1] = f + Math.min(uy * ta, uy * tb) + sy0;
    out[i * 4 + 2] = e + Math.max(ux * ta, ux * tb) + sx1; out[i * 4 + 3] = f + Math.max(uy * ta, uy * tb) + sy1;
    t0 = t1;
  }
  return out;
}
function rfPatterns() {
  const list = [];
  document.querySelectorAll('[data-rf]').forEach(cb => { if (cb.checked) list.push({ key: cb.dataset.rf, ...RF_PATTERNS[cb.dataset.rf] }); });
  const words = $('#rf-words').value.split(/[,，、;；\n]+/).map(w => w.trim()).filter(Boolean);
  if (words.length) {
    // spaces may be slipped between characters in a PDF's text, so allow them anywhere inside a word
    const esc = w => [...w.replace(/\s+/g, '')].map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
    list.push({ key: 'word', label: '關鍵字', re: new RegExp(words.map(esc).join('|'), 'gi') });
  }
  return list;
}
/* What was typed into a filled-in form is not part of the page's text: the values of its fields, one per line, every
   character boxed by its whole field, so a match covers the field (pageChars()'s { text, boxes } shape). */
async function formFieldChars(pg) {
  let annots = []; try { annots = await pg.getAnnotations({ intent: 'display' }); } catch (e) {}
  let text = ''; const list = [];
  for (const a of annots) {
    if (a.subtype !== 'Widget' || a.hidden || a.checkBox || a.radioButton || !a.rect) continue;
    let v = Array.isArray(a.fieldValue) ? a.fieldValue.join('\n') : a.fieldValue;
    const opt = (a.options || []).find(o => o.exportValue === v); if (opt) v = opt.displayValue; // a list shows its text
    if (typeof v !== 'string' || !v.trim()) continue;
    const r = a.rect, box = [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
    if (text) { text += '\n'; list.push(null); }
    for (let i = 0; i < v.length; i++) { text += v[i]; list.push(v[i] === '\n' ? null : box); }
  }
  return { text, boxes: packBoxes(list) };
}
const boxOverlap = (p, q) => {
  const w = Math.min(p[2], q[2]) - Math.max(p[0], q[0]), h = Math.min(p[3], q[3]) - Math.max(p[1], q[1]);
  return w > 0 && h > 0 ? (w * h) / Math.min((p[2] - p[0]) * (p[3] - p[1]), (q[2] - q[0]) * (q[3] - q[1])) : 0;
};
$('#rf-go').addEventListener('click', e => {
  const pats = rfPatterns();
  if (!pats.length) { toast('勾選要找的項目，或輸入關鍵字'); return; }
  const targets = $('#rf-scope').value === 'page' ? [te.page] : edit.pages.filter(fillMeta);
  const out = $('#rf-result'), useOcr = $('#rf-ocr').checked;
  runJob(e.currentTarget, '尋找中…', async check => {
    // Boxes are put on the pages only once every page has been searched: closing the editor cancels the search
    // (finishEditor), and a search cut short must not leave boxes behind outside the editor's undo step.
    const counts = {}, adds = []; let hits = 0, anyText = false, ocrPages = 0;
    const pageOf = p => edit.docs[p.docId].pj.getPage(p.index + 1), rotOf = p => (p.baseRot + p.rot) % 360;
    // Kept with the page: reading a scanned page again would take as long as the first time.
    const toRead = p => { const c = edit.meta[metaKey(p)].chars; return !c || (useOcr && !c.ocr && !c.text.trim()) || (c.ocr && c.R !== rotOf(p)); };
    const ahead = readAhead(targets.length, n => toRead(targets[n]) ? pageOf(targets[n]).then(pg => pg.getTextContent()) : null); // see core.js
    for (let n = 0; n < targets.length; n++) {
      check();
      const p = targets[n], m = edit.meta[metaKey(p)], R = rotOf(p);
      const page = () => pageOf(p);
      if (toRead(p)) {
        m.chars = await pageChars(await page(), { ocr: useOcr, rotation: R, text: ahead(n), onProgress: msg => {
          out.hidden = false; out.textContent = `第 ${n + 1} / ${targets.length} 頁是掃描的圖片，正在辨識文字（OCR）：${ocrProgressText(msg)}`;
        } });
        m.chars.R = R;
      }
      if (!m.fields) m.fields = await formFieldChars(await page());
      if (m.chars.text.trim() || m.fields.text.trim()) anyText = true;
      if (m.chars.ocr) ocrPages++;
      const boxes = [];
      for (const { text, boxes: chars, ocr } of [m.chars, m.fields]) for (const pat of pats) {
        pat.re.lastIndex = 0;
        for (let mt; (mt = pat.re.exec(text));) {
          if (!mt[0]) { pat.re.lastIndex++; continue; }
          const bs = spanBoxes(text, chars, mt.index, mt.index + mt[0].length, ocr ? 2 : 0); // one box per line of the match
          if (!bs.length) continue;
          boxes.push(...bs);
          counts[pat.label] = (counts[pat.label] || 0) + 1; hits++;
        }
      }
      if (boxes.length) adds.push([p, boxes]);
    }
    check();
    let pagesHit = 0;
    for (const [p, boxes] of adds) {
      let added = 0;
      for (const bx of boxes) {
        if (p.annots.some(a => a.type === 'redact' && boxOverlap(annotUserBox(a, p.view), bx) > .8)) continue; // already covered
        p.annots.push({ id: uid(), type: 'redact', ux: bx[0], uy: bx[1], wPt: bx[2] - bx[0], hPt: bx[3] - bx[1], rot: 0 });
        added++;
      }
      if (added) pagesHit++;
    }
    if (te.page) renderAnnots();
    out.hidden = false;
    const ocrNote = ocrPages ? `其中 ${ocrPages} 頁是用 OCR 辨識的，可能漏掉模糊或手寫的字，請特別仔細檢查。` : '';
    if (!anyText) {
      out.textContent = useOcr ? '頁面上辨識不出文字，請直接在頁面上框選。' : '這份檔案沒有可搜尋的文字（可能是掃描檔或照片）。勾選「掃描的頁面用 OCR 辨識文字」再找一次，或直接在頁面上框選。';
      return;
    }
    if (!hits) { out.textContent = '沒有找到符合的內容。' + ocrNote; return; }
    out.textContent = `找到 ${hits} 處（${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join('、')}），已在 ${pagesHit} 頁加上遮蔽框。匯出前請逐頁確認。` + ocrNote;
    toast(`已加上遮蔽框：${hits} 處`);
  }).catch(err => toast('尋找失敗：' + err.message, 'err'));
});
