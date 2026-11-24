'use strict';
/* ================= PDF -> IMAGES (or text) =================
   Format 「文字 TXT」 pulls the text out of the chosen pages instead of drawing them: one .txt file for all of them. */
const p2i = { name: '', pj: null, pages: [] };
async function loadP2i(files) {
  const f = files[0];
  if (!isPdf(f)) { toast(`「${f.name}」不是 PDF 檔`, 'err'); return; }
  const got = await readPdf(f); if (!got) return; // a password-protected file is unlocked here first
  const { bytes, owned } = got, size = bytes.length;
  let pj;
  try { pj = await openPdfjs(bytes, owned); } catch (e) { toast(loadErr(f.name, e), 'err'); return; }
  if (p2i.pj) p2i.pj.destroy();
  releaseThumbs(p2i.pages);
  p2i.name = f.name; p2i.pj = pj; p2i.size = size;
  p2i.pages = Array.from({ length: pj.numPages }, (_, i) => ({ id: uid(), index: i, selected: true, thumb: null, tw: 1, th: 1, w: 0, h: 0 }));
  $('#p2i-fname').textContent = f.name;
  $('#p2i-fmeta').textContent = `${pj.numPages} 頁 · ${fmtSize(size)}`;
  $('#p2i-empty').hidden = true; $('#p2i-work').hidden = false; $('#p2i-progress').hidden = true;
  renderP2i(); // the previous file's cards must not stay on screen while the sizes are read
  // Page sizes next (fast), so the summary is right; thumbnails come as cards scroll near the screen.
  for (const p of p2i.pages) {
    if (p2i.pj !== pj) return;
    try { const vp = (await pj.getPage(p.index + 1)).getViewport({ scale: 1 }); p.w = vp.width; p.h = vp.height; } catch (e) {}
  }
  renderP2i();
}
async function loadP2iThumb(p) {
  if (p.thumb || p.loading) return;
  const pj = p2i.pj; p.loading = true;
  try { Object.assign(p, await renderThumb(await pj.getPage(p.index + 1))); } catch (e) { return; } finally { p.loading = false; }
  if (p2i.pj === pj) setCardThumb($(`#p2i-grid [data-id="${p.id}"]`), p.thumb, p.tw, p.th, 0);
}
function renderP2i() {
  const grid = $('#p2i-grid'); forgetCards(grid); grid.innerHTML = '';
  p2i.pages.forEach(p => {
    const card = document.createElement('div');
    card.className = 'page-card static'; card.dataset.id = p.id;
    grid.append(card); renderP2iCard(p);
  });
  updateP2iSummary();
}
function renderP2iCard(p) {
  const card = $(`#p2i-grid [data-id="${p.id}"]`); if (!card) return;
  card.classList.toggle('is-selected', p.selected);
  card.innerHTML = `
    <div class="thumb">${p.thumb ? '<img alt="" draggable="false">' : '<span class="thumb-loading"></span>'}
      <label class="sel"><input type="checkbox" data-act="sel" ${p.selected ? 'checked' : ''} aria-label="選取第 ${p.index + 1} 頁"></label>
    </div>
    <div class="meta">
      <span class="mid"><span class="pno">${p.index + 1}</span><span class="psize">${p.w ? paperName(p.w, p.h) : ''}</span></span>
      <button class="icon-btn mini" data-act="one" title="只下載這一頁" aria-label="只下載第 ${p.index + 1} 頁"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg></button>
    </div>`;
  if (p.thumb) { const img = card.querySelector('img'); img.src = p.thumb; sizeThumbImg(img, p.tw, p.th, 0); }
  else whenVisible(card, () => loadP2iThumb(p));
}
function p2iOpts() {
  const fmt = $('#p2i-fmt').value;
  return { fmt, dpi: +$('#p2i-dpi').value, q: +$('#p2i-q').value, mime: fmt === 'png' ? 'image/png' : fmt === 'txt' ? 'text/plain' : 'image/jpeg' };
}
function updateP2iSummary() {
  const sel = p2i.pages.filter(p => p.selected);
  const n = p2i.pages.length, { fmt, dpi } = p2iOpts();
  $('#p2i-stat').textContent = `${n} 頁 · 已選 ${sel.length}`;
  $('#p2i-selall').textContent = sel.length === n ? '取消全選' : '全選';
  const first = sel.find(p => p.w), txt = fmt === 'txt';
  const px = first ? ` · 每張約 ${Math.round(first.w * dpi / 72)} × ${Math.round(first.h * dpi / 72)} px` : '';
  $('#p2i-summary').textContent = !sel.length ? '請至少選一頁' : txt ? `${sel.length} 頁的文字 → 1 個 TXT` : `${sel.length} 張 ${fmt.toUpperCase()}${px}`;
  const go = $('#p2i-go');
  setJobButton(go, { disabled: !sel.length, text: txt ? '抽出文字' : sel.length > 1 ? `轉成 ${sel.length} 張圖片` : '轉成圖片' });
  $('#p2i-dpi-wrap').hidden = $('#p2i-q-wrap').hidden = txt; $('#p2i-ocr-wrap').hidden = !txt;
  $('#p2i-q-wrap').style.opacity = fmt === 'png' ? .45 : 1; $('#p2i-q').disabled = fmt === 'png';
  document.querySelectorAll('#p2i-grid [data-act="one"]').forEach(b => { b.title = txt ? '只抽出這一頁的文字' : '只下載這一頁'; });
}
['#p2i-fmt', '#p2i-dpi', '#p2i-q'].forEach(s => $(s).addEventListener('change', updateP2iSummary));
async function pageToBlob(index, o) {
  const pg = await p2i.pj.getPage(index + 1);
  const vp1 = pg.getViewport({ scale: 1 });
  let scale = o.dpi / 72;
  const maxPx = 40e6; if (vp1.width * vp1.height * scale * scale > maxPx) scale = Math.sqrt(maxPx / (vp1.width * vp1.height));
  const vp = pg.getViewport({ scale });
  const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await pg.render({ canvasContext: ctx, viewport: vp }).promise;
  const blob = await new Promise(r => cv.toBlob(r, o.mime, o.q));
  pg.cleanup(); cv.width = cv.height = 0;
  return blob;
}
/* ---------- text ----------
   pdf.js gives the text as runs, each with its position. Runs are taken in the order the file stores them (that
   usually follows columns and reading order); a run whose baseline moves starts a new line, a wider gap within a line
   becomes a space, and a larger step down leaves an empty line between paragraphs. */
