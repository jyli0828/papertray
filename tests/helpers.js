'use strict';
/* Helpers for the tests in tests/cases.mjs, put into the page before each test as window.T.
   deliver() and toast() are wrapped: finished files are collected in T.results, error toasts in T.errors (a test
   fails on an error toast unless it set T.allowErrors). */
(() => {
  const T = window.T = {
    results: [], errors: [], allowErrors: false,
    ok(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); },
    eq(got, want, msg) {
      const a = JSON.stringify(got), b = JSON.stringify(want);
      if (a !== b) throw new Error(`${msg || '不相等'}：得到 ${a}，應為 ${b}`);
    },
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    async until(pred, what, ms = 30000) {
      const t0 = Date.now();
      for (;;) {
        let v; try { v = await pred(); } catch (e) { v = false; }
        if (v) return v;
        if (Date.now() - t0 > ms) throw new Error('等不到：' + what);
        await T.sleep(50);
      }
    },
    /* Runs fn (usually a button click) and waits for the file it delivers. */
    async result(fn, what = '產生結果', ms = 60000) {
      const n = T.results.length, e = T.errors.length;
      await fn();
      await T.until(() => T.results.length > n || T.errors.length > e, what, ms);
      if (T.results.length === n) throw new Error('沒有產生結果，錯誤提示：' + T.errors.slice(e).join('；'));
      return T.results[T.results.length - 1];
    },
    click(sel) { const el = $(sel); T.ok(el, '找不到 ' + sel); T.ok(!el.disabled, sel + ' 是停用的'); el.click(); },
    /* Sets a form control and fires the events the app listens to. */
    set(sel, value) {
      const el = $(sel); T.ok(el, '找不到 ' + sel);
      if (el.type === 'checkbox') el.checked = value; else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    async idle(sel) { await T.sleep(30); await T.until(() => !$(sel).classList.contains('is-running'), sel + ' 完成', 120000); },
    /* A PDF with one page per label (an empty label makes a blank page). */
    async labeled(labels, name = 'labeled.pdf', size = [595.28, 841.89]) {
      const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
      for (const l of labels) { const p = doc.addPage(size); if (l) p.drawText(l, { x: 60, y: size[1] - 90, size: 28, font }); }
      return pdfFile(await doc.save(), name);
    },
    async pdf(file) { const { bytes } = await fileBytes(file); return openPdfjs(bytes); },
    /* Text of every page. */
    async pdfText(file) {
      const pj = await T.pdf(file), out = [];
      for (let i = 1; i <= pj.numPages; i++) out.push((await (await pj.getPage(i)).getTextContent()).items.map(x => x.str).join(' '));
      pj.destroy(); return out;
    },
    async pdfPages(file) {
      const pj = await T.pdf(file), out = [];
      for (let i = 1; i <= pj.numPages; i++) { const pg = await pj.getPage(i); out.push({ w: Math.round(pg.view[2] - pg.view[0]), h: Math.round(pg.view[3] - pg.view[1]), rotate: pg.rotate }); }
      pj.destroy(); return out;
    },
    async zip(file) { await newZip(); return JSZip.loadAsync(file); },
    unexpectedErrors() { return T.allowErrors ? [] : T.errors.slice(); }
  };
  const realDeliver = deliver, realToast = toast;
  deliver = async (file, kind, from) => { T.results.push({ file, kind, from }); offerNext(file, kind, from); };
  toast = (msg, kind) => { if (kind === 'err') T.errors.push(msg); realToast(msg, kind); };
  T.realDeliver = realDeliver;
})();
