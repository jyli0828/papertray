# 開發說明

紙匣沒有建置步驟、沒有套件管理、沒有框架：一個 `index.html`、一份 CSS、一組一般的 `<script>`，加上 `lib/` 裡的第三方函式庫。改完存檔、重新整理瀏覽器就看得到。

## 執行

```powershell
python -m http.server 8000
```

打開 http://localhost:8000。直接雙擊 `index.html` 也能用，但瀏覽器不允許從硬碟開啟的網頁啟動背景程式：pdf.js 改在頁面上解析（較慢），文字辨識無法使用。改程式時請用本機伺服器，兩種情況都要能動。

瀏覽器會快取 JS，改完沒生效時按 Ctrl+F5 強制重新載入。

## 檔案結構

```
papertray/
├─ index.html           頁面結構：頁首、分頁列、每個工具的 <section>、共用對話框，最後依序載入 js/
├─ icon.svg             網站圖示（分頁 icon、頁首標誌）
├─ css/styles.css       全部樣式：顏色變數（含深色模式）、共用元件、各工具版面
├─ js/                  程式，見下方「載入順序」
├─ lib/                 第三方函式庫的本機副本，見 third-party.md
│  ├─ pdf-lib.min.js、pdf.min.js、pdf.worker.min.js、jszip.min.js、heic2any.min.js
│  ├─ qpdf/             qpdf.js 與 qpdf.wasm.js（.wasm 的 base64 版）
│  └─ tesseract/        Tesseract.js、辨識核心、lang/ 繁中與英文的辨識資料
├─ tools/
│  ├─ build.py          打包成單一檔案（dist/）
│  └─ wasm_to_js.py     更新 qpdf 時，把 qpdf.wasm 轉成 lib/qpdf/qpdf.wasm.js
├─ docs/                說明文件
└─ dist/                build.py 的產出，不在版本控制內
```

### 載入順序

`js/` 是一般的 `<script>`，不是 ES module：每個檔案的最上層變數和函式彼此共用，`index.html` 裡的順序就是執行順序。這樣做是為了讓直接雙擊開啟（`file://`）也能運作，瀏覽器不允許這種情況載入 ES module。

檔案在最上層執行的程式（綁定按鈕、註冊工具）只能用到**前面**的檔案；函式裡的程式在使用者操作時才執行，那時所有檔案都已載入，可以互相呼叫。

| 檔案 | 內容 |
|---|---|
| `core.js` | 共用基礎，必須第一個載入。見下方「共用機制」 |
| `samples.js` | 「合併」首頁的兩份範例檔（預先產生的 base64，開啟時不必載入函式庫） |
| `inpaint.js` | 去浮水印的補圖演算法（會被包成 Web Worker） |
| `preview.js` | 放大檢視頁面、預覽結果 |
| `merge.js` | 合併（依序或雙面掃描交錯） |
| `split.js` | 拆分 |
| `edit.js` | 編輯頁面：復原／重做、插入頁面、選取空白頁、頁碼與頁首頁尾、文件資訊、匯出（遮蔽頁在這裡轉成圖片） |
| `editor-dialog.js` | 單頁編輯視窗：文字、簽名、標註、遮蔽框，套用到多頁 |
| `signatures.js` | 簽名管理、手寫板、「簽名」分頁 |
| `redact.js` | 「遮蔽個資」分頁、自動尋找個資；也提供 `pageTextMap()`、`itemCharBoxes()`（頁面文字與每個字的位置） |
| `form.js` | 填寫 PDF 表單 |
| `watermark.js` | 加浮水印 |
| `resize.js` | 調整頁面尺寸、裁白邊 |
| `compress.js` | 壓縮 |
| `img2pdf.js` | 圖片轉 PDF |
| `scan.js` | 校正翻拍的文件（找四個角、透視校正、去陰影），證件影印也用 |
| `idcard.js` | 證件影印 |
| `idphoto.js` | 證件照排版 |
| `pdf2img.js` | PDF 轉圖片、抽出文字（`runsToText()`） |
| `ocr.js` | 文字辨識引擎與「文字辨識」分頁；`pageChars()` 是遮蔽個資、比較共用的「頁面文字＋每個字的位置」，沒有文字層時改用 OCR |
| `compare.js` | 比較兩份 PDF（Myers diff，先比行再比字） |
| `password.js` | 解除／加上密碼（qpdf） |
| `imgtool.js` | 圖片工具 |
| `unmark.js` | 去浮水印的介面 |
| `app.js` | 分頁切換與啟動，必須最後載入 |

