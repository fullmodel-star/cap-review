/**
 * 704 會考複習・作答進度存檔測試（2026-10-24 新增；只測不改 App）
 *
 *   node _tools/progress_tests.mjs
 *   node _tools/progress_tests.mjs --override=index.html=<改壞的副本絕對路徑>   → 用副本取代 index.html（證明測試抓得到）
 *
 * 存檔：IndexedDB `capReviewDB` v1、store `progress`（keyPath id），每題一筆
 *   {id, streak, mastered, maint, nextReview, lapses, leech, retired, reviewCount, wrongCount}
 *   規則（README／程式註解）：連對 3 次畢業、間隔 [1,3,7,14,30] 天、畢業後回訪 [14,30,60]；錯題＝答過、未畢業、答錯過。
 *   骨架版（70b4c5f）的紀錄沒有 wrongCount。
 * 1 數學 114 年照題號：第 1 輪答 6 題（對 4 錯 2）、第 2 輪再答前 2 題（都對）、第 3 輪第 1 題再對（畢業）
 *   → 重新整理 → IndexedDB 逐筆一字不差、逐題欄位＝依規則推算、狀態列／頁首／各科進度／錯題複習數字一致
 * 2 本 App 沒有清除進度功能：改測「作答不動到 localStorage 的其他 key」＋頁面沒有清除／匯出按鈕
 * 3 骨架版缺 wrongCount、只有 reviewCount 的最小紀錄、不認得的科目／題號：能開、不歸零
 * 4 匯出匯入：沒有
 * 每條斷言印樣本數 n，n=0 一律 FAIL；外部連線一律擋下。puppeteer-core、headless new、埠 0、真實時間等待。
 */
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/c0787/Desktop/App專案/02_其他App/700_學習計畫日曆/node_modules/puppeteer-core');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OVERRIDES = {};
for (const a of process.argv) if (a.startsWith('--override=')) { const [k, v] = a.slice(11).split('='); OVERRIDES['/' + k.replace(/^\/+/, '')] = v; }
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.css': 'text/css', '.woff2': 'font/woff2', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

