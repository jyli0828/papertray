'use strict';
/* ================= FILL FORM =================
   Pages are drawn by pdf.js without their form fields, and each field gets an HTML input placed over it.
   On export pdf-lib writes the values into the real fields. Text that the standard PDF font cannot show
   (Chinese and most non-Latin text) gets its own appearance: a sharp picture of the text, so every viewer shows it.
   「壓平」 turns the filled fields into fixed page content. */
const ff = { name: '', pj: null, fields: [], vals: new Map(), size: 0, urls: [] };
function releaseFormPages() { ff.urls.forEach(u => URL.revokeObjectURL(u)); ff.urls = []; }
const ffSlot = pdfSlot('form', 'ff', ff, { // see pdfSlot() in core.js
  blank: () => ({ name: '', pj: null, fields: [], vals: new Map(), size: 0 }),
  leave() { releaseFormPages(); const box = $('#ff-pages'); forgetCards(box); box.innerHTML = ''; },
});

async function loadForm(files) {
  const o = await ffSlot.open(files[0]); if (!o || !await ffSlot.take(o, null)) return;
  const { pj, f } = o, gone = () => !ffSlot.isCurrent(pj); // another file was opened, or the memory released
  $('#ff-name').value = baseName(f.name) + '-已填.pdf';
  const box = $('#ff-pages');
  if (pj.isPureXfa) {
    $('#ff-fmeta').textContent = `${pj.numPages} 頁`;
    $('#ff-none').hidden = false; $('#ff-none-text').textContent = '這是 XFA 動態表單，瀏覽器裡無法填寫，請改用 Adobe Acrobat Reader。';
    $('#ff-go').disabled = true; return;
  }
  const maxW = Math.min(900, box.clientWidth || 900), dpr = Math.min(window.devicePixelRatio || 1, 2);
  let unreadable = 0;
  for (let i = 1; i <= pj.numPages; i++) {
    let pg;
    try { pg = await pj.getPage(i); } catch (e) { if (gone()) return; unreadable++; continue; } // a broken page: show the rest
    if (gone()) return;
    const vp1 = pg.getViewport({ scale: 1 });
    const pageEl = document.createElement('div'); pageEl.className = 'ff-page';
    pageEl.style.aspectRatio = `${vp1.width} / ${vp1.height}`; pageEl.style.maxWidth = maxW + 'px';
    pageEl.innerHTML = `<span class="ff-pno mono">${i} / ${pj.numPages}</span>`;
    box.append(pageEl);
    let annots = [];
    try { annots = await pg.getAnnotations({ intent: 'display' }); } catch (e) {}
    for (const a of annots) {
      if (a.subtype !== 'Widget' || !a.fieldName || a.pushButton || a.fieldType === 'Sig' || a.hidden) continue;
      const [x1, y1, x2, y2] = vp1.convertToViewportRectangle(a.rect);
      const r = { l: Math.min(x1, x2) / vp1.width, t: Math.min(y1, y2) / vp1.height, w: Math.abs(x2 - x1) / vp1.width, h: Math.abs(y2 - y1) / vp1.height };
      const fld = { a, page: i, r, wPt: Math.abs(x2 - x1), hPt: Math.abs(y2 - y1) };
      ff.fields.push(fld);
      // A check box group (「□男 □女」: one field, a box per choice) is on when any of its boxes is.
      if (!ff.vals.has(a.fieldName) || (a.checkBox && initialValue(a))) ff.vals.set(a.fieldName, initialValue(a));
      pageEl.append(fieldInput(fld, vp1.width));
    }
    // Each page becomes a JPEG picture, like the thumbnails: a canvas kept on screen holds every pixel (an A4 page on
    // a high-resolution screen is about 18 MB), the picture a few hundred KB, and the browser decodes it only while shown.
    whenVisible(pageEl, async () => {
      const p = await pj.getPage(i); if (gone()) return;
      const vp = p.getViewport({ scale: maxW * dpr / vp1.width });
      const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      // ENABLE_FORMS: everything except the form fields, which are the inputs on top
      await p.render({ canvasContext: ctx, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS }).promise;
      p.cleanup();
      const blob = await canvasBlob(cv, 'image/jpeg', .9); cv.width = cv.height = 0;
      if (gone() || !blob) return;
      const img = document.createElement('img'); img.alt = ''; img.draggable = false;
      img.src = URL.createObjectURL(blob); ff.urls.push(img.src);
      pageEl.prepend(img);
    });
  }
  const names = new Set(ff.fields.map(x => x.a.fieldName));
  $('#ff-fmeta').textContent = `${pj.numPages} 頁 · ${names.size} 個欄位`;
  $('#ff-none').hidden = names.size > 0;
  $('#ff-none-text').textContent = '這份 PDF 沒有可填寫的欄位。要在任何位置加上文字或打勾，請改用「編輯」分頁的文字工具。';
  $('#ff-go').disabled = !names.size;
  if (unreadable) toast(`「${f.name}」有 ${unreadable} 頁無法讀取，檔案可能已損壞；其他頁面可以照常填寫。`, 'err');
  const first = box.querySelector('.ff-field'); if (first) first.focus({ preventScroll: true });
}
/* A check box's value is the name of its "on" state (null when off), not true / false: several boxes can share one
   field, each with its own on state (「□男 □女」 as boxes named M and F), and ticking one must tick that one only. Boxes
   with the same on state are copies of one box and go on and off together. */
