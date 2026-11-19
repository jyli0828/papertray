# PDF 工作台

在瀏覽器裡處理 PDF 與圖片的工具，檔案不會上傳到任何伺服器。

## 功能

- **合併**：多份 PDF 接成一份，可拖曳排序
- **拆分**：依頁碼範圍（如 `1-3, 5, 8-`）、每 N 頁或每頁一份，多份打包成 ZIP
- **編輯**：頁面排序、旋轉、刪除、加中文文字、加簽名、加頁碼、只匯出選取頁
- **簽名**：手寫或上傳簽名（白底自動去背），放到頁面上可拖曳縮放；簽名只存在本機瀏覽器
- **加浮水印**：文字或圖片，可選位置（置中／平鋪／四角）、角度、透明度、套用頁面，即時預覽
- **壓縮**：輕度／標準／強力（轉成圖片）或無損最佳化，可轉灰階
- **圖片轉 PDF**：JPG、PNG、WebP 合成 PDF，可選 A4／Letter／原圖大小、方向與邊界
- **PDF 轉圖片**：每頁存成 JPG 或 PNG（72／150／300 dpi），多頁打包成 ZIP
- **去浮水印**：筆刷塗抹後以內容感知填補（多尺度 PatchMatch，在背景 Worker 執行）

## 使用方式

用 Chrome 或 Edge 開啟 `index.html`。需要網路連線，因為函式庫從 cdnjs 載入：

- pdf-lib 1.17.1（產生與修改 PDF）
- pdf.js 3.11.174（顯示與轉圖）
- JSZip 3.10.1（打包 ZIP）

如果直接開啟時某些功能沒反應（部分瀏覽器限制本機檔案啟動背景 Worker），改用本機伺服器開啟：

```powershell
python -m http.server 8000
```

然後在瀏覽器打開 http://localhost:8000

## 檔案結構

```
PDF 工作台/
├─ index.html           入口：頁面結構（各分頁的 HTML）＋載入 CSS／JS
├─ css/
│  └─ styles.css        全部樣式（顏色變數、深色模式、各工具版面）
├─ js/                  依載入順序：
│  ├─ core.js           共用：函式庫設定、工具函式、存檔、拖放、範例檔、縮圖、頁碼範圍、座標換算
│  ├─ inpaint.js        去浮水印的補圖演算法（會被包成 Web Worker）
│  ├─ merge.js          合併
│  ├─ split.js          拆分
│  ├─ edit.js           編輯頁面與匯出
│  ├─ editor-dialog.js  頁面上加文字／簽名的編輯視窗
│  ├─ signatures.js     簽名管理、手寫板、「簽名」分頁
│  ├─ watermark.js      加浮水印
│  ├─ compress.js       壓縮
│  ├─ img2pdf.js        圖片轉 PDF
│  ├─ pdf2img.js        PDF 轉圖片
│  ├─ unmark.js         去浮水印的介面
│  └─ app.js            分頁切換與啟動（最後載入）
├─ tools/
│  └─ build.py          打包成單一檔案
└─ dist/                build.py 的產出（不要手動修改）
   ├─ PDF工作台.html     單一檔案版，可直接寄給別人
   └─ artifact.html     發布到 Claude Artifact 用
```

JS 檔案是一般 `<script>`（不是 ES module），彼此共用最上層的變數與函式，所以 `index.html` 裡的載入順序不能亂改；這樣做是為了讓 `index.html` 直接雙擊開啟也能運作。

## 修改後

改完 `index.html`、`css/` 或 `js/` 之後，執行：

```powershell
python tools/build.py
```

會重新產生 `dist/` 裡的單一檔案版。線上版（https://claude.ai/artifact/LrA1FQYwq2f55Y6jAAwKY1）用 `dist/artifact.html` 發布。
