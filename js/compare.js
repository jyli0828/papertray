'use strict';
/* ================= COMPARE =================
   Finds what text changed between two versions of a document. Each file's text is cut into tokens (a Chinese
   character, a word or number, a punctuation mark; spaces and line breaks do not count, and NFKC makes full-width and
   half-width forms equal). Lines are compared first, then the tokens inside the lines that differ, so a long document
   with a few edits stays quick and text that only moved to another line does not count as changed.
   Results: a list of changes, and both files side by side with deleted text marked red and added text green. */
const cmp = { a: null, b: null, res: null, active: -1 };
const CMP_WORD = /[A-Za-z0-9À-ɏͰ-ϿЀ-ӿ]/;

async function loadCmp(side, files) {
  const f = files[0];
  if (!f) return;
  if (!isPdf(f)) { toast(`「${f.name}」不是 PDF 檔`, 'err'); return; }
  const { bytes, owned } = await fileBytes(f), size = bytes.length;
  let pj;
  try { pj = await openPdfjs(bytes, owned); } catch (e) { toast(loadErr(f.name, e), 'err'); return; }
  if (cmp[side]) cmp[side].pj.destroy();
  cmp[side] = { name: f.name, pj, size, chars: [] };
  clearCmpResult();
  renderCmpSlots();
}
/* Two files dropped (or pasted) at once are the old and the new version, in that order; one file fills the empty side. */
function loadCmpAny(files, side) {
  const pdfs = files.filter(isPdf);
  if (!pdfs.length) { toast('請放入 PDF 檔', 'err'); return; }
  if (pdfs.length > 1) { loadCmp('a', [pdfs[0]]).then(() => loadCmp('b', [pdfs[1]])); return; }
  loadCmp(side || (!cmp.a ? 'a' : !cmp.b ? 'b' : 'b'), pdfs);
}
function renderCmpSlots() {
  for (const s of ['a', 'b']) {
    const d = cmp[s];
    $('#cmp-drop-' + s).hidden = !!d; $('#cmp-card-' + s).hidden = !d;
    if (d) { $('#cmp-name-' + s).textContent = d.name; $('#cmp-meta-' + s).textContent = `${d.pj.numPages} 頁 · ${fmtSize(d.size)}`; }
  }
  $('#cmp-go').disabled = !(cmp.a && cmp.b);
  $('#cmp-sample-row').hidden = !!(cmp.a && cmp.b);
}
function clearCmpResult() {
  for (const s of ['a', 'b']) { const box = $('#cmp-pages-' + s); forgetCmpPages(box); box.innerHTML = ''; }
  $('#cmp-list').innerHTML = ''; $('#cmp-result').hidden = true; $('#cmp-progress').hidden = true;
  cmp.res = null; cmp.active = -1;
}
/* Page pictures are drawn when they scroll near the screen (whenVisible, as for thumbnails) and kept as Blob URLs. */
function forgetCmpPages(box) {
  box.querySelectorAll('.cmp-page').forEach(el => { el._thumbJob = null; thumbIO.unobserve(el); if (el._img) releaseThumbs([el._img]); });
}
function clearCmp() {
  clearCmpResult();
  for (const s of ['a', 'b']) { if (cmp[s]) cmp[s].pj.destroy(); cmp[s] = null; }
  renderCmpSlots();
}
for (const s of ['a', 'b']) {
  bindInput($('#cmp-input-' + s), files => loadCmpAny(files, s));
  acceptFiles($('#cmp-drop-' + s), $('#cmp-drop-' + s), files => loadCmpAny(files, s));
  acceptFiles($('#cmp-card-' + s), null, files => loadCmpAny(files, s));
}
$('#panel-compare')._paste = files => loadCmpAny(files);
acceptFiles($('#panel-compare'), null, files => loadCmpAny(files));
document.querySelectorAll('[data-cmp-change]').forEach(b => b.addEventListener('click', () => $('#cmp-input-' + b.dataset.cmpChange).click()));
registerTarget('pdf', 'compare', '比較', files => loadCmpAny(files));
registerHolder('compare', () => (cmp.a ? cmp.a.size : 0) + (cmp.b ? cmp.b.size : 0) + canvasBytes('#panel-compare canvas'), clearCmp);

