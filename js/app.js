'use strict';
/* ================= tabs ================= */
const TABS = ['merge', 'split', 'edit', 'sign', 'watermark', 'resize', 'compress', 'img2pdf', 'pdf2img', 'imgtool', 'unmark'];
function showTab(name) {
  if (!TABS.includes(name)) name = 'merge';
  TABS.forEach(t => {
    $('#tab-' + t).setAttribute('aria-selected', t === name ? 'true' : 'false');
    $('#tab-' + t).tabIndex = t === name ? 0 : -1;
    $('#panel-' + t).hidden = t !== name;
  });
  if (name === 'unmark') requestAnimationFrame(fitUm);
  if (name === 'watermark' && wm.pj) requestAnimationFrame(renderWmPage);
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

/* first view: two sample files ready to merge */
(async () => {
  try {
    const a = await makeSample('Quarterly Report', 3, [.04, .48, .42]);
    const b = await makeSample('Appendix: Budget Tables', 2, [.11, .31, .72]);
    if (!merge.items.length) await addMergeFiles([asFile(a, 'quarterly-report.pdf'), asFile(b, 'appendix-budget.pdf')], true);
  } catch (e) { renderMerge(); }
})();
