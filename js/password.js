'use strict';
/* ================= PASSWORD =================
   Removes a PDF's password (or its print / copy restrictions), or adds one, with qpdf compiled to WebAssembly.
   The file is not re-drawn: text, pictures, links and form fields stay exactly as they were.
   qpdf (1.8 MB) loads the first time it is needed. Its build only finds the .wasm through locateFile(), so the bytes
   (shipped as base64 in a script, which loads even when index.html is opened from disk) are handed over as a blob: URL.
   tools/build.py points qpdfwasm straight at the .wasm on jsdelivr. */
let qpdfFactory = null, qpdfWasmUrl = null;
async function runQpdf(args, input) {
  if (!qpdfFactory) { await loadScript('qpdf'); qpdfFactory = window.Module; } // qpdf.js declares a global `Module`
  if (!qpdfWasmUrl) {
    if (/\.wasm$/.test(LIBS.qpdfwasm)) qpdfWasmUrl = LIBS.qpdfwasm;
    else {
      await loadScript('qpdfwasm');
      qpdfWasmUrl = URL.createObjectURL(new Blob([Uint8Array.from(atob(window.QPDF_WASM), c => c.charCodeAt(0))], { type: 'application/wasm' }));
      window.QPDF_WASM = null; // the blob holds it now
    }
  }
  const q = await qpdfFactory({ noInitialRun: true, locateFile: () => qpdfWasmUrl }); // a fresh instance each time (a few ms)
  q.FS.writeFile('/in.pdf', input);
  let code;
  try { code = q.callMain(args); } catch (e) { code = e && e.status != null ? e.status : 2; }
  let out = null;
  if (code === 0 || code === 3) { try { out = q.FS.readFile('/out.pdf'); } catch (e) {} } // 3: finished with warnings
  return { code, out };
}
/* pdf.js tells apart "needs a password" (1) and "wrong password" (2). */
async function pdfjsTry(bytes, password) {
  await needPdfjs();
  const opts = { data: bytes.slice(), isEvalSupported: false };
  if (password != null) opts.password = password;
  const w = pdfWorker(); if (w) opts.worker = w;
  try { const pj = await pdfjsLib.getDocument(opts).promise; const n = pj.numPages; pj.destroy(); return { ok: true, pages: n }; }
  catch (e) { return { ok: false, need: e && e.name === 'PasswordException', wrong: e && e.code === 2 }; }
}