/* ---------- text of each page ---------- */
async function cmpReadDoc(d, label, useOcr, check, progress) {
  const n = d.pj.numPages;
  for (let i = 0; i < n; i++) {
    check();
    const c = d.chars[i];
    if (c && (c.ocr || c.text.trim() || !useOcr)) continue; // already read (a scan read without OCR is read again with it)
    progress(`讀取${label}第 ${i + 1} / ${n} 頁`);
    const pg = await d.pj.getPage(i + 1), R = normRot(pg.rotate);
    const r = await pageChars(pg, { ocr: useOcr, rotation: R, onProgress: m => progress(`${label}第 ${i + 1} / ${n} 頁是掃描的圖片 · ${ocrProgressText(m)}`) });
    d.chars[i] = { ...r, view: pg.view.slice(), R };
    pg.cleanup();
  }
}
function cmpTokens(d) {
  const toks = [], lines = []; let start = 0;
  const endLine = () => { if (toks.length > start) lines.push([start, toks.length]); start = toks.length; };
  d.chars.forEach((pc, p) => {
    const t = pc.text; let sp = false;
    for (let i = 0; i < t.length;) {
      const ch = t[i];
      if (ch === '\n') { endLine(); sp = true; i++; continue; }
      if (/\s/.test(ch)) { sp = true; i++; continue; }
      let j = i + 1;
      if (CMP_WORD.test(ch)) {
        // a number keeps its separators: 1,200 and 3.5 are one token each
        while (j < t.length && (CMP_WORD.test(t[j]) || (/[,.]/.test(t[j]) && /\d/.test(t[j - 1]) && /\d/.test(t[j + 1] || '')))) j++;
      } else if (/[\uD800-\uDBFF]/.test(ch)) j = i + 2;
      toks.push({ t: t.slice(i, j).normalize('NFKC'), p, i0: i, i1: j, sp }); // sp: a space came before it
      sp = false; i = j;
    }
    endLine(); // a page always ends a line
  });
  return { toks, lines };
}

/* ---------- diff ----------
   Myers' O(ND) algorithm on two arrays of numbers. Returns runs [{ type: 'eq' | 'del' | 'ins', n }], or null when more
   than maxD edits would be needed (the trace kept for walking back grows with the square of the edits). */
