# -*- coding: utf-8 -*-
"""
合併某科目的 10 年抽題結果 + 官方答案，輸出 data/questionbank_<subject>.json
用法: python merge_subject.py <subject_key>
"""
import json, os, sys, glob

HERE = os.path.dirname(__file__)
EXTRACTED_DIR = os.path.join(HERE, 'extracted')
DATA_DIR = os.path.join(HERE, '..', 'data')


def merge(subject_key):
    files = sorted(glob.glob(os.path.join(EXTRACTED_DIR, f'*_{subject_key}.json')))
    if not files:
        print(f"[ERROR] no extracted files found for {subject_key}")
        return

    # 保留既有觀念標籤：重新合併（例如修正答案後）不該把已標好的 concept_tag 洗掉
    out_path = os.path.join(DATA_DIR, f'questionbank_{subject_key}.json')
    old_tags = {}
    if os.path.exists(out_path):
        with open(out_path, encoding='utf-8') as f:
            for q in json.load(f).get('questions', []):
                if q.get('concept_tag'):
                    old_tags[q['id']] = q['concept_tag']

    all_q = []
    by_year = {}
    no_answer = 0
    for fp in files:
        year = os.path.basename(fp).split('_')[0]
        with open(fp, encoding='utf-8') as f:
            data = json.load(f)
        ans_path = os.path.join(DATA_DIR, f'answers_{year}.json')
        answers = {}
        if os.path.exists(ans_path):
            with open(ans_path, encoding='utf-8') as f:
                answers = json.load(f).get(subject_key, {})
        year_count = 0
        for q in data.get('questions', []):
            q_no = str(q.get('q_no', '')).strip()
            answer = answers.get(q_no)
            if not answer:
                no_answer += 1
            qid = f"{year}_{subject_key}_{q_no}"
            all_q.append({
                'id': qid,
                'year': year,
                'subject': subject_key,
                'q_no': q_no,
                'question_text': q.get('question_text', ''),
                'options': q.get('options', {}),
                'answer': answer,
                'has_diagram': bool(q.get('has_diagram')),
                'concept_tag': old_tags.get(qid),
            })
            year_count += 1
        by_year[year] = year_count

    out = {'subject': subject_key, 'total': len(all_q), 'by_year': by_year, 'questions': all_q}
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2, ensure_ascii=False)

    print(f"[OK] {subject_key}: {len(all_q)} questions across {len(files)} years -> {out_path}")
    print(f"  by_year: {by_year}")
    if no_answer:
        print(f"  [WARN] {no_answer} questions have NO matched answer — check parse_answers.py output")


if __name__ == '__main__':
    merge(sys.argv[1])
