# -*- coding: utf-8 -*-
"""
寫作測驗 105-114：找出題目頁（含「題目」或「完成一篇文章」等字樣、排除封面與浮水印空白頁），
渲染成圖，文字去重後當摘要。輸出 assets/writing/<year>_p<N>.jpg 與 data/writing.json。
"""
import json, os, re, io
import fitz
from PIL import Image

SRC_ROOT = os.path.join(os.path.expanduser('~'), 'Desktop', '國中教育會考_歷屆試題_110-114')
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_IMG = os.path.join(HERE, '..', 'assets', 'writing')
OUT_JSON = os.path.join(HERE, '..', 'data', 'writing.json')
KEY = re.compile(r'題目[:：]|完成一篇|題意要求|依下列條件|寫一篇')


OK_CHAR = re.compile(r'[一-鿿　-〿＀-￯…—‘-” A-Za-z0-9.,:;?!()「」『』、。，：；？！…—]')


def readable(s):
    # 圖片內嵌文字層是自訂編碼，抽出來是亂碼；可讀字元不到八成就丟掉
    return len(s) >= 4 and sum(bool(OK_CHAR.match(c)) for c in s) / len(s) > 0.8


def clean(text):
    seen, out = set(), []
    for line in text.splitlines():
        s = line.strip().replace('!', '')
        if not readable(s) or s in seen or '會考寫作測驗' in s or s.isdigit():
            continue
        seen.add(s)
        out.append(s)
    return '\n'.join(out)


def main():
    os.makedirs(OUT_IMG, exist_ok=True)
    items = []
    for y in range(105, 115):
        year = str(y)
        doc = fitz.open(os.path.join(SRC_ROOT, year, f'{year}_寫作測驗.pdf'))
        pages = [pn for pn in range(1, len(doc)) if KEY.search(doc[pn].get_text())]
        imgs, texts = [], []
        for pn in pages:
            pix = doc[pn].get_pixmap(matrix=fitz.Matrix(2, 2))
            img = Image.open(io.BytesIO(pix.tobytes('png'))).convert('L')
            img = img.resize((1000, round(img.height * 1000 / img.width)), Image.LANCZOS)
            path = f'assets/writing/{year}_p{pn}.jpg'
            img.save(os.path.join(HERE, '..', path), 'JPEG', quality=65, optimize=True)
            imgs.append(path)
            texts.append(clean(doc[pn].get_text()))
        text = '\n'.join(texts)
        m = re.search(r'以「(.+?)」\s*為題', text.replace('\n', '')) or re.search(r'題目[:：]\s*(.+)', text)
        title = m.group(1).strip() if m else '（不必訂題）'
        items.append({'year': year, 'title': title, 'text': text, 'imgs': imgs})
        print(year, 'pages', pages, '| title:', title or '(圖文題，無明確題目)')
    json.dump(items, open(OUT_JSON, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)


if __name__ == '__main__':
    main()
