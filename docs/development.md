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
├─ index.html           頁面結構：頁首、工具列（每類一個卷宗）、每個工具的 <section>、共用對話框，最後依序載入 js/
├─ icons/               圖示：icon.svg（分頁 icon；頁首的標誌是 index.html 裡同樣圖形的 SVG，顏色跟著深淺色模式），
│                       以及安裝成 App 用的 PNG（tools/make_icons.py 產生）
├─ manifest.webmanifest App 的名稱、圖示、顏色（PWA）
├─ sw.js                service worker：離線使用
├─ css/styles.css       全部樣式：顏色變數（含深色模式）、共用元件、各工具版面
├─ js/                  程式，見下方「載入順序」
├─ lib/                 第三方函式庫的本機副本，見 third-party.md
│  ├─ pdf-lib.min.js、pdf.min.js、pdf.worker.min.js、heic2any.min.js
│  ├─ cmaps/            PDF.js 的字元對應表，讀沒有內嵌字型的中日韓文字
│  ├─ qpdf/             qpdf.js 與 qpdf.wasm.js（.wasm 的 base64 版）
│  └─ tesseract/        Tesseract.js、辨識核心、lang/ 繁中與英文的辨識資料
├─ tools/
│  ├─ build.py          打包成單一檔案（dist/）
│  ├─ make_icons.py     從 icons/icon.svg 的圖形畫出 icons/ 裡的 PNG
│  └─ wasm_to_js.py     更新 qpdf 時，把 qpdf.wasm 轉成 lib/qpdf/qpdf.wasm.js
├─ tests/               自動化測試：run.mjs（執行）、cases.mjs（測試案例）、helpers.js（頁面裡的輔助函式）
├─ docs/                說明文件
├─ dist/                build.py 的產出，不在版本控制內
├─ LICENSE              MIT 授權（紙匣自己的程式碼；lib/ 裡的函式庫各有授權）
├─ .nojekyll            讓 GitHub Pages 原樣提供檔案，不經過 Jekyll
├─ .editorconfig        編輯器設定：UTF-8、LF、2 格縮排（Python 4 格）
└─ .gitattributes       文字檔一律存成 LF，圖片、壓縮檔、wasm、CMap 視為二進位
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
| `compare.js` | 比較兩份 PDF：比對文字（Myers diff，先比行再比字）、比對畫面（逐頁逐像素） |
| `password.js` | 解除／加上密碼（qpdf） |
| `imgtool.js` | 圖片工具 |
| `unmark.js` | 去浮水印的介面 |
| `home.js` | 「全部工具」首頁：依放入的檔案推薦工具、搜尋工具、Ctrl+K |
| `app.js` | 分頁切換、記住上次用的工具、註冊 service worker，必須最後載入 |

## 共用機制（`js/core.js`）

**函式庫延後載入**：`LIBS` 列出 `lib/` 裡的檔案，`loadScript(key)` 第一次用到時才載入。pdf-lib 透過 `PDFDocument.load()`／`create()` 自動載入；pdf.js 用 `openPdfjs()`，自己開 pdf.js 文件時用 `pdfjsOpts()` 的選項（背景程式、字元對應表）。剛開啟紙匣時只載入自己的程式（約 1 MB）。`tools/build.py` 會把這些路徑換成 CDN 網址。pdf-lib 載入後，`pdfLibChunks()` 把讀檔、存檔每段處理的物件數調大（分頁不在畫面上時一次做完）：pdf-lib 預設每處理 50～100 個物件就等一次計時器，大檔的時間大多花在等待。

**選檔時先載入**：使用者在收 PDF 的工具按下選擇檔案（檔案選擇框收到 click），或把檔案拖進頁面時，`warmPdfLibs()` 先載入 pdf.js、pdf-lib，啟動背景程式，並畫一張很小的頁面。選檔、拖放要一兩秒，檔案到的時候這些都已經準備好：pdf.js 第一次畫頁面、瀏覽器第一次編碼圖片都比之後慢，第一份檔案的縮圖原本要多等 0.1–0.2 秒。只看圖片的工具不會觸發。

