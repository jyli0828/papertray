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
    /* Where on page i (as shown, rotation applied) the pixels matching match(r, g, b) are: [x0, y0, x1, y1] as
       fractions of the page, or null. */
    async ink(file, i, match, scale = .5) {
      const pj = await T.pdf(file), pg = await pj.getPage(i + 1), vp = pg.getViewport({ scale });
      const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data, W = cv.width, H = cv.height;
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        if (match(d[o], d[o + 1], d[o + 2])) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      pj.destroy();
      return x1 < 0 ? null : [x0 / W, y0 / H, (x1 + 1) / W, (y1 + 1) / H].map(v => +v.toFixed(3));
    },
    /* Where each text run containing `want` sits on page i as shown: [x, y] of its start on the baseline, as fractions. */
    async textAt(file, i, want) {
      const pj = await T.pdf(file), pg = await pj.getPage(i + 1), vp = pg.getViewport({ scale: 1 });
      const out = (await pg.getTextContent()).items.filter(it => it.str.includes(want)).map(it => {
        const t = pdfjsLib.Util.transform(vp.transform, it.transform); return [+(t[4] / vp.width).toFixed(3), +(t[5] / vp.height).toFixed(3)];
      });
      pj.destroy(); return out;
    },
    /* One A4 page per rotation, each with a grey block drawn in the page's own top-left corner area. */
    async rotated(rots = [0, 90, 180, 270]) {
      const doc = await PDFDocument.create();
      for (const r of rots) {
        const p = doc.addPage([595.28, 841.89]);
        p.drawRectangle({ x: 150, y: 300, width: 200, height: 300, color: rgb(.5, .5, .5) });
        p.setRotation(degrees(r));
      }
      return pdfFile(await doc.save(), 'rotated.pdf');
    },
    unexpectedErrors() { return T.allowErrors ? [] : T.errors.slice(); }
  };
  const realDeliver = deliver, realToast = toast;
  deliver = async (file, kind, from) => { T.results.push({ file, kind, from }); offerNext(file, kind, from); };
  toast = (msg, kind) => { if (kind === 'err') T.errors.push(msg); realToast(msg, kind); };
  T.realDeliver = realDeliver;
})();
