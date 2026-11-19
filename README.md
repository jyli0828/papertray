# 紙匣

![紙匣](icon.svg)

PDF 與圖片的隨手工具，在瀏覽器裡處理，檔案不會上傳到任何伺服器。函式庫已放在 `lib/`，桌面版不需要網路。

## 功能

- **合併**：多份 PDF 接成一份，可拖曳排序，每份可只取部分頁面（如 `1-3, 5`）
- **拆分**：依頁碼範圍（如 `1-3, 5, 8-`）、每 N 頁或每頁一份，多份打包成 ZIP
- **編輯**：排序、旋轉、刪除、複製頁面、插入空白頁或其他 PDF、加文字與簽名、加頁碼、只匯出選取頁；可復原／重做（Ctrl+Z／Ctrl+Y）
- **簽名**：手寫或上傳簽名（白底自動去背），放到頁面上可拖曳縮放，可一次套用到所有頁、奇偶頁或指定頁；簽名只存在本機瀏覽器
- **加浮水印**：文字或圖片，可選位置（置中／平鋪／四角）、角度、透明度、套用頁面，即時預覽
- **調整尺寸**：把頁面統一成 A4／A3／A5／B5／Letter／Legal（內容保持向量），或自動裁掉白邊
- **壓縮**：「保留文字」只重新壓縮照片，文字仍可選取；「整頁轉成圖片」適合掃描檔；三種強度，可轉灰階
- **圖片轉 PDF**：JPG、PNG、WebP 合成 PDF，可選 A4／Letter／原圖大小、方向與邊界
- **PDF 轉圖片**：每頁存成 JPG 或 PNG（72／150／300 dpi），多頁打包成 ZIP
- **圖片工具**：壓縮、限制尺寸、轉成 JPG／PNG／WebP，可多張一起處理
- **去浮水印**：筆刷塗抹後以內容感知填補（多尺度 PatchMatch，在背景 Worker 執行）；可放大、拖曳畫面

通用：
- **工具間串接**：做完之後畫面下方會出現「接著處理」，可以直接把結果送到其他工具，不用先下載再上傳
- **可取消**：處理中的按鈕會顯示「取消」，再按一次就停止
- **手機拖曳排序**：長按縮圖或清單項目再拖曳

## 使用方式

用 Chrome 或 Edge 開啟 `index.html`。

直接雙擊開啟時，瀏覽器不允許背景 Worker，PDF 解析會改在頁面上執行，大檔案會比較慢。想要最快的速度，改用本機伺服器開啟：

```powershell
python -m http.server 8000
```

然後在瀏覽器打開 http://localhost:8000

## 檔案結構

```
紙匣/
├─ index.html           入口：頁面結構（各分頁的 HTML）＋載入 CSS／JS
├─ icon.svg             網站圖示（分頁 icon、頁首標誌）
├─ css/
│  └─ styles.css        全部樣式（顏色變數、深色模式、各工具版面）
├─ lib/                 第三方函式庫的本機副本（離線使用）
│  ├─ pdf-lib.min.js    pdf-lib 1.17.1：產生與修改 PDF
│  ├─ pdf.min.js        pdf.js 3.11.174：顯示與轉圖
│  ├─ pdf.worker.min.js pdf.js 的背景 Worker
│  └─ jszip.min.js      JSZip 3.10.1：打包 ZIP
├─ js/                  依載入順序：
│  ├─ core.js           共用：工具函式、存檔、可取消的工作、工具間串接、拖曳排序、範例檔、縮圖、頁碼範圍、座標換算
│  ├─ inpaint.js        去浮水印的補圖演算法（會被包成 Web Worker）
│  ├─ merge.js          合併
│  ├─ split.js          拆分
│  ├─ edit.js           編輯頁面、復原／重做、插入頁面、匯出
│  ├─ editor-dialog.js  頁面上加文字／簽名的編輯視窗、套用到多頁
│  ├─ signatures.js     簽名管理、手寫板、「簽名」分頁
│  ├─ watermark.js      加浮水印
│  ├─ resize.js         調整頁面尺寸、裁白邊
│  ├─ compress.js       壓縮（保留文字／整頁轉圖片）
│  ├─ img2pdf.js        圖片轉 PDF
│  ├─ pdf2img.js        PDF 轉圖片
│  ├─ imgtool.js        圖片工具
│  ├─ unmark.js         去浮水印的介面
│  └─ app.js            分頁切換與啟動（最後載入）
├─ tools/
│  └─ build.py          打包成單一檔案
└─ dist/                build.py 的產出（不在版本控制內）
   ├─ 紙匣.html          單一檔案版，可直接寄給別人（函式庫改從 cdnjs 載入，需要網路）
   └─ artifact.html     發布到 Claude Artifact 用
```

JS 檔案是一般 `<script>`（不是 ES module），彼此共用最上層的變數與函式，所以 `index.html` 裡的載入順序不能亂改；這樣做是為了讓 `index.html` 直接雙擊開啟也能運作。

## 修改後

改完 `index.html`、`css/` 或 `js/` 之後，執行：

```powershell
python tools/build.py
```

會重新產生 `dist/` 裡的單一檔案版。線上版（https://claude.ai/artifact/LrA1FQYwq2f55Y6jAAwKY1）用 `dist/artifact.html` 發布。

更新 `lib/` 裡的函式庫版本時，也要一起修改 `tools/build.py` 的 `CDN` 對照表。
