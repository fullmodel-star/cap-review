# -*- coding: utf-8 -*-
"""
解析官方「參考答案」PDF（固定表格：題號 + 各科答案，欄序=國文/英語閱讀/[英語聽力]/數學/社會/自然）。
用法: python parse_answers.py <year>
輸出: data/answers_<year>.json  { subject_key: {q_no: 'A'} }

表格結構是實測得出的（見對話記錄）：欄位0=題號，欄位1=永遠是 None 的間隔欄，
接著才是各科答案欄；有些年份中間還會插入額外的純 None 間隔欄（例如105年），
用「該欄在所有資料列都是 None」判斷為間隔欄並丟棄，剩下的欄位依科目順序對應。
"""
import json, os, sys
import pdfplumber

SUBJECT_ORDER_WITH_LISTEN = ['chinese', 'english_read', 'english_listen', 'math', 'social', 'science']
SUBJECT_ORDER_NO_LISTEN = ['chinese', 'english_read', 'math', 'social', 'science']

SRC_ROOT = os.path.join(os.path.expanduser('~'), 'Desktop', '國中教育會考_歷屆試題_110-114')
HERE = os.path.dirname(__file__)
DATA_DIR = os.path.join(HERE, '..', 'data')


def parse(year):
    pdf_path = os.path.join(SRC_ROOT, year, f"{year}_參考答案.pdf")
    if not os.path.exists(pdf_path):
        print(f"[ERROR] not found: {pdf_path}")
        return

    has_listen = os.path.exists(os.path.join(SRC_ROOT, year, f"{year}_英語聽力.zip"))
    order = SUBJECT_ORDER_WITH_LISTEN if has_listen else SUBJECT_ORDER_NO_LISTEN

    rows = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for t in tables:
                for row in t:
                    if row and row[0] and str(row[0]).strip().isdigit():
                        rows.append(row)

    # 找出從 index2 開始、在「所有」列都是 None 的欄位 -> 視為間隔欄丟棄
    max_len = max(len(r) for r in rows)
    padded = [r + [None] * (max_len - len(r)) for r in rows]
    keep_idx = []
    for i in range(2, max_len):
        if any((r[i] is not None and str(r[i]).strip() != '') for r in padded):
            keep_idx.append(i)

    result = {s: {} for s in order}
    mismatches = 0
    for r in padded:
        q_no = int(str(r[0]).strip())
        vals = [r[i] for i in keep_idx]
        if len(vals) != len(order):
            mismatches += 1
        for subj, v in zip(order, vals):
            if v and str(v).strip():
                result[subj][str(q_no)] = str(v).strip()

    os.makedirs(DATA_DIR, exist_ok=True)
    out_path = os.path.join(DATA_DIR, f'answers_{year}.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    counts = {s: len(v) for s, v in result.items()}
    print(f"[OK] {year}: order={order} counts={counts} mismatched_rows={mismatches} -> {out_path}")


if __name__ == '__main__':
    parse(sys.argv[1])
