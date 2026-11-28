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
  const opts = pdfjsOpts(bytes.slice());
  if (password != null) opts.password = password;
  try { const pj = await pdfjsLib.getDocument(opts).promise; const n = pj.numPages; pj.loadingTask.destroy(); return { ok: true, pages: n }; }
  catch (e) { return { ok: false, need: e && e.name === 'PasswordException', wrong: e && e.code === 2 }; }
}

/* state: 'open' | 'restricted' | 'locked'. src is the file itself (on disk for a picked file), read again for each job. */
const pw = { name: '', src: null, state: '', pages: 0 };
const pwBytes = async () => (await fileBytes(pw.src)).bytes;
async function loadPw(files) {
  const f = files[0]; if (!f) return;
  if (!isPdf(f)) { toast(`「${f.name}」不是 PDF 檔`, 'err'); return; }
  const { bytes } = await fileBytes(f);
  const r = await pdfjsTry(bytes);
  if (!r.ok && !r.need) { toast(loadErr(f.name, {}), 'err'); return; }
  Object.assign(pw, { name: f.name, src: f, pages: r.pages || 0, state: !r.ok ? 'locked' : hasEncrypt(bytes) ? 'restricted' : 'open' });
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
  const pass = $('#pw-old').value, name = $('#pw-name').value;
  if (pw.state === 'locked' && !pass) { pwError('請輸入密碼'); $('#pw-old').focus(); return; }
  runJob(e.currentTarget, '解除中…', async () => {
    pwError('');
    const bytes = await pwBytes();
    if (pw.state === 'locked') {
      const r = await pdfjsTry(bytes, pass);
      if (!r.ok) {
        // Many bills use the ID number; a lower-case first letter is the usual slip.
        const hint = /^[a-z]\d{9}$/.test(pass) ? '身分證字號的英文字母通常要大寫。' : '';
        pwError((r.wrong ? '密碼不對，請再試一次。' : '無法開啟這份檔案。') + hint); $('#pw-old').select(); return;
      }
    }
    const args = pw.state === 'locked' ? [`--password=${pass}`, '--decrypt', '/in.pdf', '/out.pdf'] : ['--decrypt', '/in.pdf', '/out.pdf'];
    const { out } = await runQpdf(args, bytes);
    if (!out || !(await pdfjsTry(out)).ok) { pwError('解除失敗：這份檔案的加密方式無法處理。'); return; }
    await deliver(pdfFile(out, name), 'pdf', 'password');
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
  setJobButton($('#pw-lock-go'), { disabled: !!msg });
}
['#pw-new', '#pw-new2', '#pw-owner'].forEach(s => $(s).addEventListener('input', updatePwLock));
document.querySelectorAll('[data-pw-deny]').forEach(c => c.addEventListener('change', updatePwLock));
$('#pw-lock-go').addEventListener('click', e => {
  const user = $('#pw-new').value, name = $('#pw-lname').value, deny = [...document.querySelectorAll('[data-pw-deny]:checked')].map(c => c.dataset.pwDeny);
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
    const { out } = await runQpdf(args, await pwBytes());
    // Check the result before handing it over: it must open with the password, and only with it.
    if (!out || !(await pdfjsTry(out, user)).ok || (user && (await pdfjsTry(out)).ok)) throw new Error('產生的檔案驗證不通過');
    await deliver(pdfFile(out, name), 'locked', 'password');
    toast(user ? '已加上密碼。請記好密碼，忘記了就打不開。' : '已加上限制');
  }).catch(failToast('加密失敗'));
});
bindInput($('#pw-input'), loadPw);
acceptFiles($('#panel-password'), $('#pw-drop'), loadPw);
$('#pw-change').addEventListener('click', () => $('#pw-input').click());
registerTarget('pdf', 'password', '加密碼', loadPw);
registerHolder('password', () => heldBytes(pw.src), () => {
  Object.assign(pw, { name: '', src: null, state: '', pages: 0 });
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

/* ---------- unlocking where the file was dropped ----------
   Every tool reads PDFs through readPdf() (js/core.js), which lands here for a password-protected file. Restrictions
   alone are lifted without asking; an opening password is asked for until it is right or the user gives up. */
function askPdfPassword(name, wrong) {
  const d = $('#pwask'), inp = $('#pwask-pass');
  $('#pwask-file').textContent = `「${name}」要輸入密碼才能開啟。解除後就能繼續處理，原本的檔案不會改變。`;
  $('#pwask-err').hidden = !wrong;
  $('#pwask-err').textContent = !wrong ? '' : '密碼不對，請再試一次。' + (/^[a-z]\d{9}$/.test(inp.value) ? '身分證字號的英文字母通常要大寫。' : '');
  if (!wrong) inp.value = '';
  // Settled by the user's action itself (submit, 取消, Esc), all of which happen at once; the dialog's 'close' event
  // is queued and can arrive late, after the next prompt has already opened.
  const form = d.querySelector('form'), cancelBtn = $('#pwask-cancel');
  return new Promise(resolve => {
    const finish = value => {
      form.removeEventListener('submit', onSubmit); cancelBtn.removeEventListener('click', onCancel); d.removeEventListener('cancel', onCancel);
      if (d.open) d.close(); resolve(value);
    };
    const onSubmit = e => { e.preventDefault(); finish(inp.value || null); }; // Enter in the field, or 解除並繼續
    const onCancel = e => { e.preventDefault(); finish(null); };                 // 取消, or Esc
    form.addEventListener('submit', onSubmit); cancelBtn.addEventListener('click', onCancel); d.addEventListener('cancel', onCancel);
    d.showModal(); inp.focus(); inp.select();
  });
}
$('#pwask-show').addEventListener('change', e => { $('#pwask-pass').type = e.target.checked ? 'text' : 'password'; });
async function unlockPdf(name, bytes) {
  try {
    const open = await pdfjsTry(bytes);
    if (open.ok) { // no opening password, only print / copy / edit restrictions
      const { out } = await runQpdf(['--decrypt', '/in.pdf', '/out.pdf'], bytes);
      if (out) { toast(`已解除「${name}」的列印、複製限制`); return out; }
    } else if (open.need) {
      for (let wrong = false; ;) {
        const pass = await askPdfPassword(name, wrong);
        if (pass == null) { toast(`「${name}」沒有解除密碼，所以沒有開啟`); return null; }
        if (!(await pdfjsTry(bytes, pass)).ok) { wrong = true; continue; }
        const { out } = await runQpdf([`--password=${pass}`, '--decrypt', '/in.pdf', '/out.pdf'], bytes);
        if (out) { toast(`已解除「${name}」的密碼`); return out; }
        break;
      }
    }
  } catch (e) { /* fall through to the message below */ }
  toast(`「${name}」有密碼保護，但這份檔案的加密方式無法解除。`, 'err');
  return null;
}