## 共用機制（`js/core.js`）

**函式庫延後載入**：`LIBS` 列出 `lib/` 裡的檔案，`loadScript(key)` 第一次用到時才載入。pdf-lib 透過 `PDFDocument.load()`／`create()` 自動載入；pdf.js 用 `openPdfjs()`。剛開啟紙匣時只載入自己的程式（約 1 MB）。`tools/build.py` 會把這些路徑換成 CDN 網址。

**檔案與位元組**：工具之間傳遞的 PDF 是 `pdfFile(bytes, name)`，不是 `File`，避免每經過一個工具就複製一次。`fileBytes(f)` 取得位元組，`owned` 表示是否能交給 pdf.js（pdf.js 會接管傳入的陣列）。

**可取消的工作**：`runJob(btn, label, async check => …)` 讓按鈕顯示「取消」；長迴圈裡呼叫 `check()`，使用者按取消時會拋出 `Cancelled`。很短的動作用 `busy()`。

**結果與工具串接**：工具做完呼叫 `deliver(file, kind, fromTab)`，`kind` 是 `pdf`、`image`、`text`、`zip` 或 `locked`（有密碼的 PDF：不預覽、不交給其他工具）。結果列的「接著處理」列出用 `registerTarget(kind, tab, label, load)` 註冊過的工具。

**放入檔案**：`acceptFiles(area, highlight, handler)` 處理拖放，同時讓那個分頁接收 Ctrl+V 貼上；`bindInput(input, handler)` 處理檔案選擇框；`prepImages()` 把 HEIC 轉成 JPG。

**記憶體**：每個工具用 `registerHolder(tab, size, release)` 回報自己留著多少資料、怎麼清空。切換分頁時，其他工具合計超過 50 MB 會出現「釋放記憶體」提示。詳見下方「記憶體」。

**頁面縮圖**：`whenVisible(el, job)` 等卡片捲到附近才畫，同時最多畫兩張；`renderThumb()` 存成 Blob URL，用完 `releaseThumbs()`。

**座標**：`displayToUser()`／`userToDisplay()` 在「畫面上看到的頁面」（左上角為原點、已套用頁面旋轉）與 PDF 座標之間換算。加在頁面上的東西都存成 PDF 座標，旋轉頁面時不會跑掉。

## 新增一個工具

1. `index.html`：在 `<nav class="tabs">` 加分頁按鈕（`id="tab-xxx"`、`data-tab="xxx"`、圖示用 24×24、`stroke-width="1.8"` 的線條 SVG），在其他 `<section>` 旁加 `<section class="panel" id="panel-xxx" hidden>`。
2. 新增 `js/xxx.js`，在 `index.html` 的 `app.js` 之前加上 `<script>`。
3. `js/app.js`：把 `'xxx'` 加進 `TABS`（順序就是鍵盤左右切換的順序）。工具開著 pdf.js 文件的話，加進 `releaseCaches()`。
4. 在工具裡：
   - 放入檔案用 `acceptFiles()`、`bindInput()`；
   - 長時間的處理用 `runJob()`；
   - 做完用 `deliver()`；
   - 能接收其他工具的結果就 `registerTarget()`；
   - 留著檔案就 `registerHolder()`；
   - 加一個「用範例試試」按鈕，產生範例檔（不要放真實的個人資料）。
