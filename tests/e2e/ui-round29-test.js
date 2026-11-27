// Round 29：取れた候補を使い回し、再検索の回数を減らす（390px・変更箇所だけ）
// 検索（/api/ml-search）が何回呼ばれたかで確かめる。Firebase は偽物。API は差し替える
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = process.env.SHOTS || '/tmp';
const BASE = process.argv[2] || 'http://localhost:8767';

const src = fs.readFileSync(path.join(__dirname, 'integration-test.js'), 'utf8');
const STUB = src.match(/const STUB = `([\s\S]*?)`;/)[1];

const DAYS = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((k) => [k, '11:00〜21:00']));
// 6件の候補（件数5では5件、件数10にすると6件まで。どちらも検索は1回）
const SHOPS = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: 'c' + n, name: 'テスト店' + n, industry: n % 2 ? '寿司・割烹' : 'ラーメン・中華そば', address: '東京都テスト区' + n + '-1',
  lat: 35.66 + n * 0.0002, lng: 139.7 + n * 0.0002, rating: 4.0 + n * 0.05, reviews: 50 + n * 10, priceLevel: 'PRICE_LEVEL_MODERATE',
  opened: null, staff: null, insta: '', visited: false, hours: DAYS,
}));

const results = [];
const ok = (name, cond, extra = '') => results.push({ name, pass: !!cond, extra: String(extra) });
const wait = (page, ms) => page.waitForTimeout(ms);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  let searches = 0;
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('https://www.gstatic.com/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if (u.endsWith('/api/ml-geocode')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, lat: 35.66, lng: 139.7, label: 'テスト区', viewport: null }) });
    if (u.endsWith('/api/ml-search')) { searches += 1; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, shops: SHOPS }) }); }
    if (/\/api\/(demo-url|demo-queue|maps-info)$/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: {}, demos: [] }) });
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });
  const sr = (fn, arg) => page.evaluate(fn, arg);
  const cardCount = () => sr(() => document.getElementById('mlHost').shadowRoot.querySelectorAll('#pList .shop').length);
  const goSearch = async () => { await sr(() => document.querySelector('#mainNav [data-ml-nav="search"]').click()); await wait(page, 400); };
  const runSearch = async () => { await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="run-search"]').click()); await wait(page, 1000); };
  const setCount = async (n) => {
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="count-open"]').click());
    await wait(page, 300);
    const idx = [3, 5, 10, 15, 20].indexOf(n);
    await sr((i) => { const w = document.getElementById('mlHost').shadowRoot.querySelector('#wheel'); w.scrollTop = i * 44; }, idx);
    await wait(page, 300);
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="count-ok"]').click());
    await wait(page, 500);
  };
  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await wait(page, 1000);
    await page.click('.app-seg[data-app="ml"]'); await wait(page, 1200);
    await sr(() => {
      const input = document.getElementById('mlHost').shadowRoot.querySelector('#addr');
      input.value = 'テスト区';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await runSearch();
    ok('最初の検索は1回、件数5で5件出る', searches === 1 && (await cardCount()) === 5, `searches=${searches} cards=${await cardCount()}`);

    // 1) 件数を増やす（10件）→ 再検索しない。残りの候補から出る
    await setCount(10);
    ok('件数を10件に増やしても、再検索しない（候補の残りから6件）', searches === 1 && (await cardCount()) === 6, `searches=${searches} cards=${await cardCount()}`);

    // 2) 同じ条件で「提案リストを作る」をもう一度押す → 再検索しない
    await goSearch();
    await runSearch();
    ok('同じ条件でもう一度作っても、再検索しない', searches === 1, `searches=${searches}`);
    // 使い回したことを、画面の文字で確かめる（トーストは完了報告側か、マップリスト側に出る）
    const toasted = await sr(() => (document.body.innerText + ' ' + (document.getElementById('mlHost')?.shadowRoot?.textContent || '')).includes('保存してある候補から作りました'));
    ok('使い回したことが画面に出る', toasted, '');

    // 3) 条件（半径）を変える → 新しく検索する
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="radius"][data-v="500m"]').click());
    await wait(page, 300);
    await runSearch();
    ok('条件（半径）を変えたときは、新しく検索する', searches === 2, `searches=${searches}`);

    // 4) 再読み込み（同じ日）→ 保存してある候補で、再検索しない
    await page.reload({ waitUntil: 'domcontentloaded' });
    await wait(page, 1200);
    await page.click('.app-seg[data-app="ml"]'); await wait(page, 1200);
    await goSearch();
    await runSearch();
    ok('再読み込みしても、同じ条件なら保存してある候補から作る（再検索しない）', searches === 2, `searches=${searches}`);

    // 5) 前の日の候補は使い回さない → 新しく検索する
    await sr(() => {
      const d = JSON.parse(localStorage.getItem('vla:ui'));
      d.day = '2000-01-01'; d.poolDay = '2000-01-01';
      localStorage.setItem('vla:ui', JSON.stringify(d));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await wait(page, 1200);
    await page.click('.app-seg[data-app="ml"]'); await wait(page, 1200);
    await goSearch();
    await runSearch();
    ok('前の日の候補は使い回さず、新しく検索する', searches === 3, `searches=${searches}`);

    ok('390px：横スクロールなし', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    ok('コンソールエラーなし', errors.length === 0, errors.join(' | '));
  } finally {
    await browser.close();
  }
  let fail = 0;
  for (const r of results) { if (!r.pass) fail++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? '  [' + r.extra + ']' : ''}`); }
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e.message.split('\n')[0]); process.exit(2); });
