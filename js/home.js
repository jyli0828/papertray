'use strict';
/* ================= HOME: every tool, tools suggested for dropped files, Ctrl+K search =================
   The tool list is read from the tab bar (name, icon, description, category), so a new tab appears here by itself.
   Files dropped on the home page are looked at (password? scanned? two versions? a portrait photo?) and the fitting
   tools are offered; picking one hands the files over with the same loader 「接著處理」 uses. */
const TOOL_WORDS = {
  merge: '合併 結合 接起來 combine merge 雙面 交錯 掃描', split: '拆分 分割 切開 split', resize: '尺寸 a4 裁切 白邊 resize',
  edit: '編輯 排序 旋轉 刪除 刪頁 插入 空白頁 頁碼 頁首 頁尾 標註 螢光筆 rotate', sign: '簽名 簽章 sign 日期',
  form: '表單 填寫 欄位 form', password: '密碼 加密 解密 解鎖 帳單 對帳單 password lock',
  watermark: '浮水印 watermark logo 印章', compress: '壓縮 縮小 檔案大小 compress mb', img2pdf: '圖片 照片 轉 pdf jpg png heic 翻拍 校正',
  pdf2img: '轉圖片 jpg png 抽出文字 txt', ocr: '文字辨識 ocr 掃描 辨識 可搜尋 複製文字',
  idcard: '證件 影印 身分證 健保卡 駕照 正反面', idphoto: '證件照 大頭照 1吋 2吋 4x6 相紙 護照 簽證', imgtool: '圖片 壓縮 縮小 格式 webp 尺寸',
  unmark: '去浮水印 消除 修圖 移除 塗抹'
};
function toolList() {
  return [...document.querySelectorAll('.tab-group')].flatMap(g => [...g.querySelectorAll('.tab')].map(b => ({
    tab: b.dataset.tab, name: b.querySelector('span').textContent, desc: b.title,
    group: g.querySelector('.tab-group-label').textContent, icon: b.querySelector('svg').outerHTML
  })));
}
function toolMatches(t, q) {
  const hay = `${t.name} ${t.desc} ${t.group} ${TOOL_WORDS[t.tab] || ''}`.toLowerCase();
  return q.trim().toLowerCase().split(/\s+/).every(w => !w || hay.includes(w));
}
function openTool(tab) { showTab(tab); try { history.replaceState(null, '', '#' + tab); } catch (e) {} }
const toolButton = (t, cls, note) => `<button class="${cls}" data-tab="${t.tab}">${t.icon}<span><b>${t.name}</b><small>${note || t.desc}</small></span></button>`;

/* ---------- all tools, by category ----------
   Two folders side by side, the ones with the most tools first: folders of the same size then share a row and end
   level, with no gaps (the order among equal sizes is the tab bar's). */
function renderHomeGroups() {
  const q = $('#home-q').value, list = toolList(), size = g => list.filter(t => t.group === g).length;
  const groups = [...new Set(list.map(t => t.group))].sort((a, b) => size(b) - size(a));
  $('#home-groups').innerHTML = groups.map(g => {
    const ts = list.filter(t => t.group === g && toolMatches(t, q));
    return ts.length ? `<div class="home-group"><h3>${g}</h3><div class="home-sheet">${ts.map(t => toolButton(t, 'home-tool')).join('')}</div></div>` : '';
  }).join('') || '<p class="hint">沒有符合的工具，換個說法試試。</p>';
}
$('#home-q').addEventListener('input', renderHomeGroups);
$('#home-q').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const first = $('#home-groups .home-tool'); if (first) openTool(first.dataset.tab);
});
$('#home-groups').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) openTool(b.dataset.tab); });

