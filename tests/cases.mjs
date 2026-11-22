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
      const before = comp.items[0].bytes.length;
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
    slow: true, timeout: 240000,
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
