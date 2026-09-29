# 解析撰寫任務（每個 agent 負責一科一年）

你要替國中教育會考某一科、某一年的每一道選擇題寫「解析」，給準備明年會考的國三學生自學用。

## 輸入
- 題庫：`C:\Users\c0787\Desktop\App專案\02_其他App\704_會考複習\data\questionbank_{SUBJECT}.json`，只處理 `year == "{YEAR}"` 的題目。每題有 `id`、`q_no`、`question_text`（轉寫文字，可能有誤或為改寫）、`options`、`answer`（官方答案，已對過官方答案卷）。
- 原題圖（權威來源，以圖為準）：`C:\Users\c0787\Desktop\App專案\02_其他App\704_會考複習\assets\q\{id}.jpg`
- 題組文章圖：查 `C:\Users\c0787\Desktop\App專案\02_其他App\704_會考複習\data\images_{SUBJECT}.json`，若該題有 `group_img`，先看那張文章圖（同一組只需看一次）。沒有 `img` 的題目改看 `page` 整頁圖。

用 Read 工具直接看圖。

## 每題要產出
- `explanation`：繁體中文，2～4 句。說明為什麼官方答案正確（關鍵步驟、關鍵字句或判斷依據），必要時點出最容易誤選的選項錯在哪。數學要寫出關鍵算式；英語用中文解說，可引用關鍵英文字詞。不要長段照抄文章原文，用自己的話說明即可。
- `flag`：平常為 null。只有當你仔細看過原題圖後，確信官方答案與題目對不上（例如答案選項根本不成立），才寫一句原因。**絕對不要改 answer**。
- `text_issue`：平常為 null。若 JSON 的 `question_text` 或 `options` 跟原題圖有實質差異（數字、選項內容錯、缺關鍵條件），簡短寫出差在哪；純排版或改寫措辭不算。

## 輸出
寫到 `C:\Users\c0787\Desktop\App專案\02_其他App\704_會考複習\_pipeline\review\{YEAR}_{SUBJECT}.json`，格式：
```
{ "<id>": {"explanation": "...", "flag": null, "text_issue": null}, ... }
```
- **每完成約 8 題就把目前所有結果寫回檔案一次**（覆寫整個檔），避免中途中斷全部白做。
- 開始前若檔案已存在，讀進來，跳過已有 explanation 的題目，只補缺的（可續跑）。
- 全部做完後讀回檔案確認是合法 JSON、題數等於該年題數。

## 並行注意（很重要）
- 同時有十幾個 agent 在跑，共用同一個 scratchpad。你自己寫的任何暫存檔／腳本，檔名一律加上 `{YEAR}_{SUBJECT}_` 前綴（例如 `{YEAR}_{SUBJECT}_merge.py`），不要用 `merge.py`、`b1.json` 這類通用名稱。
- 只寫你自己的輸出檔 `{YEAR}_{SUBJECT}.json`，不要動其他年份或科目的檔案。
- 若某張圖暫時讀不到，稍等再讀，不要當成題目沒有圖。

## 回報（簡短）
完成題數／應有題數、flag 幾題（列出 id 與原因）、text_issue 幾題（列 id）。
