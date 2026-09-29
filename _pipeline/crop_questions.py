# -*- coding: utf-8 -*-
"""
從原始題本 PDF 依文字層座標逐題裁切圖片，另裁題組文章圖與整頁縮圖。

定位依據（文字層可讀，實測 105-114 五科皆適用）：
- 題號：左邊界（x0 < 75pt）的「N.」；封面頁（第 0 頁）不算；同號取第一次出現（數學非選擇題也從 1 起編）
- 題組標頭：國文/社會/自然/數學為含「X～Y題」的行；英語為左邊界的「(X-Y)」
- 大題標頭：「一、」「二、」「第二部分」開頭的行（只當切點，不當題組）
一題的範圍 = 題號 → 同頁下一個切點（題號/題組標頭/大題標頭，否則頁尾）；
若下一題在下一頁，會把下一頁頂端到第一個切點的續接段拼在下面。
題組文章 = 標頭 → 該組第一題題號（可跨頁拼接）。

用法: python crop_questions.py [subject_key ...]
輸出: img/q/<qid>.jpg、img/g/<year>_<subject>_<first>.jpg、img/page/<year>_<subject>_p<N>.jpg、data/images_<subject>.json
"""
import json, os, re, sys, io
import fitz
from PIL import Image

SUBJECT_FILE = {'chinese': '國文', 'math': '數學', 'social': '社會', 'science': '自然', 'english_read': '英語閱讀'}
YEARS = [str(y) for y in range(105, 115)]
SRC_ROOT = os.path.join(os.path.expanduser('~'), 'Desktop', '國中教育會考_歷屆試題_110-114')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
Q_DIR = os.path.join(ROOT, 'assets', 'q')
G_DIR = os.path.join(ROOT, 'assets', 'g')
P_DIR = os.path.join(ROOT, 'assets', 'page')
DATA_DIR = os.path.join(ROOT, 'data')

LEFT_MARGIN_MAX = 75
TOP_PAD = 6
PAGE_TOP = 40
BOTTOM_MARGIN = 58
MIN_CONT = 20
DPI = 150
PAGE_WIDTH_PX = 1000

GROUP_PAT = re.compile(r'(\d{1,2})\s*[～~〜至到－\-]\s*(\d{1,2})\s*題')
EN_GROUP_PAT = re.compile(r'^\s*\(\s*(\d{1,2})\s*[-～~]\s*(\d{1,2})\s*\)\s*$')
# 題目裡也會出現「一、二年級」這種開頭，大題標頭必須同時帶有單題/題組/選擇題/部分等字樣
SECTION_PAT = re.compile(r'^\s*((一|二|三|四)、|第.部分).*(單題|題組|選擇題|部分)')


def to_img(pix):
    return Image.open(io.BytesIO(pix.tobytes('png'))).convert('L')


def trim(img, pad=12):
    bbox = Image.eval(img, lambda v: 255 if v < 235 else 0).getbbox()
    if not bbox:
        return None
    return img.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad),
                     min(img.width, bbox[2] + pad), min(img.height, bbox[3] + pad)))


def stack(imgs):
    imgs = [i for i in imgs if i is not None]
    if not imgs:
        return None
    w = max(i.width for i in imgs)
    out = Image.new('L', (w, sum(i.height for i in imgs)), 255)
    y = 0
    for i in imgs:
        out.paste(i, (0, y))
        y += i.height
    return out


def clip_img(page, y0, y1):
    if y1 - y0 < 4:
        return None
    pix = page.get_pixmap(matrix=fitz.Matrix(DPI / 72, DPI / 72),
                          clip=fitz.Rect(0, y0, page.rect.width, y1))
    return trim(to_img(pix))


def scan(doc, subject, max_q):
    marks, groups, cuts = {}, [], {}
    for pn in range(1, len(doc)):
        cuts[pn] = []
        for w in doc[pn].get_text('words'):
            m = re.fullmatch(r'(\d{1,2})\.', w[4])
            if m and w[0] < LEFT_MARGIN_MAX:
                n = int(m.group(1))
                if n not in marks:
                    marks[n] = (pn, w[1])
                    cuts[pn].append(w[1])
        for b in doc[pn].get_text('dict')['blocks']:
            for l in b.get('lines', []):
                t = ''.join(s['text'] for s in l['spans'])
                y = l['bbox'][1]
                if SECTION_PAT.search(t):
                    cuts[pn].append(y)
                    continue
                m = (EN_GROUP_PAT.match(t) if subject == 'english_read' and l['bbox'][0] < LEFT_MARGIN_MAX
                     else None) or (GROUP_PAT.search(t) if subject != 'english_read' else None)
                if m:
                    a, b2 = int(m.group(1)), int(m.group(2))
                    if a < b2 <= max_q and b2 - a <= 8:
                        groups.append((a, b2, pn, y))
                        cuts[pn].append(y)
    for pn in cuts:
        cuts[pn] = sorted(set(round(c, 1) for c in cuts[pn]))
    return marks, groups, cuts


