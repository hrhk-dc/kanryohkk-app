// Round 22：再読み込みしても、提案リスト・検索条件・入力中の下書きが戻ること。下のタブの順番（390px・変更箇所だけ）
// Firebase は偽物。API は差し替える
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = process.env.SHOTS || '/tmp';
const BASE = process.argv[2] || 'http://localhost:8767';

const src = fs.readFileSync(path.join(__dirname, 'integration-test.js'), 'utf8');
const STUB = src.match(/const STUB = `([\s\S]*?)`;/)[1];

const SHOPS = [
  { id: 'place-A', name: 'テスト寿司店', industry: '寿司・割烹', address: '東京都テスト区1-1', lat: 35.66, lng: 139.7, rating: 4.4, reviews: 120, opened: null, staff: null, insta: '', visited: false,
    hours: Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((k) => [k, '11:30〜14:00'])) },
  { id: 'place-B', name: 'テストラーメン店', industry: 'ラーメン・中華そば', address: '東京都テスト区2-2', lat: 35.661, lng: 139.701, rating: 4.0, reviews: 60, opened: null, staff: null, insta: '', visited: false,
    hours: Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((k) => [k, '10:00〜20:00'])) },
];

const results = [];
const ok = (name, cond, extra = '') => results.push({ name, pass: !!cond, extra: String(extra) });
const wait = (page, ms) => page.waitForTimeout(ms);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('https://www.gstatic.com/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if (u.endsWith('/api/ml-geocode')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, lat: 35.66, lng: 139.7, label: 'テスト区', viewport: null }) });
    if (u.endsWith('/api/ml-search')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, shops: SHOPS }) });
    if (/\/api\/(demo-url|demo-queue|maps-info)$/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: {}, demos: [] }) });
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });
  const mlCards = () => page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelectorAll('#pList .shop').length);
  const mlActive = () => page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('.screen.active')?.dataset.screen || '');
  const mlAddr = () => page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('#addr')?.value || '');
  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await wait(page, 1000);

    // 1) 下のタブの順番：予定・完了報告・訪問リスト・報告一覧・集計・管理
    const tabs = await page.evaluate(() => [...document.querySelectorAll('#mainNav > .tab')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.textContent.trim()));
    ok('下のタブの順番：予定・完了報告・訪問リスト・報告一覧・集計・管理', tabs.join('/') === '予定/完了報告/訪問リスト/報告一覧/集計/管理', tabs.join('/'));
    const aboutOrder = await page.evaluate(() => [...document.querySelectorAll('#tab-about .about-list dt')].map((d) => d.textContent.trim()));
    const iForm = aboutOrder.indexOf('完了報告'), iVisit = aboutOrder.indexOf('訪問リスト');
    ok('「このアプリについて」のタブの説明も、完了報告の次に訪問リスト', iForm !== -1 && iVisit === iForm + 1, aboutOrder.join('/'));

    // 2) 完了報告の入力中の下書き：入れた内容が、再読み込みのあとも残る
    await page.click('#mainNav [data-tab="form"]'); await wait(page, 500);
    await page.fill('#reportCases [data-field-id="caseNo"]', 'A009');
    await page.dispatchEvent('#reportCases [data-field-id="caseNo"]', 'change');
    await wait(page, 1000); // 下書きの保存（約0.6秒後）

    // 3) マップリスト：検索して提案リストを作る
    await page.click('.app-seg[data-app="ml"]'); await wait(page, 1200);
    await page.evaluate(() => {
      const input = document.getElementById('mlHost').shadowRoot.querySelector('#addr');
      input.value = 'テスト区';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="run-search"]').click());
    await wait(page, 1000);
    const before = { cards: await mlCards(), active: await mlActive() };
    ok('検索：提案リストに2件出る（再読み込みの前）', before.active === 'proposal' && before.cards === 2, JSON.stringify(before));
    await wait(page, 500);

    // 4) 再読み込み：提案リスト・検索条件・画面が戻る
    await page.reload({ waitUntil: 'domcontentloaded' });
    await wait(page, 1200);
    await page.click('.app-seg[data-app="ml"]'); await wait(page, 1200);
    const after = { cards: await mlCards(), active: await mlActive(), addr: await mlAddr() };
    ok('再読み込み後：提案リストの2件が戻る（検索し直さない）', after.cards === 2, JSON.stringify(after));
    ok('再読み込み後：検索条件（エリア）と、開いていた提案の画面が戻る', after.addr === 'テスト区' && after.active === 'proposal', JSON.stringify(after));
    await page.screenshot({ path: `${SHOTS}/r22-restored.png` });

    // 5) 前の日の提案：消して、もう一度検索してもらう（検索条件は戻る）
    await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('vla:ui'));
      d.day = '2000-01-01';
      localStorage.setItem('vla:ui', JSON.stringify(d));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await wait(page, 1200);
    await page.click('.app-seg[data-app="ml"]'); await wait(page, 1000);
    const stale = { cards: await mlCards(), addr: await mlAddr() };
    ok('前の日の提案：消える（検索条件のエリアは戻る）', stale.cards === 0 && stale.addr === 'テスト区', JSON.stringify(stale));

    // 6) 完了報告に戻ると、入力中の下書きが残っている（再読み込みの後）
    await page.click('.app-seg[data-app="dc"]'); await wait(page, 700);
    await page.click('#mainNav [data-tab="form"]'); await wait(page, 600);
    const draft = await page.$eval('#reportCases [data-field-id="caseNo"]', (el) => el.value).catch(() => '');
    ok('完了報告：入力中の案件番号が、再読み込みの後も残る', draft === 'A009', draft);

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