const boxOn = a => a.exportValue || 'Yes';
function initialValue(a) {
  if (a.checkBox) return a.fieldValue != null && a.fieldValue !== 'Off' && (!a.exportValue || a.fieldValue === a.exportValue) ? boxOn(a) : null;
  if (a.radioButton) return a.fieldValue && a.fieldValue !== 'Off' ? a.fieldValue : null;
  if (a.fieldType === 'Ch') {
    const v = Array.isArray(a.fieldValue) ? a.fieldValue[0] : a.fieldValue;
    const o = (a.options || []).find(o => o.exportValue === v || o.displayValue === v);
    return o ? o.displayValue : (v || '');
  }
  return typeof a.fieldValue === 'string' ? a.fieldValue : '';
}
/* The field's font size from its own settings, or one that fits its height (0 in a PDF means "auto"). */
function fieldFontPt(fld) {
  const da = fld.a.defaultAppearanceData; const s = da && da.fontSize;
  if (s > 0) return Math.min(s, fld.hPt * .8);
  return fld.a.multiLine ? 10 : Math.max(6, Math.min(12, fld.hPt * .6));
}
function fieldInput(fld, pageW) {
  const a = fld.a, name = a.fieldName;
  let el;
  if (a.checkBox || a.radioButton) {
    el = document.createElement('input'); el.type = a.checkBox ? 'checkbox' : 'radio';
    if (a.radioButton) { el.name = 'ff-' + name; el.value = a.buttonValue; el.checked = ff.vals.get(name) === a.buttonValue; }
    else { el.value = boxOn(a); el.checked = ff.vals.get(name) === el.value; }
  } else if (a.fieldType === 'Ch') {
    el = document.createElement('select');
    if (a.combo) el.append(new Option('', ''));
    for (const o of a.options || []) el.append(new Option(o.displayValue, o.displayValue));
    if (!a.combo) el.size = Math.max(2, Math.min(6, (a.options || []).length));
    el.value = ff.vals.get(name) || '';
  } else {
    el = document.createElement(a.multiLine ? 'textarea' : 'input');
    if (!a.multiLine) el.type = 'text';
    if (a.maxLen) el.maxLength = a.maxLen;
    el.value = ff.vals.get(name) || ''; el.spellcheck = false;
    el.style.textAlign = ['left', 'center', 'right'][a.textAlignment] || 'left';
  }
  el.className = 'ff-field' + (a.checkBox || a.radioButton ? ' is-check' : '');
  el.dataset.name = name; el.title = a.alternativeText || name;
  el.setAttribute('aria-label', a.alternativeText || name);
  if (a.readOnly) el.disabled = true;
  Object.assign(el.style, { left: fld.r.l * 100 + '%', top: fld.r.t * 100 + '%', width: fld.r.w * 100 + '%', height: fld.r.h * 100 + '%',
    fontSize: (fieldFontPt(fld) / pageW * 100) + 'cqw' }); // font scales with the page (the page box is a size container)
  return el;
}
/* Keep every copy of a field (the same field shown on several pages) in step. */
$('#ff-pages').addEventListener('input', e => {
  const el = e.target.closest('.ff-field'); if (!el) return;
  const name = el.dataset.name;
  const v = el.type === 'checkbox' ? (el.checked ? el.value : null) : el.type === 'radio' ? (el.checked ? el.value : ff.vals.get(name)) : el.value;
  ff.vals.set(name, v);
  document.querySelectorAll('#ff-pages .ff-field').forEach(o => {
    if (o === el || o.dataset.name !== name) return;
    if (o.type === 'checkbox' || o.type === 'radio') o.checked = o.value === v; else o.value = v;
  });
});
/* A radio button that is already chosen can be clicked again to clear the choice. */
$('#ff-pages').addEventListener('click', e => {
  const el = e.target; if (!el.classList || !el.classList.contains('ff-field') || el.type !== 'radio') return;
  const name = el.dataset.name;
  if (el._was) { el.checked = false; ff.vals.set(name, null); }
  else ff.vals.set(name, el.value);
  document.querySelectorAll(`#ff-pages .ff-field[type="radio"]`).forEach(o => { if (o.dataset.name === name) { o.checked = o.value === ff.vals.get(name); o._was = o.checked; } });
});
$('#ff-pages').addEventListener('pointerdown', e => { const el = e.target; if (el.type === 'radio') el._was = el.checked; });

