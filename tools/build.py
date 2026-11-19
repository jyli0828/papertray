"""把 index.html + css/ + js/ 打包成單一檔案。

用法（在專案資料夾執行）：
    python tools/build.py

產生：
    dist/PDF工作台.html   單一檔案的完整網頁，可以直接寄給別人或放到任何地方開啟
    dist/artifact.html    發布到 Claude Artifact 用的版本（不含 <html>/<head>/<body> 外框）
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def inline_assets(html):
    """Replace local <link rel="stylesheet"> and <script src> with inline copies; CDN tags stay as they are."""
    def css(m):
        return '<style>\n' + read(m.group(1)) + '</style>'

    def js(m):
        code = read(m.group(1))
        # Each file is its own classic script so top-level names stay shared, exactly as when loaded separately.
        return '<script>\n' + code.replace('</script', '<\\/script') + '</script>'

    html = re.sub(r'<link rel="stylesheet" href="((?!https?:)[^"]+)">', css, html)
    html = re.sub(r'<script src="((?!https?:)[^"]+)"></script>', js, html)
    return html


def main():
    index = read('index.html')
    single = inline_assets(index)
    os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
    with open(os.path.join(ROOT, 'dist', 'PDF工作台.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(single)

    # Artifact page: head content (minus charset/viewport, which the host adds) followed by the body content.
    head = re.search(r'<head>(.*?)</head>', single, re.S).group(1)
    head = re.sub(r'\s*<meta (charset|name="viewport")[^>]*>', '', head).strip()
    body = re.search(r'<body>(.*)</body>', single, re.S).group(1).strip()
    with open(os.path.join(ROOT, 'dist', 'artifact.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(head + '\n\n' + body + '\n')

    for name in ('PDF工作台.html', 'artifact.html'):
        size = os.path.getsize(os.path.join(ROOT, 'dist', name))
        print(f'dist/{name}  {size / 1024:.0f} KB')


if __name__ == '__main__':
    main()