5. `css/styles.css`：先用現有的元件（`.drop`、`.doc-card`、`.optgrid`、`.footer-bar`、`.progress`、`.note`）；新的顏色用 `:root` 的變數，深色模式也要看過。
6. 文件：README 的工具表、`docs/features.md`；用了新的函式庫就更新 `docs/third-party.md` 和 `tools/build.py` 的 `CDN` 表。

## 打包與發布

```powershell
python tools/build.py
```

產生 `dist/` 裡的兩個檔案：

- `紙匣.html`：單一檔案版，CSS、JS 和圖示都內嵌，可以直接寄給別人。
- `artifact.html`：同樣內容，去掉 `<html>`／`<head>`／`<body>` 外框，用來發布到 Claude Artifact。

兩者都把 `lib/` 的路徑換成 `tools/build.py` 裡 `CDN` 表的網址（cdnjs 或 jsdelivr），所以需要網路。程式裡還有沒對應到 CDN 的 `'lib/…'` 路徑時，打包會失敗並列出來。

線上版：https://claude.ai/artifact/LrA1FQYwq2f55Y6jAAwKY1 ，用 `dist/artifact.html` 發布，改版後要重新發布。

## 更新函式庫

版本、來源與授權列在 [third-party.md](third-party.md)。更新時：

1. 換掉 `lib/` 裡的檔案。
2. 同步修改 `tools/build.py` 的 `CDN` 表（版本號在網址裡）。
3. qpdf 更新後，用 `python tools/wasm_to_js.py <qpdf.wasm 路徑> <版本>` 重新產生 `lib/qpdf/qpdf.wasm.js`。這個版本的 qpdf 只認 `locateFile`，不接受直接傳入 wasm 位元組，所以 `js/password.js` 把 base64 轉成 `blob:` 網址交給它。
4. 更新 `docs/third-party.md`，用每個相關工具的範例試一次。

## 記憶體

- 函式庫和背景程式（PDF 解析、去浮水印、照片壓縮、文字辨識）都在第一次用到時才載入或啟動。
- 文字辨識的背景程式會佔用超過 100 MB，閒置一分鐘後自動關閉。
- 切換分頁時，釋放其他工具的 pdf.js 快取（已解碼的圖片、字型）；檔案仍保留，回來時重新讀取。編輯、簽名、遮蔽個資共用同一批檔案，彼此切換時不釋放。
- 頁面縮圖存成 Blob，不佔 JavaScript 記憶體；換檔或清空時釋放。
- 編輯、拆分、加浮水印只留一份檔案（在 pdf.js 裡），匯出時才取回並用 pdf-lib 解析；合併只在按下「合併」時解析一次。
- 「接著處理」把結果交給下一個工具時，直接共用同一份資料，不另外複製。
- 去浮水印只有照片本身是原尺寸；筆刷遮罩最多 2000 px 寬，「按住看原圖」只在按住時才解碼。
- 處理過的檔案留在記憶體裡，直到換檔、清空或關閉分頁。其他工具合計超過 50 MB 時，分頁列下方出現提示：「釋放記憶體」清空那些工具（目前的工具和正在處理中的工具不受影響）；「不用」則要再多累積約 20 MB 才會再提示。

## 測試

沒有自動化測試。改完用本機伺服器開啟，用相關工具的「用範例試試」跑一次，並確認：

- 瀏覽器主控台沒有錯誤（文字辨識會印出一些 Tesseract 的 `Parameter not found` 警告，可以忽略）；
- 手機寬度（約 375 px）沒有橫向捲動；
- 深色模式看得清楚；
- 動到 `lib/`、`LIBS` 或 `tools/build.py` 時，執行打包並打開 `dist/紙匣.html` 試一次。

## 慣例

- 介面文字用繁體中文、全形標點；按鈕寫動作（「產生 PDF」「解除密碼」），錯誤訊息說明怎麼辦。
- 程式註解用英文，寫「為什麼」，不重述程式在做什麼。
- 2 格縮排、單引號、每個檔案開頭 `'use strict'`。
- 換行一律 LF（`.gitattributes` 會處理）。