**有密碼的 PDF**：工具讀 PDF 一律用 `readPdf(f)`，有密碼的檔案會就地解除（只有限制的直接解除，要開啟密碼的會跳出輸入框，見 `js/password.js` 的 `unlockPdf()`），使用者取消時回傳 `null`。

**檔案與位元組**：工具之間傳遞的 PDF 是 `pdfFile(bytes, name)`，不是 `File`，避免每經過一個工具就複製一次。`fileBytes(f)` 取得位元組，`owned` 表示是否能交給 pdf.js（pdf.js 會接管傳入的陣列）。判斷是不是 `pdfFile` 一律用 `inMemory(f)`，不要寫 `f.bytes`：瀏覽器的 `Blob`／`File` 本身就有 `bytes()` 方法。

**之後才要用的檔案**：清單型的工具（合併、壓縮）和要等按下按鈕才處理的工具（調整尺寸、密碼）用 `keepFile(f, got)` 留下檔案本身，不留位元組：使用者選的 `File` 只是指向硬碟的參照，不佔記憶體；解除密碼後的資料存成 `Blob`。處理時再用 `fileBytes()` 讀出來。回報記憶體用 `heldBytes(src)`。

**可取消的工作**：`runJob(btn, label, async check => …)` 讓按鈕顯示「取消」；長迴圈裡呼叫 `check()`，使用者按取消時會拋出 `Cancelled`。很短的動作用 `busy()`。

**結果與工具串接**：工具做完呼叫 `deliver(file, kind, fromTab)`，`kind` 是 `pdf`、`image`、`text`、`zip` 或 `locked`（有密碼的 PDF：不預覽、不交給其他工具）。結果列的「接著處理」列出用 `registerTarget(kind, tab, label, load)` 註冊過的工具。

**放入檔案**：`acceptFiles(area, highlight, handler)` 處理拖放，同時讓那個分頁接收 Ctrl+V 貼上；`bindInput(input, handler)` 處理檔案選擇框；`prepImages()` 把 HEIC 轉成 JPG。

**記憶體**：每個工具用 `registerHolder(tab, size, release)` 回報自己留著多少資料、怎麼清空。切換分頁時，其他工具合計超過 50 MB 會出現「釋放記憶體」提示。詳見下方「記憶體」。

**頁面縮圖**：`whenVisible(el, job)` 等卡片捲到附近才畫，同時最多畫兩張，畫面上看得到的先畫；還沒輪到就捲走的卡片退出佇列，不然 1000 頁快速捲到底時，畫面上的縮圖要等捲過的每一張都畫完（約 16 秒）。卡片拿掉或重建時呼叫 `stopThumb(el)`；`renderThumb()` 存成 Blob URL，用完 `releaseThumbs()`。縮圖長邊 `thumbPx()`：每個 CSS 像素 240 px，高解析度螢幕最多 320 px。開檔時讀每頁的大小、旋轉用 `eachPage()`，一次向 pdf.js 要 50 頁：一頁一頁要時，每次都排在正在畫的縮圖後面，1000 頁光讀大小就要一秒。編輯的卡片先顯示、讀到大小再就地補上，不重建卡片。頁面卡片（`.page-card`）設了 `content-visibility: auto`，離畫面遠的卡片不排版也不繪製。卡片很多的畫面不要每次操作都整個重做：編輯的 `renderEdit()` 留著原本的卡片，只更新有變的部分；轉成圖片的全選用 `syncP2iSel()` 只改勾選。

**逐頁轉成圖片**：每頁都要畫成圖片再處理的工作（轉成圖片、壓縮的「整頁轉圖片」和「黑白」、調整尺寸的「裁白邊」）用 `pagePipeline(n, make, use, drop, check)`：`make(i)` 畫第 i 頁，`use(r, i)` 編碼、放進檔案，`drop(r)` 釋放畫布。畫第 i+1 頁和處理第 i 頁同時進行（40 頁約快 15–25%），同時最多兩張畫好的頁面；超過 `PIPE_PX` 像素的頁面處理完才畫下一張。