function runsToText(items, vp) {
  let out = '', prev = null;
  for (const it of items) {
    if (!it.str || !it.transform) continue;
    const t = pdfjsLib.Util.transform(vp.transform, it.transform);
    const h = Math.hypot(t[2], t[3]) || 10, x = t[4], y = t[5], w = (it.width || 0) * vp.scale;
    if (prev) {
      const dy = y - prev.y, lh = Math.max(h, prev.h);
      if (Math.abs(dy) > lh * .5 || x < prev.x - lh * 2) { // a new line
        out = out.replace(/[ \t]+$/, '');
        out += dy > lh * 1.9 ? '\n\n' : '\n';
      } else if (x - prev.end > lh * .25 && !/\s$/.test(out) && !/^\s/.test(it.str)) out += ' ';
    }
    out += fixCjk(it.str);
    prev = { x, y, h, end: x + w };
  }
  return out.replace(/[ \t]+\n/g, '\n').trim();
}
/* A page without a text layer (a scan) is read with OCR when 「OCR」 is ticked; onOcr(msg) reports its progress. */
async function pageText(index, onOcr) {
  const pg = await p2i.pj.getPage(index + 1);
  const vp = pg.getViewport({ scale: 1 });
  const tc = await pg.getTextContent();
  const t = runsToText(tc.items, vp);
  if (t || !onOcr) { pg.cleanup(); return { text: t }; }
  return { text: tidyOcr((await ocrPage(pg, normRot(pg.rotate), { onProgress: onOcr })).text), ocr: true };
}
const NO_TEXT = '（這一頁沒有文字，可能是掃描的圖片）';
const p2iFileName = (index, o) => `${baseName(p2i.name)}-${String(index + 1).padStart(String(p2i.pages.length).length, '0')}.${o.fmt}`;
function p2iProgress(i, n) {
  $('#p2i-progress').hidden = false;
  $('#p2i-bar').style.width = (i / n * 100) + '%';
  $('#p2i-plabel').textContent = i < n ? `轉換第 ${i + 1} / ${n} 張` : `完成 ${n} 張`;
}
async function exportP2i(pages, btn) {
  const o = p2iOpts();
  const mini = btn.classList.contains('mini');
  await (mini ? busy(btn, '', () => go(() => {})) : runJob(btn, '轉換中…', go)).catch(err => toast('轉換失敗：' + err.message, 'err'));
  async function go(check) {
    if (o.fmt === 'txt') return goText(check);
    if (pages.length === 1) {
      p2iProgress(0, 1);
      const blob = await pageToBlob(pages[0].index, o);
      p2iProgress(1, 1);
      const name = p2iFileName(pages[0].index, o);
      const file = new File([blob], name, { type: o.mime });
      if (mini) { await saveFile(name, blob); offerNext(file, 'image', 'pdf2img'); } // 「只下載這一頁」 means download
      else await deliver(file, 'image', 'pdf2img');
      return;
    }
    const zip = await newZip();
    for (let i = 0; i < pages.length; i++) {
      check();
      p2iProgress(i, pages.length);
      zip.file(p2iFileName(pages[i].index, o), await pageToBlob(pages[i].index, o));
    }
    p2iProgress(pages.length, pages.length);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    await deliver(new File([blob], `${baseName(p2i.name)}-${o.fmt}.zip`, { type: 'application/zip' }), 'zip', 'pdf2img');
  }
  async function goText(check) {
    const parts = [], useOcr = $('#p2i-ocr').checked; let empty = 0, ocred = 0;
    for (let i = 0; i < pages.length; i++) {
      check();
      p2iProgress(i, pages.length);
      const r = await pageText(pages[i].index, useOcr ? msg => {
        $('#p2i-plabel').textContent = `第 ${i + 1} / ${pages.length} 頁是掃描的圖片 · ${ocrProgressText(msg)}`;
      } : null);
      const t = r.text;
      if (!t) empty++; else if (r.ocr) ocred++;
      parts.push(pages.length > 1 ? `──── 第 ${pages[i].index + 1} 頁 ────\n\n${t || (useOcr ? '（這一頁辨識不出文字）' : NO_TEXT)}` : t);
    }
    p2iProgress(pages.length, pages.length);
    if (empty === pages.length) {
      toast(useOcr ? '辨識不出任何文字。圖片太模糊、太暗或字太小時會這樣。'
        : pages.length > 1 ? '這些頁面都沒有文字，可能是掃描檔（圖片）。勾選「用 OCR 辨識」再試一次。' : '這一頁沒有文字，可能是掃描的圖片。勾選「用 OCR 辨識」再試一次。', 'err');
      return;
    }
    if (empty) toast(useOcr ? `有 ${empty} 頁辨識不出文字，其他頁已抽出` : `有 ${empty} 頁沒有文字（可能是掃描的圖片），其他頁已抽出`);
    else if (ocred) toast(`其中 ${ocred} 頁是用 OCR 辨識的，可能有錯字，請核對`);
    const name = pages.length === 1 && mini ? p2iFileName(pages[0].index, o) : `${baseName(p2i.name)}.txt`;
    const file = new File(['\ufeff' + parts.join('\n\n\n')], name, { type: 'text/plain;charset=utf-8' }); // BOM: older Notepad and Excel read it as UTF-8
    if (mini) { await saveFile(name, file); offerNext(file, 'text', 'pdf2img'); }
    else await deliver(file, 'text', 'pdf2img');
  }
}
$('#p2i-grid').addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t) {
    if (!isThumbClick(e)) return;
    const i0 = p2i.pages.findIndex(x => x.id === e.target.closest('.page-card').dataset.id);
    openPreview(p2i.pages.length, i0, async i => { const page = await p2i.pj.getPage(i + 1); return { page, rotation: page.rotate }; });
    return;
  }
  const p = p2i.pages.find(x => x.id === t.closest('.page-card').dataset.id); if (!p) return;
  if (t.dataset.act === 'sel') {
    const i = p2i.pages.indexOf(p), j = p2i.pages.findIndex(x => x.id === p2i.anchor);
    if (e.shiftKey && j >= 0) { for (let k = Math.min(i, j); k <= Math.max(i, j); k++) p2i.pages[k].selected = t.checked; renderP2i(); }
    else { p.selected = t.checked; t.closest('.page-card').classList.toggle('is-selected', p.selected); updateP2iSummary(); }
    p2i.anchor = p.id;
  }
  if (t.dataset.act === 'one') exportP2i([p], t);
});
$('#p2i-selall').addEventListener('click', () => {
  const all = p2i.pages.every(p => p.selected); p2i.pages.forEach(p => { p.selected = !all; }); renderP2i();
});
$('#p2i-go').addEventListener('click', e => exportP2i(p2i.pages.filter(p => p.selected), e.currentTarget));
bindInput($('#p2i-input'), loadP2i);
registerTarget('pdf', 'pdf2img', '轉成圖片／文字', loadP2i);
acceptFiles($('#panel-pdf2img'), $('#p2i-drop'), loadP2i);
$('#p2i-change').addEventListener('click', () => $('#p2i-input').click());
$('#p2i-sample').addEventListener('click', async () => {
  loadP2i([asFile(await makeSample('Quarterly Report', 3, [.04, .48, .42]), 'quarterly-report.pdf')]);
});
registerHolder('pdf2img', () => p2i.pj ? p2i.size : 0, () => {
  p2i.pj.destroy(); releaseThumbs(p2i.pages);
  forgetCards($('#p2i-grid')); $('#p2i-grid').innerHTML = '';
  Object.assign(p2i, { name: '', pj: null, pages: [], size: 0 });
  $('#p2i-empty').hidden = false; $('#p2i-work').hidden = true;
});
