'use strict';
/* ---------- saved signatures (kept in this browser only) ---------- */
const SIG_KEY = 'pdf-workbench.signatures';
const sigs = { list: [], sel: -1 };
try { const v = JSON.parse(localStorage.getItem(SIG_KEY) || '[]'); if (Array.isArray(v)) sigs.list = v.filter(s => s && s.src && s.w && s.h); } catch (e) {}
if (sigs.list.length) sigs.sel = 0;
function persistSigs() { try { localStorage.setItem(SIG_KEY, JSON.stringify(sigs.list)); } catch (e) {} }
function addSignature(sg) {
  sigs.list.unshift(sg); if (sigs.list.length > 8) sigs.list.length = 8;
  sigs.sel = 0; persistSigs(); renderSigLists();
}
function renderSigLists() {
  for (const host of [$('#sign-sig-list'), $('#te-sig-list')]) {
    host.innerHTML = '';
    if (!sigs.list.length) { const p = document.createElement('p'); p.className = 'sig-empty'; p.textContent = '還沒有簽名，先手寫或上傳一個。'; host.append(p); continue; }
    sigs.list.forEach((sg, i) => {
      const it = document.createElement('div');
      it.className = 'sig-item'; it.dataset.i = i; it.tabIndex = 0; it.setAttribute('role', 'button');
      it.setAttribute('aria-pressed', i === sigs.sel); it.setAttribute('aria-label', `簽名 ${i + 1}`);
      it.innerHTML = `<img alt=""><button class="sig-x" data-del="${i}" aria-label="刪除這個簽名">${ICON.x}</button>`;
      it.querySelector('img').src = sg.src;
      host.append(it);
    });
  }
}
function onSigListClick(e) {
  const del = e.target.closest('[data-del]');
  if (del) {
    e.stopPropagation(); const i = +del.dataset.del; sigs.list.splice(i, 1);
    // The chosen signature stays chosen when another one is deleted.
    sigs.sel = !sigs.list.length ? -1 : i < sigs.sel ? sigs.sel - 1 : i === sigs.sel ? 0 : sigs.sel;
    persistSigs(); renderSigLists(); toast('已刪除簽名'); return;
  }
  const it = e.target.closest('.sig-item'); if (!it) return;
  sigs.sel = +it.dataset.i; renderSigLists();
  if (te.page) toast('點頁面上要簽的位置');
}
$('#sign-sig-list').addEventListener('click', onSigListClick);
$('#te-sig-list').addEventListener('click', onSigListClick);
[$('#sign-sig-list'), $('#te-sig-list')].forEach(h => h.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('sig-item')) { e.preventDefault(); e.target.click(); } }));
function trimCanvas(cv, pad) {
  const ctx = cv.getContext('2d'), { width: W, height: H } = cv;
  const d = ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  let w = x1 - x0 + 1, h = y1 - y0 + 1; const k = Math.min(1, 900 / w);
  const out = document.createElement('canvas'); out.width = Math.round(w * k); out.height = Math.round(h * k);
  out.getContext('2d').drawImage(cv, x0, y0, w, h, 0, 0, out.width, out.height);
  return { src: out.toDataURL('image/png'), w: out.width, h: out.height };
}
async function uploadSignature(file) {
  if (!isImage(file)) { toast(`「${file.name}」不是支援的圖片格式`, 'err'); return; }
  let bmp; try { bmp = await createImageBitmap(file); } catch (e) { toast('這張圖片無法讀取', 'err'); return; }
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  const ctx = cv.getContext('2d'); ctx.drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close && bmp.close();
  const img = ctx.getImageData(0, 0, cv.width, cv.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;
    const a = l >= 235 ? 0 : l <= 170 ? 255 : Math.round((235 - l) / 65 * 255);
    d[i + 3] = Math.min(d[i + 3], a);
  }
  ctx.putImageData(img, 0, 0);
  const sg = trimCanvas(cv, 4);
  if (!sg) { toast('圖片裡找不到簽名筆跡', 'err'); return; }
  addSignature(sg); toast('已加入簽名');
}
document.querySelectorAll('.sig-upload').forEach(inp => bindInput(inp, f => uploadSignature(f[0])));

