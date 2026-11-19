'use strict';
/* ================= REDACT (entry point; boxes are drawn in the page editor, flattening happens on export) ================= */
async function startRedacting(files) {
  await loadEditFiles(files, p => {
    showTab('edit'); try { history.replaceState(null, '', '#edit'); } catch (e) {}
    openTextEditor(p, 'redact');
  });
}
bindInput($('#redact-input'), startRedacting);
acceptFiles($('#redact-drop'), $('#redact-drop'), startRedacting);
registerTarget('pdf', 'redact', '遮蔽', startRedacting);
$('#redact-sample').addEventListener('click', async () => {
  // A made-up application form, so there is something obviously private to cover.
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold), font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595.28, 841.89]);
  p.drawRectangle({ x: 0, y: 770, width: 595.28, height: 72, color: rgb(.04, .48, .42) });
  p.drawText('Account Application (sample)', { x: 50, y: 795, size: 22, font: bold, color: rgb(1, 1, 1) });
  const rows = [['Full name', 'Lin Ya-Ting'], ['ID number', 'A123456789'], ['Date of birth', '1990-04-12'], ['Phone', '0912-345-678'],
    ['Address', 'No. 10, Example Rd., Taipei'], ['Bank account', '012-3456-7890-12']];
  rows.forEach(([k, v], i) => {
    const y = 700 - i * 44;
    p.drawText(k, { x: 50, y, size: 12, font, color: rgb(.4, .45, .5) });
    p.drawText(v, { x: 200, y, size: 15, font: bold, color: rgb(.1, .13, .17) });
    p.drawLine({ start: { x: 50, y: y - 12 }, end: { x: 545, y: y - 12 }, thickness: .6, color: rgb(.85, .87, .9) });
  });
  p.drawText('Signature: ______________________', { x: 50, y: 360, size: 12, font, color: rgb(.4, .45, .5) });
  startRedacting([pdfFile(await doc.save(), 'application-form.pdf')]);
});