**放在很多頁上的圖只嵌一次**：編輯匯出時，中文的頁碼、頁首頁尾，加文字、標註、簽名都是畫成圖片放上去的。`pictureCache(out)` 讓內容相同的圖只嵌入一次、每頁引用同一張；頁碼頁首用 `labelPieces()` 拆成「每個數字」和「數字之間的文字」分開畫，各放在整串裡原本的位置，「第 1 頁」到「第 1000 頁」共用十幾張圖，看起來和整串畫的一樣（測試比對過畫出來的點）。由右往左的文字、字母會相連的文字不拆。原本每頁各嵌一張：1000 頁加中文頁首要 8.5 秒，檔案大 8 MB。

**畫布嵌進 PDF**：自己畫的圖要放進 PDF 時用 `embedCanvas(doc, canvas)`，不要先 `toBlob` 存成 PNG 再 `embedPng()`：結果一樣（顏色和透明度遮罩），但省掉瀏覽器編 PNG、pdf-lib 再解回像素的時間。圖大多是空白時用 `embedCanvasInk()`，只嵌有內容的那一塊，再放回原本的位置。填表單的中文欄位這樣做，100 頁 600 個欄位的存檔從 8.7 秒變 2.5 秒。

**逐頁讀文字**：比較、遮蔽個資的自動尋找用 `readAhead()` 先向 pdf.js 要後面幾頁的文字，邊處理這一頁邊讀下一頁；每個字的位置（`itemCharBoxes()`）用 `charWidth()` 記住的字寬直接算。1000 頁比較兩份從 14.5 秒變 4.9 秒，剩下的大多是 pdf.js 取文字本身（每頁約 2 ms）。

**去浮水印的補圖**（`inpaint.js`）：多層的 PatchMatch，時間幾乎只看塗了多大面積（12 MP 照片塗一筆約 6 秒），和找補丁的範圍大小關係不大。搜尋是隨機的，同一處補兩次本來就不完全一樣（平均每個值差約 8）。要改輪數或範圍時，先用固定的 `Math.random` 比較新舊結果：最細一層從 3 輪改成 2 輪只差約 2，快了約 32%；較粗的幾層少算一輪會差到和重跑一樣大，畫面結構會變，所以沒改。微調 `dist()` 的寫法（定型陣列、預先乘 3）結果完全相同但反而變慢。

**開啟時不要量版面**：最上層執行的程式（綁定按鈕、初始化工具）不要讀 `clientWidth`、`offsetLeft`、`scrollWidth` 這類版面數值，也不要畫隱藏分頁的預覽：頁面還沒載完就逼瀏覽器排版一次，原本光這樣就讓開啟慢了 70 ms（腳本全部只要約 20 ms）。要量就等 `showTab()` 打開那個分頁，或放進 `requestAnimationFrame`。

**ZIP**：多個結果用 `zipWriter()` 打包：`await zip.add(name, blobOrBytes)` 逐一加入（重名自動加 -2、-3），`zip.blob()` 取得檔案。檔案不再壓縮，壓縮檔由各檔案的 Blob 組成，不會在記憶體裡再複製一份。

**複製頁面**：pdf-lib 的 `copyPages()` 只複製頁面，而且會把頁面連到的東西整串帶過去。要從一份 PDF 複製頁面到新檔的工具（合併、拆分、編輯、調整尺寸），複製前後各做一次：
- 內部連結：`unlinkDests()` 先切斷，複製後 `relinkDests()` 接到新頁面；連到沒複製的頁面的連結會移除，否則那些頁面會一起被帶進新檔。
- 表單：複製後 `relinkFormFields()` 補回欄位清單（AcroForm）。
- 圖層：`markLayers()` 先標記，複製後 `relinkLayers()` 補回圖層設定，隱藏的圖層才會維持隱藏。

**頁面大小**：看得到的範圍用 `visibleBox(page)`（裁切框和紙張的交集），不要直接用 MediaBox 或 CropBox。

**座標**：`displayToUser()`／`userToDisplay()` 在「畫面上看到的頁面」（左上角為原點、已套用頁面旋轉）與 PDF 座標之間換算。加在頁面上的東西都存成 PDF 座標，旋轉頁面時不會跑掉。

## 工具頁的結構

每個工具頁都照這個順序，使用者換工具時不用重新找東西在哪裡：

