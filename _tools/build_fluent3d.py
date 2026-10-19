"""下載 Microsoft Fluent Emoji 的 3D 圖（MIT），縮成 128px PNG → vendor/fluent-3d/<key>.png

    python _tools/build_fluent3d.py
    （需要 Pillow：pip install pillow）

2026-10-19 版面美化「闖關考場」建立（照 605 的 _tools/build_fluent3d.py）：
首屏主視覺、狀態列、科目圖格、底部分頁、空狀態用 3D 立體圖。
- 來源：https://github.com/microsoft/fluentui-emoji （MIT，全文寫到 vendor/fluent-3d/LICENSE.txt）。
- 顯示最大 96px，存 128px 給高解析螢幕。
- 下載後檢查是 PNG 檔頭（不是錯誤頁），不合格就停。
- ⚠ 資料夾名大小寫要完全一樣（例 Tear-off calendar），錯了是 404。
- 新增圖＝加進 ICONS 後重跑，並同步 sw.js 的 CORE 清單與 _tools/ui_tests.mjs 的 F3D 清單。
"""
import io
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "vendor" / "fluent-3d"
BASE = "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main"
SIZE = 128

# key → Fluent 資料夾名（檔名＝資料夾名小寫、空白換底線＋_3d.png）
ICONS = {
    # 首屏主視覺與主鈕
    "gradcap": "Graduation cap", "books": "Books", "bullseye": "Bullseye",
    # 狀態列與分頁
    "pencil": "Pencil", "crossmark": "Cross mark", "calendar": "Tear-off calendar", "openbook": "Open book",
    # 科目圖格（對應 index.html 的 SUBJ_IMG）
    "scroll": "Scroll", "speech": "Speech balloon", "ruler": "Triangular ruler",
    "worldmap": "World map", "testtube": "Test tube", "memo": "Memo",
    # 空狀態
    "party": "Party popper", "mailbox": "Open mailbox with raised flag",
}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for key, folder in ICONS.items():
        fname = folder.lower().replace(" ", "_") + "_3d.png"
        url = f"{BASE}/assets/{urllib.parse.quote(folder)}/3D/{urllib.parse.quote(fname)}"
        raw = fetch(url)
        if not raw.startswith(b"\x89PNG"):
            print(f"[FAIL] {key}：{url} 不是 PNG"); sys.exit(1)
        im = Image.open(io.BytesIO(raw)).convert("RGBA")
        im = im.resize((SIZE, SIZE), Image.LANCZOS)
        dst = OUT / f"{key}.png"
        im.save(dst, optimize=True)
        print(f"OK {key:10s} {dst.stat().st_size // 1024} KB  <- {folder}")
    (OUT / "LICENSE.txt").write_bytes(fetch(f"{BASE}/LICENSE"))
    print("OK LICENSE.txt")


if __name__ == "__main__":
    main()
