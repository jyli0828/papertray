'use strict';
/* ================= tabs ================= */
const TABS = ['merge', 'split', 'edit', 'sign', 'form', 'redact', 'watermark', 'resize', 'compress', 'img2pdf', 'pdf2img', 'imgtool', 'unmark'];
function showTab(name) {
  if (!TABS.includes(name)) name = 'merge';
  TABS.forEach(t => {
    $('#tab-' + t).setAttribute('aria-selected', t === name ? 'true' : 'false');
    $('#tab-' + t).tabIndex = t === name ? 0 : -1;
    $('#panel-' + t).hidden = t !== name;
  });
  releaseCaches(name);
  if (name === 'unmark') requestAnimationFrame(fitUm);
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
  for (const d of docs) { try { const r = d.cleanup(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
}
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
  showTab(b.dataset.tab);
  try { history.replaceState(null, '', '#' + b.dataset.tab); } catch (e) { location.hash = b.dataset.tab; }
}));
$('.tabs').addEventListener('keydown', e => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const cur = TABS.findIndex(t => $('#tab-' + t).getAttribute('aria-selected') === 'true');
  const next = TABS[(cur + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
  $('#tab-' + next).click(); $('#tab-' + next).focus();
});
$('#handoff-close').addEventListener('click', hideNext);
window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
showTab(location.hash.slice(1));

/* first view: two sample files ready to merge (pre-built bytes, so no library has to load for them) */
(async () => {
  if (merge.items.length) return;
  const files = MERGE_SAMPLES.map(sm => Object.assign(pdfFile(Uint8Array.from(atob(sm.b64), c => c.charCodeAt(0)), sm.name), { pages: sm.pages }));
  await addMergeFiles(files, true);
})();