1. **標題列**（`.panel-head`）：`<h2>` 工具名稱，旁邊一句話說明能做什麼。
2. **放入檔案**：
   - 一次處理一份的工具用大的 `.drop`，下面一行「用範例試試」；
   - 處理清單的工具（合併、壓縮、圖片轉 PDF、圖片工具）用窄的 `.drop.compact`，放在清單上方，可以一直加。
3. **檔案**：一份檔案用 `.doc-card`（檔名、頁數與大小、「換一個檔案」）；多份用 `.file-list`；逐頁操作用 `.page-grid`。
4. **選項**：`.optgrid` 裡的下拉選單；要邊調邊看結果的工具（加浮水印、證件影印、證件照）用左邊選項、右邊預覽的兩欄版面。
5. **底部列**（`.footer-bar`）：左邊是摘要（會產生什麼），右邊是檔名和主要按鈕（`.btn.primary`）。只負責開啟編輯視窗的入口頁（簽名、遮蔽個資）沒有底部列。

## 新增一個工具

1. `index.html`：在 `<nav class="tabs">` 裡適合的類別（`.tab-group`）加分頁按鈕，並把那一組的 `--n` 加一（`id="tab-xxx"`、`data-tab="xxx"`、`title` 寫一句話說明，首頁和 Ctrl+K 會用到；圖示用 24×24、`stroke-width="1.8"` 的線條 SVG），在其他 `<section>` 旁加 `<section class="panel" id="panel-xxx" hidden>`。工具清單、首頁、Ctrl+K 都從分頁列讀取，不用另外登記；搜尋用的同義詞加在 `js/home.js` 的 `TOOL_WORDS`。
2. 新增 `js/xxx.js`，在 `index.html` 的 `app.js` 之前加上 `<script>`。
3. `js/app.js`：工具開著 pdf.js 文件的話，加進 `releaseCaches()`。
4. 在工具裡：
   - 放入檔案用 `acceptFiles()`、`bindInput()`；
   - 長時間的處理用 `runJob()`；
   - 做完用 `deliver()`；
   - 能接收其他工具的結果就 `registerTarget()`；
   - 留著檔案就 `registerHolder()`；
   - 加一個「用範例試試」按鈕，產生範例檔（不要放真實的個人資料）。
5. `css/styles.css`：先用現有的元件（`.drop`、`.doc-card`、`.optgrid`、`.footer-bar`、`.progress`、`.note`）；新的顏色用 `:root` 的變數，深色模式也要看過。
6. 文件：README 的工具表、`docs/features.md`；用了新的函式庫就更新 `docs/third-party.md` 和 `tools/build.py` 的 `CDN` 表。

## 發布

**線上版**：https://jyli0828.github.io/papertray/ ，由 GitHub Pages 直接提供 `main` 分支的檔案，不需要建置。推送到 `main` 後約一分鐘更新。線上版用的是 `lib/` 裡的函式庫，和本機伺服器完全相同，所以文字辨識等全部功能都能用。

**可以安裝、離線使用（PWA）**：
- `manifest.webmanifest` 是 App 的名稱、圖示和顏色；`icons/` 裡的 PNG 由 `python tools/make_icons.py` 從 `icons/icon.svg` 的圖形畫出來，改了圖示要重新產生。
- `sw.js` 是 service worker：
  - 紙匣自己的檔案「先問網路」，所以改版後下次開啟就是新版，沒網路時用快取；第一次造訪時就把 `index.html` 連到的檔案（`js/`、`css/`、圖示）全部存好，新增的 JS 檔不用另外登記；
  - `lib/` 的函式庫「先用快取」，第一次造訪就先存好 pdf-lib、PDF.js，其他（文字辨識、qpdf、HEIC、字元對應表）第一次用到時才存。
- 只在 http(s) 網址註冊，直接雙擊開啟時不會啟用。
- 快取的格式改變時，把 `sw.js` 的 `CACHE` 改名，舊快取會在新版啟用時刪掉。

**單一檔案版**：

```powershell
python tools/build.py
```