$('#ff-reset').addEventListener('click', () => {
  for (const fld of ff.fields) {
    const a = fld.a;
    ff.vals.set(a.fieldName, a.checkBox || a.radioButton ? null : '');
  }
  document.querySelectorAll('#ff-pages .ff-field').forEach(o => { if (o.type === 'checkbox' || o.type === 'radio') o.checked = false; else o.value = ''; });
  toast('已清除所有欄位');
});

/* ---------- export ---------- */
/* A picture (canvas) of the text that fits the field box (w × h points), wrapped onto lines for multi-line fields. */
async function renderFieldPicture(text, w, h, size, multi, align) {
  await ensureFont(text, size);
  const k = 4, c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * k)); c.height = Math.max(1, Math.ceil(h * k));
  const ctx = c.getContext('2d'); ctx.scale(k, k);
  const pad = 2;
  let s = size;
  ctx.font = fontStr(s);
  if (!multi) while (s > 4 && ctx.measureText(text).width > w - pad * 2) { s -= .5; ctx.font = fontStr(s); } // shrink to fit
  const lines = [];
  if (multi) {
    for (const para of text.split('\n')) {
      let line = '';
      for (const ch of para) {
        if (line && ctx.measureText(line + ch).width > w - pad * 2) { lines.push(line); line = ch; } else line += ch;
      }
      lines.push(line);
    }
  } else lines.push(text.replace(/\n/g, ' '));
  ctx.fillStyle = '#000'; ctx.textBaseline = 'middle';
  ctx.textAlign = ['left', 'center', 'right'][align] || 'left';
  const x = align === 1 ? w / 2 : align === 2 ? w - pad : pad;
  lines.forEach((ln, i) => ctx.fillText(ln, x, multi ? pad + (i + .5) * s * LH : h / 2));
  return c;
}
/* Draw the field's new value. "Auto" font size (0) is first replaced by a fixed one: pdf-lib's automatic size
   blows short text in a tall box up to 40 pt or more. Text the standard font cannot show gets a picture instead. */