def next_cut(cuts, pn, y, page_h):
    later = [c for c in cuts.get(pn, []) if c > y + 1]
    return (later[0] - 2) if later else (page_h - BOTTOM_MARGIN)


def run(subject):
    index = {}
    for year in YEARS:
        pdf = os.path.join(SRC_ROOT, year, f'{year}_{SUBJECT_FILE[subject]}.pdf')
        qb_path = os.path.join(DATA_DIR, f'questionbank_{subject}.json')
        if not os.path.exists(pdf):
            continue
        qnos = {int(q['q_no']) for q in json.load(open(qb_path, encoding='utf-8'))['questions'] if q['year'] == year}
        max_q = max(qnos) if qnos else 99
        doc = fitz.open(pdf)
        marks, groups, cuts = scan(doc, subject, max_q)
        pages_used = set()

        for n in sorted(qnos):
            if n not in marks:
                continue
            pn, y = marks[n]
            page = doc[pn]
            parts = [clip_img(page, max(0, y - TOP_PAD), next_cut(cuts, pn, y, page.rect.height))]
            nxt = marks.get(n + 1)
            if nxt and nxt[0] == pn + 1 and pn + 1 < len(doc):
                p2 = doc[pn + 1]
                end = next_cut(cuts, pn + 1, PAGE_TOP - 1, p2.rect.height)
                if end - PAGE_TOP > MIN_CONT:
                    parts.append(clip_img(p2, PAGE_TOP, end))
            img = stack(parts)
            qid = f'{year}_{subject}_{n}'
            entry = {'page': f'assets/page/{year}_{subject}_p{pn}.jpg'}
            if img is not None:
                img.save(os.path.join(Q_DIR, f'{qid}.jpg'), 'JPEG', quality=70, optimize=True)
                entry['img'] = f'assets/q/{qid}.jpg'
            pages_used.add(pn)
            index[qid] = entry

        for a, b, hpn, hy in groups:
            if a not in marks:
                continue
            qpn, qy = marks[a]
            parts = []
            for pn in range(hpn, qpn + 1):
                page = doc[pn]
                y0 = hy - 2 if pn == hpn else PAGE_TOP
                y1 = (qy - 2) if pn == qpn else (page.rect.height - BOTTOM_MARGIN)
                parts.append(clip_img(page, y0, y1))
                pages_used.add(pn)
            img = stack(parts)
            if img is None:
                continue
            gname = f'{year}_{subject}_{a}'
            img.save(os.path.join(G_DIR, f'{gname}.jpg'), 'JPEG', quality=70, optimize=True)
            for n in range(a, b + 1):
                qid = f'{year}_{subject}_{n}'
                if qid in index:
                    index[qid]['group_img'] = f'assets/g/{gname}.jpg'
                    index[qid]['group'] = [a, b]

        # 沒定位到題號的題目，用 source_page 對應的整頁圖當後備
        ext = os.path.join(HERE, 'extracted', f'{year}_{subject}.json')
        if os.path.exists(ext):
            for q in json.load(open(ext, encoding='utf-8')).get('questions', []):
                qid = f'{year}_{subject}_{int(q["q_no"])}'
                sp = q.get('source_page')
                if qid not in index and isinstance(sp, int) and 0 < sp < len(doc):
                    index[qid] = {'page': f'assets/page/{year}_{subject}_p{sp}.jpg'}
                    pages_used.add(sp)

        for pn in pages_used:
            pix = doc[pn].get_pixmap(matrix=fitz.Matrix(2, 2))
            img = to_img(pix)
            img = img.resize((PAGE_WIDTH_PX, round(img.height * PAGE_WIDTH_PX / img.width)), Image.LANCZOS)
            img.save(os.path.join(P_DIR, f'{year}_{subject}_p{pn}.jpg'), 'JPEG', quality=60, optimize=True)
        print(f'  {year} {subject}: {sum(1 for k in index if k.startswith(year) and "img" in index[k])}/{len(qnos)} cropped, {len(groups)} groups, {len(pages_used)} pages')

    with open(os.path.join(DATA_DIR, f'images_{subject}.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    return index


if __name__ == '__main__':
    for d in (Q_DIR, G_DIR, P_DIR):
        os.makedirs(d, exist_ok=True)
    for s in (sys.argv[1:] or list(SUBJECT_FILE)):
        idx = run(s)
        print(f'[OK] {s}: {len(idx)} entries, {sum(1 for v in idx.values() if "img" in v)} cropped, '
              f'{sum(1 for v in idx.values() if "group_img" in v)} with group passage')
