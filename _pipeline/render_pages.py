# -*- coding: utf-8 -*-
"""
把會考題本 PDF 轉成頁面 PNG，供 Agent 用 Read 工具原生讀圖抽題。
用法: python render_pages.py <year> <subject_key> [dpi]
  subject_key: chinese | math | social | science | english_read
PDF 來源固定在 Desktop\\國中教育會考_歷屆試題_110-114\\<year>\\<year>_<檔名關鍵字>.pdf
輸出到 img/<year>_<subject_key>/p<N>.png，並寫一份 manifest.json 記錄每頁 status。
"""
import json, os, sys, fitz
from datetime import datetime

SUBJECT_FILE = {
    'chinese': '國文', 'math': '數學', 'social': '社會',
    'science': '自然', 'english_read': '英語閱讀',
}
SRC_ROOT = os.path.join(os.path.expanduser('~'), 'Desktop', '國中教育會考_歷屆試題_110-114')
HERE = os.path.dirname(__file__)
IMG_ROOT = os.path.join(HERE, '..', 'img')


def render(year, subject_key, dpi=170):
    if subject_key not in SUBJECT_FILE:
        print(f"[ERROR] unknown subject_key: {subject_key}; choose from {list(SUBJECT_FILE)}")
        return
    pdf_path = os.path.join(SRC_ROOT, year, f"{year}_{SUBJECT_FILE[subject_key]}.pdf")
    if not os.path.exists(pdf_path):
        print(f"[ERROR] PDF not found: {pdf_path}")
        return

    slug = f"{year}_{subject_key}"
    out_dir = os.path.join(IMG_ROOT, slug)
    os.makedirs(out_dir, exist_ok=True)
    manifest_path = os.path.join(out_dir, 'manifest.json')

    old = {}
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding='utf-8') as f:
            old = json.load(f).get('pages', {})

    doc = fitz.open(pdf_path)
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pages = {}
    for n in range(len(doc)):
        fp = os.path.join(out_dir, f'p{n}.png')
        if not os.path.exists(fp):
            pix = doc[n].get_pixmap(matrix=mat)
            pix.save(fp)
        pages[f'p{n}'] = {
            'page_num': n,
            'status': old.get(f'p{n}', {}).get('status', 'todo'),
        }
    doc.close()

    manifest = {
        'year': year, 'subject_key': subject_key,
        'pdf_path': pdf_path, 'total_pages': len(pages),
        'created_at': datetime.now().isoformat(),
        'pages': pages,
    }
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print(f"[OK] {slug}: {len(pages)} pages rendered -> {out_dir}")


if __name__ == '__main__':
    year = sys.argv[1]
    subject_key = sys.argv[2]
    dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 170
    render(year, subject_key, dpi)