function myersRuns(a, b, maxD) {
  const n = a.length, m = b.length, runs = [];
  const push = (type, k) => { if (!k) return; const r = runs[runs.length - 1]; if (r && r.type === type) r.n += k; else runs.push({ type, n: k }); };
  let s = 0; while (s < n && s < m && a[s] === b[s]) s++;
  let e = 0; while (e < n - s && e < m - s && a[n - 1 - e] === b[m - 1 - e]) e++;
  const A = a.slice(s, n - e), B = b.slice(s, m - e), N = A.length, M = B.length;
  push('eq', s);
  if (!N || !M) { push('del', N); push('ins', M); push('eq', e); return runs; }
  const max = N + M, off = max + 1, V = new Int32Array(2 * max + 3), trace = [];
  let D = -1;
  outer: for (let d = 0; d <= max; d++) {
    if (d > maxD) return null;
    trace.push(V.slice(off - d - 1, off + d + 2)); // V before step d, for diagonals -d-1 … d+1
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && V[off + k - 1] < V[off + k + 1])) ? V[off + k + 1] : V[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) { x++; y++; }
      V[off + k] = x;
      if (x >= N && y >= M) { D = d; break outer; }
    }
  }
  const rev = []; let x = N, y = M;
  for (let d = D; d > 0; d--) {
    const v = trace[d], at = k => v[k + d + 1], k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const pk = down ? k + 1 : k - 1, px = at(pk), py = px - pk;
    rev.push(['eq', x - (down ? px : px + 1)], [down ? 'ins' : 'del', 1]);
    x = px; y = py;
  }
  rev.push(['eq', x]);
  for (let i = rev.length - 1; i >= 0; i--) push(rev[i][0], rev[i][1]);
  push('eq', e);
  return runs;
}
/* Hunks: { a0, a1, b0, b1 } token ranges, a deleted from the old file and b added in the new one. */
function cmpDiff(A, B) {
  const ids = new Map(), id = s => { let v = ids.get(s); if (v === undefined) ids.set(s, v = ids.size); return v; };
  const ta = A.toks.map(t => id(t.t)), tb = B.toks.map(t => id(t.t));
  const lineIds = (T, tt) => T.lines.map(([x, y]) => id('\u0001' + tt.slice(x, y).join(',')));
  const hunks = []; let tooBig = false;
  const addHunk = h => {
    const last = hunks[hunks.length - 1];
    // 2026/03/01 → 2026/04/10 is one change, not two around an unchanged slash: short changes split by a single
    // punctuation mark are joined.
    const gap = last && h.a0 - last.a1 === 1 && h.b0 - last.b1 === 1 ? A.toks[last.a1].t : null;
    if (gap && !CMP_WORD.test(gap) && !isCjk(gap) && h.a1 - last.a0 <= 7 && h.b1 - last.b0 <= 7) { last.a1 = h.a1; last.b1 = h.b1; }
    else hunks.push(h);
  };
  const tokenBlock = (a0, a1, b0, b1) => {
    const runs = myersRuns(ta.slice(a0, a1), tb.slice(b0, b1), 2500);
    if (!runs) { tooBig = true; addHunk({ a0, a1, b0, b1 }); return; }
    let i = a0, j = b0, h = null;
    for (const r of runs) {
      if (r.type === 'eq') { if (h) { addHunk(h); h = null; } i += r.n; j += r.n; continue; }
      if (!h) h = { a0: i, a1: i, b0: j, b1: j };
      if (r.type === 'del') { i += r.n; h.a1 = i; } else { j += r.n; h.b1 = j; }
    }
    if (h) addHunk(h);
  };
  const lruns = myersRuns(lineIds(A, ta), lineIds(B, tb), 2500);
  if (!lruns) { tokenBlock(0, ta.length, 0, tb.length); return { hunks, tooBig }; }
  const tokAt = (T, li) => li < T.lines.length ? T.lines[li][0] : T.toks.length;
  let li = 0, lj = 0;
  for (let r = 0; r < lruns.length; r++) {
    if (lruns[r].type === 'eq') { li += lruns[r].n; lj += lruns[r].n; continue; }
    let la = li, lb = lj;
    for (; r < lruns.length && lruns[r].type !== 'eq'; r++) { if (lruns[r].type === 'del') la += lruns[r].n; else lb += lruns[r].n; }
    r--;
    tokenBlock(tokAt(A, li), tokAt(A, la), tokAt(B, lj), tokAt(B, lb));
    li = la; lj = lb;
  }
  return { hunks, tooBig };
}