async function writeAppearance(doc, field, helv, text) {
  const af = field.acroField, da0 = (af.getDefaultAppearance && af.getDefaultAppearance()) || '';
  const m = da0.match(/([\d.]+)\s+Tf/), multi = !!(field.isMultiline && field.isMultiline());
  if (!(m && +m[1] > 0) && field.setFontSize) {
    const w = af.getWidgets()[0], h = w ? w.getRectangle().height : 20;
    try { field.setFontSize(Math.round(multi ? 10 : Math.max(6, Math.min(12, h * .6)))); } catch (e) {}
  }
  const da1 = af.getDefaultAppearance && af.getDefaultAppearance();
  try { field.defaultUpdateAppearances(helv); }
  catch (err) {
    if (da1 && af.setDefaultAppearance) af.setDefaultAppearance(da1); // undo whatever the failed attempt changed
    await pictureAppearance(doc, field, text);
  }
}
async function pictureAppearance(doc, field, text) {
  const L = window.PDFLib;
  const da = (field.acroField.getDefaultAppearance && field.acroField.getDefaultAppearance()) || '';
  const m = da.match(/([\d.]+)\s+Tf/); const daSize = m ? +m[1] : 0;
  let align = 0; try { align = field.getAlignment ? field.getAlignment() : 0; } catch (e) {}
  const multi = !!(field.isMultiline && field.isMultiline());
  for (const w of field.acroField.getWidgets()) {
    const r = w.getRectangle(); if (r.width < 1 || r.height < 1) continue;
    const size = daSize > 0 ? Math.min(daSize, r.height * .8) : multi ? 10 : Math.max(6, Math.min(12, r.height * .6));
    const cv = await renderFieldPicture(text, r.width, r.height, size, multi, align), ink = embedCanvasInk(doc, cv); // see core.js
    const sx = r.width / cv.width, sy = r.height / cv.height; // points per canvas pixel
    cv.width = cv.height = 0;
    const ops = [];
    try { // keep the field's border, which the standard appearance would have drawn
      const mk = w.getAppearanceCharacteristics(), bc = mk && mk.getBorderColor();
      const bs = w.getBorderStyle(), bw = bs ? bs.getWidth() : 1;
      if (bc && bc.length === 3 && bw > 0) ops.push(L.pushGraphicsState(), L.setStrokingRgbColor(...bc), L.setLineWidth(bw),
        L.rectangle(bw / 2, bw / 2, r.width - bw, r.height - bw), L.stroke(), L.popGraphicsState());
    } catch (e) {}
    // Only the part with text is a picture, put where it was in the whole box (canvas rows run top down).
    if (ink) ops.push(...L.drawImage('Im0', { x: ink.x0 * sx, y: r.height - ink.y1 * sy, width: (ink.x1 - ink.x0) * sx, height: (ink.y1 - ink.y0) * sy,
      rotate: L.degrees(0), xSkew: L.degrees(0), ySkew: L.degrees(0) }));
    const stream = doc.context.formXObject(ops, { BBox: [0, 0, r.width, r.height], Resources: ink ? { XObject: { Im0: ink.ref } } : {} });
    w.setNormalAppearance(doc.context.register(stream));
  }
}
/* The export value (as stored in the file) of the option shown as `text`, when it differs from the text; else null. */
function optionExportValue(field, text) {
  for (const { value, display } of field.acroField.getOptions()) {
    if (display && value && display.decodeText() === text && value.decodeText() !== text) return value;
  }
  return null;
}
$('#ff-go').addEventListener('click', e => runJob(e.currentTarget, '產生中…', async check => {
  // The values as they are now (清除 or typing while this runs must not reach only some of the fields).
  const vals = new Map(ff.vals), flatten = $('#ff-flatten').checked, name = ensurePdf($('#ff-name').value);
  await needPdfLib();
  const L = window.PDFLib;
  const doc = await PDFDocument.load(await ff.pj.getData());
  const form = doc.getForm(), helv = await doc.embedFont(StandardFonts.Helvetica);
  const problems = [];
  for (const field of form.getFields()) {
    check();
    const fname = field.getName(); if (!vals.has(fname)) continue;
    const v = vals.get(fname);
    try {
      if (field instanceof L.PDFTextField) {
        field.setText(v ? v : undefined);
        await writeAppearance(doc, field, helv, v || '');
      } else if (field instanceof L.PDFCheckBox) {
        // pdf-lib's check() turns on the first box's state only, so the box ticked is set here (see boxOn()).
        const ws = field.acroField.getWidgets(), onOf = w => { const n = w.getOnValue(); return n ? n.decodeText() : null; };
        const box = v && ws.find(w => onOf(w) === v);
        if (box) {
          const on = box.getOnValue();
          field.acroField.dict.set(PDFName.of('V'), on);
          ws.forEach(w => w.setAppearanceState(w.getOnValue() === on ? on : PDFName.of('Off')));
        } else if (v) field.check(); else field.uncheck();
        field.defaultUpdateAppearances();
      }
      else if (field instanceof L.PDFRadioGroup) {
        // With an /Opt list the buttons' state names are indexes into it ("0", "1"…); pdf-lib selects by the list's text.
        const opts = field.getOptions();
        if (v) field.select(opts.includes(v) ? v : /^\d+$/.test(v) && opts[+v] != null ? opts[+v] : v); else field.clear();
        field.defaultUpdateAppearances();
      }
      else if (field instanceof L.PDFDropdown || field instanceof L.PDFOptionList) {
        if (v) field.select(v); else field.clear();
        // pdf-lib stores the text shown. When the options have export values of their own (shown 「高雄」, stored
        // "KH"), the value is the export value; the field still shows the text, drawn here.
        // (Set directly: pdf-lib refuses a value that is not one of the texts shown.)
        const exp = v && optionExportValue(field, v);
        if (exp) { field.acroField.dict.set(PDFName.of('V'), exp); await pictureAppearance(doc, field, v); }
        else await writeAppearance(doc, field, helv, v || '');
      }
    } catch (err) { problems.push(fname); }
  }
  check();
  if (flatten) {
    try { form.flatten({ updateFieldAppearances: false }); }
    catch (err) { throw new Error('這份表單無法壓平，可以取消「壓平」再試一次'); }
  }
  const bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  if (problems.length) toast(`有 ${problems.length} 個欄位無法寫入：${problems.slice(0, 3).join('、')}${problems.length > 3 ? '…' : ''}`, 'err');
  await deliver(pdfFile(bytes, name), 'pdf', 'form');
}).catch(failToast('匯出失敗')));

