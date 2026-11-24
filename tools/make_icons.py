"""從 icons/icon.svg 的圖形畫出 App 圖示 PNG（安裝到電腦、手機用）。

用法（在專案資料夾執行）：
    python tools/make_icons.py

產生 icons/icon-192.png、icons/icon-512.png、icons/maskable-512.png（Android 會裁成圓形或圓角，
所以 maskable 版的圖案縮在中間 80%，背景鋪滿）、icons/apple-touch-icon.png（180 px）。
需要 Pillow。icons/icon.svg 改了的話，這裡的座標也要一起改。
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'icons')
INK, PAPER, FOLD, TRAY = (28, 63, 163, 255), (255, 255, 255, 255), (201, 212, 242, 255), (229, 199, 107, 255)
LINE = (28, 63, 163, round(255 * .45))
SS = 8  # drawn 8× larger, then scaled down, for smooth edges


def draw(size, rounded=True, inset=1.0):
    big = size * SS
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=14 / 64 * big, fill=INK)
    else:
        d.rectangle([0, 0, big, big], fill=INK)
    # icon.svg works in a 64-unit box; inset < 1 shrinks the drawing around the centre (maskable icons)
    k = big / 64 * inset
    o = (big - 64 * k) / 2
    P = lambda x, y: (o + x * k, o + y * k)
    d.polygon([P(19, 9), P(38, 9), P(47, 18), P(47, 46), P(19, 46)], fill=PAPER)
    d.polygon([P(38, 9), P(38, 18), P(47, 18)], fill=FOLD)
    lines = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(lines)
    for x, y, w in ((24, 23, 17), (24, 30, 12)):
        ld.rounded_rectangle([*P(x, y), *P(x + w, y + 3.2)], radius=1.6 * k, fill=LINE)
    img = Image.alpha_composite(img, lines)
    d = ImageDraw.Draw(img)
    # the tray: a notch on top (M8 38h13l4 6h14l4-6h13), corners rounded by 5 at the bottom
    d.polygon([P(8, 38), P(21, 38), P(25, 44), P(39, 44), P(43, 38), P(56, 38), P(56, 50), P(8, 50)], fill=TRAY)
    d.rounded_rectangle([*P(8, 44), *P(56, 55)], radius=5 * k, fill=TRAY)
    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    jobs = [('icon-192.png', 192, True, 1), ('icon-512.png', 512, True, 1),
            ('maskable-512.png', 512, False, .8), ('apple-touch-icon.png', 180, False, .86)]
    for name, size, rounded, inset in jobs:
        draw(size, rounded, inset).save(os.path.join(OUT, name), optimize=True)
        print(f'icons/{name}  {os.path.getsize(os.path.join(OUT, name)) / 1024:.1f} KB')


if __name__ == '__main__':
    main()