/* ---------- run ---------- */
function cmpProgress(text, frac) {
  $('#cmp-progress').hidden = false;
  $('#cmp-plabel').textContent = text;
  if (frac != null) $('#cmp-bar').style.width = (frac * 100) + '%';
}
$('#cmp-go').addEventListener('click', e => {
  const useOcr = $('#cmp-ocr').checked, A = cmp.a, B = cmp.b;
  runJob(e.currentTarget, '比較中…', async check => {
    clearCmpResult();
    const total = A.pj.numPages + B.pj.numPages;
    await cmpReadDoc(A, '原本', useOcr, check, t => cmpProgress(t, A.chars.filter(Boolean).length / total));
    await cmpReadDoc(B, '新版', useOcr, check, t => cmpProgress(t, (A.pj.numPages + B.chars.filter(Boolean).length) / total));
    cmpProgress('比對中…', 1);
    await new Promise(r => setTimeout(r, 30)); // let the label paint before the work below
    const TA = cmpTokens(A), TB = cmpTokens(B);
    if (!TA.toks.length || !TB.toks.length) {
      $('#cmp-progress').hidden = true;
      const which = !TA.toks.length && !TB.toks.length ? '兩份檔案都' : !TA.toks.length ? '原本的檔案' : '新版的檔案';
      toast(`${which}沒有可以比較的文字${useOcr ? '（辨識不出文字）' : '，可能是掃描檔；勾選「先用 OCR 辨識」再試一次'}`, 'err');
      return;
    }
    const { hunks, tooBig } = cmpDiff(TA, TB);
    $('#cmp-progress').hidden = true;
    cmp.res = { A, B, TA, TB, hunks };
    showCmpResult(tooBig);
  }).catch(err => toast('比較失敗：' + err.message, 'err'));
});
const cmpJoin = (T, x, y) => {
  let s = '';
  for (let i = x; i < y; i++) { const tk = T.toks[i]; if (s && (tk.sp || (CMP_WORD.test(s[s.length - 1]) && CMP_WORD.test(tk.t[0])))) s += ' '; s += tk.t; }
  return s;
};
const cmpCut = s => s.length > 160 ? s.slice(0, 160) + '…' : s;
/* The page a hunk is on, in one file; an insertion has no text in the old file, so it is placed after the token before it. */
const cmpPage = (T, x, y) => (T.toks[x < y ? x : x - 1] || T.toks[x] || { p: 0 }).p;
/* Boxes (user space, grouped by page) for tokens x..y-1. With no tokens, a thin mark where the text would be. */
function cmpBoxes(d, T, x, y) {
  const out = new Map();
  if (x >= y) {
    const t = T.toks[x - 1], tn = T.toks[x];
    const ref = t || tn; if (!ref) return out;
    const c = d.chars[ref.p], bs = spanBoxes(c.text, c.boxes, ref.i0, ref.i1); if (!bs.length) return out;
    const b = t ? bs[bs.length - 1] : bs[0], h = b[3] - b[1], w = b[2] - b[0];
    const vertical = h > w * 2.5 && ref.i1 - ref.i0 === 1 && (c.R === 90 || c.R === 270);
    const mark = vertical ? [b[0], t ? b[1] - 1.5 : b[3] - 1.5, b[2], (t ? b[1] : b[3]) + 1.5]
      : [(t ? b[2] : b[0]) - 1.2, b[1], (t ? b[2] : b[0]) + 1.2, b[3]];
    out.set(ref.p, [{ box: mark, caret: true }]);
    return out;
  }
  let i = x;
  while (i < y) {
    const p = T.toks[i].p; let j = i;
    while (j + 1 < y && T.toks[j + 1].p === p) j++;
    const c = d.chars[p];
    out.set(p, (out.get(p) || []).concat(spanBoxes(c.text, c.boxes, T.toks[i].i0, T.toks[j].i1).map(box => ({ box }))));
    i = j + 1;
  }
  return out;
}
function showCmpResult(tooBig) {
  const { A, B, TA, TB, hunks } = cmp.res;
  let mod = 0, del = 0, ins = 0;
  hunks.forEach(h => { if (h.a1 > h.a0 && h.b1 > h.b0) mod++; else if (h.a1 > h.a0) del++; else ins++; });
  $('#cmp-result').hidden = false;
  $('#cmp-sum').innerHTML = !hunks.length ? '<b>兩份檔案的文字完全相同。</b>'
    : `<b>找到 ${hunks.length} 處不同</b>：` + [mod && `修改 ${mod}`, del && `刪除 ${del}`, ins && `新增 ${ins}`].filter(Boolean).join('、')
      + (tooBig ? '。兩份檔案差異很大，部分段落直接整段標示。' : '');
  $('#cmp-prev').hidden = $('#cmp-next').hidden = !hunks.length;
  const list = $('#cmp-list'), MAX = 800;
  list.hidden = !hunks.length;
  list.innerHTML = hunks.slice(0, MAX).map((h, k) => {
    const dt = cmpJoin(TA, h.a0, h.a1), it = cmpJoin(TB, h.b0, h.b1);
    const kind = dt && it ? '修改' : dt ? '刪除' : '新增';
    return `<li data-h="${k}"><button class="cmp-item">
      <span class="cmp-where mono">${kind} · 第 ${cmpPage(TA, h.a0, h.a1) + 1} → ${cmpPage(TB, h.b0, h.b1) + 1} 頁</span>
      <span class="cmp-text">${dt ? `<del>${escHtml(cmpCut(dt))}</del>` : ''}${it ? `<ins>${escHtml(cmpCut(it))}</ins>` : ''}</span></button></li>`;
  }).join('') + (hunks.length > MAX ? `<li class="hint">只列出前 ${MAX} 處，其他的在下方頁面上都有標示。</li>` : '');
  $('#cmp-col-name-a').textContent = A.name; $('#cmp-col-name-b').textContent = B.name;
  // Every mark, by file and page: [hunk number, box]
  const marks = { a: new Map(), b: new Map() };
  hunks.forEach((h, k) => {
    for (const [side, d, T, x, y] of [['a', A, TA, h.a0, h.a1], ['b', B, TB, h.b0, h.b1]]) {
      for (const [p, bs] of cmpBoxes(d, T, x, y)) {
        if (!marks[side].has(p)) marks[side].set(p, []);
        bs.forEach(b => marks[side].get(p).push({ k, ...b }));
      }
    }
  });
  cmpPages('a', A, marks.a); cmpPages('b', B, marks.b);
}
const escHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function cmpPages(side, d, marks) {
  const box = $('#cmp-pages-' + side); forgetCmpPages(box); box.innerHTML = '';
  d.chars.forEach((c, p) => {
    const [dw, dh] = dispSize(c.view, c.R);
    const el = document.createElement('div');
    el.className = 'cmp-page'; el.dataset.p = p; el.style.aspectRatio = `${dw} / ${dh}`;
    el.innerHTML = `<span class="cmp-pno mono">${p + 1}</span>`;
    for (const mk of marks.get(p) || []) {
      const [x0, y0, x1, y1] = mk.box;
      const [ax, ay] = userToDisplay(c.view, c.R, x0, y0), [bx, by] = userToDisplay(c.view, c.R, x1, y1);
      const m = document.createElement('span');
      m.className = `cmp-mark ${side === 'a' ? 'del' : 'ins'}${mk.caret ? ' caret' : ''}`; m.dataset.h = mk.k;
      Object.assign(m.style, { left: Math.min(ax, bx) / dw * 100 + '%', top: Math.min(ay, by) / dh * 100 + '%',
        width: Math.abs(bx - ax) / dw * 100 + '%', height: Math.abs(by - ay) / dh * 100 + '%' });
      el.append(m);
    }
    box.append(el);
    whenVisible(el, async () => {
      const pg = await d.pj.getPage(p + 1);
      const w = Math.min(1400, Math.round((box.clientWidth || 400) * Math.min(window.devicePixelRatio || 1, 2)));
      const vp1 = pg.getViewport({ scale: 1, rotation: c.R }), vp = pg.getViewport({ scale: w / vp1.width, rotation: c.R });
      const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .85)); pg.cleanup(); cv.width = cv.height = 0;
      if (!el.isConnected) return;
      const img = document.createElement('img'); img.alt = ''; img.draggable = false; img.src = URL.createObjectURL(blob);
      el._img = { thumb: img.src }; el.prepend(img);
    });
  });
}
/* ---------- moving between changes ---------- */
function cmpSelect(k, from) {
  const res = cmp.res; if (!res || k < 0 || k >= res.hunks.length) return;
  cmp.active = k;
  document.querySelectorAll('#panel-compare .is-active').forEach(el => el.classList.remove('is-active'));
  document.querySelectorAll(`#panel-compare [data-h="${k}"]`).forEach(el => el.classList.add('is-active'));
  const h = res.hunks[k];
  for (const [side, T, x, y] of [['a', res.TA, h.a0, h.a1], ['b', res.TB, h.b0, h.b1]]) {
    if (side === from) continue;
    const pages = $('#cmp-pages-' + side), p = cmpPage(T, x, y);
    const target = pages.querySelector(`.cmp-mark[data-h="${k}"]`) || pages.querySelector(`.cmp-page[data-p="${p}"]`);
    if (!target) continue;
    const pageEl = target.closest('.cmp-page');
    // The page may still be an empty frame; its marks sit at their place in it, so the offset is right either way.
    const top = pageEl.offsetTop + (target === pageEl ? 0 : target.offsetTop) - pages.clientHeight / 3;
    pages.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }
  const li = $(`#cmp-list [data-h="${k}"]`);
  if (li && from !== 'list') { const L = $('#cmp-list'); L.scrollTo({ top: li.offsetTop - L.clientHeight / 3, behavior: 'smooth' }); }
}
$('#cmp-list').addEventListener('click', e => { const li = e.target.closest('[data-h]'); if (li) cmpSelect(+li.dataset.h, 'list'); });
for (const s of ['a', 'b']) $('#cmp-pages-' + s).addEventListener('click', e => {
  const m = e.target.closest('.cmp-mark'); if (m) cmpSelect(+m.dataset.h, s);
});
$('#cmp-prev').addEventListener('click', () => cmpSelect(cmp.active <= 0 ? 0 : cmp.active - 1));
$('#cmp-next').addEventListener('click', () => cmpSelect(cmp.active + 1));
document.addEventListener('keydown', e => {
  if ($('#panel-compare').hidden || !cmp.res || document.querySelector('dialog[open]')) return;
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); $('#cmp-next').click(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); $('#cmp-prev').click(); }
});