const pw = { name: '', bytes: null, state: '', pages: 0 }; // state: 'open' | 'restricted' | 'locked'
async function loadPw(files) {
  const f = files[0]; if (!f) return;
  if (!isPdf(f)) { toast(`「${f.name}」不是 PDF 檔`, 'err'); return; }
  const { bytes } = await fileBytes(f);
  const r = await pdfjsTry(bytes);
  if (!r.ok && !r.need) { toast(loadErr(f.name, {}), 'err'); return; }
  Object.assign(pw, { name: f.name, bytes, pages: r.pages || 0, state: !r.ok ? 'locked' : hasEncrypt(bytes) ? 'restricted' : 'open' });
  $('#pw-fname').textContent = f.name;
  $('#pw-fmeta').textContent = (pw.pages ? `${pw.pages} 頁 · ` : '') + fmtSize(bytes.length) + ' · ' +
    { locked: '有開啟密碼', restricted: '沒有開啟密碼，但限制了列印、複製或修改', open: '沒有密碼' }[pw.state];
  $('#pw-empty').hidden = true; $('#pw-work').hidden = false;
  $('#pw-unlock').hidden = pw.state === 'open'; $('#pw-lock').hidden = pw.state !== 'open';
  $('#pw-old-row').hidden = pw.state !== 'locked';
  $('#pw-unlock-go').textContent = pw.state === 'locked' ? '解除密碼' : '解除限制';
  $('#pw-unlock-note').textContent = pw.state === 'locked'
    ? '輸入開啟這份檔案用的密碼。解除後的檔案不需要密碼就能開啟，內容完全不變。'
    : '這份檔案不用密碼就能開啟，只是限制了列印、複製文字或修改。可以直接解除，內容完全不變。';
  $('#pw-err').hidden = true; $('#pw-old').value = '';
  $('#pw-name').value = baseName(f.name) + '-已解除密碼.pdf'; $('#pw-lname').value = baseName(f.name) + '-加密.pdf';
  ['#pw-new', '#pw-new2', '#pw-owner'].forEach(s => { $(s).value = ''; });
  document.querySelectorAll('[data-pw-deny]').forEach(c => { c.checked = false; }); updatePwLock();
  if (pw.state === 'locked') setTimeout(() => $('#pw-old').focus(), 50);
}
function pwError(msg) { const el = $('#pw-err'); el.textContent = msg; el.hidden = !msg; }
$('#pw-unlock-go').addEventListener('click', e => {
  const pass = $('#pw-old').value;
  if (pw.state === 'locked' && !pass) { pwError('請輸入密碼'); $('#pw-old').focus(); return; }
  runJob(e.currentTarget, '解除中…', async () => {
    pwError('');
    if (pw.state === 'locked') {
      const r = await pdfjsTry(pw.bytes, pass);
      if (!r.ok) {
        // Many bills use the ID number; a lower-case first letter is the usual slip.
        const hint = /^[a-z]\d{9}$/.test(pass) ? '身分證字號的英文字母通常要大寫。' : '';
        pwError((r.wrong ? '密碼不對，請再試一次。' : '無法開啟這份檔案。') + hint); $('#pw-old').select(); return;
      }
    }
    const args = pw.state === 'locked' ? [`--password=${pass}`, '--decrypt', '/in.pdf', '/out.pdf'] : ['--decrypt', '/in.pdf', '/out.pdf'];
    const { out } = await runQpdf(args, pw.bytes);
    if (!out || !(await pdfjsTry(out)).ok) { pwError('解除失敗：這份檔案的加密方式無法處理。'); return; }
    await deliver(pdfFile(out, $('#pw-name').value), 'pdf', 'password');
    toast(pw.state === 'locked' ? '已解除密碼' : '已解除限制');
  }).catch(err => pwError('解除失敗：' + err.message));
});
$('#pw-old').addEventListener('keydown', e => { if (e.key === 'Enter') $('#pw-unlock-go').click(); });
document.querySelectorAll('.pw-show').forEach(c => c.addEventListener('change', e => {
  document.querySelectorAll('.pw-show').forEach(o => { o.checked = e.target.checked; });
  document.querySelectorAll('#panel-password input[data-pw]').forEach(i => { i.type = e.target.checked ? 'text' : 'password'; });
}));
function updatePwLock() {
  const a = $('#pw-new').value, b = $('#pw-new2').value, restrict = document.querySelectorAll('[data-pw-deny]:checked').length;
  let msg = '';
  if (!a && !restrict) msg = '輸入開啟密碼，或勾選要限制的項目';
  else if (a && b && a !== b) msg = '兩次輸入的密碼不一樣';
  else if (a && !b) msg = '請再輸入一次密碼';
  $('#pw-lock-msg').textContent = msg || (a ? '開啟檔案時要輸入密碼' : '不用密碼就能開啟，但' + [...document.querySelectorAll('[data-pw-deny]:checked')].map(c => c.dataset.label).join('、'));
  $('#pw-lock-msg').classList.toggle('bad', !!msg && !!(a && b && a !== b));
  $('#pw-lock-go').disabled = !!msg;
}
['#pw-new', '#pw-new2', '#pw-owner'].forEach(s => $(s).addEventListener('input', updatePwLock));
document.querySelectorAll('[data-pw-deny]').forEach(c => c.addEventListener('change', updatePwLock));
$('#pw-lock-go').addEventListener('click', e => {
  const user = $('#pw-new').value, deny = [...document.querySelectorAll('[data-pw-deny]:checked')].map(c => c.dataset.pwDeny);
  // The owner password lifts the restrictions. Without one given, restrictions get a random one nobody knows
  // (they then stay); with no restrictions it is simply the same as the opening password.
  let owner = $('#pw-owner').value;
  if (!owner) owner = deny.length ? Array.from(crypto.getRandomValues(new Uint8Array(18)), b => b.toString(16).padStart(2, '0')).join('') : user;
  runJob(e.currentTarget, '加密中…', async () => {
    const args = ['--encrypt', `--user-password=${user}`, `--owner-password=${owner}`, '--bits=256'];
    if (deny.includes('print')) args.push('--print=none');
    if (deny.includes('copy')) args.push('--extract=n');
    if (deny.includes('modify')) args.push('--modify=none');
    args.push('--', '/in.pdf', '/out.pdf');
    const { out } = await runQpdf(args, pw.bytes);
    // Check the result before handing it over: it must open with the password, and only with it.
    if (!out || !(await pdfjsTry(out, user)).ok || (user && (await pdfjsTry(out)).ok)) throw new Error('產生的檔案驗證不通過');
    await deliver(pdfFile(out, $('#pw-lname').value), 'locked', 'password');
    toast(user ? '已加上密碼。請記好密碼，忘記了就打不開。' : '已加上限制');
  }).catch(err => toast('加密失敗：' + err.message, 'err'));
});
bindInput($('#pw-input'), loadPw);
acceptFiles($('#panel-password'), $('#pw-drop'), loadPw);
$('#pw-change').addEventListener('click', () => $('#pw-input').click());
registerTarget('pdf', 'password', '加密碼', loadPw);
registerHolder('password', () => pw.bytes ? pw.bytes.length : 0, () => {
  Object.assign(pw, { name: '', bytes: null, state: '', pages: 0 });
  $('#pw-empty').hidden = false; $('#pw-work').hidden = true;
});
/* sample: a statement locked with a made-up ID number, as banks do */
$('#pw-sample').addEventListener('click', async e => {
  await busy(e.currentTarget, '產生中…', async () => {
    const src = await makeSample('Monthly Statement', 2, [.11, .3, .55]);
    const { out } = await runQpdf(['--encrypt', '--user-password=A123456789', '--owner-password=sample-owner', '--bits=256', '--', '/in.pdf', '/out.pdf'], src);
    await loadPw([pdfFile(out, 'statement-locked.pdf')]);
    toast('範例檔的密碼是 A123456789');
  });
});
updatePwLock();
