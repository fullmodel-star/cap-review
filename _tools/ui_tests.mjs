/**
 * 704 會考複習 · 瀏覽器層功能走查（安全網）
 *
 *   node _tools/ui_tests.mjs                     → 對專案根目錄跑
 *   node _tools/ui_tests.mjs --dir=<另一個資料夾>  → 對部署包／故意弄壞的副本跑（相對於專案根或絕對路徑）
 *
 * 2026-10-03 建立：這支 App 已上線但沒有自動測試。之後改外觀或改資料前，先把「功能照樣能用」
 * 釘成測試——下面每一項改完都必須照樣通過。寫法沿用 605 500碗的 ui_tests.mjs（以及 609 踩過的坑）：
 * - 不用 --virtual-time-budget：會讓斷言跑在重繪之前。一律真實時間輪詢（until）。
 * - 自己起 http server 並送 Cache-Control: no-store；直接試綁埠，不先探測（Windows SO_REUSEADDR 會綁到別人的埠）。
 * - addScriptToEvaluateOnNewDocument 會累積：每次 open 先移除上一支，整段包 IIFE；alert/confirm 一律攔截。
 * - 「首訪不重整」數主框架導覽次數（在頁面上做記號會被重整搶先，舊版照樣通過）。
 * - 每條斷言印出樣本數或實際值，避免「空集合讓測試假通過」。
 *
 * 對答案的「標準答案」不拿 App 自己的題庫欄位，而是讀 data/answers_<年>.json（官方答案 PDF 抽出的獨立檔），
 * 測試開頭先確認兩邊 2247 題完全一致；畫面上標成正解的選項必須等於官方答案。
 * 進度存在 IndexedDB（capReviewDB / progress），每次執行用全新的 Chrome profile，所以一開始一定是空的。
 *
 * 2026-10-19 版面美化「闖關考場」新增第 8 節（照 605 第 13、14 節）：主視覺與唯一主鈕、粉圓字型載入且有用到、
 * 每種 3D 圖實際載入（不用 img.complete，lazy 圖會假失敗）、狀態列數字＝IndexedDB、操作元件沒有 emoji、
 * 深色模式、桌機兩欄＋分頁收進頁首不蓋卡片、無水平捲動。第 7 節的「只連本機」放在最後，涵蓋第 8 節。
 */
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dirArg = process.argv.find((a) => a.startsWith('--dir='));
const ROOT = path.resolve(HERE, '..', dirArg ? dirArg.slice(6) : '.');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css',
  '.txt': 'text/plain', '.woff2': 'font/woff2' };

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : '')); }
}

/* ── 磁碟上的資料（測試的「標準答案」） ── */
const SUBJ = [['chinese', '國文'], ['english_read', '英語閱讀'], ['math', '數學'], ['social', '社會'], ['science', '自然']];
const NAME = Object.fromEntries(SUBJ);
const KEY_OF = Object.fromEntries(SUBJ.map(([k, n]) => [n, k]));
const YEARS = ['105', '106', '107', '108', '109', '110', '111', '112', '113', '114'];
const readJSON = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const BANK = {}, NOTES = {}, OFFICIAL = {};
for (const [k] of SUBJ) { BANK[k] = readJSON(`data/questionbank_${k}.json`).questions; NOTES[k] = readJSON(`data/concept_notes_${k}.json`); }
for (const y of YEARS) OFFICIAL[y] = readJSON(`data/answers_${y}.json`);
const WRITING = readJSON('data/writing.json');
const TOTAL = SUBJ.reduce((s, [k]) => s + BANK[k].length, 0);
const official = (subj, year, qno) => (OFFICIAL[year] && OFFICIAL[year][subj] || {})[String(qno)];

/* ── 靜態伺服器：直接試綁，失敗換下一個 ── */
async function startServer() {
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const rel = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname);
    const p = path.join(ROOT, rel);
    if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    try {
      const b = await readFile(p);
      res.writeHead(200, { 'content-type': TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(b);
    } catch { res.writeHead(404); res.end(); }
  });
  for (let port = 8820; port < 8860; port++) {
    const okBind = await new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (okBind) return { server, port };
  }
  throw new Error('找不到可用的埠');
}

/* ── 最小 CDP 用戶端 ── */
const LOADED = `document.querySelectorAll('#notesArea .card').length > 0 && /已練\\s*\\d+\\s*\\/\\s*\\d+/.test(document.getElementById('hdrSub').textContent||'')`;
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiters = new Map(); this.errors = []; this.requests = []; this.initScript = null; this.navs = 0; }
  static async connect(debugPort) {
    let target = null;
    for (let i = 0; i < 40 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
        target = list.find((t) => t.type === 'page');
      } catch { /* Chrome 還沒起來 */ }
      if (!target) await sleep(250);
    }
    if (!target) throw new Error('接不上 Chrome 的 CDP');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.waiters.has(m.id)) { c.waiters.get(m.id)(m); c.waiters.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') {
        c.errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'unknown');
      }
      if (m.method === 'Network.requestWillBeSent') c.requests.push(m.params.request.url);
      // 主框架每完成一次導覽（含 location.reload）就 +1；用來抓「頁面自己重整」
      if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId && /^http/.test(m.params.frame.url)) c.navs++;
    };
    await c.send('Runtime.enable');
    await c.send('Page.enable');
    await c.send('Network.enable');
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    // 20 秒沒回應就當失敗（App 被改壞時頁面內的 Promise 可能永遠不 resolve，不可讓整支測試卡死）
    return new Promise((res) => {
      const t = setTimeout(() => { this.waiters.delete(id); res({ result: { exceptionDetails: { text: `CDP ${method} 逾時 20 秒` } } }); }, 20000);
      this.waiters.set(id, (m) => { clearTimeout(t); res(m); });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  }
  async until(expr, ms = 8000, step = 150) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (await this.eval(expr)) return true; } catch { /* 還沒 ready */ }
      await sleep(step);
    }
    return false;
  }
  async width(w, h = 844) {
    await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    await sleep(200);
  }
  /** 開頁面：攔 alert/confirm（在頁面任何程式碼之前）。進度在 IndexedDB，不在這裡清——要靠它驗「重新整理後仍在」。 */
  async open(url) {
    if (this.initScript) await this.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.initScript });
    const r = await this.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      window.__alerts = [];
      window.alert = (m) => { window.__alerts.push(String(m)); };
      window.confirm = (m) => { window.__alerts.push('confirm:' + String(m)); return true; };
    })();` });
    this.initScript = r.result && r.result.identifier;
    await this.send('Page.navigate', { url });
    return this.until(LOADED, 15000);
  }
  /** 重新整理：先在舊文件放記號，等新文件（沒有記號）載完才算 */
  async reload() {
    await this.eval(`window.__oldDoc = 1`);
    await this.send('Page.reload', { ignoreCache: false });
    return this.until(`!window.__oldDoc && (${LOADED})`, 15000);
  }
}

// 整支測試的保險絲：正常約 10 秒跑完，超過 4 分鐘一定是卡住了
const WATCHDOG = setTimeout(async () => { console.log('  FAIL 測試整體逾時（4 分鐘）'); console.log('\nFAIL　通過 ' + pass + ' 項，失敗 ' + (fail + 1) + ' 項'); await cleanup(); process.exit(1); }, 240000);
const { server, port } = await startServer();
const BASE = `http://127.0.0.1:${port}/`;
const profile = await mkdtemp(path.join(tmpdir(), 'capreview-ui-'));
const DEBUG_PORT = 9300 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let c;
async function cleanup() {
  // 先請 Chrome 自己關（kill 只殺主行程，子行程還抓著 profile 檔案，暫存資料夾會刪不掉）
  const exited = chrome.exitCode !== null ? Promise.resolve() : new Promise((r) => chrome.once('exit', r));
  try { if (c) c.ws.send(JSON.stringify({ id: 999999, method: 'Browser.close' })); } catch {}
  await Promise.race([exited, sleep(4000)]);
  try { chrome.kill(); } catch {}
  server.close();
  await sleep(300);
  for (let i = 0; i < 20; i++) { try { await rm(profile, { recursive: true, force: true }); break; } catch { await sleep(300); } }
}

