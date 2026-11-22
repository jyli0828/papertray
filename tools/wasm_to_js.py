"""把 qpdf.wasm 包成 lib/qpdf/qpdf.wasm.js（base64 放在一個 <script> 裡）。

直接雙擊 index.html（file://）時，瀏覽器不允許 fetch 本機檔案，.wasm 載入不了；
<script> 標籤則可以，所以 WebAssembly 以 base64 存在 script 裡，js/password.js 再把它變回 blob: 網址。

用法（在專案資料夾執行）：
    python tools/wasm_to_js.py path/to/qpdf.wasm 0.3.1

第二個參數是 @neslinesli93/qpdf-wasm 的版本，只寫進檔案開頭的說明。
"""
import base64
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'lib', 'qpdf', 'qpdf.wasm.js')


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    wasm_path, version = sys.argv[1], sys.argv[2]
    with open(wasm_path, 'rb') as f:
        data = f.read()
    if data[:4] != b'\0asm':
        raise SystemExit(f'{wasm_path} 不是 WebAssembly 檔')
    with open(OUT, 'w', encoding='ascii', newline='\n') as f:
        f.write(f'/* qpdf.wasm (@neslinesli93/qpdf-wasm {version}) as base64, so it loads with a <script> tag even when '
                'the page is opened from disk. */\n')
        f.write('window.QPDF_WASM = "' + base64.b64encode(data).decode('ascii') + '";\n')
    print(f'lib/qpdf/qpdf.wasm.js  {os.path.getsize(OUT) / 1024:.0f} KB')


if __name__ == '__main__':
    main()
