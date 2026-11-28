/* Benchmark cases for tests/_bench-run.mjs (see make-runner.mjs). Each case runs in a fresh page, like a test.
   ONLY=a,b (environment) keeps the cases whose name contains one of the parts.
   Helpers spliced into every case (the prelude below):
     photo(w, h, seed, type)  a synthetic photo File (JPEG by default), deterministic
     photoPdf(n)              a PDF with n 12 MP JPEG photos;   scanPdf(n)  n scanned-looking pages (JPEG, no text)
     makeSample(title, n, c)  (from js/core.js) an n-page vector PDF with text
     capture()                swallows deliver(); .get() the file, .restore() afterwards
     measure(reps, setup, fn) median of reps timings, with gc and MARK lines for the memory sampler
   A case returns its result line. Add a case: copy a similar one; keep reps at 3 (single runs vary ±30%). */
const prelude = `
  const now = () => performance.now();
  async function photo(w = 4000, h = 3000, seed = 1, type = 'image/jpeg') {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d'), g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, seed % 2 ? '#1d4fb8' : '#0b7a6b'); g.addColorStop(1, '#f2a65a'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    for (let k = 0; k < 60; k++) { c.fillStyle = 'hsla(' + ((k * 47 + seed * 30) % 360) + ',60%,50%,.4)'; c.beginPath(); c.arc((k * 173 * seed) % w, (k * 311) % h, 80 + (k * 13) % 300, 0, 7); c.fill(); }
    const img = c.getImageData(0, 0, w, h), d = img.data;
    for (let p = 0; p < d.length; p += 4) { const n = ((p * 2654435761) >>> 24) / 16 - 8; d[p] += n; d[p + 1] += n; d[p + 2] += n; }
    c.putImageData(img, 0, 0);
    const blob = await new Promise(r => cv.toBlob(r, type, .9)); cv.width = cv.height = 0;
    return new File([blob], 'IMG_' + seed + (type === 'image/png' ? '.png' : '.jpg'), { type });
  }
  async function photoPdf(n) {
    const doc = await PDFDocument.create();
    for (let i = 0; i < n; i++) {
      const f = await photo(4000, 3000, i + 1), img = await doc.embedJpg(new Uint8Array(await f.arrayBuffer()));
      doc.addPage([595.28, 841.89]).drawImage(img, { x: 40, y: 200, width: 515, height: 386 });
    }
    return doc.save();
  }
  async function scanPdf(n) {
    const doc = await PDFDocument.create();
    for (let i = 0; i < n; i++) {
      const cv = document.createElement('canvas'); cv.width = 1240; cv.height = 1754;
      const c = cv.getContext('2d'); c.fillStyle = '#f4f1ea'; c.fillRect(0, 0, cv.width, cv.height);
      c.fillStyle = '#222'; c.font = '22px serif';
      for (let y = 120; y < 1650; y += 34) c.fillText('掃描文件第 ' + (i + 1) + ' 頁 Lorem ipsum dolor sit amet ' + y, 90, y);
      const jpg = await new Promise(r => cv.toBlob(r, 'image/jpeg', .8));
      const img = await doc.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
      doc.addPage([595.28, 841.89]).drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
    }
    return doc.save();
  }
  const capture = () => { let got = null; const od = deliver; deliver = async f => { got = f; }; return { get: () => got, restore: () => { deliver = od; } }; };
  async function measure(reps, setup, fn) {
    const times = [];
    for (let r = 0; r < reps; r++) {
      if (setup) await setup();
      await T.sleep(200); window.gc && gc(); await T.sleep(250); console.log('MARK m start');
      const t = now(); await fn(); times.push(now() - t); console.log('MARK m end');
    }
    times.sort((a, b) => a - b);
    return Math.round(times[times.length >> 1]) + ' ms (' + times.map(Math.round).join('/') + ')';
  }
`;
const code = body => ({ toString: () => `async () => { ${prelude} ${body} }` });
const startup = { toString: () => `async () => {
  const n = performance.getEntriesByType('navigation')[0], paint = performance.getEntriesByName('first-contentful-paint')[0];
  return 'DOMContentLoaded ' + Math.round(n.domContentLoadedEventEnd) + ' ms · FCP ' + Math.round(paint ? paint.startTime : -1) + ' ms · 腳本 ' + Math.round(n.domContentLoadedEventStart - n.responseEnd) + ' ms';
}` };
const all = [
  { name: 'bench: 開啟紙匣 1', run: startup }, { name: 'bench: 開啟紙匣 2', run: startup }, { name: 'bench: 開啟紙匣 3', run: startup },
  { name: 'bench: 壓縮 保留文字（8 張 12 MP 照片）', timeout: 600000, run: code(`
      await needPdfLib(); await needPdfjs(); const bytes = await photoPdf(8); let r;
      const t = await measure(3, null, async () => { r = await compressKeepText(bytes, KEEP_LEVELS.medium, false, () => {}); });
      return t + ' · ' + (bytes.length >> 10) + ' → ' + (r.bytes.length >> 10) + ' KB';
  `) },
  { name: 'bench: 壓縮 整頁轉圖片（20 頁掃描）', timeout: 600000, run: code(`
      await needPdfLib(); await needPdfjs(); const bytes = await scanPdf(20); let r;
      const t = await measure(3, null, async () => { r = await compressRaster(bytes, LEVELS.medium, false, () => {}); });
      return t + ' · ' + (r.bytes.length >> 10) + ' KB';
  `) },
  { name: 'bench: 壓縮 整頁轉圖片（4 頁掃描）', timeout: 600000, run: code(`
      await needPdfLib(); await needPdfjs(); const bytes = await scanPdf(4); let r;
      const t = await measure(5, null, async () => { r = await compressRaster(bytes, LEVELS.medium, false, () => {}); });
      return t + ' · ' + (r.bytes.length >> 10) + ' KB';
  `) },
  { name: 'bench: 壓縮 整頁轉圖片（40 頁文字）', timeout: 600000, run: code(`
      await needPdfLib(); await needPdfjs(); const bytes = await makeSample('T', 40, [.1, .2, .3]); let r;
      const t = await measure(3, null, async () => { r = await compressRaster(bytes, LEVELS.medium, false, () => {}); });
      return t + ' · ' + (r.bytes.length >> 10) + ' KB';
  `) },
  { name: 'bench: 壓縮 黑白 300 dpi（10 頁掃描）', timeout: 600000, run: code(`
      await needPdfLib(); await needPdfjs(); const bytes = await scanPdf(10); let r;
      const t = await measure(3, null, async () => { r = await compressBW(bytes, 300, () => {}); });
      return t + ' · ' + (r.bytes.length >> 10) + ' KB';
  `) },
  { name: 'bench: PDF 轉圖片（20 頁掃描 150 dpi JPG）', timeout: 600000, run: code(`
      await needPdfLib(); showTab('pdf2img'); await loadP2i([pdfFile(await scanPdf(20), 'p.pdf')]);
      T.set('#p2i-fmt', 'jpg'); T.set('#p2i-dpi', '150');
      const cap = capture();
      const t = await measure(3, null, async () => { T.click('#p2i-go'); await T.idle('#p2i-go'); });
      cap.restore(); return t;
  `) },
  { name: 'bench: 調整尺寸 裁白邊（40 頁掃描）', timeout: 600000, run: code(`
      await needPdfLib(); showTab('resize'); setRsMode('crop'); await loadResize([pdfFile(await scanPdf(40), 'c.pdf')]);
      const cap = capture();
      const t = await measure(3, null, async () => { T.click('#rs-go'); await T.idle('#rs-go'); });
      cap.restore(); setRsMode('fit'); return t;
  `) },
  { name: 'bench: 編輯 選取空白頁（30 頁掃描）', timeout: 600000, run: code(`
      await needPdfLib(); showTab('edit'); const bytes = await scanPdf(30);
      const t = await measure(3, async () => { clearEdit(); await loadEditFiles([pdfFile(bytes.slice(), 'scan.pdf')]); await T.until(() => edit.pages.length === 30 && edit.pages.every(p => p.view), '頁面'); },
        async () => { T.click('#edit-find-blank'); await T.idle('#edit-find-blank'); });
      return t;
  `) },
  { name: 'bench: 圖片工具（5 張 12 MP → 1920 px JPG）', timeout: 600000, run: code(`
      showTab('imgtool'); const files = []; for (let i = 0; i < 5; i++) files.push(await photo(4000, 3000, i + 1));
      itool.items = []; await addImgTool(files); T.set('#it-size', 'long'); T.set('#it-size-v', '1920'); T.set('#it-fmt', 'jpg');
      const cap = capture();
      const t = await measure(3, null, async () => { T.click('#it-go'); await T.idle('#it-go'); });
      cap.restore(); return t;
  `) },
  { name: 'bench: 圖片轉 PDF（10 張 12 MP JPG）', timeout: 600000, run: code(`
      showTab('img2pdf'); const files = []; for (let i = 0; i < 10; i++) files.push(await photo(4000, 3000, i + 1));
      const t0 = now(); imgs.items = []; await addImages(files); const add = Math.round(now() - t0);
      const cap = capture();
      const t = await measure(3, null, async () => { T.click('#img-go'); await T.idle('#img-go'); });
      cap.restore(); return t + ' · 加入清單 ' + add + ' ms';
  `) },
  { name: 'bench: 加浮水印 文字（300 頁）', timeout: 600000, run: code(`
      await needPdfLib(); showTab('watermark'); await loadWm([pdfFile(await makeSample('W', 300, [.1, .2, .3]), 'w.pdf')]);
      const cap = capture();
      const t = await measure(3, null, async () => { T.click('#wm-go'); await T.idle('#wm-go'); });
      cap.restore(); return t;
  `) },
  { name: 'bench: 編輯 開啟 1000 頁 + 匯出（含頁碼）', timeout: 600000, run: code(`
      await needPdfLib(); showTab('edit'); const bytes = await makeSample('E', 1000, [.1, .2, .3]);
      const open = await measure(3, async () => { clearEdit(); await T.sleep(100); }, async () => { await loadEditFiles([pdfFile(bytes.slice(), 'e.pdf')]); });
      T.set('#edit-numbers', true); T.set('#pn-fmt', 'zh');
      const cap = capture();
      const exp = await measure(3, null, async () => { T.click('#edit-export'); await T.idle('#edit-export'); });
      cap.restore(); T.set('#edit-numbers', false);
      return '開啟 ' + open + ' · 匯出 ' + exp;
  `) },
  { name: 'bench: 拆分 每頁一份（300 頁 → ZIP）', timeout: 600000, run: code(`
      await needPdfLib(); showTab('split'); await loadSplit([pdfFile(await makeSample('S', 300, [.1, .2, .3]), 's.pdf')]);
      document.querySelector('input[name="split-mode"][value="single"]').click();
      const cap = capture();
      const t = await measure(3, null, async () => { T.click('#split-go'); await T.idle('#split-go'); });
      cap.restore(); return t;
  `) },
  { name: 'bench: 合併 10 份 × 100 頁', timeout: 600000, run: code(`
      await needPdfLib(); showTab('merge'); merge.items = []; const files = [];
      for (let i = 0; i < 10; i++) files.push(pdfFile(await makeSample('M' + i, 100, [.1, .2, .3]), 'm' + i + '.pdf'));
      const t0 = now(); await addMergeFiles(files); const add = Math.round(now() - t0);
      const cap = capture();
      const t = await measure(3, null, async () => { T.click('#merge-go'); await T.idle('#merge-go'); });
      cap.restore(); return t + ' · 加入清單 ' + add + ' ms';
  `) },
  { name: 'bench: PDF 轉圖片（20 頁 150 dpi JPG）', timeout: 600000, run: code(`
      await needPdfLib(); showTab('pdf2img'); await loadP2i([pdfFile(await makeSample('P', 20, [.1, .2, .3]), 'p.pdf')]);
      T.set('#p2i-fmt', 'jpg'); T.set('#p2i-dpi', '150');
      const cap = capture();
      const t = await measure(3, null, async () => { T.click('#p2i-go'); await T.idle('#p2i-go'); });
      cap.restore(); return t;
  `) },
  { name: 'bench: 文字辨識 檢查哪些頁要辨識（1000 頁）', timeout: 600000, run: code(`
      await needPdfLib(); showTab('ocr'); const bytes = await makeSample('O', 1000, [.1, .2, .3]);
      return await measure(3, null, async () => { await loadOcr([pdfFile(bytes.slice(), 'o.pdf')]); });
  `) },
];
const only = (process.env.ONLY || '').split(',').filter(Boolean);
export default only.length ? all.filter(c => only.some(o => c.name.includes(o))) : all;