產生 `dist/紙匣.html`，CSS、JS 和圖示都內嵌，可以直接寄給別人。函式庫改從 `tools/build.py` 裡 `CDN` 表的網址（cdnjs 或 jsdelivr）載入，所以需要網路；它不含 service worker 和 App 圖示。程式裡還有沒對應到 CDN 的 `'lib/…'` 路徑時，打包會失敗並列出來。

## 更新函式庫

版本、來源與授權列在 [third-party.md](third-party.md)。更新時：

1. 換掉 `lib/` 裡的檔案。更新 PDF.js 時，`lib/cmaps/` 也要換成同一版 `pdfjs-dist` 套件裡的 `cmaps/`。
2. 同步修改 `tools/build.py` 的 `CDN` 表（版本號在網址裡）。
3. qpdf 更新後，用 `python tools/wasm_to_js.py <qpdf.wasm 路徑> <版本>` 重新產生 `lib/qpdf/qpdf.wasm.js`。這個版本的 qpdf 只認 `locateFile`，不接受直接傳入 wasm 位元組，所以 `js/password.js` 把 base64 轉成 `blob:` 網址交給它。
4. 把 `sw.js` 的 `CACHE` 改名：`lib/` 的檔名沒有版本號，又是「先用快取」，不改名的話已安裝的使用者會一直用舊版。
5. 更新 `docs/third-party.md`，用每個相關工具的範例試一次。

## 記憶體

- 函式庫和背景程式（PDF 解析、去浮水印、照片壓縮、文字辨識）都在第一次用到時才載入或啟動。
- 文字辨識的背景程式會佔用超過 100 MB。辨識完一分鐘沒有新工作就關閉；切換到不會用到它的工具（文字辨識、PDF 轉圖片、比較、編輯／簽名／遮蔽以外）時立刻關閉，除非還有工作在跑。
- 切換分頁時，釋放其他工具的 pdf.js 快取（已解碼的圖片、字型）；檔案仍保留，回來時重新讀取。編輯、簽名、遮蔽個資共用同一批檔案，彼此切換時不釋放。
- 頁面縮圖、填表單的頁面、比較的頁面都存成 JPEG 的 Blob 圖片，不留畫布：一張 A4 的畫布在高解析度螢幕上約 18 MB，圖片只要幾百 KB，瀏覽器也只在顯示時解碼。換檔或清空時釋放。
- 編輯、拆分、加浮水印只留一份檔案（在 pdf.js 裡），匯出時才取回並用 pdf-lib 解析。
- 合併、壓縮、調整尺寸、密碼只留檔案本身（`keepFile()`，見上方「之後才要用的檔案」），處理時才讀入；合併只在按下「合併」時解析一次，而且一份一份來：每份複製完頁面，就先取出最後要用的部分（表單設定 `formDefaults()`、圖層 `layerPart()`、書籤），然後放掉那份，記憶體高峰是最大的一份，不是全部加起來。一次壓縮多份時，結果存成 Blob 等著打包。
- 「接著處理」把結果交給下一個工具時，直接共用同一份資料，不另外複製。
- 打包 ZIP 時，Blob 的檢查碼是一段一段串流讀出來算的（`blobCrc32()`），連一整個檔案都不會讀進頁面；壓縮檔本身由檔案的 Blob 組成；拆分成多份時每做好一份就放進去，不會等全部做完才打包。
- 圖片清單（圖片轉 PDF、圖片工具、證件影印）顯示的是 `listThumb()` 做的小圖，不是照片本身：照片放進 `<img>` 會以原尺寸解碼常駐（12 MP 約 48 MB 一張）。只要尺寸時用 `imageSize()`，不解碼像素。圖片轉 PDF、圖片工具用 `listPicture()`：不用轉向的照片（大多數）直接解碼成小圖的大小，不先解出整張。
- 預覽結果時，pdf.js 拿到自己的一份，頁面上的那份先放掉，關閉預覽時再從 pdf.js 取回（`file.lent`，`fileBytes()` 會等它）：同一份結果不會同時在記憶體裡兩份。
- 照片只解碼到需要的大小：證件影印的預覽只留小圖，產生 PDF 時才依 300 dpi 解碼、用完即關；證件照最長邊 2400 px。
- 比較和遮蔽個資記住的「每個字的位置」存成一個 `Float32Array`（每字 16 bytes，原本每字一個小陣列約 60 bytes）。
- 去浮水印只有照片本身是原尺寸；筆刷遮罩最多 2000 px 寬，「按住看原圖」只在按住時才解碼。
- 處理過的檔案留在記憶體裡，直到換檔、清空或關閉分頁。其他工具合計超過 50 MB 時，分頁列下方出現提示：「釋放記憶體」清空那些工具（目前的工具和正在處理中的工具不受影響）；「不用」則要再多累積約 20 MB 才會再提示。