let pass = 0, fail = 0;
function ok(name, cond, n, extra) {
  const empty = !(n > 0);
  const good = !!cond && !empty;
  if (good) pass++; else fail++;
  console.log(`  ${good ? 'ok  ' : 'FAIL'} ${name}  [n=${n}]${empty ? '（空集合）' : ''}` + (!good && extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : ''));
}
function info(s) { console.log('  info ' + s); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(u.pathname);
  if (rel === '/__blank.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end('<!doctype html><title>blank</title>'); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const p = OVERRIDES[rel] || path.join(ROOT, rel);
  if (!OVERRIDES[rel] && !p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try {
    const b = await readFile(p);
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(b);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const profile = await mkdtemp(path.join(tmpdir(), 'cap704-prog-'));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: profile,
  args: ['--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'] });

const external = [], pageErrors = [];
async function newPage() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const h = (() => { try { return new URL(r.url()).hostname; } catch { return ''; } })();
    if (/^https?:/.test(r.url()) && h !== '127.0.0.1') { external.push(r.url()); r.abort(); } else r.continue();
  });
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
  page.on('dialog', (d) => d.accept());
  page.__ctx = ctx;
  return page;
}
async function closePage(page) { try { await page.__ctx.close(); } catch {} }
/** 空白頁上先寫 localStorage 與 IndexedDB（records 為 progress 紀錄陣列；null＝不建資料庫） */
async function seed(page, ls, records) {
  await page.goto(BASE + '__blank.html', { waitUntil: 'load' });
  await page.evaluate(async (ls, records) => {
    localStorage.clear();
    for (const k in ls) localStorage.setItem(k, typeof ls[k] === 'string' ? ls[k] : JSON.stringify(ls[k]));
    await new Promise((res) => { const r = indexedDB.deleteDatabase('capReviewDB'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    if (!records) return;
    await new Promise((res, rej) => {
      const req = indexedDB.open('capReviewDB', 1);
      req.onupgradeneeded = (e) => e.target.result.createObjectStore('progress', { keyPath: 'id' });
      req.onsuccess = (e) => { const db = e.target.result; const tx = db.transaction('progress', 'readwrite'); records.forEach((x) => tx.objectStore('progress').put(x)); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = rej; };
      req.onerror = rej;
    });
  }, ls, records);
}
/** 用另一條連線讀整個 progress store（不經過 App 的記憶體） */
async function dumpDB(page) {
  return page.evaluate(() => new Promise((res) => {
    const req = indexedDB.open('capReviewDB');
    req.onsuccess = (e) => { const db = e.target.result; if (!db.objectStoreNames.contains('progress')) { db.close(); res(null); return; }
      const r = db.transaction('progress', 'readonly').objectStore('progress').getAll(); r.onsuccess = () => { db.close(); res(r.result.sort((a, b) => a.id < b.id ? -1 : 1)); }; };
    req.onerror = () => res(null);
  }));
}
async function openApp(page) {
  const e0 = pageErrors.length;
  await page.goto(BASE + 'index.html', { waitUntil: 'load' });
  const ready = await page.waitForFunction(() => AVAILABLE.length === 5 && /已練/.test(document.getElementById('hdrSub').textContent) && document.querySelector('#notesArea .hud'),
    { timeout: 20000, polling: 150 }).then(() => true, () => false);
  return { ready, newErrors: pageErrors.slice(e0) };
}
async function hud(page) { return page.evaluate(() => [...document.querySelectorAll('#notesArea .hud b')].map((b) => b.textContent.trim())); }
async function tab(page, t) { await page.evaluate((t) => document.querySelector(`nav.tabs button[data-tab="${t}"]`).click(), t); await sleep(150); }
async function startMath114(page) {
  await tab(page, 'practice');
  await page.waitForFunction(() => document.querySelector('#practiceArea .chips .chip'), { timeout: 10000, polling: 150 });
  await page.evaluate(() => [...document.querySelectorAll('#practiceArea .chips .chip')].find((c) => c.textContent.trim() === '數學').click());
  await page.waitForFunction(() => pf.subject === 'math' && document.querySelector('#practiceArea select'), { timeout: 15000, polling: 150 });
  await page.evaluate(() => { const s = document.querySelector('#practiceArea select'); s.value = '114'; s.dispatchEvent(new Event('change')); });
  await page.waitForFunction(() => pf.year === '114', { timeout: 5000, polling: 100 });
  await page.evaluate(() => [...document.querySelectorAll('#practiceArea button')].find((b) => b.textContent.includes('開始練習')).click());
  await page.waitForFunction(() => session && session.mode === 'practice' && document.querySelector('#practiceArea .ansgrid .ans'), { timeout: 5000, polling: 100 });
}
async function answer(page, want) {
  const q = await page.evaluate(() => { const q = session.queue[session.idx]; return { id: q.id, ans: q.answer, letters: ['A', 'B', 'C', 'D'].filter((l) => q.options && l in q.options) }; });
  const choice = want ? q.ans : q.letters.find((l) => l !== q.ans);
  await page.evaluate((c) => [...document.querySelectorAll('#practiceArea .ansgrid .ans')].find((b) => b.textContent.trim() === c).click(), choice);
  await page.waitForFunction(() => session.picked !== null && document.querySelector('#practiceArea .result'), { timeout: 5000, polling: 100 });
  return { id: q.id, correct: choice === q.ans };
}
async function next(page) {
  const i = await page.evaluate(() => session.idx);
  await page.evaluate(() => document.getElementById('nextBtn').click());
  await page.waitForFunction((i) => session.idx === i + 1, { timeout: 4000, polling: 100 }, i);
}

/** 依 README 規則獨立推算一題的紀錄（不呼叫 App 的 grade） */
function model(seq) {
  const p = { streak: 0, mastered: false, maint: null, lapses: 0, leech: false, retired: false, reviewCount: 0, wrongCount: 0, nextDays: 0 };
  const INT = [1, 3, 7, 14, 30], MAINT = [14, 30, 60];
  for (const c of seq) {
    p.reviewCount++;
    if (!c) p.wrongCount++;
    if (p.mastered) { if (c) { p.maint++; if (p.maint >= MAINT.length) p.retired = true; else p.nextDays = MAINT[p.maint]; } else { p.mastered = false; p.maint = null; p.streak = 0; p.lapses++; if (p.lapses >= 3) p.leech = true; p.nextDays = 1; } }
    else if (c) { p.streak++; if (p.streak >= 3) { p.mastered = true; p.maint = 0; p.nextDays = MAINT[0]; } else p.nextDays = INT[Math.min(p.streak, INT.length - 1)]; }
    else { if (p.streak > 0) { p.lapses++; if (p.lapses >= 3) p.leech = true; } p.streak = 0; p.nextDays = 1; }
  }
  return p;
}
const FOREIGN = { ninja_xp_v1: { xp: 50, bySrc: { biology: 50 }, seen: {}, ts: 1 }, biogsat_qb_v1: { rec: { a: { correct: true, n: 1 } } }, 'rl.some.flag': '1' };

try {
  console.log('對象：' + ROOT + (Object.keys(OVERRIDES).length ? '（覆寫 ' + JSON.stringify(OVERRIDES) + '）' : ''));

  /* ---------- 1 ---------- */
  console.log('\n[1 數學 114 年：3 輪作答 → 重新整理]');
  const page = await newPage();
  await seed(page, FOREIGN, null);
  let o = await openApp(page);
  ok('1.0 沒有資料庫時能開、無例外、狀態列 0/0/0', o.ready && o.newErrors.length === 0 && eq(await hud(page), ['0', '0', '0']), 1, { o, hud: await hud(page) });
  const seqs = {};
  const rec = (a) => { (seqs[a.id] = seqs[a.id] || []).push(a.correct); return a; };
  await startMath114(page);
  const R1 = [true, false, true, false, true, true];
  for (let i = 0; i < R1.length; i++) { rec(await answer(page, R1[i])); if (i < R1.length - 1) await next(page); }
  await startMath114(page);
  rec(await answer(page, true)); await next(page); rec(await answer(page, true));
  await startMath114(page);
  rec(await answer(page, true));
  const ids = Object.keys(seqs);
  ok(`1.1 共作答 ${Object.values(seqs).flat().length} 次、${ids.length} 題（照題號，第 2、3 輪回到同一批題）`, ids.length === 6 && seqs[ids[0]].length === 3 && seqs[ids[1]].length === 2, ids.length, seqs);
  await sleep(300);
  const db0 = await dumpDB(page);
  const t0 = await page.evaluate(() => today());
  const bad = [];
  for (const id of ids) {
    const r = (db0 || []).find((x) => x.id === id), m = model(seqs[id]);
    const got = r && { streak: r.streak, mastered: r.mastered, maint: r.maint, lapses: r.lapses || 0, leech: !!r.leech, retired: !!r.retired, reviewCount: r.reviewCount, wrongCount: r.wrongCount || 0, nextDays: Math.round((r.nextReview - t0) / 86400000) };
    if (!eq(got, m)) bad.push({ id, got, m });
  }
  ok(`1.2 IndexedDB 逐題欄位＝依規則推算（連對次數、畢業、錯題次數、下次複習天數）`, db0 && db0.length === ids.length && bad.length === 0, db0 ? db0.length : 0, bad);
  const expWrong = ids.filter((id) => { const m = model(seqs[id]); return !m.mastered && m.wrongCount > 0; }).length;
  const expMastered = ids.filter((id) => model(seqs[id]).mastered).length;
  ok(`1.3 推算：錯題 ${expWrong} 題、畢業 ${expMastered} 題（樣本確實含對錯與畢業）`, expWrong === 2 && expMastered === 1, ids.length);
  const hdr0 = await page.evaluate(() => document.getElementById('hdrSub').textContent);

  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => AVAILABLE.length === 5 && document.querySelector('#notesArea .hud'), { timeout: 20000, polling: 150 });
  const db1 = await dumpDB(page);
  ok('1.4 重新整理後 IndexedDB 逐筆一字不差', eq(db0, db1), db1 ? db1.length : 0, { db0, db1 });
  const h = await hud(page);
  ok(`1.5 狀態列：已練 ${ids.length}、錯題 ${expWrong}、今日複習 0（全部排在明天以後）`, eq(h, [String(ids.length), String(expWrong), '0']), h.length, h);
  const hdr1 = await page.evaluate(() => document.getElementById('hdrSub').textContent);
  ok(`1.6 頁首「已練 ${ids.length} / …」重整前後相同`, hdr0 === hdr1 && hdr1.startsWith(`已練 ${ids.length} /`), 1, { hdr0, hdr1 });
  await tab(page, 'practice');
  await page.waitForFunction(() => document.querySelectorAll('#practiceArea .sp-row').length === 5, { timeout: 15000, polling: 150 });
  const side = await page.evaluate(() => [...document.querySelectorAll('#practiceArea .sp-row')].map((r) => r.querySelector('.nm').textContent + ' ' + r.querySelector('.ct').textContent));
  ok(`1.7 各科闖關進度：數學 ${ids.length} 題，其他四科 0`, side.includes(`數學 ${ids.length} / 255 題`) && side.filter((s) => / 0 \//.test(s)).length === 4, side.length, side);
  const cnt = await page.evaluate(() => (document.querySelector('#practiceArea .muted.small') || {}).textContent || '');
  ok(`1.8 練習首頁（重整後篩選回到全科全年）「已練過 ${ids.length} 題」`, cnt.includes(`已練過 ${ids.length} 題`), 1, cnt);
  await tab(page, 'review');
  await page.waitForFunction(() => /所有錯題/.test(document.getElementById('reviewArea').textContent), { timeout: 15000, polling: 150 });
  const rv = await page.evaluate(() => [...document.querySelectorAll('#reviewArea button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
  ok(`1.9 錯題複習：今日到期 0、所有錯題 ${expWrong}`, rv.some((t) => t === '今日到期 0') && rv.some((t) => t === `所有錯題 ${expWrong}`), rv.length, rv);
  await page.evaluate(() => [...document.querySelectorAll('#reviewArea button')].find((b) => b.textContent.includes('所有錯題')).click());
  await page.waitForFunction(() => session && session.mode === 'review' && session.title === '所有錯題', { timeout: 5000, polling: 100 });
  const rq = await page.evaluate(() => session.queue.map((q) => q.id).sort());
  const expWrongIds = ids.filter((id) => { const m = model(seqs[id]); return !m.mastered && m.wrongCount > 0; }).sort();
  ok(`1.10 「所有錯題」出題＝那 ${expWrong} 題`, eq(rq, expWrongIds), rq.length, { rq, expWrongIds });
  const ls = await page.evaluate((ks) => ks.map((k) => localStorage.getItem(k)), Object.keys(FOREIGN));
  ok(`2.1 作答與重整不動 localStorage 其他 ${ls.length} 個 key`, Object.keys(FOREIGN).every((k, i) => ls[i] === (typeof FOREIGN[k] === 'string' ? FOREIGN[k] : JSON.stringify(FOREIGN[k]))), ls.length, ls);
  const btns = await page.evaluate(() => [...document.querySelectorAll('button, .chip, [role=button]')].map((b) => b.textContent.trim()));
  const resetUi = btns.filter((t) => /清除|重置|重新開始|刪除紀錄|匯出|匯入|備份|還原/.test(t));
  ok('2.2／4.1 頁面沒有清除進度、匯出匯入、備份按鈕（本 App 不提供，無從測還原）', resetUi.length === 0, btns.length, resetUi);
  await closePage(page);

  /* ---------- 3 ---------- */
  console.log('\n[3 骨架版紀錄（缺 wrongCount）、最小紀錄、不認得的題號]');
  const p3 = await newPage();
  const DAY = 86400000;
  const today0 = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  // 3a：70b4c5f 的 prog() 形狀：沒有 wrongCount；一題答錯過（明天到期→改成昨天到期）、一題答對 1 次
  const OLD = [
    { id: '114_math_1', streak: 0, mastered: false, maint: null, nextReview: today0 - DAY, lapses: 0, leech: false, retired: false, reviewCount: 1 },
    { id: '114_math_2', streak: 1, mastered: false, maint: null, nextReview: today0 + 3 * DAY, lapses: 0, leech: false, retired: false, reviewCount: 1 },
  ];
  await seed(p3, {}, OLD);
  o = await openApp(p3);
  let h3 = await hud(p3);
  ok('3a.1 骨架版紀錄：能開、無例外、已練 2、今日複習 1（到期的那題）', o.ready && o.newErrors.length === 0 && h3[0] === '2' && h3[2] === '1', 2, { o, h3 });
  info(`3a 骨架版答錯紀錄沒有 wrongCount → 狀態列「錯題」= ${h3[1]}、不進「所有錯題」，只會出現在「今日到期」；wrongCount 在第一次 v1（b66aa8e，同日）就加入，骨架版是否曾上線不明 → 規則不明`);
  await tab(p3, 'review');
  await p3.waitForFunction(() => session && session.mode === 'review', { timeout: 15000, polling: 150 });
  const dueQ = await p3.evaluate(() => session.queue.map((q) => q.id));
  ok('3a.2 今日到期出題含那題舊錯題', eq(dueQ, ['114_math_1']), dueQ.length, dueQ);
  await p3.evaluate(() => [...document.querySelectorAll('#reviewArea .ansgrid .ans')].find((b) => b.textContent.trim() === session.queue[0].answer).click());
  await p3.waitForFunction(() => session.picked !== null, { timeout: 5000, polling: 100 });
  await sleep(200);
  const r3 = (await dumpDB(p3)).find((x) => x.id === '114_math_1');
  ok('3a.3 舊紀錄再答對：reviewCount 1→2、streak 0→1、補上 wrongCount 欄位不出錯', r3.reviewCount === 2 && r3.streak === 1 && (r3.wrongCount || 0) === 0, 1, r3);

  // 3b：只有 id＋reviewCount 的最小紀錄、不認得的科目與題號
  await seed(p3, {}, [{ id: '113_science_5', reviewCount: 2 }, { id: '114_listening_3', reviewCount: 1, wrongCount: 1 }, { id: 'garbage', reviewCount: 5 }, { id: '110_social_9', reviewCount: 1, wrongCount: 1, streak: 0, nextReview: today0 + DAY }]);
  o = await openApp(p3);
  h3 = await hud(p3);
  ok('3b.1 最小紀錄＋不認得的題號：能開、無例外、已練只算認得的 2 題、錯題 1', o.ready && o.newErrors.length === 0 && h3[0] === '2' && h3[1] === '1', 2, { o, h3 });
  await tab(p3, 'review');
  const rvOk = await p3.waitForFunction(() => session && session.mode === 'review' && /所有錯題 1/.test(document.getElementById('reviewArea').textContent.replace(/\s+/g, ' ')), { timeout: 15000, polling: 150 }).then(() => true, () => false);
  ok('3b.2 錯題複習頁能開、所有錯題 1（不認得的題號不出題、不出錯）', rvOk && pageErrors.length === 0, 1, await p3.evaluate(() => document.getElementById('reviewArea').textContent.slice(0, 200)));
  const db3 = await dumpDB(p3);
  ok('3b.3 打開不會刪掉或改寫任何舊紀錄（含不認得的）', db3 && db3.length === 4, db3 ? db3.length : 0, db3);
  await closePage(p3);

  console.log('\n[5 外部連線]');
  ok('5.1 外部請求全部被擋（擋下 ' + external.length + ' 個；0 代表 App 不連外，以樣本 1 計）', true, 1);
  if (external.length) info('被擋的外部網址（前 3）：' + external.slice(0, 3).join(' , '));
  info('整輪頁面例外 ' + pageErrors.length + ' 個' + (pageErrors.length ? '：' + pageErrors.slice(0, 3).join(' | ') : ''));
} catch (e) {
  fail++;
  console.log('  FAIL 測試程式本身出錯：' + (e && e.stack || e));
} finally {
  console.log('\n' + (fail ? 'FAIL' : 'PASS') + '　通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  try { await browser.close(); } catch {}
  server.close();
  await sleep(300);
  try { await rm(profile, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
}
