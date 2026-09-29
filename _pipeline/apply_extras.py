# -*- coding: utf-8 -*-
"""
把 data/images_<subject>.json（原題圖／題組文章圖／整頁圖）與 _pipeline/review/<year>_<subject>.json
（解析、flag、text_issue）併進 data/questionbank_<subject>.json。可重複執行，只寫入非空值。
用法: python apply_extras.py [subject_key ...]
"""
import json, os, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', 'data')
REVIEW = os.path.join(HERE, 'review')
SUBJECTS = ['chinese', 'english_read', 'math', 'social', 'science']


def run(s):
    qb_path = os.path.join(DATA, f'questionbank_{s}.json')
    qb = json.load(open(qb_path, encoding='utf-8'))
    imgs_path = os.path.join(DATA, f'images_{s}.json')
    imgs = json.load(open(imgs_path, encoding='utf-8')) if os.path.exists(imgs_path) else {}
    reviews = {}
    for fp in glob.glob(os.path.join(REVIEW, f'*_{s}.json')):
        try:
            reviews.update(json.load(open(fp, encoding='utf-8')))
        except json.JSONDecodeError:
            print(f'  [WARN] {os.path.basename(fp)} 不是合法 JSON（可能還在寫），先跳過')

    n_img = n_exp = n_flag = n_issue = 0
    for q in qb['questions']:
        for k, v in imgs.get(q['id'], {}).items():
            q[k] = v
        r = reviews.get(q['id'], {})
        for k in ('explanation', 'flag', 'text_issue'):
            if r.get(k):
                q[k] = r[k]
        n_img += 'img' in q
        n_exp += bool(q.get('explanation'))
        n_flag += bool(q.get('flag'))
        n_issue += bool(q.get('text_issue'))

    # 先寫暫存檔再整檔替換：平行 agent 正在讀題庫，不能讓它讀到寫一半的檔案
    tmp = qb_path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(qb, f, ensure_ascii=False, indent=2)
    os.replace(tmp, qb_path)
    total = len(qb['questions'])
    print(f'[OK] {s}: {total} 題｜原題圖 {n_img}｜解析 {n_exp}｜flag {n_flag}｜text_issue {n_issue}')


if __name__ == '__main__':
    for s in (sys.argv[1:] or SUBJECTS):
        run(s)
