'use strict';
/* ================= tabs ================= */
/* The tab bar is the list of tools, in its order (home first, then by category). */
const TABS = [...document.querySelectorAll('.tabs .tab')].map(b => b.dataset.tab);
/* Opening 紙匣 without a #tool goes back to the tool used last time; the very first time, to the home page. */
function startTab() {
  let t = null; try { t = localStorage.getItem('papertray.tab'); } catch (e) {}
  return TABS.includes(t) ? t : 'home';
}
function showTab(name) {
  if (!TABS.includes(name)) name = startTab();
  TABS.forEach(t => {
    $('#tab-' + t).setAttribute('aria-selected', t === name ? 'true' : 'false');
    $('#tab-' + t).tabIndex = t === name ? 0 : -1;
    $('#panel-' + t).hidden = t !== name;
  });
  try { localStorage.setItem('papertray.tab', name); } catch (e) {}
  // The home page lists every tool itself, as a drawer of folders; the tool tabs would only repeat it.
  document.body.classList.toggle('at-home', name === 'home');
  // On a phone the tab bar is one row that scrolls sideways: bring the open tool into view.
  // Measured on the next frame: measuring now makes the browser lay out the page on the spot, and at start-up that
  // is a whole extra layout (about 35 ms) before the page is complete.
  const nav = $('.tabs'), tb = $('#tab-' + name);
  requestAnimationFrame(() => {
    if (nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: Math.max(0, tb.offsetLeft - (nav.clientWidth - tb.offsetWidth) / 2), behavior: 'smooth' });
  });
  if (name === 'home') renderHomeGroups();
  releaseCaches(name);
  ocrLeave(name);
  checkMemory(name);
  if (name === 'unmark') requestAnimationFrame(fitUm);
  if (name === 'idcard') requestAnimationFrame(drawIdPreview);
  if (name === 'idphoto') requestAnimationFrame(drawPhAll);
  if (name === 'watermark' && wm.pj) requestAnimationFrame(renderWmPage);
}
/* Leaving a tool frees what pdf.js cached for its files (decoded images, fonts); the files stay open and are
   simply re-read when needed again. The editor's files stay warm on the tabs that open the editor. */
function releaseCaches(active) {
  const docs = [];
  if (!['edit', 'sign', 'redact'].includes(active)) Object.values(edit.docs).forEach(d => docs.push(d.pj));
  if (active !== 'split' && split.pj) docs.push(split.pj);
  if (active !== 'pdf2img' && p2i.pj) docs.push(p2i.pj);
  if (active !== 'watermark' && wm.pj) docs.push(wm.pj);
  if (active !== 'form' && ff.pj) docs.push(ff.pj);
  if (active !== 'ocr' && ocrTab.pj) docs.push(ocrTab.pj);
  if (active !== 'compare') for (const d of [cmp.a, cmp.b]) if (d) docs.push(d.pj);
  for (const d of docs) { try { const r = d.cleanup(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
}
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
  showTab(b.dataset.tab);
  try { history.replaceState(null, '', '#' + b.dataset.tab); } catch (e) { location.hash = b.dataset.tab; }
}));
$('.tabs').addEventListener('keydown', e => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  // Arrows move between the tools; 全部工具 hides the tab bar, so they pass it by.
  const tools = TABS.filter(t => t !== 'home'), cur = tools.findIndex(t => $('#tab-' + t).getAttribute('aria-selected') === 'true');
  const next = tools[(cur + (e.key === 'ArrowRight' ? 1 : tools.length - 1)) % tools.length];
  $('#tab-' + next).click(); $('#tab-' + next).focus();
});
$('#handoff-close').addEventListener('click', hideNext);
// The logo and name lead home, as on most sites.
document.querySelectorAll('.brand-mark, .brand h1').forEach(el => el.addEventListener('click', () => $('#tab-home').click()));
window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
showTab(location.hash.slice(1));

/* first view: two sample files ready to merge (pre-built bytes, so no library has to load for them) */
(async () => {
  if (merge.items.length) return;
  const files = MERGE_SAMPLES.map(sm => Object.assign(pdfFile(Uint8Array.from(atob(sm.b64), c => c.charCodeAt(0)), sm.name), { pages: sm.pages }));
  await addMergeFiles(files, true);
})();

/* ---------- installable app (PWA) ----------
   Served over http(s), 紙匣 registers sw.js so it keeps working offline and can be installed. tools/build.py turns
   this off in the single-file bundles, which have no sw.js next to them. */
const PWA = true;
if (PWA && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  // Not on the load event: that waits for Google Fonts, which may never answer. This script runs last, once the
  // page's own scripts and styles are in. Once the worker is in charge it keeps the libraries too (sw.js, cacheLibs()).
  navigator.serviceWorker.register('sw.js')
    .then(() => navigator.serviceWorker.ready).then(reg => { if (reg.active) reg.active.postMessage('cache-libs'); }).catch(() => {});
}
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; $('#install-app').hidden = false; });
$('#install-app').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  try { await installPrompt.userChoice; } catch (e) {}
  installPrompt = null; $('#install-app').hidden = true;
});
window.addEventListener('appinstalled', () => { $('#install-app').hidden = true; toast('已安裝紙匣，可以從桌面或主畫面開啟'); });