/* 頁面內讀 IndexedDB（不透過 App 的函式，獨立驗證真的寫進去了） */
const IDB_ALL = `new Promise(r=>{const o=indexedDB.open('capReviewDB');o.onerror=()=>r(null);o.onsuccess=()=>{const d=o.result;if(!d.objectStoreNames.contains('progress')){d.close();r([]);return;}const t=d.transaction('progress').objectStore('progress').getAll();t.onsuccess=()=>{d.close();r(t.result)};t.onerror=()=>{d.close();r(null)}}})`;
const hdr = () => c.eval(`(()=>{const m=(document.getElementById('hdrSub').textContent||'').match(/已練\\s*(\\d+)\\s*\\/\\s*(\\d+)/); return m?[+m[1],+m[2]]:null})()`);
const poolText = () => c.eval(`(()=>{const m=(document.getElementById('practiceArea').textContent||'').match(/符合\\s*(\\d+)\\s*題，已練過\\s*(\\d+)\\s*題/); return m?[+m[1],+m[2]]:null})()`);
const clickText = (sel, text) => c.eval(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.trim().includes(${JSON.stringify(text)})); if(!e) return false; e.click(); return true})()`);
const tab = async (name) => { await c.eval(`document.querySelector('nav.tabs button[data-tab="${name}"]').click()`); await c.until(`document.getElementById('page-${name}').classList.contains('on')`, 3000);
  // 2026-10-12：題庫改成進練習／複習才載入，等「題庫載入中…」消失才算分頁就緒
  await c.until(`!/題庫載入中/.test(document.getElementById('page-${name}').textContent)`, 15000); };
/** 練習首頁：選科目＋年份（'all' 表示全部） */
async function setPractice(subjKey, year) {
  await tab('practice');
  const before = await poolText();
  await clickText('#practiceArea .chip', subjKey === 'all' ? '全科' : NAME[subjKey]);
  await c.until(`!!document.querySelector('#practiceArea .chip.on') && document.querySelector('#practiceArea .chip.on').textContent.includes(${JSON.stringify(subjKey === 'all' ? '全科' : NAME[subjKey])})`, 3000);
  await c.eval(`(()=>{const s=document.querySelector('#practiceArea select'); s.value=${JSON.stringify(year)}; s.dispatchEvent(new Event('change',{bubbles:true})); return 1})()`);
  await c.until(`document.querySelector('#practiceArea select').value === ${JSON.stringify(year)}`, 3000);
  return before;
}
/** 目前出題卡的身分（從畫面上讀，不讀 App 變數） */
const cardId = (area) => c.eval(`(()=>{const sp=[...document.querySelectorAll('#${area} .row.small.muted span')]; const t=sp.map(s=>s.textContent).join(' '); const m=t.match(/(\\d{3})年\\s*(\\S+?)\\s*第(\\d+)題/); const n=t.match(/(\\d+)\\s*\\/\\s*(\\d+)/); return m?{year:m[1], subj:m[2], qno:m[3], idx:n?+n[1]:null, len:n?+n[2]:null}:null})()`);

try {
  console.log('\n[0 測試前提：資料檔]');
  let mism = 0;
  for (const [k] of SUBJ) for (const q of BANK[k]) if (official(k, q.year, q.q_no) !== q.answer) mism++;
  ok(`0.1 題庫 ${TOTAL} 題的答案與官方答案檔（answers_<年>.json）逐題一致（不一致 ${mism} 題）`, TOTAL > 2000 && mism === 0, { TOTAL, mism });

  c = await CDP.connect(DEBUG_PORT);
  await c.width(390);

  const meta = readJSON('data/meta.json');
  ok(`0.2 data/meta.json 各科題數＝題庫實際題數（${JSON.stringify(meta.total)}）`, SUBJ.every(([k]) => meta.total[k] === BANK[k].length), meta);

  console.log('\n[1 載入與筆記]');
  c.navs = 0;
  const loaded = await c.open(BASE);
  const h0 = await hdr();
  ok(`1.1 載入完成：頁首「已練 0 / ${TOTAL}」（實際 ${JSON.stringify(h0)}）`, loaded && !!h0 && h0[0] === 0 && h0[1] === TOTAL, h0);
  ok('1.2 預設在筆記分頁', await c.eval(`document.getElementById('page-notes').classList.contains('on') && document.querySelector('nav.tabs button.on').dataset.tab==='notes'`));
  const noteChips = await c.eval(`[...document.querySelectorAll('#notesArea .chip')].map(e=>e.textContent.trim())`);
  ok(`1.3 筆記科目標籤：五科＋作文題目（${noteChips.length} 個：${noteChips.join('、')}）`,
    noteChips.length === 6 && SUBJ.every(([, n]) => noteChips.some((t) => t.includes(n))) && noteChips.some((t) => t.includes('作文')), noteChips);
  const cn0 = await c.eval(`document.querySelectorAll('#notesDetail .card').length`);
  ok(`1.4 國文觀念卡片數＝concept_notes 筆數（畫面 ${cn0}／檔案 ${NOTES.chinese.length}）`, cn0 > 0 && cn0 === NOTES.chinese.length, cn0);
  await clickText('#notesArea .chip', '數學');
  await c.until(`document.querySelector('#notesArea .chip.on').textContent.includes('數學')`, 3000);
  const mathNotes = await c.eval(`[document.querySelectorAll('#notesDetail .card').length, (document.getElementById('notesDetail').textContent.match(/共\\s*(\\d+)\\s*題/)||[])[1], document.querySelector('#notesDetail .card h2').textContent]`);
  ok(`1.5 切到數學：觀念 ${mathNotes[0]} 個（檔案 ${NOTES.math.length}）、共 ${mathNotes[1]} 題（檔案 ${BANK.math.length}）、第一個＝「${mathNotes[2]}」`,
    mathNotes[0] === NOTES.math.length && +mathNotes[1] === BANK.math.length && mathNotes[2].includes(NOTES.math[0].concept), mathNotes);
  const freqs = await c.eval(`[...document.querySelectorAll('#notesDetail .card')].map(e=>+((e.textContent.match(/出現\\s*(\\d+)\\s*次/)||[])[1]))`);
  ok(`1.6 觀念依出現次數由多到少排（${freqs.length} 個：${freqs.slice(0, 6).join(',')}…）`, freqs.length > 5 && freqs.every((f, i) => Number.isFinite(f) && (i === 0 || f <= freqs[i - 1])), freqs.slice(0, 10));
  await clickText('#notesArea .chip', '作文');
  await c.until(`document.querySelector('#notesArea .chip.on').textContent.includes('作文')`, 3000);
  const wr = await c.eval(`[...document.querySelectorAll('#notesDetail .card h2')].map(e=>e.textContent)`);
  ok(`1.7 作文題目：${wr.length} 篇（檔案 ${WRITING.length}），最新一年在最上面（${wr[0]}）`, wr.length === WRITING.length && wr.length > 0 && wr[0].startsWith(WRITING[WRITING.length - 1].year), wr.slice(0, 2));
  // 1.8 首次造訪：sw activate 的 clients.claim() 會觸發 controllerchange；不可因此自己重整
  const controlled = await c.until(`!!(navigator.serviceWorker && navigator.serviceWorker.controller)`, 10000);
  await sleep(2000);
  ok('1.8 🔴 第一次造訪時 Service Worker 接管後，頁面不會自己重整（導覽次數＝1，實測 ' + c.navs + '）',
    controlled && c.navs === 1, { controlled, navs: c.navs });

  console.log('\n[2 練習：科目／年份／觀念篩選]');
  await tab('practice');
  const p0 = await poolText();
  ok(`2.1 練習首頁：全科符合 ${p0 && p0[0]} 題（應＝${TOTAL}）、已練過 0`, !!p0 && p0[0] === TOTAL && p0[1] === 0, p0);
  await setPractice('math', 'all');
  const p1 = await poolText();
  ok(`2.2 選數學：符合 ${p1 && p1[0]} 題（檔案 ${BANK.math.length}）`, !!p1 && p1[0] === BANK.math.length && p1[0] < TOTAL, p1);
  const want110 = BANK.math.filter((q) => q.year === '110');
  await setPractice('math', '110');
  await c.until(`(document.getElementById('practiceArea').textContent.match(/符合\\s*(\\d+)/)||[])[1] === '${want110.length}'`, 3000);
  const p2 = await poolText();
  ok(`2.3 數學＋110 年：符合 ${p2 && p2[0]} 題（檔案 ${want110.length}）`, !!p2 && p2[0] === want110.length && want110.length > 0, p2);
  await clickText('#practiceArea button', '開始練習');
  await c.until(`!!document.querySelector('#practiceArea .ansgrid button')`, 4000);
  const q2 = await c.eval(`session && session.queue.map(q=>[q.subject,q.year,+q.q_no])`);
  const id2 = await cardId('practiceArea');
  ok(`2.4 單一科目＋單一年份照題號順序出題（${q2 && q2.length} 題，第一張畫面＝${id2 && id2.year}年${id2 && id2.subj}第${id2 && id2.qno}題）`,
    !!q2 && q2.length === want110.length && q2.every((x, i) => x[0] === 'math' && x[1] === '110' && (i === 0 || x[2] > q2[i - 1][2]))
    && !!id2 && id2.qno === '1' && id2.subj === '數學' && id2.len === want110.length, { len: q2 && q2.length, id2 });
  // 觀念篩選：回首頁、年份改全部、選第 3 個觀念
  await tab('practice');
  await setPractice('science', 'all');
  const cIdx = 2, cName = NOTES.science[cIdx].concept;
  const wantC = BANK.science.filter((q) => q.concept_tag === cName);
  const hasConceptSel = await c.eval(`document.querySelectorAll('#practiceArea select').length === 2`);
  await c.eval(`(()=>{const s=document.querySelectorAll('#practiceArea select')[1]; s.value='${cIdx}'; s.dispatchEvent(new Event('change',{bubbles:true})); return 1})()`);
  await c.until(`(document.getElementById('practiceArea').textContent.match(/符合\\s*(\\d+)/)||[])[1] === '${wantC.length}'`, 3000);
  const p3 = await poolText();
  ok(`2.5 自然＋觀念「${cName}」：符合 ${p3 && p3[0]} 題（檔案 ${wantC.length}）`, hasConceptSel && !!p3 && p3[0] === wantC.length && wantC.length > 0 && wantC.length < BANK.science.length, p3);
  await clickText('#practiceArea button', '開始練習');
  await c.until(`!!document.querySelector('#practiceArea .ansgrid button')`, 4000);
  const q3 = await c.eval(`session.queue.map(q=>q.id)`);
  const wantCIds = new Set(wantC.map((q) => q.id));
  ok(`2.6 觀念練習的題目全部屬於該觀念（${q3.length} 題）`, q3.length === wantC.length && q3.every((id) => wantCIds.has(id)), q3.slice(0, 3));
  // 筆記的「練這個觀念」
  await tab('notes');
  await clickText('#notesArea .chip', '社會');
  await c.until(`document.querySelector('#notesArea .chip.on').textContent.includes('社會')`, 3000);
  await clickText('#notesDetail button', '練這個觀念');
  await c.until(`document.getElementById('page-practice').classList.contains('on') && !!document.querySelector('#practiceArea .ansgrid button')`, 4000);
  const sName = NOTES.social[0].concept, wantS = BANK.social.filter((q) => q.concept_tag === sName);
  const q4 = await c.eval(`session.queue.map(q=>q.concept_tag)`);
  ok(`2.7 筆記按「練這個觀念」→ 切到練習且題目全是「${sName}」（${q4.length} 題，檔案 ${wantS.length}）`, q4.length === wantS.length && q4.length > 0 && q4.every((t) => t === sName), q4.slice(0, 3));

  console.log('\n[3 作答與對答案（標準答案＝官方答案檔）]');
  // 每科照題號作答，偶數張選正解、奇數張故意選錯；英語閱讀 110 年做到第 15 題（第一題題組文章題）；
  // 社會 110 年第 3 題有已知轉寫錯誤（text_issue），用來驗「文字版」要藏起來
  const PLAN = [['chinese', '114', 3], ['english_read', '110', 15], ['math', '105', 2], ['social', '110', 3], ['science', '110', 2]];
  const answered = [];   // {id, subj, year, qno, picked, truth, resultOk, resultText, correctBtn, disabled, explain, textVer, textIssue, img, group}
  for (const [subj, year, n] of PLAN) {
    await setPractice(subj, year);
    await clickText('#practiceArea button', '開始練習');
    for (let i = 0; i < n; i++) {
      await c.until(`!!document.querySelector('#practiceArea .ansgrid button:not([disabled])')`, 4000);
      const id = await cardId('practiceArea');
      const qno = id ? id.qno : '?';
      const truth = official(subj, year, qno);
      const bq = BANK[subj].find((q) => q.year === year && q.q_no === qno) || {};
      const img = await c.until(`(()=>{const i=document.querySelector('#practiceArea .card .qimg'); return !!i && i.complete && i.naturalWidth>0})()`, 8000)
        ? await c.eval(`document.querySelector('#practiceArea .card .qimg').getAttribute('src')`) : null;
      let group = null;
      if (bq.group_img) {
        group = await c.until(`(()=>{const i=document.querySelector('#practiceArea details.passage img'); return !!i && i.complete && i.naturalWidth>0})()`, 8000)
          ? await c.eval(`document.querySelector('#practiceArea details.passage img').getAttribute('src')`) : 'BROKEN';
      }
      const letters = await c.eval(`[...document.querySelectorAll('#practiceArea .ansgrid button')].map(b=>b.textContent.trim())`);
      const pickL = i % 2 === 0 ? truth : letters.find((l) => l !== truth);
      await clickText('#practiceArea .ansgrid button', pickL);
      await c.until(`!!document.querySelector('#practiceArea .result')`, 4000);
      const r = await c.eval(`(()=>{const a=document.getElementById('practiceArea'); const res=a.querySelector('.result');
        const ex=[...a.querySelectorAll('.card')].find(e=>e.querySelector('h2') && e.querySelector('h2').textContent.includes('解析'));
        return { ok: !!res && res.classList.contains('ok'), bad: !!res && res.classList.contains('bad'), text: res?res.textContent.trim():'',
          correctBtn: [...a.querySelectorAll('.ansgrid .ans.correct')].map(b=>b.textContent.trim()),
          wrongBtn: [...a.querySelectorAll('.ansgrid .ans.wrong')].map(b=>b.textContent.trim()),
          disabled: [...a.querySelectorAll('.ansgrid button')].every(b=>b.disabled),
          explain: ex ? (ex.querySelector('.explain')||{}).textContent||'' : '',
          textVer: [...a.querySelectorAll('details.passage summary')].some(s=>s.textContent.includes('文字版')),
          hasNext: [...a.querySelectorAll('button')].some(b=>b.textContent.includes('下一題')) } })()`);
      answered.push({ id: `${year}_${subj}_${qno}`, subj, year, qno, idx: id && id.idx, picked: pickL, truth, ...r, textIssue: !!bq.text_issue, img, group });
      if (i < n - 1) { await clickText('#practiceArea button', '下一題'); await c.until(`!!document.querySelector('#practiceArea .ansgrid button:not([disabled])')`, 4000); }
    }
  }
  const rights = answered.filter((a) => a.picked === a.truth), wrongs = answered.filter((a) => a.picked !== a.truth);
  ok(`3.1 依序出題：每科第 k 張就是第 k 題（${answered.length} 張）`, answered.length === PLAN.reduce((s, p) => s + p[2], 0) && PLAN.every(([s, , n]) => answered.filter((a) => a.subj === s).every((a, k) => a.qno === String(k + 1) && a.idx === k + 1)), answered.map((a) => a.subj[0] + a.qno).join(' '));
  ok(`3.2 選官方正解 → 顯示「✓ 答對了」（${rights.length} 題）`, rights.length >= 10 && rights.every((a) => a.ok && !a.bad && a.text.includes('答對了')), rights.filter((a) => !a.ok).map((a) => a.id));
  ok(`3.3 選錯 → 顯示「✗ 你選 X，正解是 <官方答案>」（${wrongs.length} 題）`, wrongs.length >= 10 && wrongs.every((a) => a.bad && !a.ok && a.text.includes(`你選 ${a.picked}，正解是 ${a.truth}`)), wrongs.filter((a) => !a.bad || !a.text.includes(`正解是 ${a.truth}`)).map((a) => [a.id, a.text.slice(0, 30)]));
  ok(`3.4 標成正解（綠框）的選項＝官方答案、且只有一個（${answered.length} 題）`, answered.length > 0 && answered.every((a) => a.correctBtn.length === 1 && a.correctBtn[0] === a.truth), answered.filter((a) => a.correctBtn[0] !== a.truth).map((a) => [a.id, a.correctBtn, a.truth]));
  ok(`3.5 選錯時只有自己選的那顆標紅（${wrongs.length} 題）；選對時沒有紅框（${rights.length} 題）`,
    wrongs.length > 0 && wrongs.every((a) => a.wrongBtn.length === 1 && a.wrongBtn[0] === a.picked) && rights.every((a) => a.wrongBtn.length === 0), answered.filter((a) => a.picked === a.truth ? a.wrongBtn.length : a.wrongBtn[0] !== a.picked).map((a) => a.id));
  ok(`3.6 作答後 A–D 全部鎖住、出現「下一題」（${answered.length} 題）`, answered.length > 0 && answered.every((a) => a.disabled && a.hasNext), answered.filter((a) => !a.disabled || !a.hasNext).map((a) => a.id));
  ok(`3.7 每題都顯示解析且非「整理中」（${answered.length} 題，最短 ${Math.min(...answered.map((a) => a.explain.length))} 字）`, answered.length > 0 && answered.every((a) => a.explain.length >= 10 && !a.explain.includes('整理中')), answered.filter((a) => a.explain.length < 10).map((a) => a.id));
  const tvSample = answered.filter((a) => a.textIssue).length;
  ok(`3.8 「文字版」只在沒有已知轉寫錯誤的題目出現（有 text_issue ${tvSample} 題、沒有 ${answered.length - tvSample} 題）`, tvSample >= 1 && answered.length - tvSample >= 1 && answered.every((a) => a.textVer === !a.textIssue), answered.filter((a) => a.textVer === a.textIssue).map((a) => a.id));

  console.log('\n[4 題目圖片]');
  const imgOk = answered.filter((a) => a.img && a.img === `assets/q/${a.id}.jpg`);
  ok(`4.1 原題圖真的載入（naturalWidth>0），且是該題的圖（抽樣 ${imgOk.length}/${answered.length} 張，五科都有）`,
    answered.length > 0 && imgOk.length === answered.length && SUBJ.every(([k]) => imgOk.some((a) => a.subj === k)), answered.filter((a) => !a.img || a.img !== `assets/q/${a.id}.jpg`).map((a) => [a.id, a.img]));
  const groups = answered.filter((a) => a.group !== null);
  ok(`4.2 題組文章圖載入（抽樣 ${groups.length} 張：${groups.map((a) => a.id).join(',')}）`, groups.length >= 1 && groups.every((a) => a.group && a.group !== 'BROKEN' && a.group.includes('assets/g/')), groups.map((a) => [a.id, a.group]));
  const zoomBtn = await clickText('#practiceArea button', '看原頁');
  const zoomOk = zoomBtn && await c.until(`document.getElementById('zoom').classList.contains('on') && document.getElementById('zoomImg').complete && document.getElementById('zoomImg').naturalWidth>0`, 8000);
  const zoomSrc = await c.eval(`document.getElementById('zoomImg').getAttribute('src')`);
  ok(`4.3 「看原頁」開啟放大檢視且整頁圖載入（${zoomSrc}）`, zoomOk && /assets\/page\//.test(zoomSrc || ''), { zoomBtn, zoomSrc });
  await c.eval(`document.querySelector('#zoom .close').click()`);
  ok('4.4 放大檢視可以關閉', await c.until(`!document.getElementById('zoom').classList.contains('on')`, 2000));
  await c.eval(`document.querySelector('#practiceArea .card .qimg').click()`);
  const zq = await c.until(`document.getElementById('zoom').classList.contains('on') && /assets\\/q\\//.test(document.getElementById('zoomImg').getAttribute('src')||'') && document.getElementById('zoomImg').naturalWidth>0`, 4000);
  ok('4.5 點原題圖也能放大', zq);
  await c.eval(`document.getElementById('zoom').click()`);
  await c.until(`!document.getElementById('zoom').classList.contains('on')`, 2000);

  console.log('\n[5 進度／錯題記錄]');
  const recs = await c.eval(IDB_ALL);
  const wrongIds = new Set(wrongs.map((a) => a.id)), allIds = new Set(answered.map((a) => a.id));
  ok(`5.1 IndexedDB 寫入 ${recs && recs.length} 筆（作答 ${answered.length} 題），id 一一對應`, !!recs && recs.length === answered.length && recs.every((r) => allIds.has(r.id)), recs && recs.map((r) => r.id).slice(0, 5));
  const recWrong = (recs || []).filter((r) => (r.wrongCount || 0) > 0);
  ok(`5.2 記錄內容：答錯 ${recWrong.length} 筆 wrongCount=1／streak=0；答對 ${(recs || []).length - recWrong.length} 筆 streak=1`,
    !!recs && recWrong.length === wrongs.length && recWrong.every((r) => wrongIds.has(r.id) && r.streak === 0 && r.reviewCount === 1)
    && recs.filter((r) => !wrongIds.has(r.id)).every((r) => r.streak === 1 && !(r.wrongCount > 0) && r.nextReview > Date.now()), (recs || []).slice(0, 2));
  const h1 = await hdr();
  ok(`5.3 頁首「已練 ${h1 && h1[0]} / ${h1 && h1[1]}」跟著更新`, !!h1 && h1[0] === answered.length && h1[1] === TOTAL, h1);
  const navBefore = c.navs;
  const reloaded = await c.reload();
  const recs2 = await c.eval(IDB_ALL), h2 = await hdr();
  ok(`5.4 重新整理後記錄仍在（IndexedDB ${recs2 && recs2.length} 筆、頁首已練 ${h2 && h2[0]}）`, reloaded && c.navs === navBefore + 1 && !!recs2 && recs2.length === answered.length && !!h2 && h2[0] === answered.length, { reloaded, h2, n: recs2 && recs2.length });
  await setPractice('english_read', '110');
  const p5 = await poolText();
  const enDone = answered.filter((a) => a.subj === 'english_read').length, en110 = BANK.english_read.filter((q) => q.year === '110').length;
  ok(`5.5 練習首頁「已練過」從記錄算出：英語閱讀 110 年 ${p5 && p5[1]} 題（應 ${enDone}）`, !!p5 && p5[0] === en110 && p5[1] === enDone && enDone > 0, p5);
  await clickText('#practiceArea button', '只練沒做過的');
  await c.until(`!!document.querySelector('#practiceArea .ansgrid button')`, 4000);
  const q5 = await c.eval(`session.queue.map(q=>q.id)`);
  ok(`5.6 「只練沒做過的」排除已作答（${q5.length} 題＝${en110}−${enDone}，且不含做過的）`, q5.length === en110 - enDone && q5.length > 0 && q5.every((id) => !allIds.has(id)), q5.slice(0, 3));

  await tab('review');
  const rv = await c.eval(`(()=>{const t=document.getElementById('reviewArea').textContent; return {due:+((t.match(/今日到期\\s*(\\d+)/)||[])[1]??-1), wrong:+((t.match(/所有錯題\\s*(\\d+)/)||[])[1]??-1), empty: t.includes('目前沒有到期的錯題')}})()`);
  ok(`5.7 錯題複習：今日到期 ${rv.due}（剛答錯的明天才到期）、所有錯題 ${rv.wrong}（應 ${wrongs.length}）`, rv.due === 0 && rv.empty && rv.wrong === wrongs.length && wrongs.length > 0, rv);
  await clickText('#reviewArea button', '所有錯題');
  await c.until(`!!document.querySelector('#reviewArea .ansgrid button')`, 4000);
  const rq = await c.eval(`session.queue.map(q=>q.id)`);
  const rid = await cardId('reviewArea');
  ok(`5.8 「所有錯題」佇列＝答錯的那 ${rq.length} 題（第一張畫面＝${rid && rid.year}年${rid && rid.subj}第${rid && rid.qno}題）`,
    rq.length === wrongs.length && rq.every((id) => wrongIds.has(id)) && !!rid && wrongIds.has(`${rid.year}_${KEY_OF[rid.subj]}_${rid.qno}`), rq.slice(0, 4));
  const subjChips = await c.eval(`[...document.querySelectorAll('#reviewArea .chip')].map(e=>e.textContent.trim())`);
  await clickText('#reviewArea .chip', '數學');
  await c.until(`!!document.querySelector('#reviewArea .chip.on') && document.querySelector('#reviewArea .chip.on').textContent.includes('數學')`, 3000);
  const mathWrong = wrongs.filter((a) => a.subj === 'math');
  const rvM = await c.eval(`[+((document.getElementById('reviewArea').textContent.match(/所有錯題\\s*(\\d+)/)||[])[1]??-1), session.queue.map(q=>q.subject)]`);
  ok(`5.9 錯題依科目篩選：標籤 ${subjChips.length} 個（全部＋5科）；選數學 → 錯題 ${rvM[0]}（應 ${mathWrong.length}）`,
    subjChips.length === 6 && rvM[0] === mathWrong.length && mathWrong.length > 0 && rvM[1].length === mathWrong.length && rvM[1].every((s) => s === 'math'), { subjChips, rvM });
  // 在複習裡答對那題數學錯題 → streak 1、reviewCount 2，寫回 IndexedDB
  const mid = await cardId('reviewArea');
  const mkey = mid ? `${mid.year}_${KEY_OF[mid.subj]}_${mid.qno}` : '?';
  await clickText('#reviewArea .ansgrid button', official('math', mid && mid.year, mid && mid.qno) || 'Z');
  await c.until(`!!document.querySelector('#reviewArea .result')`, 4000);
  const mrec = await c.until(`${IDB_ALL}.then(a=>{const r=(a||[]).find(x=>x.id===${JSON.stringify(mkey)}); return !!r && r.streak===1 && r.reviewCount===2 && r.wrongCount===1})`, 3000);
  ok(`5.10 錯題在複習中答對 → 記錄 streak=1、reviewCount=2（${mkey}）`, mrec && await c.eval(`!!document.querySelector('#reviewArea .result.ok')`), mkey);
  // 模擬「到了明天」：把一題錯題的 nextReview 改成昨天，重新整理後應出現在今日到期
  const dueId = wrongs.find((a) => a.subj === 'science').id;
  await c.eval(`new Promise(r=>{const o=indexedDB.open('capReviewDB');o.onsuccess=()=>{const d=o.result;const s=d.transaction('progress','readwrite').objectStore('progress');const g=s.get(${JSON.stringify(dueId)});g.onsuccess=()=>{const v=g.result;if(!v){d.close();r(0);return;}v.nextReview=Date.now()-2*86400000;const p=s.put(v);p.onsuccess=()=>{d.close();r(1)};p.onerror=()=>{d.close();r(0)}};g.onerror=()=>{d.close();r(0)}};o.onerror=()=>r(0)})`);
  await c.reload();
  await tab('review');
  await c.until(`!!document.querySelector('#reviewArea .ansgrid button') || document.getElementById('reviewArea').textContent.includes('目前沒有')`, 4000);
  const due1 = await c.eval(`[+((document.getElementById('reviewArea').textContent.match(/今日到期\\s*(\\d+)/)||[])[1]??-1), session && session.queue.map(q=>q.id), (document.getElementById('hdrSub').textContent.match(/今日待複習\\s*(\\d+)/)||[])[1]]`);
  ok(`5.11 到期的錯題出現在「今日到期」（${due1[0]} 題＝${(due1[1] || []).join(',')}），頁首顯示今日待複習 ${due1[2]}`,
    due1[0] === 1 && Array.isArray(due1[1]) && due1[1].length === 1 && due1[1][0] === dueId && due1[2] === '1', due1);

  console.log('\n[6 版面：手機寬度]');
  for (const w of [360, 390]) {
    await c.width(w);
    await c.open(BASE);
    const sw = async () => c.eval(`[document.documentElement.scrollWidth, window.innerWidth]`);
    const s1 = await sw();
    await setPractice('social', '114');
    const s2 = await sw();
    await clickText('#practiceArea button', '開始練習');
    await c.until(`(()=>{const i=document.querySelector('#practiceArea .card .qimg'); return !!i && i.complete && i.naturalWidth>0})()`, 8000);
    await c.eval(`document.querySelector('#practiceArea .ansgrid button').click()`);
    await c.until(`!!document.querySelector('#practiceArea .result')`, 4000);
    const s3 = await sw();
    ok(`6.${w}a ${w}px 筆記／練習首頁／作答後出題卡都沒有水平捲動（${JSON.stringify([s1, s2, s3])}）`, [s1, s2, s3].every((s) => s[0] <= s[1] + 1 && s[1] === w), [s1, s2, s3]);
    const sizes = await c.eval(`[...document.querySelectorAll('nav.tabs button, #practiceArea .ansgrid button, #practiceArea .btn:not(.sm)')]
      .filter(e=>e.offsetParent).map(e=>{const r=e.getBoundingClientRect(); return {h:Math.round(r.height), w:Math.round(r.width), t:e.textContent.trim().slice(0,8)}})`);
    const small = sizes.filter((x) => x.h < 44);
    ok(`6.${w}b ${w}px 底部分頁、A–D、主要按鈕高度都 ≥ 44px（量了 ${sizes.length} 顆，最矮 ${Math.min(...sizes.map((x) => x.h))}px）`, sizes.length >= 8 && small.length === 0, small.slice(0, 5));
    const ans = sizes.filter((x) => /^[A-D]$/.test(x.t));
    ok(`6.${w}c ${w}px A–D 四顆一排且寬度 ≥ 60px（${ans.map((x) => x.w).join(',')}）`, ans.length === 4 && ans.every((x) => x.w >= 60), ans);
  }
  await c.width(390);

  console.log('\n[8 版面美化「闖關考場」（2026-10-19）]');
  // 3D 圖清單以 sw.js 的 F3D 為準（與 _tools/build_fluent3d.py 的 ICONS 一致，8.3 會交叉檢查）
  const swSrc = readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const f3dKeys = ((swSrc.match(/const F3D = \[([^\]]*)\]/) || [])[1] || '').match(/'([a-z0-9_-]+)'/g)?.map((s) => s.slice(1, -1)) || [];
  let buildKeys = [];
  try { buildKeys = [...readFileSync(path.join(HERE, 'build_fluent3d.py'), 'utf8').matchAll(/"([a-z0-9]+)":\s*"[^"]+"/g)].map((m) => m[1]); } catch { /* 部署包沒有 _tools */ }
  await c.width(390);
  await c.open(BASE);
  const hero = await c.eval(`(()=>{const h=document.querySelector('#notesArea .hero'); if(!h) return null; const r=h.getBoundingClientRect();
    const go=[...h.querySelectorAll('button')]; const g=document.querySelector('#notesArea .hero .btn.go'); const gr=g?g.getBoundingClientRect():null;
    const nav=document.querySelector('nav.tabs').getBoundingClientRect();
    return {top:Math.round(r.top), btns:go.length, goText:g?g.textContent.trim():'', goBottom:gr?Math.round(gr.bottom):null, goW:gr?Math.round(gr.width):0, heroW:Math.round(r.width), navTop:Math.round(nav.top),
      howtoOpen:!!h.querySelector('details.howto[open]'), ol:!!h.querySelector('details.howto ol'), inHeader:!!h.closest('header')}})()`);
  ok(`8.1 手機首屏：主視覺在內容區（不在黏住的頁首），裡面只有一顆主鈕「${hero && hero.goText}」、全寬（${hero && hero.goW}/${hero && hero.heroW}px），不用捲就看得到（下緣 ${hero && hero.goBottom} < 分頁上緣 ${hero && hero.navTop}），說明收在「怎麼玩？」`,
    !!hero && !hero.inHeader && hero.btns === 1 && /開始練習/.test(hero.goText) && hero.goBottom < hero.navTop && hero.goW >= hero.heroW - 60 && !hero.howtoOpen && hero.ol, hero);
  const font = await c.eval(`document.fonts.ready.then(()=>{const f=[...document.fonts].filter(x=>x.family.replace(/["']/g,'')==='CapRound');
    const use=['header .rl-title','#notesArea .hero-h','#notesArea .btn.go','nav.tabs button','#notesArea .chip.tile','#notesDetail .card h2','#notesArea .hud b'].map(s=>{const e=document.querySelector(s); return [s, e?getComputedStyle(e).fontFamily.split(',')[0].replace(/["']/g,'').trim():'(無)']});
    return {loaded:f.map(x=>x.status), use}})`);
  ok(`8.2 粉圓子集字型 CapRound 已載入（${JSON.stringify(font.loaded)}），App 名／主視覺標題／主鈕／分頁／科目圖格／觀念卡標題／狀態列都用它（${font.use.filter((u) => u[1] === 'CapRound').length}/${font.use.length}）`,
    font.loaded.includes('loaded') && font.use.every((u) => u[1] === 'CapRound'), font);
  const imgs = await c.eval(`Promise.all(${JSON.stringify(f3dKeys)}.map(k=>new Promise(r=>{const i=new Image(); i.onload=()=>r([k,i.naturalWidth]); i.onerror=()=>r([k,0]); i.src='vendor/fluent-3d/'+k+'.png?t='+Date.now();})))`);
  const domSrc = await c.eval(`[...new Set([...document.querySelectorAll('img[src*="fluent-3d/"]')].map(i=>i.getAttribute('src').replace(/^.*fluent-3d\\//,'').replace(/\\.png.*$/,'')))]`);
  const coreOk = /cap-round\.woff2/.test(swSrc) && /\.\.\.F3D/.test(swSrc);
  ok(`8.3 每種 3D 圖都真的載得出來（${imgs.filter((x) => x[1] > 0).length}/${f3dKeys.length} 種，用 new Image() 實際載入）；畫面用到的 ${domSrc.length} 種都在清單內；sw 預先快取含字型與 3D 圖；清單＝build_fluent3d.py（${buildKeys.length || '部署包略過'}）`,
    f3dKeys.length >= 10 && imgs.every((x) => x[1] > 0) && domSrc.length >= 8 && domSrc.every((k) => f3dKeys.includes(k)) && coreOk
    && (!buildKeys.length || (buildKeys.length === f3dKeys.length && buildKeys.every((k) => f3dKeys.includes(k)))), { bad: imgs.filter((x) => !x[1]), domSrc, buildKeys });
  // 8.4 狀態列數字＝IndexedDB 作答紀錄（第 3–5 節已作答過，這裡一定不是 0）
  const recs8 = await c.eval(IDB_ALL);
  const att = (recs8 || []).filter((r) => (r.reviewCount || 0) > 0);
  const want = { done: att.length, wrong: att.filter((r) => !r.mastered && (r.wrongCount || 0) > 0).length };
  const hud = await c.eval(`(()=>{const b=[...document.querySelectorAll('#notesArea .hud b')].map(e=>+e.textContent.trim()); const l=[...document.querySelectorAll('#notesArea .hud span')].map(e=>e.textContent.trim()); return {b,l, xp:(document.querySelector('#notesArea .hero .xpl')||{}).textContent||''}})()`);
  ok(`8.4 狀態列「已練 ${hud.b[0]}／錯題 ${hud.b[1]}／今日複習 ${hud.b[2]}」＝IndexedDB（已練 ${want.done}、錯題 ${want.wrong}）；主視覺進度條文字「${hud.xp.replace(/\s+/g, ' ').trim()}」`,
    want.done > 0 && want.wrong > 0 && hud.b.length === 3 && hud.b[0] === want.done && hud.b[1] === want.wrong && hud.b[2] >= 1 && new RegExp(`已練\\s*${want.done}\\s*/\\s*${TOTAL}`).test(hud.xp), { hud, want });
  // 8.5 操作元件（按鈕、分頁、科目、展開列、狀態列、作答結果）文字沒有 emoji；家族注入的頁尾不算
  const EMO = `(()=>{const re=/\\p{Extended_Pictographic}/u; return [...document.querySelectorAll('button, nav.tabs, .chip, summary, .hud, .hero, .result, .empty, .row.small.muted')].filter(e=>!e.closest('#rdgFoot') && e.offsetParent!==null && re.test(e.textContent)).map(e=>e.textContent.trim().slice(0,20))})()`;
  const emo = [];
  emo.push(...await c.eval(EMO));
  await setPractice('math', '113');
  emo.push(...await c.eval(EMO));
  await clickText('#practiceArea button', '開始練習');
  await c.until(`!!document.querySelector('#practiceArea .ansgrid button:not([disabled])')`, 4000);
  await c.eval(`document.querySelector('#practiceArea .ansgrid button').click()`);
  await c.until(`!!document.querySelector('#practiceArea .result')`, 4000);
  const scanned = await c.eval(`document.querySelectorAll('#practiceArea button, #practiceArea summary, #practiceArea .result').length`);
  emo.push(...await c.eval(EMO));
  await tab('review');
  emo.push(...await c.eval(EMO));
  ok(`8.5 筆記／練習首頁／作答後／錯題複習的操作元件沒有 emoji（作答頁掃 ${scanned} 個元件）`, scanned >= 6 && emo.length === 0, emo.slice(0, 6));
  // 8.6 深色模式：深底淺字、主視覺與主鈕還在
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await tab('notes');
  const dark = await c.eval(`(()=>{const L=c=>{const m=c.match(/\\d+(\\.\\d+)?/g).map(Number); return (0.2126*m[0]+0.7152*m[1]+0.0722*m[2])/255};
    const bg=getComputedStyle(document.body).backgroundColor, card=document.querySelector('#notesDetail .card'); const cs=getComputedStyle(card);
    return {bg:L(bg), card:L(cs.backgroundColor), txt:L(cs.color), go:!!document.querySelector('#notesArea .hero .btn.go')}})()`);
  ok(`8.6 深色模式：頁面底 ${dark.bg.toFixed(2)}、卡片底 ${dark.card.toFixed(2)} 都是深色，卡片字 ${dark.txt.toFixed(2)} 是淺色，主鈕還在`, dark.bg < 0.2 && dark.card < 0.25 && dark.txt > 0.75 && dark.go, dark);
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  // 8.7 桌機 1440：主視覺｜科目圖格兩欄、觀念卡兩欄、分頁收進頁首且不蓋任何卡片、練習首頁兩欄、沒有水平捲動
  await c.width(1440, 900);
  await c.open(BASE);
  const desk = await c.eval(`(()=>{const R=e=>e.getBoundingClientRect(); if(!document.querySelector('#notesArea .hero') || !document.querySelector('#notesArea .notes-side')) return {sw:[document.documentElement.scrollWidth, innerWidth]}; const h=R(document.querySelector('#notesArea .hero')), s=R(document.querySelector('#notesArea .notes-side'));
    const cards=[...document.querySelectorAll('#notesDetail .grid')][0]; const cc=[...cards.children].slice(0,2).map(R);
    const nav=R(document.querySelector('nav.tabs')), hdr=R(document.querySelector('header.rl-appbar'));
    const all=[...document.querySelectorAll('.card, .hero, .hud > div, .chip.tile')].map(R);
    const hit=all.filter(r=>!(r.right<=nav.left||r.left>=nav.right||r.bottom<=nav.top||r.top>=nav.bottom)).length;
    return {heroR:Math.round(h.right), sideL:Math.round(s.left), sameRow:Math.abs(h.top-s.top)<40, cardsSide: cc.length===2 && Math.abs(cc[0].top-cc[1].top)<4 && cc[0].right<=cc[1].left,
      navInHdr: nav.top>=hdr.top-1 && nav.bottom<=hdr.bottom+1, hit, sw:[document.documentElement.scrollWidth, innerWidth], usedW:Math.round(s.right-h.left)}})()`);
  await tab('practice');
  const deskP = await c.eval(`(()=>{const g=document.querySelector('#practiceArea .ph-grid'); if(!g) return null; const k=[...g.children].map(e=>e.getBoundingClientRect()); return {two:k.length===2 && Math.abs(k[0].top-k[1].top)<4 && k[0].right<=k[1].left, sw:[document.documentElement.scrollWidth, innerWidth]}})()`);
  ok(`8.7 桌機 1440：主視覺｜科目圖格同列兩欄（寬 ${desk.usedW}px）、觀念卡兩欄、分頁在頁首內且不蓋任何卡片（重疊 ${desk.hit}）、練習首頁兩欄、無水平捲動（${JSON.stringify(desk.sw)}）`,
    desk.sameRow && desk.heroR <= desk.sideL && desk.usedW >= 1000 && desk.cardsSide && desk.navInHdr && desk.hit === 0 && desk.sw[0] <= desk.sw[1] && !!deskP && deskP.two && deskP.sw[0] <= deskP.sw[1], { desk, deskP });
  await c.width(1000, 800);
  await tab('notes');
  const sw1000 = await c.eval(`[document.documentElement.scrollWidth, innerWidth, (()=>{const n=document.querySelector('nav.tabs').getBoundingClientRect(), t=document.querySelector('header .rl-title').getBoundingClientRect(); return n.left>=t.right})()]`);
  ok(`8.8 1000px：無水平捲動（${sw1000[0]}/${sw1000[1]}）、頁首分頁不壓到 App 名`, sw1000[0] <= sw1000[1] && sw1000[2], sw1000);
  await c.width(390);

  console.log('\n[7 沒有錯誤、沒有意外的對外連線]');
  ok(`7.1 沒有未捕捉的 JS 例外（${c.errors.length} 個）`, c.errors.length === 0, c.errors.slice(0, 3));
  ok(`7.2 最後一頁沒有被呼叫的 alert／confirm`, (await c.eval(`window.__alerts.length`)) === 0, await c.eval(`window.__alerts`));
  const httpReq = c.requests.filter((u) => /^https?:/i.test(u));
  const hosts = [...new Set(httpReq.map((u) => new URL(u).hostname))];
  const unexpected = hosts.filter((h) => h !== '127.0.0.1');
  ok(`7.3 只連本機（${httpReq.length} 個請求，主機：${hosts.join(', ')}）`, httpReq.length > 20 && unexpected.length === 0, unexpected);
} catch (e) {
  fail++;
  console.log('  FAIL 測試程式本身出錯：' + (e && e.stack || e));
} finally {
  console.log('\n' + (fail ? 'FAIL' : 'PASS') + '　通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  await cleanup();
  process.exit(fail ? 1 : 0);
}
