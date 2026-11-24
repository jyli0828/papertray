# 第三方函式庫

`lib/` 裡是下列函式庫的本機副本，讓紙匣不用網路也能使用。全部都在第一次用到時才載入，見 [development.md](development.md#共用機制jscorejs)。打包成單一檔案版時，改從表中的 CDN 載入（`tools/build.py` 的 `CDN` 表）。

| 函式庫 | 版本 | 本機檔案 | 大小 | 用在 | 授權 | CDN |
|---|---|---|---|---|---|---|
| [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.17.1 | `pdf-lib.min.js` | 513 KB | 產生與修改 PDF | MIT | cdnjs |
| [PDF.js](https://github.com/mozilla/pdf.js) | 3.11.174 | `pdf.min.js`、`pdf.worker.min.js` | 1.4 MB | 顯示頁面、轉圖片、抽出文字 | Apache-2.0 | cdnjs |
| [JSZip](https://github.com/Stuk/jszip) | 3.10.1 | `jszip.min.js` | 95 KB | 打包 ZIP | MIT 或 GPL-3.0（擇一） | cdnjs |
| [heic2any](https://github.com/alexcorvi/heic2any) | 0.0.4 | `heic2any.min.js` | 1.3 MB | iPhone 照片（HEIC）轉 JPG；瀏覽器自己能解碼時不載入 | MIT | cdnjs |
| [Tesseract.js](https://github.com/naptha/tesseract.js) | 7.0.0 | `tesseract/tesseract.min.js`、`tesseract/worker.min.js` | 170 KB | 文字辨識 | Apache-2.0 | jsdelivr |
| [tesseract.js-core](https://github.com/naptha/tesseract.js-core) | 7.0.0 | `tesseract/tesseract-core-simd-lstm.wasm.js` | 3.7 MB | 辨識核心（Tesseract 的 WebAssembly 版，只含 LSTM 引擎） | Apache-2.0 | jsdelivr |
| [@tesseract.js-data](https://github.com/naptha/tessdata) chi_tra、eng | 1.0.0（`4.0.0_best_int`） | `tesseract/lang/*.traineddata.gz` | 4.4 MB | 繁體中文、英文的辨識資料 | Apache-2.0 | jsdelivr |
| [qpdf-wasm](https://github.com/neslinesli93/qpdf-wasm)（[qpdf](https://github.com/qpdf/qpdf)） | 0.3.1 | `qpdf/qpdf.js`、`qpdf/qpdf.wasm.js` | 1.7 MB | 解除與加上密碼 | 包裝 ISC，qpdf 本身 Apache-2.0 | jsdelivr |

- `qpdf/qpdf.wasm.js` 是 `qpdf.wasm` 轉成 base64 的版本（`tools/wasm_to_js.py`），直接雙擊開啟時也能載入；單一檔案版直接從 CDN 取 `.wasm`。
- Tesseract.js 和 qpdf 的授權全文在 `lib/tesseract/LICENSE`、`lib/qpdf/LICENSE`；pdf-lib、PDF.js、JSZip 的授權聲明在各自 `.min.js` 的開頭；heic2any 的發布檔沒有附聲明，授權見它的 GitHub。
- 單一檔案版的文字辨識資料不指定版本，由 Tesseract.js 從 `@tesseract.js-data/<語言>` 下載。

## 字型

介面字型從 Google Fonts 載入；離線時改用系統字型（微軟正黑體、蘋方等），不影響功能。

| 字型 | 用在 | 授權 |
|---|---|---|
| Noto Sans TC | 內文、加在 PDF 上的中文文字 | SIL Open Font License 1.1 |
| 霞鶩文楷 TC（LXGW WenKai TC） | 標題、工具分類的標籤；離線時改用標楷體 | SIL Open Font License 1.1 |
