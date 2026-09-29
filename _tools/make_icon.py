# -*- coding: utf-8 -*-
r"""產生 704 會考複習的安裝 icon（denali 學習家族色 squircle ＋ 白色 Tabler「books」線稿）。

沿用 607_爸爸救星 的管線（規則見 05_品牌資源\03_App圖示_正式檔\02_安裝icon_其他家族\_README.md）：
背景＝家族色 squircle(n=5.2)；線條 #EEF3F6；圖案佔比 0.68；Tabler SVG 由 headless Chrome 渲染。
apple-touch-icon 要壓平成不透明（iOS 會把透明四角填黑），底色取家族色。

用法：python _tools/make_icon.py
"""
import io, shutil, subprocess, tempfile
from pathlib import Path
from PIL import Image
import numpy as np

HERE = Path(__file__).resolve().parent
APP = HERE.parent
SLUG = "cap-review"
OUT_OFFICIAL = APP.parent.parent / "05_品牌資源" / "03_App圖示_正式檔" / "02_安裝icon_其他家族" / SLUG
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

FAMILY_HEX = "4E6A7C"      # denali / 學習家族（tokens v4.9.1）
SIZE = 1024
RATIO = 0.68
SIZES = [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024]

# Tabler Icons v3 "books"（MIT），內嵌路徑，建置時不上網
BOOKS_PATHS = [
    "M5 4m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z",
    "M9 4m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z",
    "M5 8h4",
    "M9 16h4",
    "M13.803 4.56l2.184 -.53c.562 -.135 1.133 .19 1.282 .732l3.695 13.418a1.02 1.02 0 0 1 -.634 1.219l-.133 .041l-2.184 .53c-.562 .135 -1.133 -.19 -1.282 -.732l-3.695 -13.418a1.02 1.02 0 0 1 .634 -1.219l.133 -.041z",
    "M14 9l4 -1",
    "M16 16l3.923 -.98",
]


def squircle_mask(size, n=5.2):
    a = b = size / 2
    y, x = np.mgrid[0:size, 0:size]
    val = (np.abs((x - a) / a)) ** n + (np.abs((y - b) / b)) ** n
    return Image.fromarray(((val <= 1.0).astype(np.uint8) * 255), mode="L")


def render_glyph(px=800):
    paths = "\n".join('<path d="%s" />' % d for d in BOOKS_PATHS)
    html = ('<!doctype html><html><head><meta charset="utf-8">'
            '<style>html,body{margin:0;padding:0;background:transparent}'
            'svg{width:%dpx;height:%dpx;display:block}</style></head><body>'
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" '
            'stroke="#EEF3F6" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
            '%s</svg></body></html>' % (px, px, paths))
    tmp = Path(tempfile.mkdtemp(prefix="cap_review_icon_"))
    hp = tmp / "render.html"
    hp.write_text(html, encoding="utf-8")
    shot = tmp / "glyph.png"
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--default-background-color=00000000", "--window-size=%d,%d" % (px, px),
                    "--screenshot=%s" % shot, hp.as_uri()], check=True, capture_output=True, timeout=120)
    if not shot.exists():
        raise SystemExit("✘ headless Chrome 沒有輸出截圖")
    im = Image.open(shot).convert("RGBA")
    bbox = im.getbbox()
    if not bbox:
        raise SystemExit("✘ 渲染結果是空白圖")
    return im.crop(bbox)


def compose(glyph, ratio=RATIO, full_bleed=False):
    bg = tuple(int(FAMILY_HEX[i:i + 2], 16) for i in (0, 2, 4)) + (255,)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    fill = Image.new("RGBA", (SIZE, SIZE), bg)
    canvas.paste(fill, (0, 0), None if full_bleed else squircle_mask(SIZE))
    target = int(SIZE * ratio)
    w, h = glyph.size
    s = target / max(w, h)
    g = glyph.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)
    canvas.paste(g, ((SIZE - g.size[0]) // 2, (SIZE - g.size[1]) // 2), g)
    return canvas


def main():
    if not Path(CHROME).exists():
        raise SystemExit("✘ 找不到 Chrome：%s" % CHROME)
    glyph = render_glyph()
    master = compose(glyph)
    maskable = compose(glyph, ratio=0.52, full_bleed=True)

    OUT_OFFICIAL.mkdir(parents=True, exist_ok=True)
    for s in SIZES:
        master.resize((s, s), Image.LANCZOS).save(OUT_OFFICIAL / ("%s-%d.png" % (SLUG, s)))
    for s in (192, 512):
        shutil.copyfile(OUT_OFFICIAL / ("%s-%d.png" % (SLUG, s)), APP / ("icon-%d.png" % s))
    shutil.copyfile(OUT_OFFICIAL / ("%s-32.png" % SLUG), APP / "favicon-32.png")
    maskable.resize((512, 512), Image.LANCZOS).save(APP / "icon-maskable-512.png")
    bg = tuple(int(FAMILY_HEX[i:i + 2], 16) for i in (0, 2, 4))
    src = Image.open(OUT_OFFICIAL / ("%s-180.png" % SLUG)).convert("RGBA")
    flat = Image.new("RGB", src.size, bg)
    flat.paste(src, (0, 0), src)
    flat.save(APP / "apple-touch-icon.png")
    print("✔ 正式檔 %d 尺寸 → %s；App 端 icon-192/512、favicon-32、maskable、apple-touch-icon（不透明）" % (len(SIZES), OUT_OFFICIAL))


main()