/* ---------- sample: two versions of a made-up agreement ---------- */
async function makeAgreement(v2) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const paras = [
    ['h1', 'Printing Services Agreement'],
    ['p', `This agreement is made on ${v2 ? 'March 3, 2026' : 'February 24, 2026'} between Harbor Print Co. ("Provider") and Lin Design Studio ("Client").`],
    ['h2', '1. Services'],
    ['p', `Provider will print and deliver ${v2 ? '1,500' : '1,200'} copies of the spring catalogue on 150 gsm coated paper, folded and stapled. Provider will send one printed proof for approval before the full run.`],
    ['h2', '2. Fees and payment'],
    ['p', `Client will pay a total fee of NT$ ${v2 ? '86,400' : '72,000'}, with 30% due on signing and the balance within 30 days of delivery.`],
    v2 && ['p', 'Rush orders delivered within five working days carry a 15% surcharge.'],
    ['h2', '3. Delivery'],
    ['p', `Delivery will be made to the Client's office in Taipei no later than ${v2 ? 'April 10, 2026' : 'March 31, 2026'}. Risk passes to Client on delivery.`],
    ['h2', '4. Changes'],
    ['p', `Any change to quantity, paper or delivery date must be agreed${v2 ? ' in writing' : ''} by both parties.`],
    ['h2', '5. Termination'],
    ['p', `Either party may end this agreement with ${v2 ? '30' : '14'} days written notice. Work already completed will be paid for at the agreed rate.`],
    !v2 && ['p', 'Provider keeps the printing plates for six months after delivery.']
  ].filter(Boolean);
  let page = doc.addPage([595.28, 841.89]), y = 770;
  const wrap = (text, f, size, width) => {
    const out = []; let line = '';
    for (const w of text.split(' ')) { const t = line ? line + ' ' + w : w; if (f.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w; } else line = t; }
    if (line) out.push(line); return out;
  };
  for (const [kind, text] of paras) {
    const f = kind === 'p' ? font : bold, size = kind === 'h1' ? 22 : kind === 'h2' ? 13 : 11.5, lh = size * 1.45;
    if (kind === 'h2') y -= 10;
    for (const ln of wrap(text, f, size, 495)) { page.drawText(ln, { x: 50, y, size, font: f, color: rgb(.1, .13, .17) }); y -= lh; }
    if (kind === 'h1') y -= 8;
  }
  page.drawText(v2 ? 'Version 2 - revised' : 'Version 1 - draft', { x: 50, y: 40, size: 9, font, color: rgb(.4, .45, .5) });
  page = doc.addPage([595.28, 841.89]);
  page.drawText('Signatures', { x: 50, y: 770, size: 13, font: bold });
  ['Provider: Harbor Print Co.', 'Client: Lin Design Studio'].forEach((t, i) => {
    page.drawText(t, { x: 50, y: 720 - i * 90, size: 11.5, font });
    page.drawLine({ start: { x: 50, y: 680 - i * 90 }, end: { x: 300, y: 680 - i * 90 }, thickness: .8, color: rgb(.5, .55, .6) });
  });
  return pdfFile(await doc.save(), v2 ? 'agreement-v2.pdf' : 'agreement-v1.pdf');
}
$('#cmp-sample').addEventListener('click', async () => {
  await loadCmp('a', [await makeAgreement(false)]);
  await loadCmp('b', [await makeAgreement(true)]);
  $('#cmp-go').click();
});