/* ---------- suggestions for dropped files ---------- */
let homeFiles = [];
async function pdfFacts(f) {
  const { bytes } = await fileBytes(f), out = { size: bytes.length, locked: hasEncrypt(bytes), pages: 0, scanned: false };
  if (out.locked) return out;
  try {
    const pj = await openPdfjs(bytes, false); out.pages = pj.numPages;
    let chars = 0;
    for (let i = 1; i <= Math.min(3, pj.numPages); i++) {
      const pg = await pj.getPage(i), tc = await pg.getTextContent();
      chars += tc.items.reduce((n, it) => n + (it.str || '').trim().length, 0); pg.cleanup();
    }
    out.scanned = chars < 20; pj.destroy();
  } catch (e) { out.broken = true; }
  return out;
}
async function suggestTools(files) {
  const pdfs = files.filter(isPdf), imgs = files.filter(f => !isPdf(f) && isImage(f)), picks = [];
  const add = (tab, why) => { if (!picks.some(p => p.tab === tab)) picks.push({ tab, why }); };
  if (pdfs.length) {
    const facts = await Promise.all(pdfs.slice(0, 6).map(pdfFacts));
    if (facts.some(f => f.locked)) add('password', '有密碼保護：先解除密碼，才能做其他處理');
    if (pdfs.length === 2) add('merge', '接成一份；正面、反面分開掃描的可以交錯合併');
    else if (pdfs.length > 2) add('merge', `${pdfs.length} 份接成一份`);
    if (facts.some(f => f.scanned && !f.locked)) add('ocr', '看起來是掃描檔：辨識文字，變成可以搜尋的 PDF');
    const big = facts.find(f => f.size > 4 * 1048576);
    if (big) add('compress', `檔案有 ${fmtSize(big.size)}：壓縮成比較好寄的大小`);
    if (pdfs.length === 1) {
      add('edit', '排序、旋轉、刪頁、選取空白頁、加頁碼');
      add('sign', '簽名、加上日期'); add('split', '拆成幾份');
      add('pdf2img', '每頁存成圖片，或抽出文字');
    }
  }
  if (imgs.length) {
    let portrait = false;
    if (imgs.length === 1) { try { const s = await imageSize(imgs[0]); portrait = s.h > s.w * 1.1; } catch (e) {} }
    add('img2pdf', imgs.length > 1 ? `${imgs.length} 張合成一份 PDF；翻拍的文件可以拉正` : '轉成 PDF；翻拍的文件可以拉正、去陰影');
    if (imgs.length === 2) add('idcard', '證件正反面：依實際大小印在同一張 A4');
    if (portrait) add('idphoto', '大頭照：排成 2 吋、1 吋，印在 4×6 相紙');
    add('ocr', '辨識圖片裡的字'); add('imgtool', '壓縮、縮小尺寸、轉換格式');
  }
  return picks.slice(0, 6);
}
async function homeTakeFiles(files) {
  files = await prepImages(files.filter(f => isPdf(f) || isImage(f)));
  if (!files.length) { toast('請放入 PDF 或圖片', 'err'); return; }
  homeFiles = files;
  $('#home-files').textContent = files.length === 1 ? `「${files[0].name}」可以：` : `${files.length} 個檔案可以：`;
  $('#home-picks').innerHTML = '<p class="hint">看看是什麼檔案…</p>';
  $('#home-suggest').hidden = false; $('#home-drop').hidden = true;
  const list = toolList(), picks = await suggestTools(files);
  $('#home-picks').innerHTML = picks.map(p => toolButton(list.find(t => t.tab === p.tab), 'home-pick', p.why)).join('')
    + '<p class="hint">或在下方選其他工具，檔案會一起帶過去。</p>';
}
/* Tools that take PDFs and pictures alike get every file; the others get the kind they work on. */
const TAKES_BOTH = ['merge', 'edit', 'ocr'];
async function sendHomeFiles(tab) {
  const t = NEXT_TARGETS.pdf.find(x => x.tab === tab) || NEXT_TARGETS.image.find(x => x.tab === tab);
  const isImgTool = !NEXT_TARGETS.pdf.some(x => x.tab === tab);
  let files = TAKES_BOTH.includes(tab) ? homeFiles : homeFiles.filter(f => isImgTool ? !isPdf(f) : isPdf(f));
  if (tab === 'password') {
    // 密碼 works on one file: the one with the password, not simply the first.
    const locked = [];
    for (const f of files) if (hasEncrypt((await fileBytes(f)).bytes)) locked.push(f);
    if (locked.length) files = locked;
    if (locked.length > 1) toast(`有 ${locked.length} 份檔案有密碼，先處理「${locked[0].name}」；其他的可以之後再放入。`);
  }
  // A tool still working on its own files must not get new ones under it (see toolBusy()); they stay here for later.
  if (t && files.length && toolBusy($('#panel-' + tab))) return;
  openTool(tab);
  if (t && files.length) t.load(files.slice());
  else if (homeFiles.length) toast(isImgTool ? '這個工具處理圖片，請在這裡放入圖片' : '這個工具處理 PDF，請在這裡放入 PDF');
}
function clearHomeFiles() { homeFiles = []; $('#home-suggest').hidden = true; $('#home-drop').hidden = false; }
$('#home-picks').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) sendHomeFiles(b.dataset.tab); });
$('#home-clear').addEventListener('click', clearHomeFiles);
bindInput($('#home-input'), homeTakeFiles);
acceptFiles($('#panel-home'), $('#home-drop'), homeTakeFiles);
// With files waiting, a tool picked from the full list gets them too.
$('#home-groups').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]'); if (b && homeFiles.length) { e.stopImmediatePropagation(); sendHomeFiles(b.dataset.tab); }
}, true);
registerHolder('home', () => homeFiles.reduce((n, f) => n + (f.size || 0), 0), clearHomeFiles);

/* ---------- Ctrl+K: jump to a tool by typing ---------- */
const cmdk = { list: [], i: 0 };
function renderCmdk() {
  const q = $('#cmdk-q').value;
  cmdk.list = toolList().filter(t => toolMatches(t, q));
  cmdk.i = Math.min(cmdk.i, Math.max(0, cmdk.list.length - 1));
  $('#cmdk-list').innerHTML = cmdk.list.map((t, k) => `<li role="option" data-tab="${t.tab}" aria-selected="${k === cmdk.i}">${t.icon}<b>${t.name}</b><small>${t.group}</small></li>`).join('')
    || '<li class="hint">沒有符合的工具</li>';
  const cur = $('#cmdk-list [aria-selected="true"]'); if (cur) cur.scrollIntoView({ block: 'nearest' });
}
function openCmdk() {
  const d = $('#cmdk'); if (d.open) return;
  $('#cmdk-q').value = ''; cmdk.i = 0; renderCmdk(); d.showModal(); $('#cmdk-q').focus();
}
function pickCmdk(tab) { $('#cmdk').close(); if (tab) openTool(tab); }
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
    if (document.querySelector('dialog[open]:not(#cmdk)')) return;
    e.preventDefault(); openCmdk();
  }
});
$('#cmdk-q').addEventListener('input', () => { cmdk.i = 0; renderCmdk(); });
$('#cmdk-q').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); const n = cmdk.list.length; if (!n) return;
    cmdk.i = (cmdk.i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; renderCmdk();
  } else if (e.key === 'Enter') { e.preventDefault(); const t = cmdk.list[cmdk.i]; if (t) pickCmdk(t.tab); }
});
$('#cmdk-list').addEventListener('click', e => { const li = e.target.closest('[data-tab]'); if (li) pickCmdk(li.dataset.tab); });
$('#cmdk').addEventListener('click', e => { if (e.target === $('#cmdk')) $('#cmdk').close(); }); // a click on the backdrop
renderHomeGroups();
