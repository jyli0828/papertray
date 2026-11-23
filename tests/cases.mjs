/* 紙匣的測試案例。每個 run() 都在頁面裡執行（不是在 Node 裡）：js/ 的所有名稱都能直接用，加上 tests/helpers.js 的 T。
   run() 回傳的字串會印在測試名稱後面。slow: true 的測試可以用 --skip-slow 略過。 */
export default [
  /* ---------- shared code ---------- */
  {
    name: '頁碼範圍：一般寫法、全形、錯誤',
    async run() {
      T.eq(parseRanges('1-3, 5, 8-', 10).ranges, [[1, 3], [5, 5], [8, 10]]);
      T.eq(parseRanges('１－３，５、7～', 9).ranges, [[1, 3], [5, 5], [7, 9]], '全形輸入');
      for (const bad of ['3-1', '11', '0', 'abc', '-']) T.ok(parseRanges(bad, 10).error, `「${bad}」應該報錯`);
      T.eq(parseRanges(' ， ', 10).ranges, [], '只有分隔符號');
    }
  },
  {
    name: '比較：diff 演算法和最長共同子序列一致',
    async run() {
      const lcs = (a, b) => {
        const dp = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1));
        for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        return dp[0][0];
      };
      for (let t = 0; t < 2000; t++) {
        const K = 1 + (t % 4), a = Array.from({ length: t % 13 }, () => Math.floor(Math.random() * K)), b = Array.from({ length: (t * 7) % 11 }, () => Math.floor(Math.random() * K));
        let i = 0, j = 0, eq = 0;
        for (const r of myersRuns(a, b, 1000)) {
          T.ok(r.n > 0, 'run 長度為 0');
          if (r.type === 'eq') { for (let k = 0; k < r.n; k++) T.ok(a[i + k] === b[j + k], 'eq 段落內容不同'); i += r.n; j += r.n; eq += r.n; }
          else if (r.type === 'del') i += r.n; else j += r.n;
        }
        T.ok(i === a.length && j === b.length, '沒有走完兩個序列');
        T.eq(eq, lcs(a, b), `不是最短編輯 ${JSON.stringify([a, b])}`);
      }
      return '2000 組隨機序列';
    }
  },

  /* ---------- 整理頁面 ---------- */
  {
    name: '合併：首頁範例、雙面掃描交錯',
    async run() {
      showTab('merge');
      await T.until(() => merge.items.length === 2, '範例檔');
      const pages = merge.items.reduce((n, it) => n + it.pages, 0);
      const r = await T.result(() => T.click('#merge-go'));
      T.eq((await T.pdfPages(r.file)).length, pages, '合併後頁數');
      // fronts in order, backs scanned as a turned-over stack (last page first)
      await addMergeFiles([await T.labeled(['F1', 'F2', 'F3'], 'front.pdf'), await T.labeled(['B3', 'B2', 'B1'], 'back.pdf')]);
      T.eq(merge.items.map(i => i.name), ['front.pdf', 'back.pdf'], '加入檔案時移除範例');
      T.set('#merge-how', 'zip'); T.set('#merge-rev', true);
      const z = await T.result(() => T.click('#merge-go'));
      T.eq((await T.pdfText(z.file)).map(s => s.trim()), ['F1', 'B1', 'F2', 'B2', 'F3', 'B3'], '交錯順序');
      T.set('#merge-how', 'seq');
      merge.items[0].range = '２－３'; updateMergeSummary();
      const p = await T.result(() => T.click('#merge-go'));
      T.eq((await T.pdfText(p.file)).map(s => s.trim()), ['F2', 'F3', 'B3', 'B2', 'B1'], '取頁（全形）');
    }
  },
  {
    name: '合併：保留書籤（巢狀、具名目的地、網址），每份檔案一個書籤，取頁時跟著調整',
    async run() {
      const a = await T.withOutline(['A1', 'A2', 'A3'], [
        { title: '第一章', page: 0, open: true, kids: [{ title: '1.1 節', page: 1 }] },
        { title: '第二章', name: 'chap2', pageOfName: 2 },
        { title: '網站', url: 'https://example.com/' }
      ], '報告.pdf');
      const b = await T.withOutline(['B1', 'B2'], [{ title: 'Intro', page: 1 }], 'appendix.pdf');
      showTab('merge'); await addMergeFiles([a, b]);
      T.eq(merge.items.map(i => i.marks), [4, 1], '清單顯示書籤數');
      T.ok($('#merge-list').textContent.includes('4 個書籤'), '清單文字');
      T.set('#merge-bm', true);
      const r1 = await T.result(() => T.click('#merge-go'));
      T.eq(await T.outline(r1.file), [
        { t: '報告', p: 1, k: [{ t: '第一章', p: 1, k: [{ t: '1.1 節', p: 2 }] }, { t: '第二章', p: 3 }, { t: '網站', p: 'https://example.com/' }] },
        { t: 'appendix', p: 4, k: [{ t: 'Intro', p: 5 }] }
      ], '每份檔案一個書籤');
      // without the per-file bookmarks; and only pages 2-3 of the first file
      T.set('#merge-bm', false); merge.items[0].range = '2-3'; updateMergeSummary();
      const r2 = await T.result(() => T.click('#merge-go'));
      T.eq(await T.outline(r2.file), [
        { t: '第一章', p: 1, k: [{ t: '1.1 節', p: 1 }] }, // its own page (1) was left out: it goes to its sub-bookmark
        { t: '第二章', p: 2 }, { t: '網站', p: 'https://example.com/' }, { t: 'Intro', p: 4 }
      ], '取頁後的書籤');
      // files without bookmarks still get one each; interleaving adds none of its own
      T.set('#merge-bm', true);
      await addMergeFiles([await T.labeled(['X'], 'x.pdf'), await T.labeled(['Y', 'Y2'], 'y.pdf')]); merge.items.splice(0, 2); renderMerge();
      T.eq(await T.outline((await T.result(() => T.click('#merge-go'))).file), [{ t: 'x', p: 1 }, { t: 'y', p: 2 }], '沒有書籤的檔案');
      T.set('#merge-how', 'zip');
      T.ok($('#merge-bm-wrap').hidden, '交錯時不顯示這個選項');
      T.eq(await T.outline((await T.result(() => T.click('#merge-go'))).file), [], '交錯合併不加檔名書籤');
      T.set('#merge-how', 'seq');
    }
  },
  {
    name: '拆分：依範圍、每 N 頁',
    async run() {
      showTab('split'); T.click('#split-sample');
      await T.until(() => split.pages.length === 6, '範例檔');
      const r = await T.result(() => T.click('#split-go'));
      T.eq(r.kind, 'zip');
      T.eq(Object.keys((await T.zip(r.file)).files).sort(), ['quarterly-report-第1-3頁.pdf', 'quarterly-report-第4-6頁.pdf']);
      $('input[name="split-mode"][value="every"]').checked = true; T.set('#split-every', '4');
      const e = await T.result(() => T.click('#split-go'));
      const files = Object.values((await T.zip(e.file)).files);
      T.eq(files.length, 2, '每 4 頁');
      T.set('#split-ranges', '2'); // focusing the field switches back to ranges; one range gives one PDF
      $('input[name="split-mode"][value="range"]').checked = true; renderSplit();
      const one = await T.result(() => T.click('#split-go'));
      T.eq(one.kind, 'pdf'); T.eq((await T.pdfPages(one.file)).length, 1);
    }
  },
  {
    name: '編輯：旋轉、刪除、複製、復原、匯出',
    async run() {
      showTab('edit');
      await loadEditFiles([await T.labeled(['P1', 'P2', 'P3', 'P4'], 'four.pdf')]);
      await T.until(() => edit.pages.every(p => p.view), '頁面資訊');
      const btn = (i, act) => $(`#edit-grid .page-card:nth-child(${i + 1}) [data-act="${act}"]`).click();
      btn(0, 'rotr'); btn(1, 'del'); btn(0, 'dup');
      T.eq(edit.pages.length, 4, '刪一頁、複製一頁');
      undoEdit();
      T.eq(edit.pages.length, 3, '復原複製');
      const r = await T.result(() => T.click('#edit-export'));
      T.eq((await T.pdfText(r.file)).map(s => s.trim()), ['P1', 'P3', 'P4']);
      T.eq((await T.pdfPages(r.file))[0].rotate, 90, '第 1 頁旋轉');
    }
  },
  {
    name: '編輯：頁碼（起始數字空白時從 1 開始）、頁首',
    async run() {
      showTab('edit');
      await loadEditFiles([await T.labeled(['', ''], 'n.pdf')]);
      await T.until(() => edit.pages.every(p => p.view), '頁面資訊');
      T.set('#edit-numbers', true); T.set('#pn-fmt', 'nN'); T.set('#hf-head', 'Report {頁}/{總頁}');
      for (const [start, want] of [['', ['1 / 2', '2 / 2']], ['5', ['5 / 6', '6 / 6']]]) {
        T.set('#pn-start', start);
        const r = await T.result(() => T.click('#edit-export'));
        const text = await T.pdfText(r.file);
        want.forEach((w, i) => T.ok(text[i].includes(w), `第 ${i + 1} 頁應有「${w}」：${text[i]}`));
        T.ok(text[1].includes('Report 2/2'), '頁首：' + text[1]);
      }
    }
  },
  {
    name: '編輯：選取空白頁',
    async run() {
      showTab('edit');
      await loadEditFiles([await T.labeled(['Text', '', 'More text', ''], 'scan.pdf')]);
      await T.until(() => edit.pages.every(p => p.view), '頁面資訊');
      T.click('#edit-find-blank'); await T.idle('#edit-find-blank');
      T.eq(edit.pages.map(p => p.selected), [false, true, false, true]);
    }
  },
  {
    name: '調整尺寸：統一成 A4、裁白邊',
    async run() {
      showTab('resize'); T.click('#rs-sample');
      await T.until(() => rs.n === 3, '範例檔');
      const fit = await T.result(() => T.click('#rs-go'));
      for (const p of await T.pdfPages(fit.file)) T.ok([595, 842].includes(p.w) && [595, 842].includes(p.h) && p.w !== p.h, 'A4：' + JSON.stringify(p));
      setRsMode('crop');
      const crop = await T.result(() => T.click('#rs-go'));
      const pages = await T.pdfPages(crop.file);
      T.ok(pages[0].w < 400 && pages[0].h < 500, '裁掉白邊：' + JSON.stringify(pages[0]));
    }
  },

  {
    name: '旋轉過的頁面：頁碼、頁首、浮水印、遮蔽框、調整尺寸都在看到的位置',
    async run() {
      const grey = (r, g, b) => r > 100 && r < 160 && Math.abs(r - g) < 12 && Math.abs(g - b) < 12;
      const near = (a, b, tol, what) => T.ok(a && b && a.every((v, k) => Math.abs(v - b[k]) <= tol), `${what}：得到 ${JSON.stringify(a)}，應接近 ${JSON.stringify(b)}`);
      const src = await T.rotated(), rots = [0, 90, 180, 270];
      const block = []; for (let i = 0; i < 4; i++) block.push(await T.ink(src, i, grey)); // where pdf.js shows the block

      // page numbers bottom right, header centred at the top; a redaction box 40 pt from the top-left corner
      showTab('edit'); await loadEditFiles([src]);
      await T.until(() => edit.pages.every(p => p.view), '頁面資訊');
      T.set('#edit-numbers', true); T.set('#pn-fmt', 'n'); T.set('#pn-pos', 'br'); T.set('#pn-start', '1');
      T.set('#hf-head', 'HEADER'); T.set('#hf-head-pos', 'c');
      const out = await T.result(() => T.click('#edit-export'));
      T.eq((await T.pdfPages(out.file)).map(p => p.rotate), rots, '旋轉保留');
      for (let i = 0; i < 4; i++) {
        const [n] = await T.textAt(out.file, i, String(i + 1)), [h] = await T.textAt(out.file, i, 'HEADER');
        T.ok(n && n[0] > .85 && n[1] > .9, `第 ${i + 1} 頁（${rots[i]}°）頁碼應在右下：${JSON.stringify(n)}`);
        T.ok(h && h[0] > .35 && h[0] < .5 && h[1] < .1, `第 ${i + 1} 頁（${rots[i]}°）頁首應在上方置中：${JSON.stringify(h)}`);
      }
      T.set('#edit-numbers', false); T.set('#hf-head', '');
      for (const p of edit.pages) {
        te.page = p; te.R = (p.baseRot + p.rot) % 360;
        const a = { id: uid(), type: 'redact', wPt: 150, hPt: 80 }; setTopLeft(a, 40, 40); p.annots.push(a);
      }
      te.page = null;
      const red = await T.result(() => T.click('#edit-export'));
      for (let i = 0; i < 4; i++) {
        const [dw, dh] = rots[i] % 180 ? [841.89, 595.28] : [595.28, 841.89];
        near(await T.ink(red.file, i, (r, g, b) => r < 30 && g < 30 && b < 30), [40 / dw, 40 / dh, 190 / dw, 120 / dh], .015, `第 ${i + 1} 頁（${rots[i]}°）遮蔽框`);
        // the page is now a JPEG, which leaves a grey fringe around the black box (top left): compare the block's far edges
        const g = await T.ink(red.file, i, grey);
        near(g && g.slice(2), block[i].slice(2), .015, `第 ${i + 1} 頁（${rots[i]}°）遮蔽後內容`);
      }

      // watermark in the top-left corner, level
      showTab('watermark'); await loadWm([src]);
      T.set('#wm-text', 'WM'); T.set('#wm-pos', 'tl'); T.set('#wm-angle', '0'); T.set('#wm-size', '40'); T.set('#wm-pages', ''); T.set('#wm-opacity', '100');
      const wmOut = await T.result(() => T.click('#wm-go'));
      for (let i = 0; i < 4; i++) {
        const b = await T.ink(wmOut.file, i, (r, g, b) => r > 150 && g < 140 && b < 140);
        T.ok(b && b[0] < .1 && b[1] < .1 && b[2] < .35 && b[3] < .2, `第 ${i + 1} 頁（${rots[i]}°）浮水印應在左上：${JSON.stringify(b)}`);
      }

      // resize: fit to A4 keeps the look; cropping keeps the block and trims the rest
      showTab('resize'); await loadResize([src]); setRsMode('fit'); T.set('#rs-size', 'a4'); T.set('#rs-orient', 'auto');
      const fit = await T.result(() => T.click('#rs-go'));
      for (let i = 0; i < 4; i++) near(await T.ink(fit.file, i, grey), block[i], .03, `第 ${i + 1} 頁（${rots[i]}°）統一尺寸後的內容`);
      setRsMode('crop');
      const crop = await T.result(() => T.click('#rs-go'));
      for (let i = 0; i < 4; i++) {
        const b = await T.ink(crop.file, i, grey);
        T.ok(b && b[2] - b[0] > .6 && b[3] - b[1] > .6, `第 ${i + 1} 頁（${rots[i]}°）裁白邊後內容應佔滿大部分：${JSON.stringify(b)}`);
      }
    }
  },

  {
    name: '裁切框不在原點的頁面、編輯器的文字與「套用到其他頁」',
    async run() {
      const red = (r, g, b) => r > 150 && g < 110 && b < 110, black = (r, g, b) => r < 30 && g < 30 && b < 30;
      const near = (a, b, tol, what) => T.ok(a && b && a.every((v, k) => Math.abs(v - b[k]) <= tol), `${what}：得到 ${JSON.stringify(a)}，應接近 ${JSON.stringify(b)}`);
      // page 1: crop box moved away from the origin; page 2: the same, turned 90°; page 3: a small landscape page
      const doc = await PDFDocument.create();
      for (const r of [0, 90]) {
        const p = doc.addPage([595.28, 841.89]);
        p.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(.85, .85, .85) }); // outside the crop box: must not show
        p.drawRectangle({ x: 80, y: 90, width: 420, height: 650, color: rgb(1, 1, 1) });
        p.setCropBox(80, 90, 420, 650); p.setRotation(degrees(r));
      }
      doc.addPage([420, 297]);
      const src = pdfFile(await doc.save(), 'crop.pdf');
      showTab('edit'); await loadEditFiles([src]);
      await T.until(() => edit.pages.every(p => p.view), '頁面資訊');
      T.eq(edit.pages[0].view, [80, 90, 500, 740], 'pdf.js 的 view 是裁切框');
      // red text 30 pt from the top-left of page 1 as shown, then copied to every page; a black box at bottom right of page 2
      const p0 = edit.pages[0]; te.page = p0; te.R = 0;
      const a = { id: uid(), type: 'text', text: 'Hi', size: 30, color: '#ff0000' }; measureAnnot(a); setTopLeft(a, 30, 30); p0.annots.push(a);
      te.sel = a; $('#te-apply-to').value = 'all'; $('#te-apply-go').click();
      const p1 = edit.pages[1]; te.page = p1; te.R = 90;
      const box = { id: uid(), type: 'redact', wPt: 100, hPt: 60 }; setTopLeft(box, 650 - 100 - 20, 420 - 60 - 20); p1.annots.push(box);
      te.page = null; te.sel = null;
      T.set('#edit-numbers', true); T.set('#pn-fmt', 'n'); T.set('#pn-pos', 'bc');
      const out = await T.result(() => T.click('#edit-export'));
      T.set('#edit-numbers', false);
      const pages = await T.pdfPages(out.file);
      const shown = [[420, 650], [650, 420], [420, 297]];
      for (let i = 0; i < 3; i++) {
        const [dw, dh] = shown[i];
        near(await T.ink(out.file, i, red), [30 / dw, 30 / dh, (30 + a.wPt) / dw, (30 + a.hPt) / dh], .03, `第 ${i + 1} 頁的文字`);
        const [n] = await T.textAt(out.file, i, String(i + 1));
        T.ok(n && Math.abs(n[0] - .5) < .05 && n[1] > .9, `第 ${i + 1} 頁頁碼應在下方置中：${JSON.stringify(n)}`);
      }
      near(await T.ink(out.file, 1, black), [530 / 650, 340 / 420, 630 / 650, 400 / 420], .015, '第 2 頁的遮蔽框');
      // What lies outside the crop box (light grey) would show as a band along the page edges. (Light grey also appears
      // inside: anti-aliased page numbers, and the JPEG fringe round the box on the redacted page.)
      const lightGrey = (r, g, b) => r > 200 && r < 225 && Math.abs(r - g) < 6;
      for (const i of [0, 1]) {
        const g = await T.ink(out.file, i, lightGrey);
        T.ok(!g || (g[0] > .02 && g[1] > .02 && g[2] < .98 && g[3] < .98), `第 ${i + 1} 頁出現裁切框外的內容：` + JSON.stringify(g));
      }
      T.eq(pages.map(p => [p.w, p.h]), [[420, 650], [420, 650], [420, 297]], '頁面大小');
    }
  },

  /* ---------- 填寫與簽署 ---------- */
  {
    name: '簽名：換第二份 PDF 時不會帶著第一份',
    async run() {
      await startSigning([await T.labeled(['A1', 'A2'], 'a.pdf')]);
      await T.until(() => dlg.open, '簽名視窗'); $('#te-done').click();
      await startSigning([await T.labeled(['B1', 'B2', 'B3'], 'b.pdf')]);
      await T.until(() => dlg.open, '簽名視窗');
      T.eq(Object.values(edit.docs).map(d => d.name), ['b.pdf']);
      T.eq($('#te-title').textContent, '第 1 頁');
      T.eq($('#edit-name').value, 'b-編輯.pdf');
      // a signature placed on the page ends up in the export
      sigs.list = [{ src: (() => { const c = document.createElement('canvas'); c.width = 60; c.height = 20; c.getContext('2d').fillRect(5, 8, 50, 4); return c.toDataURL('image/png'); })(), w: 60, h: 20 }]; sigs.sel = 0;
      setTeMode('sig');
      const r0 = overlay.getBoundingClientRect();
      overlay.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r0.left + 100, clientY: r0.top + 100 }));
      T.eq(edit.pages[0].annots.length, 1, '放上簽名');
      $('#te-done').click();
      const r = await T.result(() => T.click('#edit-export'));
      T.eq((await T.pdfText(r.file)).map(s => s.trim()), ['B1', 'B2', 'B3']);
      const ops = await (await (await T.pdf(r.file)).getPage(1)).getOperatorList();
      T.ok(ops.fnArray.includes(pdfjsLib.OPS.paintImageXObject), '簽名圖片');
    }
  },
  {
    name: '填表單：中文、下拉、單選、勾選',
    async run() {
      showTab('form'); T.click('#ff-sample');
      await T.until(() => ff.fields.length >= 8, '表單欄位');
      const set = (name, v) => { const el = $(`#ff-pages .ff-field[data-name="${name}"]`); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
      set('name', '王小明'); set('city', 'Taichung'); set('address', '台北市信義路\n五段 7 號');
      const radio = [...document.querySelectorAll('#ff-pages .ff-field[type="radio"]')][1];
      radio.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); radio.click();
      $('#ff-pages .ff-field[type="checkbox"]').click();
      const r = await T.result(() => T.click('#ff-go'));
      const an = await (await (await T.pdf(r.file)).getPage(1)).getAnnotations();
      const val = n => an.find(a => a.fieldName === n).fieldValue;
      T.eq(val('name'), '王小明'); T.eq(val('city'), ['Taichung']); T.eq(val('address'), '台北市信義路\n五段 7 號');
      T.eq(val('plan'), radio.value); T.ok(val('newsletter') !== 'Off', '勾選');
    }
  },

  /* ---------- 隱私與安全 ---------- */
  {
    name: '遮蔽個資：自動找出身分證號，匯出後文字真的刪掉',
    async run() {
      showTab('redact'); T.click('#redact-sample');
      await T.until(() => dlg.open && te.page, '遮蔽視窗');
      document.querySelectorAll('[data-rf]').forEach(c => { c.checked = ['id', 'mobile'].includes(c.dataset.rf); });
      T.click('#rf-go'); await T.idle('#rf-go');
      T.eq(edit.pages[0].annots.filter(a => a.type === 'redact').length, 2, '身分證、手機各一');
      $('#te-done').click();
      const r = await T.result(() => T.click('#edit-export'));
      const text = (await T.pdfText(r.file)).join('');
      T.ok(!text.includes('A123456789') && !text.includes('0912'), '匯出檔仍有個資：' + text);
    }
  },
  {
    name: '密碼：中文密碼加密、解除，就地解除限制',
    async run() {
      showTab('password');
      await loadPw([await T.labeled(['Secret'], 's.pdf')]);
      T.set('#pw-new', '密碼123'); T.set('#pw-new2', '密碼123');
      const locked = await T.result(() => T.click('#pw-lock-go'));
      T.eq(locked.kind, 'locked');
      T.ok((await pdfjsTry(locked.file.bytes, '密碼123')).ok, '用密碼開得了');
      T.ok(!(await pdfjsTry(locked.file.bytes)).ok, '沒密碼打不開');
      await loadPw([locked.file]);
      T.eq(pw.state, 'locked');
      T.set('#pw-old', '密碼123');
      const open = await T.result(() => T.click('#pw-unlock-go'));
      T.ok(!hasEncrypt(open.file.bytes), '已解除');
      T.eq((await T.pdfText(open.file))[0].trim(), 'Secret');
      // print / copy restrictions only: any tool lifts them without asking
      const { out } = await runQpdf(['--encrypt', '--user-password=', '--owner-password=own', '--bits=256', '--print=none', '--', '/in.pdf', '/out.pdf'], (await T.labeled(['R'])).bytes);
      const got = await readPdf(pdfFile(out, 'restricted.pdf'));
      T.ok(got && !hasEncrypt(got.bytes), '限制已解除');
    }
  },
  {
    name: '加浮水印：頁碼欄只有逗號時不能送出；文字浮水印',
    async run() {
      showTab('watermark'); T.click('#wm-sample');
      await T.until(() => wm.n === 3 && $('#wm-pno').textContent, '範例檔');
      T.set('#wm-pages', ',');
      T.ok($('#wm-go').disabled && !$('#wm-err').hidden, '逗號應該報錯');
      T.set('#wm-pages', '２');
      T.ok(!$('#wm-go').disabled, '全形頁碼');
      const r = await T.result(() => T.click('#wm-go'));
      const pj = await T.pdf(r.file), has = async i => (await (await pj.getPage(i)).getOperatorList()).fnArray.filter(f => f === pdfjsLib.OPS.paintImageXObject).length;
      T.eq([await has(1), await has(2), await has(3)], [0, 1, 0], '只有第 2 頁有浮水印');
    }
  },

  /* ---------- 轉換 ---------- */
  {
    name: '壓縮：保留文字縮小照片；整頁黑白',
    async run() {
      showTab('compress');
      await loadCompFile([pdfFile(await makePhotoSample(), 'photos.pdf')]);
      const before = comp.items[0].size;
      const r = await T.result(() => T.click('#comp-go'), '壓縮', 90000);
      T.ok(r.file.size < before * .5, `${before} → ${r.file.size}`);
      T.ok((await T.pdfText(r.file))[0].includes('Site survey'), '文字還在');
      setCompMode('raster'); T.set('#comp-color', 'bw');
      const bw = await T.result(() => T.click('#comp-go'), '黑白', 90000);
      T.ok(bw.file.size < before * .2, '黑白：' + bw.file.size);
      return `${(before / 1e6).toFixed(1)} MB → ${(r.file.size / 1e6).toFixed(2)} MB → ${(bw.file.size / 1e3).toFixed(0)} KB`;
    }
  },
  {
    name: '圖片轉 PDF：每張一頁，直橫自動',
    async run() {
      showTab('img2pdf'); T.click('#img-sample');
      await T.until(() => imgs.items.length === 3, '範例圖片');
      const r = await T.result(() => T.click('#img-go'));
      const pages = await T.pdfPages(r.file);
      T.eq(pages.length, 3);
      T.ok(pages[0].w > pages[0].h && pages[1].w < pages[1].h, '橫的圖橫放、直的圖直放');
    }
  },
  {
    name: 'PDF 轉圖片與文字',
    async run() {
      showTab('pdf2img'); T.click('#p2i-sample');
      await T.until(() => p2i.pages.length === 3 && p2i.pages.every(p => p.w), '範例檔');
      const r = await T.result(() => T.click('#p2i-go'));
      T.eq(Object.keys((await T.zip(r.file)).files).sort(), ['quarterly-report-1.jpg', 'quarterly-report-2.jpg', 'quarterly-report-3.jpg']);
      T.set('#p2i-fmt', 'txt');
      const t = await T.result(() => T.click('#p2i-go'));
      const text = await t.file.text();
      T.ok(text.includes('Quarterly Report') && text.includes('第 3 頁'), text.slice(0, 120));
    }
  },
  {
    name: '文字辨識：掃描檔變成可搜尋的 PDF',
    slow: true, http: true, timeout: 240000,
    async run() {
      showTab('ocr'); T.click('#ocr-sample');
      await T.until(() => ocrTab.pj && ocrTab.hasText.length === ocrTab.n && !$('#ocr-go').disabled, '檢查頁面');
      const r = await T.result(() => T.click('#ocr-go'), '辨識', 220000);
      const text = (await T.pdfText(r.file)).join('').replace(/\s+/g, '');
      for (const w of ['管理委員會', '486,500', 'office@example.com']) T.ok(text.includes(w), `找不到「${w}」`);
    }
  },

  /* ---------- 比對 ---------- */
  {
    name: '比較：比對文字',
    async run() {
      showTab('compare'); T.click('#cmp-sample');
      await T.until(() => cmp.res, '比較結果');
      const items = [...document.querySelectorAll('#cmp-list .cmp-item')].map(b => b.textContent);
      T.ok(items.some(t => t.includes('72,000') && t.includes('86,400')), '金額的修改');
      T.ok(items.some(t => t.includes('in writing')), '新增的字');
      T.ok(!items.some(t => t.includes('第 2 → 2 頁')), '簽名是圖，不算文字差異');
      cmpSelect(0); T.ok($('#cmp-list [data-h="0"]').classList.contains('is-active'), '跳到第一處');
      return `${cmp.res.hunks.length} 處`;
    }
  },
  {
    name: '比較：比對畫面',
    async run() {
      showTab('compare'); setCmpMode('visual');
      T.ok($('#cmp-ocr-wrap').hidden && !$('#cmp-sens-wrap').hidden, '畫面模式的選項');
      await loadCmp('a', [await makeAgreement(false)]); await loadCmp('b', [await makeAgreement(true)]);
      T.click('#cmp-go'); await T.idle('#cmp-go');
      const hunks = cmp.res.hunks;
      T.ok(hunks.some(h => h.pa === 1 && h.kind === 'change'), '第 2 頁的簽名（圖）');
      T.ok(hunks.filter(h => h.pa === 0).length >= 3, '第 1 頁的修改');
      T.eq(document.querySelectorAll('#cmp-pages-b .cmp-mark').length, hunks.length, '每處都有標記');
      T.ok(document.querySelectorAll('.cmp-crops img').length === hunks.length * 2, '清單裡的前後對照圖');
      await loadCmp('b', [await makeAgreement(false)]);
      T.click('#cmp-go'); await T.idle('#cmp-go');
      T.eq(cmp.res.hunks.length, 0, '相同的檔案');
      // one page more in the new file, and a page that changed size
      await loadCmp('a', [await T.labeled(['X', 'Y'], 'a.pdf')]);
      const b = await PDFDocument.create(), f = await b.embedFont(StandardFonts.Helvetica);
      b.addPage([595.28, 841.89]).drawText('X', { x: 60, y: 751.89, size: 28, font: f }); b.addPage([841.89, 595.28]); b.addPage([595.28, 841.89]);
      await loadCmp('b', [pdfFile(await b.save(), 'b.pdf')]);
      T.click('#cmp-go'); await T.idle('#cmp-go');
      T.eq(cmp.res.hunks.map(h => h.kind), ['size', 'ins']);
      return `範例找到 ${hunks.length} 處`;
    }
  },

  /* ---------- 證件、圖片 ---------- */
  {
    name: '證件影印與證件照',
    async run() {
      showTab('idcard'); T.click('#id-sample');
      await T.until(() => idc.sides.every(s => s && s.scan), '正反面（自動找到邊緣）');
      const r = await T.result(() => T.click('#id-go'));
      T.eq((await T.pdfPages(r.file)).map(p => [p.w, p.h]), [[595, 842]], '一頁 A4');
      showTab('idphoto'); T.click('#ph-sample');
      await T.until(() => ph.bmp && !$('#ph-go').disabled, '照片');
      const p = await T.result(() => T.click('#ph-go'));
      const bmp = await createImageBitmap(p.file);
      T.eq([bmp.width, bmp.height].sort(), [1200, 1800], '4×6 相紙 300 dpi');
      return $('#ph-summary').textContent;
    }
  },
  {
    name: '圖片工具：縮小並轉格式',
    async run() {
      showTab('imgtool'); T.click('#it-sample');
      await T.until(() => itool.items.length === 2, '範例圖片');
      T.set('#it-size', 'long'); T.set('#it-size-v', '1000'); T.set('#it-fmt', 'webp');
      const r = await T.result(() => T.click('#it-go'));
      T.eq(Object.keys((await T.zip(r.file)).files).sort(), ['IMG_001.webp', 'IMG_002.webp']);
      T.ok(itool.items.every(it => Math.max(it.out.w, it.out.h) === 1000), '最長邊 1000');
    }
  },
  {
    name: '去浮水印：塗抹的地方被補上',
    async run() {
      showTab('unmark'); T.click('#um-sample');
      await T.until(() => um.w === 1600, '範例照片');
      const area = () => Array.from(uctx.getImageData(560, 470, 480, 120).data);
      const before = area();
      um.last = [580, 530]; umStroke([580, 530], [1020, 530]);
      T.click('#um-go'); await T.idle('#um-go');
      const after = area();
      let changed = 0; for (let i = 0; i < before.length; i += 4) if (Math.abs(before[i] - after[i]) > 8) changed++;
      T.ok(changed > 1000, '畫面沒有改變：' + changed);
      T.eq(um.history.length, 1, '可以復原');
    }
  },

  {
    name: '選擇檔案：每個 PDF 工具都收得下使用者選的檔案（File）',
    async run() {
      // Browsers give every File a bytes() method; it must not be taken for a PDF handed on in memory.
      const file = async name => new File([(await T.labeled(['Picked', 'Two'])).bytes], name, { type: 'application/pdf' });
      const pick = async (sel, name) => {
        const dt = new DataTransfer(); dt.items.add(await file(name));
        const inp = $(sel); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
      };
      const checks = [
        ['merge', '#merge-input', n => merge.items.some(i => i.name === n)], ['split', '#split-input', n => split.name === n],
        ['edit', '#edit-input', n => Object.values(edit.docs).some(d => d.name === n)], ['form', '#ff-input', n => ff.name === n],
        ['watermark', '#wm-input', n => wm.name === n], ['resize', '#rs-input', n => rs.name === n],
        ['compress', '#comp-input', n => comp.items.some(i => i.name === n)], ['pdf2img', '#p2i-input', n => p2i.name === n],
        ['ocr', '#ocr-input', n => ocrTab.name === n], ['password', '#pw-input', n => pw.name === n],
        ['compare', '#cmp-input-a', n => cmp.a && cmp.a.name === n],
        ['sign', '#sign-input', n => dlg.open && Object.values(edit.docs).some(d => d.name === n)],
        ['redact', '#redact-input', n => dlg.open && Object.values(edit.docs).some(d => d.name === n)]
      ];
      for (const [tab, sel, loaded] of checks) {
        showTab(tab); const name = tab + '.pdf';
        await pick(sel, name);
        await T.until(() => loaded(name), `「${tab}」載入選擇的檔案`, 8000);
        if (dlg.open) $('#te-done').click();
      }
      return `${checks.length} 個工具`;
    }
  },

  /* ---------- 記憶體 ---------- */
  {
    name: '記憶體：合併、壓縮、調整尺寸、密碼只留檔案本身',
    async run() {
      const asPicked = async (labels, name) => new File([(await T.labeled(labels)).bytes], name, { type: 'application/pdf' });
      showTab('merge');
      await addMergeFiles([await asPicked(['M1'], 'm1.pdf'), await asPicked(['M2', 'M3'], 'm2.pdf')]);
      T.ok(merge.items.every(it => it.src instanceof File && heldBytes(it.src) === 0), '合併清單應留 File');
      const m = await T.result(() => T.click('#merge-go'));
      T.eq((await T.pdfText(m.file)).map(s => s.trim()), ['M1', 'M2', 'M3']);
      // an unlocked file is kept as a Blob of the unlocked bytes
      const { out } = await runQpdf(['--encrypt', '--user-password=', '--owner-password=o', '--bits=256', '--print=none', '--', '/in.pdf', '/out.pdf'], (await T.labeled(['L'])).bytes);
      await addMergeFiles([new File([out], 'locked.pdf', { type: 'application/pdf' })]);
      const last = merge.items[merge.items.length - 1].src;
      T.ok(!(last instanceof File) && last instanceof Blob && !hasEncrypt(new Uint8Array(await last.arrayBuffer())), '解除後的檔案存成 Blob');
      showTab('compress');
      await loadCompFile([new File([await makePhotoSample()], 'p1.pdf', { type: 'application/pdf' }), new File([await makePhotoSample()], 'p2.pdf', { type: 'application/pdf' })]);
      T.ok(comp.items.every(it => heldBytes(it.src) === 0), '壓縮清單應留 File');
      T.click('#comp-go'); await T.idle('#comp-go');
      T.ok(comp.items.every(it => it.out && !it.out.kept && it.out.src instanceof Blob && it.out.size < it.size), '多份的結果存成 Blob');
      showTab('resize'); await loadResize([await asPicked(['R'], 'r.pdf')]);
      T.eq(heldBytes(rs.src), 0, '調整尺寸');
      const r = await T.result(() => T.click('#rs-go')); T.eq((await T.pdfText(r.file))[0].trim(), 'R');
      showTab('password'); await loadPw([await asPicked(['P'], 'p.pdf')]);
      T.eq(heldBytes(pw.src), 0, '密碼');
    }
  },
  {
    name: '記憶體：填表單的頁面是圖片，不留畫布',
    async run() {
      showTab('form'); T.click('#ff-sample');
      await T.until(() => $('#ff-pages .ff-page img'), '頁面圖片');
      T.eq(document.querySelectorAll('#ff-pages canvas').length, 0, '畫布');
      T.ok($('#ff-pages .ff-page img').src.startsWith('blob:'), 'Blob 圖片');
    }
  },
  {
    name: '記憶體：證件照片只解碼需要的大小',
    async run() {
      showTab('idcard'); T.click('#id-sample');
      await T.until(() => idc.sides.every(s => s && s.bmp), '預覽');
      T.ok(idc.sides.every(s => s.bmp.width < 600), '預覽用的小圖：' + idc.sides.map(s => s.bmp.width));
      const r = await T.result(() => T.click('#id-go'));
      const pj = await T.pdf(r.file), ops = await (await pj.getPage(1)).getOperatorList();
      const img = await new Promise(res => (async () => { const pg = await pj.getPage(1); pg.objs.get(ops.argsArray[ops.fnArray.indexOf(pdfjsLib.OPS.paintImageXObject)][0], res); })());
      T.ok(img.width >= 1000, '匯出仍是 300 dpi：' + img.width);
      const big = document.createElement('canvas'); big.width = 4000; big.height = 3000;
      big.getContext('2d').fillStyle = '#8ab'; big.getContext('2d').fillRect(0, 0, 4000, 3000);
      const blob = await new Promise(res => big.toBlob(res, 'image/jpeg', .8));
      showTab('idphoto'); await loadPh([new File([blob], 'big.jpg', { type: 'image/jpeg' })]);
      T.eq([ph.bmp.width, ph.bmp.height], [2400, 1800], '證件照最長邊 2400');
    }
  },
  {
    name: '記憶體：每個字的位置存成 Float32Array',
    async run() {
      const pj = await T.pdf(await T.labeled(['Hello world']));
      const c = await pageChars(await pj.getPage(1));
      T.ok(c.boxes instanceof Float32Array && c.boxes.length === c.text.length * 4, '格式');
      const bs = spanBoxes(c.text, c.boxes, 0, 5);
      T.ok(bs.length === 1 && bs[0][2] > bs[0][0], 'Hello 的框：' + JSON.stringify(bs));
    }
  },
  {
    name: '記憶體：預覽結果時只留一份',
    async run() {
      const f = await T.labeled(['Preview'], 'pv.pdf'), size = f.size;
      offerNext(f, 'pdf', 'test'); await openResultPreview();
      T.ok(pvDlg.open && f.bytes === null && f.lent, '預覽時頁面放掉自己的那份');
      T.ok(heldBytes(f) === size, '記憶體估算');
      const waiting = fileBytes(f);
      await T.sleep(200); $('#pv-close').click();
      const { bytes } = await waiting;
      T.eq(bytes.length, size, '關閉後拿回來');
      T.ok(f.bytes === bytes && !f.lent, '還原');
      T.eq((await T.pdfText(f))[0].trim(), 'Preview');
    }
  },
  {
    name: '記憶體：離開會用到 OCR 的工具時關掉辨識引擎',
    slow: true, http: true, timeout: 120000,
    async run() {
      showTab('pdf2img');
      const pj = await T.pdf(await T.labeled(['']));
      await ocrRecognize(await new Promise(r => { const c = document.createElement('canvas'); c.width = c.height = 64; c.toBlob(r); }));
      T.ok(ocrEng.worker, '引擎啟動');
      showTab('compare'); T.ok(ocrEng.worker, '比較也會用到，留著');
      showTab('merge'); T.ok(!ocrEng.worker, '離開後關閉');
      pj.destroy();
    }
  },

  /* ---------- 出錯與同時操作 ---------- */
  {
    name: '去浮水印：背景程式當掉時改在頁面上補圖，不會卡住',
    async run() {
      showTab('unmark'); T.click('#um-sample');
      await T.until(() => um.w === 1600, '範例照片');
      // a worker that takes the pixels (transferring them, as a real one does) and then crashes
      umWorker = { terminate() {}, postMessage(msg, transfer) { structuredClone(msg, { transfer }); setTimeout(() => this.onerror(new Event('error')), 10); } };
      umStroke([580, 530], [1020, 530]);
      T.click('#um-go');
      await T.until(() => !$('#um-go').classList.contains('is-running'), '補圖完成（沒有卡住）', 30000);
      T.eq(um.history.length, 1, '已補圖');
    }
  },
  {
    name: '壓縮：處理中加入檔案不會讓結果出錯',
    async run() {
      showTab('compress');
      await loadCompFile([pdfFile(await makePhotoSample(), 'a.pdf'), pdfFile(await makePhotoSample(), 'b.pdf')]);
      const late = pdfFile(await makePhotoSample(), 'late.pdf');
      T.click('#comp-go');
      await T.until(() => comp.items[0].out, '第一份壓縮完');
      await loadCompFile([late]);
      T.eq($('#toast').textContent, '正在壓縮，請等完成再加入檔案', '處理中不加入');
      await T.idle('#comp-go');
      T.ok($('#comp-result').hidden === false, '應該顯示壓縮結果');
      T.eq(comp.items.map(i => i.name), ['a.pdf', 'b.pdf']);
      T.ok(comp.items.every(i => i.out), '每份都有結果');
    }
  },
  {
    name: '編輯：匯出中清空或換檔不會讓匯出出錯',
    async run() {
      showTab('edit');
      const many = await T.labeled(Array.from({ length: 12 }, (_, i) => 'P' + (i + 1)), 'many.pdf');
      await loadEditFiles([many]);
      await T.until(() => edit.pages.every(p => p.view), '頁面資訊');
      for (const p of edit.pages) { te.page = p; te.R = 0; const a = { id: uid(), type: 'redact', wPt: 50, hPt: 20 }; setTopLeft(a, 40, 40); p.annots.push(a); }
      te.page = null;
      const n = T.results.length;
      T.click('#edit-export');
      await T.until(() => $('#edit-export').classList.contains('is-running'), '開始匯出');
      await startSigning([await T.labeled(['New'], 'new.pdf')]); // replaces the editor's files mid-export
      if (dlg.open) $('#te-done').click();
      await T.idle('#edit-export');
      const clear = $('#edit-clear'); clear.click(); clear.click(); // 清空重來 (asks twice)
      T.ok(T.results.length > n || T.errors.length === 0, '匯出失敗：' + T.errors.join('；'));
    }
  },

  {
    name: '處理中放入新檔案：不會和舊檔案混在一起',
    async run() {
      const pick = async (sel, f) => { const dt = new DataTransfer(); dt.items.add(f); const inp = $(sel); inp.files = dt.files; inp.dispatchEvent(new Event('change')); };
      const asFileObj = async (labels, name) => new File([(await T.labeled(labels)).bytes], name, { type: 'application/pdf' });
      showTab('pdf2img');
      await loadP2i([await T.labeled(Array.from({ length: 10 }, (_, i) => 'OLD' + i), 'old.pdf')]);
      await T.until(() => p2i.pages.every(p => p.w), '頁面資訊');
      T.set('#p2i-fmt', 'txt');
      const n = T.results.length;
      T.click('#p2i-go');
      await T.until(() => $('#p2i-go').classList.contains('is-running'), '開始');
      await pick('#p2i-input', await asFileObj(Array.from({ length: 10 }, (_, i) => 'NEW' + i), 'new.pdf'));
      await T.idle('#p2i-go');
      await T.until(() => T.results.length > n, '結果');
      const text = await T.results[T.results.length - 1].file.text();
      T.ok(!text.includes('NEW'), '舊檔案的結果混進了新檔案的頁面');
      T.eq((text.match(/OLD\d/g) || []).length, 10, '舊檔案的 10 頁都在');
    }
  },

  /* ---------- 互動 ---------- */
  {
    name: '釋放記憶體：每個工具都能清空，而且清空後還能再用',
    async run() {
      const loads = [['split', '#split-sample', () => split.pj], ['watermark', '#wm-sample', () => wm.pj], ['pdf2img', '#p2i-sample', () => p2i.pj],
        ['form', '#ff-sample', () => ff.pj], ['resize', '#rs-sample', () => rs.src], ['img2pdf', '#img-sample', () => imgs.items.length],
        ['imgtool', '#it-sample', () => itool.items.length], ['idcard', '#id-sample', () => idc.sides[0]], ['idphoto', '#ph-sample', () => ph.bmp],
        ['unmark', '#um-sample', () => um.w], ['compare', '#cmp-sample', () => cmp.res]];
      for (const [tab, sample, ready] of loads) { showTab(tab); T.click(sample); await T.until(ready, tab + ' 範例'); }
      showTab('edit'); await loadEditFiles([await T.labeled(['E'])]);
      showTab('compress'); await loadCompFile([await T.labeled(['C'])]);
      showTab('password'); await loadPw([await T.labeled(['P'])]);
      showTab('home');
      const held = HOLDERS.filter(h => h.size() > 0).map(h => h.tab);
      for (const h of HOLDERS) if (h.size() > 0) h.release();
      T.eq(HOLDERS.filter(h => h.size() > 0).map(h => h.tab), [], '釋放後仍留著');
      // every tool works again afterwards
      showTab('split'); T.click('#split-sample'); await T.until(() => split.pages.length === 6, '拆分再載入');
      showTab('watermark'); T.click('#wm-sample'); await T.until(() => wm.pj && wm.n === 3, '浮水印再載入');
      showTab('unmark'); T.click('#um-sample'); await T.until(() => um.w, '去浮水印再載入');
      return `${held.length} 個工具：${held.join('、')}`;
    }
  },
  {
    name: '校正翻拍：套用、還原',
    async run() {
      showTab('img2pdf'); T.click('#img-sample');
      await T.until(() => imgs.items.length === 3, '範例圖片');
      const it = imgs.items[0], w0 = it.w;
      openScan(it); await T.until(() => scDlg.open && sc.bmp, '校正視窗');
      sc.quad = [[.1, .1], [.9, .12], [.88, .9], [.12, .88]]; $('#sc-filter').value = 'bw';
      T.click('#sc-preview'); T.click('#sc-rotr');
      T.click('#sc-apply'); await T.until(() => !scDlg.open, '套用');
      T.ok(it.scan && it.kind === 'png' && it.w !== w0, '已校正（黑白存成 PNG、轉了 90°）：' + JSON.stringify([it.kind, it.w, it.h]));
      openScan(it); await T.until(() => scDlg.open && sc.bmp, '再開校正視窗');
      T.ok(!$('#sc-reset').hidden, '可以還原'); T.click('#sc-reset');
      await T.until(() => !scDlg.open && !it.scan, '還原');
      T.eq(it.w, w0, '還原成原圖');
      const r = await T.result(() => T.click('#img-go'));
      T.eq((await T.pdfPages(r.file)).length, 3);
    }
  },
  {
    name: '簽名板：手寫後儲存，簽名清單、刪除',
    async run() {
      showTab('sign'); localStorage.removeItem(SIG_KEY); sigs.list = []; renderSigLists();
      T.click('#sign-new'); await T.until(() => sigDlg.open, '簽名板');
      const r = sigCv.getBoundingClientRect(), at = (fx, fy) => ({ bubbles: true, pointerId: 1, clientX: r.left + r.width * fx, clientY: r.top + r.height * fy });
      sigCv.dispatchEvent(new PointerEvent('pointerdown', at(.2, .6)));
      for (let k = 1; k <= 20; k++) sigCv.dispatchEvent(new PointerEvent('pointermove', at(.2 + k * .03, .6 - Math.sin(k / 3) * .2)));
      sigCv.dispatchEvent(new PointerEvent('pointerup', at(.8, .6)));
      T.click('#sig-save');
      T.ok(!sigDlg.open && sigs.list.length === 1, '已儲存');
      T.eq(JSON.parse(localStorage.getItem(SIG_KEY)).length, 1, '存在這個瀏覽器');
      T.ok(sigs.list[0].w > sigs.list[0].h, '裁掉空白後是橫的');
      $('#sign-sig-list [data-del="0"]').click();
      T.eq(sigs.list.length, 0, '刪除');
    }
  },
  {
    name: '編輯：鍵盤快捷鍵、拖曳排序、Shift 多選',
    async run() {
      showTab('edit');
      await loadEditFiles([await T.labeled(['K1', 'K2', 'K3', 'K4', 'K5'], 'keys.pdf')]);
      await T.until(() => edit.pages.every(p => p.view), '頁面資訊');
      const key = (k, o = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o }));
      const order = () => edit.pages.map(p => p.index + 1).join('');
      const box = i => $(`#edit-grid .page-card:nth-child(${i + 1}) input[data-act="sel"]`);
      box(1).click(); box(3).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); // pages 2–4
      T.eq(edit.pages.map(p => p.selected), [false, true, true, true, false], 'Shift 多選');
      key('ArrowRight'); T.eq(order(), '15234', '→ 往後移');
      key('r'); T.ok(edit.pages.filter(p => p.selected).every(p => p.rot === 90), 'R 旋轉');
      key('d'); T.eq(edit.pages.length, 8, 'D 複製');
      key('Delete'); T.eq(order(), '15234', 'Delete 刪除複製出來的頁面');
      key('z', { ctrlKey: true }); T.eq(edit.pages.length, 8, 'Ctrl+Z');
      key('y', { ctrlKey: true }); T.eq(edit.pages.length, 5, 'Ctrl+Y');
      key('Escape'); T.ok(edit.pages.every(p => !p.selected), 'Esc 取消選取');
      key('a', { ctrlKey: true }); T.ok(edit.pages.every(p => p.selected), 'Ctrl+A');
      key('Escape');
      // drag the first card after the last
      const cards = () => [...document.querySelectorAll('#edit-grid .page-card')];
      const dt = new DataTransfer(), first = cards()[0], last = cards()[4], lr = last.getBoundingClientRect();
      first.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      last.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: lr.right - 2, clientY: lr.top + 5 }));
      last.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: lr.right - 2, clientY: lr.top + 5 }));
      first.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
      T.eq(order(), '52341', '拖到最後');
      const r = await T.result(() => T.click('#edit-export'));
      T.eq((await T.pdfText(r.file)).map(s => s.trim()), ['K5', 'K2', 'K3', 'K4', 'K1']);
    }
  },
  {
    name: '預覽：點縮圖放大、左右換頁、Esc 關閉；Ctrl+K 找工具',
    async run() {
      showTab('split'); T.click('#split-sample');
      await T.until(() => $('#split-grid .page-card img'), '縮圖');
      $('#split-grid .page-card .thumb').click();
      await T.until(() => pvDlg.open && $('#pv-canvas').width > 0, '預覽');
      T.eq($('#pv-title').textContent, '第 1 / 6 頁');
      pvDlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await T.sleep(100); T.eq($('#pv-title').textContent, '第 2 / 6 頁');
      T.click('#pv-close'); T.ok(!pvDlg.open, '關閉');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
      T.ok($('#cmdk').open, 'Ctrl+K 開啟');
      $('#cmdk-q').value = '浮水印'; $('#cmdk-q').dispatchEvent(new Event('input'));
      $('#cmdk-q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      T.ok(!$('#cmdk').open && !$('#panel-watermark').hidden, '跳到加浮水印');
    }
  },
  {
    name: '密碼分頁：只有限制的檔案直接解除',
    async run() {
      const { out } = await runQpdf(['--encrypt', '--user-password=', '--owner-password=o', '--bits=256', '--print=none', '--', '/in.pdf', '/out.pdf'], (await T.labeled(['Restricted'])).bytes);
      showTab('password'); await loadPw([pdfFile(out, 'r.pdf')]);
      T.eq(pw.state, 'restricted');
      T.ok($('#pw-old-row').hidden && $('#pw-unlock-go').textContent === '解除限制', '不用輸入密碼');
      const r = await T.result(() => T.click('#pw-unlock-go'));
      T.ok(!hasEncrypt(r.file.bytes), '已解除');
    }
  },

  {
    name: '圖片浮水印、上傳簽名圖檔（白底去背）',
    async run() {
      const png = async (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')); return new File([await new Promise(r => c.toBlob(r, 'image/png'))], 'x.png', { type: 'image/png' }); };
      const pick = (sel, f) => { const dt = new DataTransfer(); dt.items.add(f); const inp = $(sel); inp.files = dt.files; inp.dispatchEvent(new Event('change')); };
      showTab('watermark'); T.click('#wm-sample'); await T.until(() => wm.n === 3, '範例檔');
      setWmType('img'); T.ok($('#wm-go').disabled, '還沒選圖片時不能送出');
      pick('#wm-img-input', await png(300, 120, c => { c.fillStyle = '#1060d0'; c.fillRect(0, 0, 300, 120); }));
      await T.until(() => wm.img, '浮水印圖片'); T.set('#wm-opacity', '100'); T.set('#wm-pos', 'center'); T.set('#wm-angle', '0');
      const r = await T.result(() => T.click('#wm-go'));
      for (let i = 0; i < 3; i++) {
        const b = await T.ink(r.file, i, (R, G, B) => B > 150 && R < 60);
        T.ok(b && Math.abs((b[0] + b[2]) / 2 - .5) < .02 && Math.abs(b[2] - b[0] - .35) < .02, `第 ${i + 1} 頁圖片浮水印置中、寬 35%：${JSON.stringify(b)}`);
      }
      showTab('sign'); sigs.list = []; renderSigLists();
      const upload = document.querySelector('#panel-sign .sig-upload');
      pick('.sig-upload', await png(400, 200, c => { c.fillStyle = '#fff'; c.fillRect(0, 0, 400, 200); c.fillStyle = '#000'; c.fillRect(100, 90, 200, 12); }));
      await T.until(() => sigs.list.length === 1, '上傳的簽名');
      const sg = sigs.list[0];
      T.ok(sg.w < 230 && sg.h < 40, '裁掉白邊：' + sg.w + '×' + sg.h);
      const im = await createImageBitmap(await (await fetch(sg.src)).blob()), c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const ctx = c.getContext('2d'); ctx.drawImage(im, 0, 0);
      T.eq(ctx.getImageData(1, 1, 1, 1).data[3], 0, '白底變透明');
    }
  },
  {
    name: '填表單：中文內容壓平後還在，欄位消失',
    async run() {
      showTab('form'); T.click('#ff-sample');
      await T.until(() => ff.fields.length >= 8, '表單欄位');
      const el = $('#ff-pages .ff-field[data-name="name"]'); el.value = '陳美玲'; el.dispatchEvent(new Event('input', { bubbles: true }));
      T.set('#ff-flatten', true);
      const r = await T.result(() => T.click('#ff-go'));
      const pj = await T.pdf(r.file), pg = await pj.getPage(1);
      T.eq((await pg.getAnnotations()).filter(a => a.fieldName).length, 0, '壓平後沒有欄位');
      const red = await T.ink(r.file, 0, (R, G, B) => R < 60 && G < 60 && B < 60, 1);
      T.ok(red, '中文內容畫在頁面上');
      T.set('#ff-flatten', false);
    }
  },
  {
    name: '壓縮（保留文字）：透明的 PNG 照片保留透明',
    async run() {
      const doc = await PDFDocument.create(), page = doc.addPage([595, 842]);
      page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(1, .85, 0) }); // yellow page behind the photo
      const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const x = c.getContext('2d');
      // left half: photo-like noise (does not compress as PNG); right half: transparent
      const id = x.createImageData(600, 900);
      for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = v; id.data[i + 1] = 255 - v; id.data[i + 2] = (v * 7) % 255; id.data[i + 3] = 255; }
      x.putImageData(id, 0, 0);
      const img = await doc.embedPng(new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer()));
      page.drawImage(img, { x: 0, y: 0, width: 595, height: 446 });
      showTab('compress'); await loadCompFile([pdfFile(await doc.save(), 'alpha.pdf')]);
      T.click('#comp-go'); await T.idle('#comp-go');
      const o = comp.items[0].out;
      T.ok(o && !o.kept, '應該壓得更小：' + JSON.stringify(o && { kept: o.kept, size: o.size, orig: comp.items[0].size }) + ' ' + $('#comp-plabel').textContent + ' ' + $('#toast').textContent);
      const r = T.results[T.results.length - 1];
      // the right half of the photo is transparent: the yellow page must still show through there
      const yellow = await T.ink(r.file, 0, (R, G, B) => R > 230 && G > 190 && B < 60);
      T.ok(yellow && yellow[3] > .99 && yellow[2] > .99, '透明處仍看得到底下的黃色：' + JSON.stringify(yellow));
      const pj = await T.pdf(r.file), ops = await (await pj.getPage(1)).getOperatorList();
      T.ok(ops.fnArray.includes(pdfjsLib.OPS.paintImageXObject), '照片還在');
      return `${(comp.items[0].size / 1e6).toFixed(2)} MB → ${(r.file.size / 1e6).toFixed(2)} MB`;
    }
  },

  {
    name: '表單經過編輯、合併、拆分後還能填寫',
    async run() {
      showTab('form'); T.click('#ff-sample');
      await T.until(() => ff.fields.length >= 8, '表單欄位');
      const form = pdfFile(await ff.pj.getData(), 'form.pdf');
      const fill = async (file, what) => {
        showTab('form'); await loadForm([file]);
        await T.until(() => ff.fields.length >= 8, what + '：表單欄位');
        const el = $('#ff-pages .ff-field[data-name="name"]'); el.value = 'Filled ' + what; el.dispatchEvent(new Event('input', { bubbles: true }));
        const r = await T.result(() => T.click('#ff-go'));
        const an = await (await (await T.pdf(r.file)).getPage(1)).getAnnotations();
        const f = an.find(a => a.fieldName === 'name');
        T.eq(f && f.fieldValue, 'Filled ' + what, what + '後填寫的內容沒有寫進去');
      };
      showTab('edit'); await loadEditFiles([form, await T.labeled(['Cover'])]);
      await T.until(() => edit.pages.length === 2 && edit.pages.every(p => p.view), '頁面資訊');
      await fill(await T.result(() => T.click('#edit-export')).then(r => r.file), '編輯');
      showTab('merge'); await addMergeFiles([form, await T.labeled(['Appendix'])]);
      await fill((await T.result(() => T.click('#merge-go'))).file, '合併');
      showTab('split'); await loadSplit([(await T.result(() => T.click('#merge-go'))).file]);
      await T.until(() => split.pages.length === 2, '拆分');
      T.set('#split-ranges', '1'); $('input[name="split-mode"][value="range"]').checked = true; renderSplit();
      await fill((await T.result(() => T.click('#split-go'))).file, '拆分');
      // a field shown on two pages, split down to one: it must still fill and flatten
      const doc = await PDFDocument.create(), p1 = doc.addPage([400, 300]), p2 = doc.addPage([400, 300]);
      const tf = doc.getForm().createTextField('shared'); tf.addToPage(p1, { x: 40, y: 200, width: 200, height: 24 }); tf.addToPage(p2, { x: 40, y: 200, width: 200, height: 24 });
      showTab('split'); await loadSplit([pdfFile(await doc.save(), 'two.pdf')]);
      await T.until(() => split.pages.length === 2, '拆分');
      T.set('#split-ranges', '2'); $('input[name="split-mode"][value="range"]').checked = true; renderSplit();
      const one = (await T.result(() => T.click('#split-go'))).file;
      showTab('form'); await loadForm([one]); await T.until(() => ff.fields.length === 1, '一個欄位');
      const el = $('#ff-pages .ff-field[data-name="shared"]'); el.value = 'Only page 2'; el.dispatchEvent(new Event('input', { bubbles: true }));
      T.set('#ff-flatten', true);
      const flat = await T.result(() => T.click('#ff-go'));
      T.set('#ff-flatten', false);
      T.ok((await T.ink(flat.file, 0, (r, g, b) => r < 80 && g < 80 && b < 80, 1)), '壓平後看得到內容');
    }
  },

  {
    name: '拆出一頁時，頁面上的內部連結不會把整份檔案帶進來',
    async run() {
      const doc = await PDFDocument.create(), L = window.PDFLib;
      const c = document.createElement('canvas'); c.width = 600; c.height = 600; const x = c.getContext('2d'), id = x.createImageData(600, 600);
      for (let i = 0; i < id.data.length; i++) id.data[i] = Math.random() * 255;
      x.putImageData(id, 0, 0);
      const jpg = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', .95))).arrayBuffer());
      const pages = [];
      for (let i = 0; i < 12; i++) { const p = doc.addPage([400, 400]); p.drawImage(await doc.embedJpg(jpg), { x: 0, y: 0, width: 400, height: 400 }); pages.push(p); }
      // page 1: a table of contents linking to every page
      const links = pages.map((p, i) => doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 10 + i * 20, 100, 25 + i * 20], Border: [0, 0, 0], Dest: [p.ref, 'XYZ', null, null, null] })));
      pages[0].node.set(L.PDFName.of('Annots'), doc.context.obj(links));
      const whole = await doc.save();
      showTab('split'); await loadSplit([pdfFile(whole, 'toc.pdf')]);
      await T.until(() => split.pages.length === 12, '拆分');
      T.set('#split-ranges', '1'); $('input[name="split-mode"][value="range"]').checked = true; renderSplit();
      const one = (await T.result(() => T.click('#split-go'))).file;
      T.ok(one.size < whole.length / 4, `只拆出 1 頁卻有 ${(one.size / 1e3).toFixed(0)} KB（整份 ${(whole.length / 1e3).toFixed(0)} KB）`);
      // links in a new document: to its own pages where those were copied, gone where they were not
      const check = async (file, want) => {
        const d = await PDFDocument.load((await fileBytes(file)).bytes), refs = d.getPages().map(p => p.ref.toString());
        const annots = d.getPage(0).node.lookupMaybe(L.PDFName.of('Annots'), L.PDFArray);
        const dests = annots ? annots.asArray().map(r => d.context.lookup(r).lookup(L.PDFName.of('Dest'), L.PDFArray).get(0)) : [];
        T.eq(dests.map(r => refs.indexOf(r.toString())), want, `${file.name} 的連結指向的頁`);
        return [...d.context.enumerateIndirectObjects()].filter(([, o]) => o instanceof L.PDFRawStream && o.dict.get(L.PDFName.of('Subtype')) === L.PDFName.of('Image')).length;
      };
      T.eq(await check(one, [0]), 1, '只拆出第 1 頁，只該有 1 張圖');
      T.set('#split-ranges', '1-3'); renderSplit();
      T.eq(await check((await T.result(() => T.click('#split-go'))).file, [0, 1, 2]), 3, '第 1–3 頁');
      // 編輯: a deleted page is really gone, even though page 1 links to it
      showTab('edit'); await loadEditFiles([pdfFile(whole, 'toc.pdf')]);
      await T.until(() => edit.pages.length === 12 && edit.pages.every(p => p.view), '頁面資訊');
      edit.pages = edit.pages.filter(p => p.index !== 11); renderEdit();
      const ed = (await T.result(() => T.click('#edit-export'))).file;
      T.eq(await check(ed, [...Array(11).keys()]), 11, '刪掉的第 12 頁不在檔案裡（連到它的連結也拿掉）');
      // 合併: two copies of the document, each one's links lead to its own pages
      showTab('merge'); await addMergeFiles([pdfFile(whole, 'a.pdf'), pdfFile(whole, 'b.pdf')]);
      const mg = (await T.result(() => T.click('#merge-go'))).file;
      T.eq(await check(mg, [...Array(12).keys()]), 24, '合併');
      const d2 = await PDFDocument.load((await fileBytes(mg)).bytes), refs2 = d2.getPages().map(p => p.ref.toString());
      const a13 = d2.getPage(12).node.lookupMaybe(L.PDFName.of('Annots'), L.PDFArray);
      T.eq(a13.asArray().map(r => refs2.indexOf(d2.context.lookup(r).lookup(L.PDFName.of('Dest'), L.PDFArray).get(0).toString())), [...Array(12).keys()].map(i => i + 12), '第二份的連結');
      return `整份 ${(whole.length / 1e3).toFixed(0)} KB → 第 1 頁 ${(one.size / 1e3).toFixed(0)} KB`;
    }
  },

  {
    name: '取消：處理中再按一次會停下，工具還能再用',
    async run() {
      const cancelMid = async (btn, started) => {
        T.click(btn); await T.until(started, btn + ' 開始處理', 20000);
        $(btn).click(); await T.idle(btn);
        T.eq($('#toast').textContent, '已取消', btn + ' 取消');
      };
      // 壓縮: photos are being re-encoded in background workers when it is cancelled
      showTab('compress');
      await loadCompFile([pdfFile(await makePhotoSample(), 'p1.pdf'), pdfFile(await makePhotoSample(), 'p2.pdf'), pdfFile(await makePhotoSample(), 'p3.pdf')]);
      await cancelMid('#comp-go', () => /張照片|頁/.test($('#comp-plabel').textContent));
      const n = T.results.length;
      T.click('#comp-go'); await T.idle('#comp-go');
      T.ok(comp.items.every(i => i.out && !i.out.kept), '取消後再壓縮一次正常');
      // PDF 轉圖片: many pages at high resolution
      showTab('pdf2img');
      await loadP2i([await T.labeled(Array.from({ length: 15 }, (_, i) => 'P' + i), 'many.pdf')]);
      await T.until(() => p2i.pages.every(p => p.w), '頁面資訊');
      T.set('#p2i-fmt', 'png'); T.set('#p2i-dpi', '300');
      await cancelMid('#p2i-go', () => /轉換第 [2-9]/.test($('#p2i-plabel').textContent));
      T.set('#p2i-dpi', '72');
      const r = await T.result(() => T.click('#p2i-go'));
      T.eq(Object.keys((await T.zip(r.file)).files).length, 15, '取消後再轉一次正常');
      // 比對畫面
      showTab('compare'); setCmpMode('visual');
      await loadCmp('a', [await T.labeled(Array.from({ length: 15 }, (_, i) => 'A' + i))]); await loadCmp('b', [await T.labeled(Array.from({ length: 15 }, (_, i) => 'B' + i))]);
      await cancelMid('#cmp-go', () => /比對第 [2-9]/.test($('#cmp-plabel').textContent));
      T.click('#cmp-go'); await T.idle('#cmp-go');
      T.eq(cmp.res.hunks.length, 15, '取消後再比一次正常');
    }
  },

  {
    name: '壞掉的檔案、空檔案、沒有頁面的 PDF：每個工具都只顯示錯誤訊息',
    async run() {
      T.allowErrors = true; // error toasts are the expected outcome here
      const empty = await PDFDocument.create();
      const bad = {
        '亂碼': new File(['this is not a pdf at all '.repeat(40)], 'broken.pdf', { type: 'application/pdf' }),
        '空檔案': new File([], 'empty.pdf', { type: 'application/pdf' }),
        '截斷': new File([(await T.labeled(['Cut'])).bytes.slice(0, 300)], 'cut.pdf', { type: 'application/pdf' }),
        '零頁': new File([await empty.save()], 'nopages.pdf', { type: 'application/pdf' })
      };
      const inputs = { merge: '#merge-input', split: '#split-input', edit: '#edit-input', form: '#ff-input', watermark: '#wm-input', resize: '#rs-input',
        compress: '#comp-input', pdf2img: '#p2i-input', ocr: '#ocr-input', password: '#pw-input', compare: '#cmp-input-a', sign: '#sign-input', redact: '#redact-input' };
      const rejections = [];
      const onRej = e => rejections.push(String(e.reason && e.reason.message || e.reason));
      window.addEventListener('unhandledrejection', onRej);
      const report = [];
      for (const [kind, f] of Object.entries(bad)) for (const [tab, sel] of Object.entries(inputs)) {
        showTab(tab); const e0 = T.errors.length, r0 = rejections.length;
        const dt = new DataTransfer(); dt.items.add(f); $(sel).files = dt.files; $(sel).dispatchEvent(new Event('change'));
        await T.sleep(400);
        if (dlg.open) $('#te-done').click();
        if (rejections.length > r0) report.push(`${kind}→${tab}：未處理的錯誤 ${rejections.slice(r0).join('；')}`);
        else if (T.errors.length === e0 && kind !== '零頁') report.push(`${kind}→${tab}：沒有任何提示`);
      }
      window.removeEventListener('unhandledrejection', onRej);
      T.eq(report, [], '有問題的組合');
    }
  },

  {
    name: '釋放記憶體提示：出現、不用、釋放',
    async run() {
      const big = async (w, h, name) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#7a9'; x.fillRect(0, 0, w, h); return new File([await new Promise(r => c.toBlob(r, 'image/jpeg', .8))], name, { type: 'image/jpeg' }); };
      showTab('unmark'); await loadUm([await big(4000, 3000, 'big.jpg')]); // about 48 MB of pixels
      showTab('idphoto'); await loadPh([await big(3000, 4000, 'face.jpg')]);
      showTab('merge');
      T.ok(!$('#mem-note').hidden, '應該出現提示');
      T.ok(/去浮水印/.test($('#mem-text').textContent), $('#mem-text').textContent);
      T.click('#mem-close'); T.ok($('#mem-note').hidden, '不用');
      showTab('split'); T.ok($('#mem-note').hidden, '按了不用之後，沒有多出來就不再提示');
      showTab('unmark'); showTab('merge'); T.ok($('#mem-note').hidden, '還是不提示');
      memDismissedAt = 0; showTab('split');
      T.ok(!$('#mem-note').hidden, '重新提示'); T.click('#mem-free');
      T.ok($('#mem-note').hidden && !um.w && !ph.bmp, '已釋放');
      T.ok(!$('#um-empty').hidden && !$('#ph-drop').hidden, '工具回到空白狀態');
    }
  },
  {
    name: '證件照、證件影印的特殊設定',
    async run() {
      showTab('idphoto'); T.click('#ph-sample'); await T.until(() => ph.bmp, '照片');
      T.set('#ph-spec', 'custom'); T.set('#ph-cw', '110'); T.set('#ph-ch', '120'); await T.sleep(100); drawPhAll(); await T.sleep(100);
      T.ok($('#ph-go').disabled && /放不進/.test($('#ph-summary').textContent), '太大放不進 4×6：' + $('#ph-summary').textContent);
      T.set('#ph-paper', 'a4'); await T.sleep(100);
      T.ok(!$('#ph-go').disabled, 'A4 放得下');
      const r = await T.result(() => T.click('#ph-go'));
      T.ok(/\.pdf$/.test(r.file.name), 'A4 產生 PDF：' + r.file.name);
      T.set('#ph-spec', 'tw2'); T.set('#ph-paper', '4x6');
      showTab('idcard'); T.click('#id-sample'); await T.until(() => idc.sides.every(s => s && s.bmp), '證件');
      T.set('#id-type', 'passport'); T.set('#id-scale', '2'); T.set('#id-arrange', 'side'); await T.sleep(300);
      T.ok(/超出 A4，已縮小到 \d+%/.test($('#id-prev-hint').textContent), '提示：' + $('#id-prev-hint').textContent);
      const c = await T.result(() => T.click('#id-go'));
      T.eq((await T.pdfPages(c.file)).length, 1);
      // both cards must lie entirely on the page, with a margin
      const ink = await T.ink(c.file, 0, (r, g, b) => r < 245 || g < 245 || b < 245);
      T.ok(ink && ink[0] > .02 && ink[1] > .02 && ink[2] < .98 && ink[3] < .98, '證件超出 A4：' + JSON.stringify(ink));
    }
  },

  {
    name: '壓縮：PNG 預測過的 Flate 圖片解得正確；校正的透視轉換對準四角',
    async run() {
      const W = 640, H = 480, raw = new Uint8Array(W * H * 3);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 3; raw[o] = x * 255 / W; raw[o + 1] = y * 255 / H; raw[o + 2] = 128 + 100 * Math.sin(x / 40) * Math.cos(y / 30); }
      // PNG row filters, every type in turn (None, Sub, Up, Average, Paeth)
      const stride = W * 3, filtered = new Uint8Array((stride + 1) * H);
      for (let y = 0; y < H; y++) {
        const ft = y % 5; filtered[y * (stride + 1)] = ft;
        for (let x = 0; x < stride; x++) {
          const v = raw[y * stride + x], a = x >= 3 ? raw[y * stride + x - 3] : 0, b = y ? raw[(y - 1) * stride + x] : 0, c = x >= 3 && y ? raw[(y - 1) * stride + x - 3] : 0;
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][ft];
          filtered[y * (stride + 1) + 1 + x] = (v - pred) & 255;
        }
      }
      const doc = await PDFDocument.create(), ctx = doc.context, L = window.PDFLib;
      const img = ctx.register(ctx.stream(await deflate(filtered), { Type: 'XObject', Subtype: 'Image', Width: W, Height: H, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode', DecodeParms: { Predictor: 15, Colors: 3, Columns: W, BitsPerComponent: 8 } }));
      const page = doc.addPage([W * .75, H * .75]), name = page.node.newXObject('Im', img);
      page.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(W * .75, 0, 0, H * .75, 0, 0), L.drawObject(name), L.popGraphicsState());
      const src = pdfFile(await doc.save(), 'png-predictor.pdf');
      showTab('compress'); await loadCompFile([src]);
      const r = await T.result(() => T.click('#comp-go'), '壓縮', 90000);
      const pixels = async f => { const pj = await T.pdf(f), pg = await pj.getPage(1), vp = pg.getViewport({ scale: 1 }), c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; pj.destroy(); return c.getContext('2d').getImageData(0, 0, c.width, c.height).data; };
      const a = await pixels(src), b = await pixels(r.file);
      let diff = 0; for (let i = 0; i < a.length; i += 4) diff += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      const mean = diff / (a.length / 4) / 3;
      T.ok(mean < 6, '壓縮後的圖和原圖差太多（解碼錯誤）：平均差 ' + mean.toFixed(1));
      // perspective: the output rectangle's corners land exactly on the four chosen points
      const q = [[37, 21], [610, 55], [580, 470], [20, 430]], h = homography(500, 300, q);
      const map = (u, v) => { const d = h[6] * u + h[7] * v + 1; return [(h[0] * u + h[1] * v + h[2]) / d, (h[3] * u + h[4] * v + h[5]) / d]; };
      [[0, 0], [500, 0], [500, 300], [0, 300]].forEach(([u, v], k) => { const [x, y] = map(u, v); T.ok(Math.hypot(x - q[k][0], y - q[k][1]) < 1e-6, `角 ${k}：${x},${y}`); });
      return '平均差 ' + mean.toFixed(1);
    }
  },

  {
    name: '掃描檔：遮蔽個資用 OCR 找到電話與 Email；比較用 OCR 比對文字',
    slow: true, http: true, timeout: 240000,
    async run() {
      showTab('ocr'); T.click('#ocr-sample');
      await T.until(() => ocrTab.pj && ocrTab.hasText.length === 1, '掃描範例');
      const scan = pdfFile(await ocrTab.pj.getData(), 'scan.pdf');
      await startRedacting([scan]);
      await T.until(() => dlg.open && te.page, '遮蔽視窗');
      document.querySelectorAll('[data-rf]').forEach(c => { c.checked = ['phone', 'email'].includes(c.dataset.rf); });
      $('#rf-ocr').checked = true;
      T.click('#rf-go'); await T.idle('#rf-go');
      const boxes = edit.pages[0].annots.filter(a => a.type === 'redact');
      T.eq(boxes.length, 2, '電話、Email 各一：' + $('#rf-result').textContent);
      // each box sits where the words are on the scan: in the lower part of the page, left half
      const [x0, y0, x1, y1] = edit.pages[0].view;
      for (const b of boxes) T.ok(b.ux > x0 && b.ux + b.wPt < x0 + (x1 - x0) * .8 && b.uy < y1 - (y1 - y0) * .4, '框的位置：' + JSON.stringify([b.ux, b.uy, b.wPt, b.hPt]));
      $('#te-done').click();
      // compare the scan with a version whose amount changed
      showTab('compare'); setCmpMode('text'); $('#cmp-ocr').checked = true;
      await loadCmp('a', [scan]); await loadCmp('b', [scan]);
      T.click('#cmp-go'); await T.idle('#cmp-go');
      T.eq(cmp.res.hunks.length, 0, '同一份掃描檔');
      T.ok(cmp.a.chars[0].ocr && cmp.a.chars[0].boxes instanceof Float32Array, '用 OCR 讀出文字和位置');
    }
  },

  {
    name: '手機：長按拖曳排序（觸控），點縮圖不會在拖完時誤開預覽；分頁列方向鍵',
    viewport: { width: 375, height: 812 },
    async run() {
      showTab('edit');
      await loadEditFiles([await T.labeled(['T1', 'T2', 'T3'], 'touch.pdf')]);
      await T.until(() => edit.pages.every(p => p.view) && $('#edit-grid .page-card .thumb img'), '頁面');
      const cards = () => [...document.querySelectorAll('#edit-grid .page-card')];
      const c0 = cards()[0], last = cards()[2], r0 = c0.querySelector('.meta').getBoundingClientRect();
      last.scrollIntoView({ block: 'center' }); await T.sleep(50);
      const s = c0.querySelector('.meta').getBoundingClientRect(), lr = last.getBoundingClientRect();
      const ev = (type, el, x, y) => (el || window).dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 7, clientX: x, clientY: y, isPrimary: true }));
      ev('pointerdown', c0.querySelector('.meta .mid'), s.left + s.width / 2, s.top + s.height / 2);
      await T.sleep(450); // long press
      T.ok(c0.classList.contains('sort-lifted'), '長按後拿起');
      for (let k = 1; k <= 6; k++) ev('pointermove', null, s.left + (lr.right - 5 - s.left) * k / 6, s.top + (lr.top + lr.height / 2 - s.top) * k / 6);
      ev('pointerup', null, lr.right - 5, lr.top + lr.height / 2);
      T.eq(edit.pages.map(p => p.index + 1).join(''), '231', '拖到最後');
      cards()[2].querySelector('.thumb').click(); // the finger lifts on a card: not a click on it
      T.ok(!pvDlg.open, '拖完不應開預覽');
      await T.sleep(600); cards()[0].querySelector('.thumb').click();
      T.ok(pvDlg.open, '之後點縮圖會開預覽'); T.click('#pv-close');
      // tab bar: arrow keys move between tools
      showTab('merge'); $('#tab-merge').focus();
      $('.tabs').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      T.ok(!$('#panel-' + TABS[TABS.indexOf('merge') + 1]).hidden && document.activeElement === $('#tab-' + TABS[TABS.indexOf('merge') + 1]), '→ 到下一個工具');
    }
  },

  /* ---------- 整體 ---------- */
  {
    name: '首頁：依放入的檔案建議工具',
    async run() {
      await homeTakeFiles([await T.labeled(['v1'], 'v1.pdf'), await T.labeled(['v2'], 'v2.pdf')]);
      const picks = [...document.querySelectorAll('#home-picks [data-tab]')].map(b => b.dataset.tab);
      T.ok(picks.includes('compare') && picks.includes('merge'), picks.join());
      document.querySelector('#home-picks [data-tab="compare"]').click();
      await T.until(() => cmp.a && cmp.b, '帶到比較');
    }
  },
  {
    name: '離線：第一次開啟就存好所有檔案',
    http: true,
    async run() {
      await navigator.serviceWorker.ready;
      const own = [...document.querySelectorAll('script[src], link[href]')].map(e => new URL(e.src || e.href, location.href))
        .filter(u => u.origin === location.origin).map(u => u.pathname);
      const need = [...new Set([...own, '/', '/index.html', '/lib/pdf.min.js', '/lib/pdf-lib.min.js'])];
      await T.until(async () => {
        const keys = (await (await caches.open('papertray-v1')).keys()).map(r => new URL(r.url).pathname);
        return need.every(p => keys.includes(p));
      }, '快取完成', 20000);
      return `${need.length} 個檔案`;
    }
  },
  {
    name: '離線：沒有網路時重新開啟，紙匣照常運作',
    http: true, offline: true,
    async run() {
      await navigator.serviceWorker.ready;
      await T.until(async () => (await (await caches.open('papertray-v1')).keys()).some(r => r.url.endsWith('/js/app.js')), '快取完成', 20000);
    },
    async after() {
      T.ok(getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)', 'CSS 有載入');
      showTab('merge');
      await T.until(() => merge.items.length === 2, '範例檔');
      const r = await T.result(() => T.click('#merge-go'));
      T.ok((await T.pdfPages(r.file)).length > 1, '離線也能合併');
      return '離線開啟並合併成功';
    }
  },
  {
    name: '手機寬度：每個工具都沒有橫向捲動',
    viewport: { width: 375, height: 812 },
    async run() {
      const wide = [];
      for (const t of TABS) {
        showTab(t); await T.sleep(60);
        if (document.documentElement.scrollWidth > window.innerWidth + 1) wide.push(`${t}（${document.documentElement.scrollWidth}px）`);
      }
      T.eq(wide, [], '比畫面寬的工具');
      return `${TABS.length} 個工具`;
    }
  }
];
