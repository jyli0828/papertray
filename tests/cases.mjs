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
      T.eq(parseRanges('1 - 3, 5', 10).ranges, [[1, 3], [5, 5]], '橫線前後有空格');
      T.eq(parseRanges('1 -3 5', 10).ranges, [[1, 3], [5, 5]], '橫線前有空格不會多出第 1 頁');
      T.eq(parseRanges('２ － ４，8 -', 10).ranges, [[2, 4], [8, 10]], '全形加空格');
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
    name: '編輯：頁首的 {檔名}，檔名有 $ 符號也照原樣',
    async run() {
      showTab('edit');
      await loadEditFiles([await T.labeled([''], 'n.pdf')]);
      await T.until(() => edit.pages.every(p => p.view), '頁面資訊');
      $('#edit-name').value = 'US$$5 $& $1.pdf'; T.set('#hf-head', 'File {檔名}');
      const r = await T.result(() => T.click('#edit-export'));
      const text = (await T.pdfText(r.file))[0];
      T.ok(text.includes('File US$$5 $& $1'), '頁首：' + text);
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
    name: '裁切框超出紙張（CropBox 比 MediaBox 大）：浮水印、頁碼、調整尺寸都照看得到的範圍',
    async run() {
      const doc = await PDFDocument.create(), p = doc.addPage([400, 400]);
      p.node.set(PDFName.of('CropBox'), doc.context.obj([0, 0, 800, 400])); // viewers show only the 400 × 400 paper
      const src = pdfFile(await doc.save(), 'crop.pdf');
      showTab('watermark'); await loadWm([src]);
      T.set('#wm-text', 'MARK'); T.set('#wm-color', '#ff0000'); T.set('#wm-pos', 'center'); T.set('#wm-angle', '0'); T.set('#wm-opacity', '100');
      const wmBox = await T.ink((await T.result(() => T.click('#wm-go'))).file, 0, (r, g, b) => r > 200 && g < 100 && b < 100);
      T.ok(wmBox && Math.abs((wmBox[0] + wmBox[2]) / 2 - .5) < .03, '浮水印在看得到的頁面中央：' + JSON.stringify(wmBox));
      showTab('edit'); await loadEditFiles([src]); await T.until(() => edit.pages.every(p => p.view), '頁面資訊');
      T.set('#edit-numbers', true); T.set('#pn-fmt', 'n'); T.set('#pn-pos', 'br');
      const at = await T.textAt((await T.result(() => T.click('#edit-export'))).file, 0, '1');
      T.set('#edit-numbers', false);
      T.ok(at.length === 1 && at[0][0] > .8 && at[0][0] < 1 && at[0][1] > .9, '頁碼在看得到的右下角：' + JSON.stringify(at));
      showTab('resize'); await loadResize([src]);
      T.ok($('#rs-fmeta').textContent.includes('141×141mm'), '尺寸是看得到的範圍：' + $('#rs-fmeta').textContent);
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
    name: '遮蔽個資：自動尋找也找填好的表單欄位，匯出後欄位和內容都不在',
    async run() {
      const doc = await PDFDocument.create(), p = doc.addPage([400, 400]), form = doc.getForm();
      p.drawText('ID / Phone / City', { x: 30, y: 340, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
      const id = form.createTextField('idno'); id.addToPage(p, { x: 80, y: 292, width: 200, height: 24 }); id.setText('A123456789');
      const ph = form.createTextField('notes'); ph.enableMultiline(); ph.addToPage(p, { x: 80, y: 200, width: 250, height: 60 }); ph.setText('call me\n0912-345-678');
      const keep = form.createTextField('city'); keep.addToPage(p, { x: 80, y: 120, width: 200, height: 24 }); keep.setText('Taipei');
      showTab('redact'); await startRedacting([pdfFile(await doc.save(), 'filled.pdf')]);
      await T.until(() => dlg.open && te.page, '遮蔽視窗');
      document.querySelectorAll('[data-rf]').forEach(c => { c.checked = ['id', 'mobile'].includes(c.dataset.rf); });
      T.click('#rf-go'); await T.idle('#rf-go');
      T.eq(edit.pages[0].annots.filter(a => a.type === 'redact').length, 2, '身分證、手機各一個框：' + $('#rf-result').textContent);
      $('#te-done').click();
      const r = await T.result(() => T.click('#edit-export'));
      const pj = await T.pdf(r.file), fo = await pj.getFieldObjects(); pj.destroy();
      T.ok(!fo || !Object.keys(fo).length, '匯出檔不留欄位：' + JSON.stringify(fo && Object.keys(fo)));
      const bytes = (await fileBytes(r.file)).bytes, d = await PDFDocument.load(bytes);
      T.ok(!d.getForm().getFields().length, '沒有表單欄位');
    }
  },
  {
    name: '遮蔽個資：市話包括苗栗、台東、金門、馬祖的 5、6 碼號碼，日期和手機不算市話',
    async run() {
      const re = RF_PATTERNS.phone.re, hit = s => { re.lastIndex = 0; const m = re.exec(s); return m ? m[0] : null; };
      for (const s of ['02-2345-6789', '(02)2345-6789', '04 2345 6789', '049-2345678', '037-559999', '(037)559999', '089-326141', '082-318823', '0836-22381', '02-2345-6789 轉 123'])
        T.eq(hit(`電話：${s}。`), s, '市話');
      for (const s of ['2026-11-24', '01-02-2024', '0912-345678', '0912345678', '05-11']) T.eq(hit(`見 ${s} 。`), null, `不是市話：${s}`);
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

  {
    name: 'Google 字型連不上（連線被吃掉、一直沒有回應）時，紙匣照常啟動',
    stallFonts: 'all',
    async run() {
      // Getting here at all is the test: the runner waits for app.js to have run.
      showTab('watermark'); T.click('#wm-sample');
      await T.until(() => wm.n === 3, '範例檔');
    }
  },
  {
    name: '字型檔一直下載不完時，加文字與文字浮水印不會一直等下去',
    stallFonts: 'files',
    async run() {
      const link = $('link[rel="stylesheet"][href*="fonts.googleapis.com"]');
      const loaded = () => link.sheet && link.media !== 'print';
      for (let i = 0; i < 100 && !loaded(); i++) await T.sleep(100);
      if (!loaded()) return '略過：連不到 Google Fonts';
      const t0 = performance.now();
      await ensureFont('測試文字', 20);
      const waited = performance.now() - t0;
      T.ok(waited > 1000 && waited < 5000, `等字型等了 ${Math.round(waited)} ms`);
      showTab('watermark'); T.click('#wm-sample');
      await T.until(() => wm.n === 3 && $('#wm-pno').textContent, '範例檔');
      T.eq(wm.type, 'text', '預設是文字浮水印'); T.set('#wm-text', '僅供參考');
      const r = await T.result(() => T.click('#wm-go'));
      T.eq((await T.pdf(r.file)).numPages, 3, '浮水印做完');
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
      // The list shows small pictures, not the photos themselves (those would stay decoded at full size).
      const thumbs = [...document.querySelectorAll('#img-list .img-thumb')];
      await T.until(() => thumbs.every(t => t.complete && t.naturalWidth), '清單縮圖');
      T.ok(thumbs.every(t => Math.min(t.naturalWidth, t.naturalHeight) <= 96), '清單縮圖是小圖');
      T.eq(imgs.items.map(it => [it.w, it.h]).every(([w, h]) => w > 96 && h > 96), true, '尺寸是原圖的');
    }
  },
  {
    name: '圖片轉 PDF：副檔名和內容不符的圖片（網路下載的 WebP 存成 .jpg 之類）照樣轉換',
    async run() {
      const cv = document.createElement('canvas'); cv.width = 300; cv.height = 200;
      const c = cv.getContext('2d'); c.fillStyle = '#c00'; c.fillRect(0, 0, 300, 200);
      const bytes = async t => new Uint8Array(await (await new Promise(r => cv.toBlob(r, t, .9))).arrayBuffer());
      const files = [new File([await bytes('image/png')], 'png.jpg', { type: 'image/jpeg' }), new File([await bytes('image/webp')], 'webp.jpg', { type: 'image/jpeg' }),
        new File([await bytes('image/jpeg')], 'jpeg.png', { type: 'image/png' })];
      showTab('img2pdf'); await addImages(files);
      T.eq(imgs.items.map(it => it.kind), ['png', 'other', 'jpg'], '依內容判斷格式');
      const r = await T.result(() => T.click('#img-go'));
      T.eq((await T.pdfPages(r.file)).length, 3, '三張都轉成一頁');
      for (let i = 0; i < 3; i++) T.ok(await T.ink(r.file, i, (R, G, B) => R > 150 && G < 60 && B < 60), `第 ${i + 1} 頁有圖`);
    }
  },
  {
    name: '圖片轉 PDF：帶 EXIF 轉向的 PNG 照瀏覽器顯示的方向放，不會被壓扁',
    async run() {
      const cv = document.createElement('canvas'); cv.width = 400; cv.height = 200;
      const c = cv.getContext('2d'); c.fillStyle = '#f00'; c.fillRect(0, 0, 200, 200); c.fillStyle = '#00f'; c.fillRect(200, 0, 200, 200);
      const png = new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/png'))).arrayBuffer());
      // an eXIf chunk (orientation 6: turn 90° clockwise) right after IHDR
      const table = Array.from({ length: 256 }, (_, n) => { let k = n; for (let i = 0; i < 8; i++) k = k & 1 ? 0xEDB88320 ^ (k >>> 1) : k >>> 1; return k >>> 0; });
      const crc = b => { let x = 0xFFFFFFFF; for (const v of b) x = table[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xFFFFFFFF) >>> 0; };
      const tiff = [0x4D, 0x4D, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0];
      const body = [0x65, 0x58, 0x49, 0x66, ...tiff], sum = crc(body), be = n => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
      const chunk = [...be(tiff.length), ...body, ...be(sum)], at = 8 + 25;
      const out = new Uint8Array(png.length + chunk.length); out.set(png.subarray(0, at)); out.set(chunk, at); out.set(png.subarray(at), at + chunk.length);
      showTab('img2pdf'); await addImages([new File([out], 'turned.png', { type: 'image/png' })]);
      T.eq([imgs.items[0].w, imgs.items[0].h, imgs.items[0].kind], [200, 400, 'other'], '照顯示的方向（直的）、重新編碼');
      const r = await T.result(() => T.click('#img-go'));
      const red = await T.ink(r.file, 0, (R, G, B) => R > 200 && G < 60 && B < 60), blue = await T.ink(r.file, 0, (R, G, B) => B > 200 && R < 60 && G < 60);
      T.ok(red && blue && red[3] <= blue[1] + .01, `紅色在上、藍色在下：${JSON.stringify({ red, blue })}`);
    }
  },
  {
    name: 'HEIC 照片改名成 .jpg 也會先轉成 JPEG（依檔案開頭判斷）',
    async run() {
      // The start of a HEIC file ("ftyp" + brand "heic"); the converter is replaced by one that records its input.
      const heic = new File([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0])], 'IMG_0001.jpg', { type: 'image/jpeg' });
      const cv = document.createElement('canvas'); cv.width = 40; cv.height = 30;
      const jpg = await new Promise(r => cv.toBlob(r, 'image/jpeg'));
      const seen = [], real = window.heic2any;
      window.heic2any = async ({ blob }) => { seen.push(blob.name); return jpg; };
      try {
        const out = await prepImages([heic, new File([jpg], 'real.jpg', { type: 'image/jpeg' })]);
        T.eq(seen, ['IMG_0001.jpg'], '只有 HEIC 送去轉換');
        T.eq(out.map(f => [f.name, f.type]), [['IMG_0001.jpg', 'image/jpeg'], ['real.jpg', 'image/jpeg']], '轉換後的檔案');
        T.ok(out[1].size === jpg.size, '一般 JPEG 原封不動');
      } finally { window.heic2any = real; }
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
    name: '轉向的頁面與橫放的文字：抽出文字分得出行與字；遮蔽個資找得到分成幾段的電話',
    async run() {
      const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
      // page 1: ordinary text on a page turned by /Rotate 90 (a landscape page)
      const p1 = doc.addPage([400, 300]);
      p1.drawText('First line', { x: 30, y: 250, size: 14, font }); p1.drawText('here', { x: 140, y: 250, size: 14, font });
      p1.drawText('Second line', { x: 30, y: 230, size: 14, font });
      p1.setRotation(degrees(90));
      // page 2: text set sideways (running up the page), with the phone number in three runs
      const p2 = doc.addPage([300, 400]);
      [['Tel', 60], ['0912', 100], ['345', 140], ['678', 172]].forEach(([s, y]) => p2.drawText(s, { x: 150, y, size: 14, font, rotate: degrees(90) }));
      p2.drawText('next', { x: 170, y: 60, size: 14, font, rotate: degrees(90) });
      const src = pdfFile(await doc.save(), 'turned.pdf');
      showTab('pdf2img'); await loadP2i([src]);
      T.set('#p2i-fmt', 'txt');
      const text = (await (await T.result(() => T.click('#p2i-go'))).file.text()).replace(/^﻿/, '');
      T.set('#p2i-fmt', 'jpg');
      T.ok(/First line here\nSecond line/.test(text), '第 1 頁分行、字之間有空格：' + JSON.stringify(text));
      T.ok(/Tel 0912 345 678\s*\n\s*next/.test(text), '第 2 頁：' + JSON.stringify(text));
      showTab('redact'); await startRedacting([src]);
      await T.until(() => dlg.open && te.page, '遮蔽視窗');
      document.querySelectorAll('[data-rf]').forEach(c => { c.checked = c.dataset.rf === 'mobile'; });
      $('#rf-scope').value = 'all'; T.click('#rf-go'); await T.idle('#rf-go');
      T.eq(edit.pages[1].annots.filter(a => a.type === 'redact').length, 1, '橫放的手機號碼：' + $('#rf-result').textContent);
      $('#te-done').click();
    }
  },
  {
    name: '沒有內嵌字型的中文（舊式 Big5、UCS-2 對應表）：畫得出來，也抽得出文字',
    async run() {
      // Older Taiwanese PDFs name a standard font (MingLiU) and an Adobe character map instead of embedding anything;
      // pdf.js needs its CMap files (lib/cmaps) to read such text at all.
      const doc = await PDFDocument.create(), ctx = doc.context, page = doc.addPage([300, 200]);
      const font = enc => ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'MingLiU', Encoding: enc,
        DescendantFonts: [ctx.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'MingLiU',
          CIDSystemInfo: { Registry: window.PDFLib.PDFString.of('Adobe'), Ordering: window.PDFLib.PDFString.of('CNS1'), Supplement: 0 },
          FontDescriptor: ctx.register(ctx.obj({ Type: 'FontDescriptor', FontName: 'MingLiU', Flags: 6, FontBBox: [0, -200, 1000, 800],
            ItalicAngle: 0, Ascent: 800, Descent: -200, CapHeight: 700, StemV: 80 })), DW: 1000 })] }));
      page.node.set(PDFName.of('Resources'), ctx.obj({ Font: { U: font('UniCNS-UCS2-H'), B: font('ETen-B5-H') } }));
      page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(
        'BT /U 30 Tf 30 130 Td <4E2D65875B57> Tj ET BT /B 30 Tf 30 60 Td <A4A4A4E5A672> Tj ET')));
      const src = pdfFile(await doc.save(), 'big5.pdf');
      T.ok(await T.ink(src, 0, (r, g, b) => r < 120 && g < 120 && b < 120), '頁面上畫出字');
      showTab('pdf2img'); await loadP2i([src]);
      T.set('#p2i-fmt', 'txt');
      const text = (await (await T.result(() => T.click('#p2i-go'))).file.text()).replace(/^﻿/, '');
      T.set('#p2i-fmt', 'jpg');
      T.eq(text.split('\n').map(s => s.replace(/\s+/g, '')).filter(Boolean), ['中文字', '中文字'], JSON.stringify(text));
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
  {
    name: '打得開但有一頁壞掉的 PDF：拆分保留原本的檔案，填表單、加浮水印照常顯示其他頁',
    async run() {
      T.allowErrors = true;
      const bad = async () => { // page 2 of the page tree is not a page at all
        const d = await PDFDocument.load((await T.labeled(['A', 'B', 'C'])).bytes);
        d.catalog.Pages().Kids().set(1, d.context.obj(5));
        return pdfFile(await d.save({ useObjectStreams: false }), 'badpage.pdf');
      };
      showTab('split');
      await loadSplit([await T.labeled(['S1', 'S2'], 'good.pdf')]);
      let e0 = T.errors.length;
      await loadSplit([await bad()]);
      T.ok(T.errors.length > e0, '拆分要說明檔案有問題');
      T.eq(split.name, 'good.pdf', '拆分留著原本的檔案');
      const r = await T.result(() => T.click('#split-go'));
      T.eq(r.kind, 'zip', '原本的檔案還能拆分');
      showTab('form'); e0 = T.errors.length;
      await loadForm([await bad()]);
      T.ok(T.errors.length > e0 && /無法讀取/.test(T.errors[T.errors.length - 1]), '填表單說明有頁面讀不到');
      T.eq($('#ff-pages').querySelectorAll('.ff-page').length, ff.pj.numPages - 1, '其他頁照常顯示');
      showTab('watermark');
      await loadWm([await bad()]);
      e0 = T.errors.length; T.click('#wm-next');
      await T.until(() => T.errors.length > e0, '第 2 頁的錯誤提示');
      T.eq($('#wm-pno').textContent, `2 / ${wm.n}`, '頁碼跟著換');
      T.click('#wm-prev'); await T.until(() => $('#wm-pno').textContent === `1 / ${wm.n}` && !wm.task, '回到第 1 頁');
    }
  },
  {
    name: '處理中調整清單：合併、圖片轉 PDF 照按下時的清單產生，書籤名稱也對得上',
    async run() {
      showTab('merge'); merge.items = []; renderMerge();
      const files = [];
      for (const k of ['A', 'B', 'C']) files.push(await T.labeled(Array.from({ length: 150 }, (_, i) => k + i), k + '.pdf'));
      await addMergeFiles(files);
      T.set('#merge-bm', true);
      let pending = T.result(() => T.click('#merge-go'));
      $('#merge-list .file-row:nth-child(1) [data-act="remove"]').click(); // refused while merging
      T.eq(merge.items.length, 3, '合併中不能移除');
      merge.items.reverse(); renderMerge(); // a drag in the list while merging
      let r = await pending;
      const text = await T.pdfText(r.file);
      T.eq(['A', 'B', 'C'].map(k => text.findIndex(s => s.trim() === k + '0')), [0, 150, 300], '照按下時的順序');
      T.eq((await T.outline(r.file)).map(o => [o.t, o.p]), [['A', 1], ['B', 151], ['C', 301]], '每份檔案的書籤名稱');
      T.set('#merge-bm', false);
      showTab('img2pdf'); imgs.items = []; renderImgs();
      const pics = [];
      for (let i = 0; i < 3; i++) {
        const cv = document.createElement('canvas'); cv.width = 1600; cv.height = 1000 + i * 100;
        cv.getContext('2d').fillRect(0, 0, 10, 10);
        pics.push(new File([await new Promise(res => cv.toBlob(res, 'image/webp', .9))], `p${i}.webp`, { type: 'image/webp' }));
      }
      await addImages(pics);
      pending = T.result(() => T.click('#img-go'));
      $('#img-list .file-row:nth-child(1) [data-act="remove"]').click();
      T.eq(imgs.items.length, 3, '轉換中不能移除');
      imgs.items.reverse(); renderImgs();
      r = await pending;
      T.eq((await T.pdfPages(r.file)).length, 3, '三張圖片都在');
    }
  },
  {
    name: '去浮水印：處理中按「復原」不會被處理完的結果蓋回去',
    async run() {
      showTab('unmark'); T.click('#um-sample'); await T.until(() => um.w, '範例');
      const paint = (x0, y0, x1, y1) => { mctxU.save(); mctxU.setTransform(um.ms, 0, 0, um.ms, 0, 0); mctxU.fillStyle = '#ff2a4a'; mctxU.fillRect(x0, y0, x1 - x0, y1 - y0); mctxU.restore(); };
      paint(250, 250, 300, 300); T.click('#um-go'); await T.idle('#um-go');
      T.eq(um.history.length, 1, '第一次移除');
      paint(400, 250, 460, 310); T.click('#um-go');
      T.ok(um.busy, '第二次移除進行中');
      $('#um-undo').click();
      T.eq(um.history.length, 1, '處理中不復原');
      await T.idle('#um-go');
      T.eq(um.history.length, 2, '兩次移除都能復原');
    }
  },
  {
    name: '比較：比對中切換方式會停下，不會顯示另一種方式的結果',
    async run() {
      showTab('compare'); setCmpMode('visual');
      await loadCmp('a', [await T.labeled(Array.from({ length: 12 }, (_, i) => 'Old ' + i), 'a.pdf')]);
      await loadCmp('b', [await T.labeled(Array.from({ length: 12 }, (_, i) => (i % 3 ? 'Old ' : 'New ') + i), 'b.pdf')]);
      T.click('#cmp-go');
      $('#cmp-m-text').click();
      await T.idle('#cmp-go');
      T.ok($('#cmp-result').hidden && !cmp.res, '比對畫面的結果不會出現在比對文字');
      T.click('#cmp-go'); await T.idle('#cmp-go');
      T.ok(cmp.res && !cmp.res.vis && cmp.res.hunks.length === 4, '再按一次比對文字：' + $('#cmp-sum').textContent);
    }
  },
  {
    name: '壓縮：處理中改設定會停下，不會在最後出錯',
    async run() {
      showTab('compress'); comp.items = []; clearCompResults(); renderCompList();
      await loadCompFile([await T.labeled(['A1', 'A2', 'A3'], 'a.pdf'), await T.labeled(Array.from({ length: 6 }, (_, i) => 'B' + i), 'b.pdf')]);
      setCompMode('raster');
      try {
        T.click('#comp-go');
        await T.until(() => comp.items[0].out, '第一份完成');
        const strong = $('input[name="level"][value="strong"]'); strong.checked = true; strong.dispatchEvent(new Event('change', { bubbles: true }));
        await T.idle('#comp-go');
        T.ok($('#comp-result').hidden && comp.items.every(it => !it.out), '停下，舊設定的結果清掉');
        T.click('#comp-go'); await T.idle('#comp-go');
        T.ok(comp.items.every(it => it.out) && !$('#comp-result').hidden, '用新設定再壓一次');
      } finally { setCompMode('keep'); $('input[name="level"][value="medium"]').checked = true; }
    }
  },
  {
    name: '圖片工具：處理中改格式會停下；同一批的圖片都是同一種格式',
    async run() {
      showTab('imgtool'); itool.items = []; renderImgTool();
      const files = [];
      for (let i = 0; i < 4; i++) {
        const cv = document.createElement('canvas'); cv.width = 2400; cv.height = 1600; cv.getContext('2d').fillRect(0, 0, 50, 50);
        files.push(new File([await new Promise(r => cv.toBlob(r, 'image/jpeg', .9))], `p${i}.jpg`, { type: 'image/jpeg' }));
      }
      await addImgTool(files);
      try {
        T.set('#it-fmt', 'jpg');
        const n = T.results.length;
        T.click('#it-go');
        await T.until(() => itool.items[0].out, '第一張完成');
        T.set('#it-fmt', 'png');
        await T.idle('#it-go');
        T.eq(T.results.length, n, '改了格式就不交出混合格式的結果');
        const r = await T.result(() => T.click('#it-go'));
        T.eq(Object.keys((await T.zip(r.file)).files).map(k => k.split('.').pop()), ['png', 'png', 'png', 'png'], '同一種格式');
      } finally { T.set('#it-fmt', 'keep'); }
    }
  },
  {
    name: '按下匯出、產生之後才改的頁面或設定，不會跑進結果（編輯、填表單）',
    async run() {
      showTab('edit');
      await loadEditFiles([await T.labeled(['P1', 'P2', 'P3'], 'three.pdf')]);
      await T.until(() => edit.pages.every(p => p.view), '頁面資訊');
      $('#edit-numbers').checked = false;
      try {
        let pending = T.result(() => T.click('#edit-export'));
        edit.pages.forEach(p => { p.rot = 90; }); renderEdit(); $('#edit-numbers').checked = true;
        let r = await pending;
        T.eq((await T.pdfPages(r.file)).map(p => p.rotate), [0, 0, 0], '按下後才轉的頁面不轉');
        T.eq((await T.pdfText(r.file)).map(s => s.trim()), ['P1', 'P2', 'P3'], '按下後才勾的頁碼不加');
        r = await T.result(() => T.click('#edit-export'));
        T.eq((await T.pdfPages(r.file)).map(p => p.rotate), [90, 90, 90], '再匯出一次就有');
      } finally { $('#edit-numbers').checked = false; }
      showTab('form'); T.click('#ff-sample'); await T.until(() => ff.fields.length > 3, '表單');
      const inp = $('#ff-pages .ff-field[data-name="name"]'); inp.value = '王小明'; inp.dispatchEvent(new Event('input', { bubbles: true }));
      const pending = T.result(() => T.click('#ff-go'));
      $('#ff-reset').click();
      const f = await pending;
      T.eq((await PDFDocument.load(f.file.bytes)).getForm().getTextField('name').getText(), '王小明', '按下產生後才清除，結果還是填好的');
    }
  },
  {
    name: '文字辨識：辨識中切換輸出格式，檔名的副檔名還是對的',
    slow: true, http: true, timeout: 180000,
    async run() {
      showTab('ocr'); T.click('#ocr-sample');
      await T.until(() => ocrTab.pj && ocrTab.hasText.length === 1, '掃描範例');
      T.set('#ocr-out', 'pdf');
      try {
        const pending = T.result(() => T.click('#ocr-go'), '辨識', 150000);
        await T.sleep(50); T.set('#ocr-out', 'txt');
        const r = await pending;
        T.eq([r.kind, r.file.name], ['pdf', '範例掃描檔-可搜尋.pdf'], '輸出 PDF 的檔名');
      } finally { T.set('#ocr-out', 'pdf'); }
    }
  },
  {
    name: '處理中的按鈕一直顯示「取消」而且按得到，處理完才換成新的標籤（壓縮、拆分、只匯出選取）',
    async run() {
      showTab('compress'); comp.items = []; clearCompResults(); renderCompList();
      await loadCompFile([await T.labeled(['A1', 'A2'], 'a.pdf'), await T.labeled(Array.from({ length: 6 }, (_, i) => 'B' + i), 'b.pdf')]);
      setCompMode('raster');
      try {
        const go = $('#comp-go'); T.click('#comp-go');
        await T.until(() => comp.items[0].out, '第一份完成');
        T.ok(go.querySelector('.cancel-hint'), '壓縮完第一份後還顯示「取消」');
        await T.idle('#comp-go');
        T.eq(go.textContent, '壓縮 2 份', '完成後恢復');
      } finally { setCompMode('keep'); }
      showTab('split');
      await loadSplit([await T.labeled(Array.from({ length: 120 }, (_, i) => 'S' + i), 's.pdf')]);
      T.click('#split-go'); T.set('#split-ranges', 'abc'); // a mistake typed while splitting
      T.ok(!$('#split-go').disabled && $('#split-go').querySelector('.cancel-hint'), '拆分中還能按取消');
      $('#split-go')._jobAt -= 1000; // as if a moment had passed (a click right after the first is a double-click)
      $('#split-go').click(); await T.idle('#split-go');
      T.ok($('#split-go').disabled, '停下後才照新的（有誤的）頁碼停用');
      showTab('edit');
      await loadEditFiles([await T.labeled(['P1', 'P2', 'P3'], 'e.pdf')]);
      await T.until(() => edit.pages.every(p => p.view), '頁面資訊');
      edit.pages[0].selected = true; renderEdit();
      const xs = $('#edit-export-sel'), pending = T.result(() => xs.click());
      edit.pages.forEach(p => { p.selected = true; }); renderEdit(); // all selected: the button would hide
      T.ok(!xs.hidden && xs.querySelector('.cancel-hint'), '匯出中按鈕不會消失');
      await pending; await T.idle('#edit-export-sel');
      T.ok(xs.hidden, '完成後才藏起來');
    }
  },
  {
    name: '連按兩下（雙擊）開始的按鈕不會馬上取消',
    async run() {
      showTab('pdf2img');
      await loadP2i([await T.labeled(Array.from({ length: 8 }, (_, i) => 'P' + i), 'many.pdf')]);
      T.set('#p2i-fmt', 'png'); T.set('#p2i-dpi', '300');
      const pending = T.result(async () => { T.click('#p2i-go'); await T.sleep(150); $('#p2i-go').click(); });
      const r = await pending;
      T.eq(Object.keys((await T.zip(r.file)).files).length, 8, '雙擊後照常轉完');
      T.set('#p2i-dpi', '150');
    }
  },
  {
    name: '簽名：刪除其他簽名時，選好的簽名不會換掉',
    async run() {
      const mk = c => { const cv = document.createElement('canvas'); cv.width = 200; cv.height = 80; const x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(10, 10, 180, 60); return { src: cv.toDataURL(), w: 200, h: 80 }; };
      sigs.list = []; const [red, green, blue] = [mk('red'), mk('green'), mk('blue')];
      addSignature(red); addSignature(green); addSignature(blue); // newest first: blue, green, red
      $('#sign-sig-list .sig-item[data-i="2"]').click();
      T.ok(sigs.list[sigs.sel] === red, '選了紅色');
      $('#sign-sig-list [data-del="0"]').click();
      T.ok(sigs.list[sigs.sel] === red, '刪掉藍色後還是紅色');
      $('#sign-sig-list [data-del="1"]').click();
      T.ok(sigs.list[sigs.sel] === green, '刪掉選好的，改選剩下的');
      $('#sign-sig-list [data-del="0"]').click();
      T.eq(sigs.sel, -1, '全部刪掉');
    }
  },
  {
    name: '首頁推薦的工具正在處理時，檔案不會被塞進去',
    async run() {
      showTab('pdf2img');
      await loadP2i([await T.labeled(Array.from({ length: 30 }, (_, i) => 'OLD' + i), 'old.pdf')]);
      await T.until(() => p2i.pages.every(p => p.w), '頁面資訊');
      T.set('#p2i-fmt', 'png'); T.set('#p2i-dpi', '300');
      const n = T.results.length;
      T.click('#p2i-go');
      await T.until(() => $('#p2i-go').classList.contains('is-running'), '開始');
      showTab('home'); await homeTakeFiles([await T.labeled(['NEW'], 'new.pdf')]);
      await sendHomeFiles('pdf2img');
      T.ok(!$('#panel-home').hidden, '工具在忙時應該留在首頁');
      await T.idle('#p2i-go');
      T.ok(T.results.length > n && T.results[T.results.length - 1].kind === 'zip', '舊檔案的轉換要完成');
      T.eq(p2i.name, 'old.pdf', '處理中不換檔案');
      await sendHomeFiles('pdf2img'); // done now: the waiting file goes in
      await T.until(() => p2i.name === 'new.pdf', '之後再交給工具');
    }
  },
  {
    name: '換檔載入中：舊的頁面卡片不會留在畫面上；拆分換檔時舊檔案在讀完前都還能用',
    async run() {
      showTab('pdf2img');
      await loadP2i([await T.labeled(['A', 'B'], 'small.pdf')]);
      const loading = loadP2i([await T.labeled(Array.from({ length: 300 }, (_, i) => 'P' + i), 'big.pdf')]);
      await T.until(() => p2i.pages.length === 300, '新檔案的頁面');
      T.eq($('#p2i-grid').children.length, 300, '格子裡是新檔案的頁面');
      $('#p2i-grid [data-act="sel"]').click();
      await loading;
      T.eq(p2i.pages.filter(p => p.selected).length, 299, '取消勾選一頁');
      showTab('split');
      await loadSplit([await T.labeled(['S1', 'S2'], 'first.pdf')]);
      // The old file is closed only after every page of the new one has been read.
      const old = split.pj, order = [], realOpen = openPdfjs, realDestroy = old.destroy.bind(old);
      old.destroy = () => { order.push('close old'); return realDestroy(); };
      openPdfjs = async (...a) => { const pj = await realOpen(...a), get = pj.getPage.bind(pj); pj.getPage = n => { order.push('read'); return get(n); }; return pj; };
      try { await loadSplit([await T.labeled(Array.from({ length: 30 }, (_, i) => 'N' + i), 'next.pdf')]); } finally { openPdfjs = realOpen; }
      T.eq(order.indexOf('close old'), 30, '讀完新檔案的 30 頁才關掉舊檔案');
      T.eq(split.pages.length, 30, '換成新檔案');
    }
  },
  {
    name: '編輯：放入不能用的檔案不會多出空的復原步驟；插入頁面一次復原',
    async run() {
      T.allowErrors = true;
      showTab('edit');
      await loadEditFiles([await T.labeled(['P1', 'P2'], 'two.pdf')]);
      await T.until(() => edit.pages.every(p => p.view), '頁面資訊');
      $('#panel-edit')._paste([new File(['hello'], 'notes.txt', { type: 'text/plain' })]);
      await T.sleep(200);
      T.eq(editHist.undo.length, 0, '沒有加入頁面就不該有復原步驟');
      T.ok($('#edit-undo').disabled, '復原按鈕停用');
      $('#panel-edit')._paste([await T.labeled(['P3'], 'three.pdf')]);
      await T.until(() => edit.pages.length === 3, '插入');
      T.click('#edit-blank'); await T.until(() => edit.pages.length === 4, '空白頁');
      T.eq(editHist.undo.length, 2, '插入 PDF、空白頁各一步');
      undoEdit(); undoEdit();
      T.eq(edit.pages.length, 2, '復原兩次回到原本兩頁');
    }
  },
  {
    name: '合併：交錯合併時取頁有錯，提示不會留著舊的順序',
    async run() {
      showTab('merge');
      await addMergeFiles([await T.labeled(['F1', 'F2'], 'front.pdf'), await T.labeled(['B2', 'B1'], 'back.pdf')]);
      T.set('#merge-how', 'zip');
      T.ok($('#merge-how-hint').textContent.startsWith('順序'), '顯示順序');
      merge.items[0].range = '9'; updateMergeSummary();
      T.ok(!$('#merge-how-hint').textContent.includes('順序：'), '頁碼有誤時不顯示舊的順序：' + $('#merge-how-hint').textContent);
      T.ok($('#merge-go').disabled, '不能合併');
      merge.items[0].range = ''; updateMergeSummary();
      T.ok($('#merge-how-hint').textContent.startsWith('順序') && !$('#merge-how-hint').classList.contains('warn'), '修正後恢復');
      T.set('#merge-how', 'seq');
    }
  },
  {
    name: '遮蔽個資：自動尋找還沒完成就關掉編輯視窗，不會在背後加上遮蔽框',
    async run() {
      showTab('edit');
      await loadEditFiles([await T.labeled(Array.from({ length: 4 }, () => 'ID A123456789'), 'ids.pdf')]);
      await T.until(() => edit.pages.every(p => p.view), '頁面資訊');
      // Hold the search on its second page (as a slow OCR page would), then close the editor.
      let release; const gate = new Promise(r => { release = r; });
      const real = pageChars; let calls = 0;
      pageChars = async (...a) => { if (++calls === 2) await gate; return real(...a); };
      try {
        await openTextEditor(edit.pages[0], 'redact');
        $('#rf-scope').value = 'all'; document.querySelectorAll('[data-rf]').forEach(c => { c.checked = c.dataset.rf === 'id'; });
        T.click('#rf-go');
        await T.until(() => calls === 2, '尋找到第二頁');
        $('#te-done').click();
        release(); await T.idle('#rf-go');
      } finally { pageChars = real; }
      T.eq(edit.pages.map(p => p.annots.length), [0, 0, 0, 0], '關掉後沒有遮蔽框');
      T.ok($('#edit-undo').disabled, '沒有要復原的');
      await openTextEditor(edit.pages[0], 'redact');
      T.click('#rf-go'); await T.idle('#rf-go');
      $('#te-done').click();
      T.eq(edit.pages.map(p => p.annots.length), [1, 1, 1, 1], '找完再關：每頁一個框');
      T.eq($('#edit-grid').querySelectorAll('.badge.redact').length, 4, '頁面上看得到');
      undoEdit();
      T.eq(edit.pages.map(p => p.annots.length), [0, 0, 0, 0], '一次復原');
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
    name: '填表單：下拉選項有自己的匯出值時，存的是匯出值，畫面顯示選項文字',
    async run() {
      const doc = await PDFDocument.create(), L = window.PDFLib, ctx = doc.context, N = k => PDFName.of(k);
      const p = doc.addPage([400, 400]), dd = doc.getForm().createDropdown('city');
      dd.addOptions(['x']); dd.addToPage(p, { x: 50, y: 300, width: 200, height: 24 });
      dd.acroField.dict.set(N('Opt'), ctx.obj([['TP', 'Taipei'], ['KH', '高雄']].map(([v, d]) => ctx.obj([L.PDFString.of(v), L.PDFHexString.fromText(d)]))));
      showTab('form'); await loadForm([pdfFile(await doc.save(), 'opt.pdf')]);
      const sel = $('#ff-pages select'); T.eq([...sel.options].map(o => o.textContent), ['', 'Taipei', '高雄'], '選單顯示選項文字');
      sel.value = '高雄'; sel.dispatchEvent(new Event('input', { bubbles: true }));
      const r = await T.result(() => T.click('#ff-go'));
      const out = await PDFDocument.load(r.file.bytes);
      T.eq(out.getForm().getField('city').acroField.dict.lookup(N('V')).decodeText(), 'KH', '欄位的值');
      T.ok(await T.ink(r.file, 0, (R, G, B) => R < 60 && G < 60 && B < 60, 1), '欄位上畫出「高雄」');
      await loadForm([r.file]); T.eq($('#ff-pages select').value, '高雄', '再打開時選的是高雄');
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
    name: '壓縮（保留文字）：Word、Acrobat 那種沒有 /Decode 的透明遮罩不會被轉成 JPEG，照片不會消失',
    async run() {
      const W = 800, H = 600, doc = await PDFDocument.create(), ctx = doc.context, N = k => PDFName.of(k);
      // a photo, and a soft-edged mask: left half (nearly) opaque, right half (nearly) transparent
      const px = new Uint8Array(W * H * 3), mask = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) {
        px[i * 3] = 20 + Math.random() * 30; px[i * 3 + 1] = 40 + Math.random() * 30; px[i * 3 + 2] = 200 + Math.random() * 50;
        mask[i] = (i % W) < W / 2 ? 180 + Math.random() * 75 : Math.random() * 20;
      }
      const sm = ctx.register(ctx.stream(await deflate(mask), { Type: 'XObject', Subtype: 'Image', Width: W, Height: H, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode' }));
      const im = ctx.register(ctx.stream(await deflate(px), { Type: 'XObject', Subtype: 'Image', Width: W, Height: H, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode', SMask: sm }));
      const p = doc.addPage([400, 300]);
      p.node.set(N('Resources'), ctx.obj({ XObject: ctx.obj({ Im1: im }) }));
      p.node.set(N('Contents'), ctx.register(ctx.flateStream('q 400 0 0 300 0 0 cm /Im1 Do Q')));
      const blue = (r, g, b) => b > 120 && r < 120 && b - r > 60;
      showTab('compress'); await loadCompFile([pdfFile(await doc.save(), 'smask.pdf')]);
      const r = await T.result(() => T.click('#comp-go'));
      const shown = await T.ink(r.file, 0, blue);
      T.ok(shown && shown[0] < .05 && Math.abs(shown[2] - .5) < .05, '照片的左半邊還在、右半邊透明：' + JSON.stringify(shown));
      const d = await PDFDocument.load(r.file.bytes), mk = d.context.enumerateIndirectObjects().find(([, o]) => o instanceof window.PDFLib.PDFRawStream && o.dict.get(N('SMask')));
      T.eq(String(d.context.lookup(mk[1].dict.get(N('SMask'))).dict.get(N('ColorSpace'))), '/DeviceGray', '遮罩還是灰階');
    }
  },
  {
    name: '壓縮（保留文字）：PDF 裡帶 EXIF 轉向的手機照片不會被轉向、壓扁（背景程式和頁面上都一樣）',
    async run() {
      // 1600 × 800, red left half and blue right half, with an EXIF tag saying "turn 90°" (which PDF viewers ignore)
      const cv = document.createElement('canvas'); cv.width = 1600; cv.height = 800;
      const c = cv.getContext('2d'), id = c.createImageData(1600, 800);
      for (let y = 0; y < 800; y++) for (let x = 0; x < 1600; x++) {
        const o = (y * 1600 + x) * 4, n = Math.random() * 40, left = x < 800;
        id.data[o] = left ? 215 + n : n; id.data[o + 1] = n; id.data[o + 2] = left ? n : 215 + n; id.data[o + 3] = 255;
      }
      c.putImageData(id, 0, 0);
      const jpg = new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/jpeg', .97))).arrayBuffer());
      const tiff = [0x4D, 0x4D, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0];
      const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff], len = body.length + 2, app1 = [0xFF, 0xE1, len >> 8, len & 255, ...body];
      const exif = new Uint8Array(jpg.length + app1.length); exif.set(jpg.subarray(0, 2)); exif.set(app1, 2); exif.set(jpg.subarray(2), 2 + app1.length);
      const red = (r, g, b) => r > 180 && g < 90 && b < 90, blue = (r, g, b) => b > 180 && r < 90 && g < 90;
      for (const n of [1, 2]) { // one photo is done on the page, several in background workers
        const doc = await PDFDocument.create(), img = await doc.embedJpg(exif);
        for (let k = 0; k < n; k++) doc.addPage([400, 200]).drawImage(n > 1 && k ? await doc.embedJpg(exif.slice()) : img, { x: 0, y: 0, width: 400, height: 200 });
        showTab('compress'); comp.items = []; await loadCompFile([pdfFile(await doc.save(), `exif-${n}.pdf`)]);
        const r = await T.result(() => T.click('#comp-go'));
        T.ok(!comp.items[0].out.kept, '照片有重新壓縮');
        T.eq([await T.ink(r.file, 0, red), await T.ink(r.file, 0, blue)], [[0, 0, .5, 1], [.5, 0, 1, 1]], `${n} 張照片：紅左藍右，和原本一樣`);
      }
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
    name: '具名目的地的內部連結（LaTeX、Word 的寫法）：拆分、編輯、合併不會失敗，連結指向新檔案裡的頁',
    async run() {
      const doc = await PDFDocument.create(), ctx = doc.context, N = k => PDFName.of(k), L = window.PDFLib;
      const pages = [0, 1, 2].map(() => doc.addPage([300, 300]));
      const link = (y, extra) => ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, y, 100, y + 30], Border: [0, 0, 0], ...extra }));
      pages[0].node.set(N('Annots'), ctx.obj([
        link(10, { A: ctx.obj({ S: 'GoTo', D: L.PDFString.of('third') }) }), // a string, from the /Names tree
        link(50, { Dest: N('second') })                                       // a name, from the old /Dests dictionary
      ]));
      doc.catalog.set(N('Names'), ctx.obj({ Dests: ctx.obj({ Names: ctx.obj([L.PDFString.of('third'), ctx.obj([pages[2].ref, N('Fit')])]) }) }));
      doc.catalog.set(N('Dests'), ctx.obj({ second: ctx.obj([pages[1].ref, N('Fit')]) }));
      const src = pdfFile(await doc.save(), 'named.pdf');
      const links = async (file, pno) => {
        const pj = await T.pdf(file), out = [];
        for (const a of await (await pj.getPage(pno)).getAnnotations()) if (a.subtype === 'Link') {
          let d = a.dest; if (typeof d === 'string') d = await pj.getDestination(d);
          out.push(d ? (await pj.getPageIndex(d[0])) + 1 : null);
        }
        pj.destroy(); return out;
      };
      showTab('split'); await loadSplit([src]);
      $('input[name="split-mode"][value="range"]').checked = true; T.set('#split-ranges', '1-3'); renderSplit();
      T.eq(await links((await T.result(() => T.click('#split-go'))).file, 1), [3, 2], '拆分');
      T.set('#split-ranges', '1-2'); renderSplit();
      T.eq(await links((await T.result(() => T.click('#split-go'))).file, 1), [2], '拆分（第 3 頁不在，連到它的連結拿掉）');
      showTab('edit'); await loadEditFiles([src]); await T.until(() => edit.pages.length === 3 && edit.pages.every(p => p.view), '頁面資訊');
      T.eq(await links((await T.result(() => T.click('#edit-export'))).file, 1), [3, 2], '編輯');
      showTab('merge'); await addMergeFiles([await T.labeled(['X'], 'x.pdf'), src]);
      T.eq(await links((await T.result(() => T.click('#merge-go'))).file, 2), [4, 3], '合併');
    }
  },
  {
    name: '同一個表單欄位放在每一頁：拆出一頁或刪掉其他頁時，其他頁的內容不會跟著進來，欄位還能填',
    async run() {
      const doc = await PDFDocument.create();
      const c = document.createElement('canvas'); c.width = 600; c.height = 600; const x = c.getContext('2d'), id = x.createImageData(600, 600);
      for (let i = 0; i < id.data.length; i++) id.data[i] = Math.random() * 255;
      x.putImageData(id, 0, 0);
      const jpg = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', .95))).arrayBuffer());
      const tf = doc.getForm().createTextField('name');
      for (let i = 0; i < 8; i++) { const p = doc.addPage([400, 400]); p.drawImage(await doc.embedJpg(jpg), { x: 0, y: 0, width: 400, height: 400 }); tf.addToPage(p, { x: 20, y: 20, width: 200, height: 24 }); }
      const whole = await doc.save();
      const images = async f => { const d = await PDFDocument.load((await fileBytes(f)).bytes); return [...d.context.enumerateIndirectObjects()].filter(([, o]) => o instanceof window.PDFLib.PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')).length; };
      showTab('split'); await loadSplit([pdfFile(whole, 'f.pdf')]);
      $('input[name="split-mode"][value="range"]').checked = true; T.set('#split-ranges', '1'); renderSplit();
      const one = (await T.result(() => T.click('#split-go'))).file;
      T.eq(await images(one), 1, '拆出 1 頁只有 1 張圖');
      showTab('edit'); await loadEditFiles([pdfFile(whole, 'f.pdf')]);
      await T.until(() => edit.pages.length === 8 && edit.pages.every(p => p.view), '頁面資訊');
      edit.pages = edit.pages.slice(0, 2); renderEdit();
      const ed = (await T.result(() => T.click('#edit-export'))).file;
      T.eq(await images(ed), 2, '刪掉的 6 頁不在檔案裡');
      showTab('form'); await loadForm([one]);
      T.eq(ff.fields.map(f => f.a.fieldName), ['name'], '拆出的頁上欄位還能填');
      return `整份 ${(whole.length / 1e3).toFixed(0)} KB → 第 1 頁 ${(one.size / 1e3).toFixed(0)} KB`;
    }
  },
  {
    name: '圖層：預設隱藏的圖層在拆分、編輯（含複製的頁）、合併、調整尺寸後仍然隱藏',
    async run() {
      const doc = await PDFDocument.create(), ctx = doc.context, N = k => PDFName.of(k), L = window.PDFLib;
      const hidden = ctx.register(ctx.obj({ Type: 'OCG', Name: L.PDFString.of('Hidden') }));
      const shown = ctx.register(ctx.obj({ Type: 'OCG', Name: L.PDFString.of('Shown') }));
      for (let i = 0; i < 2; i++) {
        const p = doc.addPage([300, 300]);
        p.node.set(N('Resources'), ctx.obj({ Properties: ctx.obj({ h: hidden, s: shown }) }));
        p.node.set(N('Contents'), ctx.register(ctx.flateStream('/OC /h BDC 1 0 0 rg 20 20 100 100 re f EMC /OC /s BDC 0 0 1 rg 180 180 100 100 re f EMC')));
      }
      doc.catalog.set(N('OCProperties'), ctx.obj({ OCGs: [hidden, shown], D: ctx.obj({ OFF: [hidden], Order: [shown, hidden] }) }));
      const src = pdfFile(await doc.save(), 'layers.pdf');
      const red = (r, g, b) => r > 200 && g < 80 && b < 80, blue = (r, g, b) => b > 200 && r < 80 && g < 80;
      const check = async (file, what) => {
        const pj = await T.pdf(file), n = pj.numPages, groups = Object.values((await pj.getOptionalContentConfig()).getGroups() || {}).map(g => g.name).sort();
        pj.destroy();
        T.eq([...new Set(groups)], ['Hidden', 'Shown'], what + '：圖層清單');
        for (let i = 0; i < n; i++) {
          T.eq(await T.ink(file, i, red), null, `${what} 第 ${i + 1} 頁：隱藏的圖層不該顯示`);
          T.ok(await T.ink(file, i, blue), `${what} 第 ${i + 1} 頁：顯示的圖層要在`);
        }
        const d = await PDFDocument.load((await fileBytes(file)).bytes);
        T.ok(![...d.context.enumerateIndirectObjects()].some(([, o]) => o instanceof L.PDFDict && o.get(N(LAYER_MARK))), what + '：不留下標記');
        return n;
      };
      await check(src, '原檔');
      showTab('split'); await loadSplit([src]);
      $('input[name="split-mode"][value="range"]').checked = true; T.set('#split-ranges', '2'); renderSplit();
      await check((await T.result(() => T.click('#split-go'))).file, '拆分');
      showTab('edit'); await loadEditFiles([src]);
      await T.until(() => edit.pages.length === 2 && edit.pages.every(p => p.view), '頁面資訊');
      edit.pages.splice(1, 0, { ...edit.pages[0], id: uid(), annots: [] }); renderEdit(); // page 1 twice
      T.eq(await check((await T.result(() => T.click('#edit-export'))).file, '編輯'), 3, '編輯後頁數');
      showTab('merge'); await addMergeFiles([src, pdfFile((await fileBytes(src)).bytes.slice(), 'b.pdf')]);
      T.eq(await check((await T.result(() => T.click('#merge-go'))).file, '合併'), 4, '合併後頁數');
      showTab('resize'); await loadResize([src]); setRsMode('fit');
      await check((await T.result(() => T.click('#rs-go'))).file, '調整尺寸');
    }
  },

  {
    name: '取消：處理中再按一次會停下，工具還能再用',
    async run() {
      const cancelMid = async (btn, started) => {
        T.click(btn); await T.until(started, btn + ' 開始處理', 20000);
        await T.sleep(Math.max(0, 520 - (Date.now() - $(btn)._jobAt))); // not the second click of a double-click
        $(btn).click(); await T.idle(btn);
        T.eq($('#toast').textContent, '已取消', btn + ' 取消');
      };
      // 壓縮: photos are being re-encoded in background workers when it is cancelled
      showTab('compress');
      const photos = await makePhotoSample();
      await loadCompFile(Array.from({ length: 8 }, (_, i) => pdfFile(photos.slice(), `p${i + 1}.pdf`)));
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
  },
  {
    name: 'pdf-lib 讀寫大檔時不會一直停下來等計時器，呼叫端自己的設定照樣有效',
    async run() {
      const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
      for (let i = 0; i < 600; i++) doc.addPage([200, 200]).drawText('p' + i, { x: 20, y: 20, size: 12, font });
      // Counts the zero-delay timers pdf-lib waits on between chunks while fn runs.
      const ticks = async fn => {
        const st = window.setTimeout; let n = 0;
        window.setTimeout = (f, ms, ...a) => { if (!ms) n++; return st(f, ms, ...a); };
        try { await fn(); } finally { window.setTimeout = st; }
        return n;
      };
      let bytes;
      const save = await ticks(async () => { bytes = await doc.save(); });
      const load = await ticks(() => PDFDocument.load(bytes));
      const own = await ticks(() => doc.save({ objectsPerTick: 50 }));
      T.ok(save <= 3 && load <= 3, `存檔 ${save} 次、讀檔 ${load} 次`);
      T.ok(own > 20, `指定 objectsPerTick: 50 時 ${own} 次`);
      T.eq((await PDFDocument.load(bytes)).getPageCount(), 600);
      return `存檔 ${save} 次、讀檔 ${load} 次（pdf-lib 預設約 ${own} 次）`;
    }
  },
  {
    name: '找 /Encrypt：在檔案開頭、結尾，或只差一個字',
    async run() {
      const has = t => hasEncrypt(new TextEncoder().encode(t));
      T.eq([has('/Encrypt'), has('trailer <</Encrypt 5 0 R>>'), has('xx/Encrypt'), has('/Encryp'), has('/Encrypy'), has('Encrypt'), has('/encrypt'), has('yyyy'), has('')],
        [true, true, true, false, false, false, false, false, false]);
    }
  },
  {
    name: 'ZIP：檢查碼正確、中文檔名、重名加編號、空檔案',
    async run() {
      T.eq(crc32(new TextEncoder().encode('123456789')), 0xCBF43926, 'CRC-32 標準檢查值');
      const z = zipWriter();
      await z.add('報告.pdf', new TextEncoder().encode('one'));
      await z.add('報告.pdf', new Blob(['two']));
      await z.add('報告.pdf', new Uint8Array(0));
      await z.add('README', new Uint8Array([1, 2, 3]));
      await z.add('README', new Uint8Array([4]));
      const { files } = await T.zip(z.blob());
      T.eq(Object.keys(files), ['報告.pdf', '報告-2.pdf', '報告-3.pdf', 'README', 'README-2']);
      T.eq(new TextDecoder().decode(files['報告-2.pdf'].bytes), 'two');
      T.eq(files['報告-3.pdf'].bytes.length, 0);
      // A Blob is checksummed as a stream, in pieces; a file in pieces must give the same checksum as in one go.
      const big = new Uint8Array(3e6 + 5); for (let i = 0; i < big.length; i++) big[i] = (i * 2654435761) >>> 13;
      T.eq(await blobCrc32(new Blob([big.subarray(0, 7), big.subarray(7)])), crc32(big), '分段計算的檢查碼相同');
      T.eq(crc32(big.subarray(1000), crc32(big.subarray(0, 1000))), crc32(big), '接續計算的檢查碼相同');
      const z2 = zipWriter(); await z2.add('big.bin', new Blob([big]));
      T.eq((await T.zip(z2.blob())).files['big.bin'].bytes.length, big.length, '大檔案');
    }
  },
  {
    name: '編輯：點一下只更新那張卡片，其他卡片和縮圖原封不動',
    async run() {
      showTab('edit');
      await loadEditFiles([await T.labeled(['A', 'B', 'C', 'D', 'E', 'F'], 'six.pdf')]);
      await T.until(() => document.querySelectorAll('#edit-grid .thumb img').length === 6, '縮圖');
      const cards = () => [...$('#edit-grid').children];
      const before = cards(), imgs = before.map(c => c.querySelector('img'));
      const click = (i, act) => cards()[i].querySelector(`[data-act="${act}"]`).click();
      click(2, 'sel');
      T.ok(cards().every((c, i) => c === before[i]), '勾選不會重做卡片');
      T.ok(cards()[2].classList.contains('is-selected') && cards()[2].querySelector('[data-act="sel"]').checked, '勾選有顯示');
      click(1, 'rotr');
      T.ok(cards().every((c, i) => c === before[i]), '轉向也不會重做卡片');
      T.ok(/rotate\(90deg\)/.test(cards()[1].querySelector('img').style.transform), '縮圖轉過去了');
      click(0, 'right'); // A ↔ B
      T.eq(cards().map(c => c.querySelector('.pno').textContent), ['1', '2', '3', '4', '5', '6'], '頁碼跟著位置');
      T.ok(cards()[0].querySelector('[data-act="left"]').disabled && !cards()[1].querySelector('[data-act="left"]').disabled, '最前面那張不能再往前');
      T.eq(cards()[1], before[0], '移動的是同一張卡片');
      click(5, 'del');
      T.eq(cards().length, 5); T.ok(cards()[4].querySelector('[data-act="right"]').disabled, '刪掉最後一頁後，新的最後一張不能再往後');
      T.click('#edit-undo'); T.click('#edit-undo'); T.click('#edit-undo');
      T.eq(cards().map(c => c.dataset.id), edit.pages.map(p => p.id), '復原後卡片順序和頁面一致');
      T.eq(cards().slice(2).map(c => c.querySelector('img')), imgs.slice(2), '沒變的頁面留著原來的縮圖');
      T.eq((await T.pdfText((await T.result(() => T.click('#edit-export'))).file)).map(t => t.trim()), ['A', 'B', 'C', 'D', 'E', 'F']);
    }
  },
  {
    name: '轉成圖片：全選、Shift 多選不會重畫縮圖，頁面大小補進已顯示的卡片',
    async run() {
      showTab('pdf2img');
      await loadP2i([await T.labeled(['A', 'B', 'C', 'D'], 'four.pdf', [300, 400])]);
      await T.until(() => document.querySelectorAll('#p2i-grid .thumb img').length === 4, '縮圖');
      const imgs = [...document.querySelectorAll('#p2i-grid .thumb img')];
      T.eq([...document.querySelectorAll('#p2i-grid .psize')].map(e => e.textContent.length > 0), [true, true, true, true], '頁面大小');
      T.click('#p2i-selall');
      T.eq([...document.querySelectorAll('#p2i-grid [data-act="sel"]')].map(b => b.checked), [false, false, false, false]);
      T.ok(!$('#p2i-grid .is-selected'), '取消全選後沒有標成選取的卡片');
      const box = i => document.querySelectorAll('#p2i-grid [data-act="sel"]')[i];
      box(0).click(); box(2).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      T.eq(p2i.pages.map(p => p.selected), [true, true, true, false], 'Shift 多選');
      T.eq([...document.querySelectorAll('#p2i-grid [data-act="sel"]')].map(b => b.checked), [true, true, true, false]);
      T.eq([...document.querySelectorAll('#p2i-grid .thumb img')], imgs, '縮圖還是原來那些');
      T.ok($('#p2i-summary').textContent.startsWith('3 張'), $('#p2i-summary').textContent);
    }
  }
];