bindInput($('#ff-input'), loadForm);
acceptFiles($('#panel-form'), $('#ff-drop'), loadForm);
registerTarget('pdf', 'form', '填表單', loadForm);
bindInput($('#ff-input-2'), loadForm);
$('#ff-to-edit').addEventListener('click', async () => {
  if (!ff.pj) return;
  const bytes = await ff.pj.getData();
  showTab('edit'); try { history.replaceState(null, '', '#edit'); } catch (e) {}
  loadEditFiles([pdfFile(bytes, ff.name)]);
});
onSample($('#ff-sample'), async () => {
  // A made-up application form with every kind of field.
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold), font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595.28, 841.89]), form = doc.getForm();
  const ink = rgb(.1, .13, .17), soft = rgb(.4, .45, .5), line = rgb(.75, .79, .83);
  p.drawRectangle({ x: 0, y: 770, width: 595.28, height: 72, color: rgb(.04, .48, .42) });
  p.drawText('Membership Application (sample)', { x: 50, y: 795, size: 22, font: bold, color: rgb(1, 1, 1) });
  const box = { borderColor: line, borderWidth: 1 };
  const row = (label, y) => p.drawText(label, { x: 50, y: y + 6, size: 12, font, color: soft });
  [['Full name', 'name', 700], ['Phone', 'phone', 660], ['Email', 'email', 620]].forEach(([label, key, y]) => {
    row(label, y); const t = form.createTextField(key); t.addToPage(p, { x: 170, y, width: 370, height: 24, ...box }); t.setFontSize(12);
  });
  row('Address', 556);
  const addr = form.createTextField('address'); addr.enableMultiline(); addr.addToPage(p, { x: 170, y: 530, width: 370, height: 50, ...box }); addr.setFontSize(11);
  row('City', 490);
  const city = form.createDropdown('city'); city.addOptions(['Taipei', 'New Taipei', 'Taichung', 'Tainan', 'Kaohsiung']);
  city.addToPage(p, { x: 170, y: 490, width: 180, height: 24, ...box }); city.setFontSize(12);
  row('Plan', 446);
  const plan = form.createRadioGroup('plan');
  [['Basic', 170], ['Standard', 270], ['Premium', 380]].forEach(([v, x]) => {
    plan.addOptionToPage(v, p, { x, y: 448, width: 14, height: 14, ...box });
    p.drawText(v, { x: x + 20, y: 450, size: 12, font, color: ink });
  });
  const news = form.createCheckBox('newsletter'); news.addToPage(p, { x: 170, y: 406, width: 14, height: 14, ...box });
  p.drawText('Send me the monthly newsletter', { x: 192, y: 408, size: 12, font, color: ink });
  row('Notes', 340);
  const notes = form.createTextField('notes'); notes.enableMultiline(); notes.addToPage(p, { x: 170, y: 290, width: 370, height: 74, ...box }); notes.setFontSize(11);
  p.drawText('Signature: ______________________     Date: ____________', { x: 50, y: 200, size: 12, font, color: soft });
  await loadForm([pdfFile(await doc.save(), 'membership-form.pdf')]);
});
