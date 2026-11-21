"""把 index.html + css/ + js/ 打包成單一檔案。

用法（在專案資料夾執行）：
    python tools/build.py

產生：
    dist/紙匣.html        單一檔案的完整網頁，可以直接寄給別人或放到任何地方開啟
    dist/artifact.html    發布到 Claude Artifact 用的版本（不含 <html>/<head>/<body> 外框）
"""
import base64
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


# lib/ holds offline copies of these libraries; the bundled pages load the same versions from cdnjs instead
# (the single file stays small, and Claude Artifacts only allow scripts from approved CDNs).
CDN = {
    'lib/pdf-lib.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
    'lib/pdf.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'lib/jszip.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'lib/heic2any.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js',
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
    icon = 'data:image/svg+xml;base64,' + base64.b64encode(read('icon.svg').encode('utf-8')).decode('ascii')
    html = html.replace('href="icon.svg"', f'href="{icon}"').replace('src="icon.svg"', f'src="{icon}"')
    html = re.sub(r'<link rel="stylesheet" href="((?!https?:)[^"]+)">', css, html)
    html = re.sub(r'<script src="((?!https?:)[^"]+)"></script>', js, html)
    # Libraries load on demand from the paths in js/core.js (LIBS); in the bundles those paths point at cdnjs.
    for local, url in CDN.items():
        html = html.replace(f"'{local}'", f"'{url}'")
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

    # Artifact page: head content (minus charset/viewport, which the host adds) followed by the body content.
    head = re.search(r'<head>(.*?)</head>', single, re.S).group(1)
    head = re.sub(r'\s*<meta (charset|name="viewport")[^>]*>', '', head).strip()
    body = re.search(r'<body>(.*)</body>', single, re.S).group(1).strip()
    with open(os.path.join(ROOT, 'dist', 'artifact.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(head + '\n\n' + body + '\n')

    for name in ('紙匣.html', 'artifact.html'):
        size = os.path.getsize(os.path.join(ROOT, 'dist', name))
        print(f'dist/{name}  {size / 1024:.0f} KB')


if __name__ == '__main__':
    main()