/* signature pad */
const sigDlg = $('#sig-dialog'), sigCv = $('#sig-canvas');
const pad = { color: '#111111', pts: [], has: false, dpr: 1 };
function openSigPad() {
  sigDlg.showModal();
  const cssW = sigCv.parentElement.clientWidth, cssH = Math.round(cssW * .38);
  pad.dpr = Math.min(window.devicePixelRatio || 1, 2);
  sigCv.width = Math.round(cssW * pad.dpr); sigCv.height = Math.round(cssH * pad.dpr); sigCv.style.height = cssH + 'px';
  clearPad();
}
function clearPad() { sigCv.getContext('2d').clearRect(0, 0, sigCv.width, sigCv.height); pad.has = false; }
const padPt = e => { const r = sigCv.getBoundingClientRect(); return [(e.clientX - r.left) * pad.dpr, (e.clientY - r.top) * pad.dpr]; };
sigCv.addEventListener('pointerdown', e => {
  e.preventDefault(); try { sigCv.setPointerCapture(e.pointerId); } catch (_) {}
  const p = padPt(e); pad.pts = [p, p]; pad.has = true;
  const ctx = sigCv.getContext('2d'); ctx.fillStyle = pad.color;
  ctx.beginPath(); ctx.arc(p[0], p[1], +$('#sig-width').value * pad.dpr / 2, 0, 7); ctx.fill();
});
sigCv.addEventListener('pointermove', e => {
  if (!pad.pts.length) return;
  const p = padPt(e), [a, b] = pad.pts.slice(-2);
  const ctx = sigCv.getContext('2d');
  ctx.strokeStyle = pad.color; ctx.lineWidth = +$('#sig-width').value * pad.dpr; ctx.lineCap = ctx.lineJoin = 'round';
  const m1 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], m2 = [(b[0] + p[0]) / 2, (b[1] + p[1]) / 2];
  ctx.beginPath(); ctx.moveTo(m1[0], m1[1]); ctx.quadraticCurveTo(b[0], b[1], m2[0], m2[1]); ctx.stroke();
  pad.pts.push(p);
});
const padEnd = () => { pad.pts = []; };
sigCv.addEventListener('pointerup', padEnd); sigCv.addEventListener('pointercancel', padEnd);
document.querySelectorAll('[data-pen]').forEach(b => b.addEventListener('click', () => {
  pad.color = b.dataset.pen; document.querySelectorAll('[data-pen]').forEach(x => x.setAttribute('aria-pressed', x === b));
}));
$('#sig-clear').addEventListener('click', clearPad);
$('#sig-cancel').addEventListener('click', () => sigDlg.close());
$('#sig-save').addEventListener('click', () => {
  if (!pad.has) { toast('請先在框內簽名'); return; }
  const sg = trimCanvas(sigCv, 6 * pad.dpr);
  if (!sg) { toast('請先在框內簽名'); return; }
  addSignature(sg); sigDlg.close(); toast('已儲存簽名');
});
$('#sign-new').addEventListener('click', openSigPad);
$('#te-sig-new').addEventListener('click', openSigPad);
renderSigLists();


/* ================= SIGN (entry point; signing happens in the page editor) ================= */
async function startSigning(files) {
  if (editBusy()) return; // signing replaces the editor's files
  if (!sigs.list.length) toast('先建立一個簽名，就能直接點頁面放上去');
  await loadEditFiles(files, p => { showTab('edit'); try { history.replaceState(null, '', '#edit'); } catch (e) {} openTextEditor(p, 'sig'); }, null, true);
}
bindInput($('#sign-input'), startSigning);
registerTarget('pdf', 'sign', '簽名', startSigning);
acceptFiles($('#sign-drop'), $('#sign-drop'), startSigning);
onSample($('#sign-sample'), async () => startSigning([asFile(await makeSample('Service Agreement', 2, [.11, .31, .72]), 'service-agreement.pdf')]));