## 測試

### 自動化測試

```powershell
node tests/run.mjs
```

不用安裝任何套件：需要 Node 22 以上和 Chrome 或 Edge（找不到時用環境變數 `CHROME` 指定執行檔）。它會開一個本機伺服器、在背景開瀏覽器，每個測試用全新的瀏覽器設定檔跑一次，約三分鐘。

- `node tests/run.mjs 比較 合併`：只跑名稱含有這些字的測試；`--skip-slow` 略過文字辨識；`--headed` 開著視窗看過程。
- `--file`：改成直接開啟 `index.html`（`file://`），也就是使用者雙擊開啟的情況；`--bundle`：測試單一檔案版 `dist/紙匣.html`（先執行 `python tools/build.py`，需要網路）。三種都要通過。
- 測試在 `tests/cases.mjs`：每個 `run()` 在頁面裡執行，`js/` 的所有名稱都能直接用，另外有 `tests/helpers.js` 的 `T`（`T.result()` 等工具產生結果、`T.pdfText()` 讀出 PDF 的文字、`T.ink()` 找出頁面上某種顏色畫在哪裡、`T.eq()`／`T.ok()` 檢查）。
- 測試的選項：`slow: true` 可用 `--skip-slow` 略過；`http: true` 只在本機伺服器下跑（離線快取、文字辨識）；`viewport` 模擬手機；`offline: true` 先跑 `run()`，再斷網重新開啟頁面跑 `after()`；`stallFonts: 'all'`／`'files'` 讓 Google Fonts 的請求（或只有字型檔）一直沒有回應，模擬會吃掉連線的網路。
- 測試失敗的情況：`run()` 丟出錯誤、逾時、主控台有錯誤或未處理的例外，或出現沒預期的錯誤提示（預期會出錯的測試設 `T.allowErrors = true`）。
- 涵蓋每個工具的主要流程；旋轉過、裁切框不在原點的頁面；表單和內部連結經過編輯、合併、拆分；取消、處理中放入新檔案、背景程式當掉、壞掉的檔案；斷網重新開啟；以及修過的每個錯誤。新增工具或修好錯誤時，在 `cases.mjs` 加一個測試。

### 手動檢查

改了畫面時，用本機伺服器開啟，用相關工具的「用範例試試」跑一次，並確認：

- 瀏覽器主控台沒有錯誤（文字辨識會印出一些 Tesseract 的 `Parameter not found` 警告，可以忽略）；
- 深色模式看得清楚；
- 動到 `lib/`、`LIBS` 或 `tools/build.py` 時，執行打包並打開 `dist/紙匣.html` 試一次。

## 慣例

- 外觀取自辦公室的紙匣和文件櫃：鋼櫃灰的底、影印紙白的工作區、牛皮紙色的卷宗（工具分類）、原子筆藍的主要按鈕與圖示；螢光筆黃（`--mark`）只用來標示「目前這個」（開著的工具、最推薦的工具），不要拿來裝飾。標題和分類標籤用霞鶩文楷（`--font-display`），其他都用 Noto Sans TC。
- 介面文字用繁體中文、全形標點；按鈕寫動作（「產生 PDF」「解除密碼」），錯誤訊息說明怎麼辦。
- 外部資源（目前只有 Google Fonts）不能擋住頁面：連不上或一直沒有回應時，紙匣也要照常啟動、照常做完工作。等網路字型一律用 `loadFont()`／`ensureFont()`，它們最多等 3 秒。
- 程式註解用英文，寫「為什麼」，不重述程式在做什麼。
- 2 格縮排、單引號、每個檔案開頭 `'use strict'`。
- 換行一律 LF（`.gitattributes` 會處理）。
