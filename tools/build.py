"""把 index.html + css/ + js/ 打包成單一檔案。

用法（在專案資料夾執行）：
    python tools/build.py

產生：
    dist/紙匣.html        單一檔案的完整網頁，可以直接寄給別人或放到任何地方開啟
"""
import base64
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


# lib/ holds offline copies of these libraries; the bundled pages load the same versions from cdnjs instead
# (the single file stays small).
CDN = {
    'lib/pdf-lib.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
    'lib/pdf.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'lib/cmaps/': 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
    'lib/jszip.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'lib/heic2any.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js',
    # Tesseract.js (文字辨識) is not on cdnjs; jsdelivr serves the npm packages. For the language data the bundles
    # give a CDN address instead of a folder, and js/ocr.js then lets Tesseract fetch each language from its own
    # @tesseract.js-data package (chi_tra, eng).
    'lib/tesseract/tesseract.min.js': 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js',
    'lib/tesseract/worker.min.js': 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
    'lib/tesseract/tesseract-core-simd-lstm.wasm.js': 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-simd-lstm.wasm.js',
    'lib/tesseract/lang': 'https://cdn.jsdelivr.net/npm/@tesseract.js-data',
    # qpdf (密碼): the local copy ships its .wasm as base64 in a script; the bundles fetch the .wasm itself.
    'lib/qpdf/qpdf.js': 'https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.1/dist/qpdf.js',
    'lib/qpdf/qpdf.wasm.js': 'https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.1/dist/qpdf.wasm',
}


def inline_assets(html):
    """Inline local <link rel="stylesheet"> and <script src>, then point the on-demand library paths at cdnjs."""
    def css(m):
        return '<style>\n' + read(m.group(1)) + '</style>'

    def js(m):
        code = read(m.group(1))
        # Each file is its own classic script so top-level names stay shared, exactly as when loaded separately.
        return '<script>\n' + code.replace('</script', '<\\/script') + '</script>'

    # The icon travels inside the file as a data: URI (favicon and header logo).
    icon = 'data:image/svg+xml;base64,' + base64.b64encode(read('icons/icon.svg').encode('utf-8')).decode('ascii')
    html = html.replace('href="icons/icon.svg"', f'href="{icon}"').replace('src="icons/icon.svg"', f'src="{icon}"')
    html = re.sub(r'<link rel="stylesheet" href="((?!https?:)[^"]+)">', css, html)
    html = re.sub(r'<script src="((?!https?:)[^"]+)"></script>', js, html)
    # Libraries load on demand from the paths in js/core.js (LIBS); in the bundles those paths point at cdnjs.
    for local, url in CDN.items():
        html = html.replace(f"'{local}'", f"'{url}'")
    # The bundles are single files: no service worker, manifest or app icons next to them.
    html = html.replace('const PWA = true;', 'const PWA = false;')
    html = re.sub(r'\s*<link rel="(manifest|apple-touch-icon)" href="[^"]+">', '', html)
    leftover = re.findall(r"""['"](lib/[^'"]+)""", html)
    if leftover:
        raise SystemExit(f'沒有對應的 CDN 網址：{leftover}（請加到 tools/build.py 的 CDN 表）')
    return html


def main():
    index = read('index.html')
    single = inline_assets(index)
    os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
    with open(os.path.join(ROOT, 'dist', '紙匣.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(single)
    print(f"dist/紙匣.html  {os.path.getsize(os.path.join(ROOT, 'dist', '紙匣.html')) / 1024:.0f} KB")


if __name__ == '__main__':
    main()
