// Round 30：業種は「飲食店・飲食店以外・全て」の3択。検索は20件ずつ、「追加で20件を見る」で次のページ（上限60件）。
// 手元の候補の業種絞り込みは検索しない。再読み込みしても追加分が残る（390px・変更箇所だけ）
// Firebase は偽物。API は差し替える（hasMore と page / category を、やり取りの約束どおりに返す）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = process.env.SHOTS || '/tmp';
const BASE = process.argv[2] || 'http://localhost:8767';

const src = fs.readFileSync(path.join(__dirname, 'integration-test.js'), 'utf8');
const STUB = src.match(/const STUB = `([\s\S]*?)`;/)[1];

const DAYS = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((k) => [k, '11:00〜21:00']));
// 1ページ20件。ページごとに名前の印（a・b・c）を変える。b は評価が高い（上に並ぶ）
function page(p) {
  const tag = 'abc'[p - 1];
  const rating = p === 2 ? 4.8 : 3.8;
  return Array.from({ length: 20 }, (_, i) => ({
    id: `${tag}${i + 1}`, name: `テスト${tag}${i + 1}`, industry: i % 2 ? 'ラーメン・中華そば' : '寿司・割烹',
    address: `東京都テスト区${tag}${i + 1}`, lat: 35.66 + i * 0.0003, lng: 139.7 + p * 0.0003 + i * 0.0002,
    rating: rating - i * 0.01, reviews: 60 + i, priceLevel: 'PRICE_LEVEL_MODERATE', opened: null, staff: null, insta: '', visited: false, hours: DAYS,
  }));
}

const results = [];
const ok = (name, cond, extra = '') => results.push({ name, pass: !!cond, extra: String(extra) });
const wait = (page, ms) => page.waitForTimeout(ms);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page1 = await ctx.newPage();
  const errors = [];
  const calls = [];
  page1.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errors.push(m.text()); });
  page1.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page1.on('response', (r) => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
  const attach = (pg, log = calls) => pg.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('https://www.gstatic.com/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if (u.endsWith('/api/ml-geocode')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, lat: 35.66, lng: 139.7, label: 'テスト区', viewport: null }) });
    if (u.endsWith('/api/ml-search')) {
      let body = {};
      try { body = route.request().postDataJSON() || {}; } catch (e) { body = {}; }
      const p = Number(body.page) || 1;
      log.push({ page: p, category: body.category || null, hasIndustries: 'industries' in body });
      const hasMore = p < 3;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, shops: page(p), hasMore }) });
    }
    if (/\/api\/(demo-url|demo-queue|maps-info)$/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: {}, demos: [] }) });
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });
  await attach(page1);
  const sr = (fn, arg) => page1.evaluate(fn, arg);
  const cards = () => sr(() => [...document.getElementById('mlHost').shadowRoot.querySelectorAll('#pList .shop')].map((c) => c.querySelector('.shop-name').textContent.trim()));
  const moreBtn = () => sr(() => { const b = document.getElementById('mlHost').shadowRoot.querySelector('[data-act="more-results"]'); return b ? 'enabled' : (document.getElementById('mlHost').shadowRoot.querySelector('#pList .more .btn:disabled') ? 'disabled' : 'none'); });

  try {
    await page1.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await wait(page1, 1000);
    await page1.click('.app-seg[data-app="ml"]'); await wait(page1, 1200);

    // 1) 業種は3択（飲食店・飲食店以外・全て）。細かい業種のチップと「全て」ボタンはない
    const ind = await sr(() => {
      const root = document.getElementById('mlHost').shadowRoot;
      return {
        labels: [...root.querySelectorAll('#s-ind .seg button')].map((b) => b.textContent.trim()),
        chips: root.querySelectorAll('#s-ind .chip').length,
        allInd: !!document.querySelector('#allInd') || !!root.querySelector('#allInd'),
      };
    });
    ok('業種は3択：全て・飲食店・飲食店以外', ind.labels.join('/') === '全て/飲食店/飲食店以外', JSON.stringify(ind.labels));
    ok('細かい業種のチップと「全て」ボタンはない', ind.chips === 0 && !ind.allInd, JSON.stringify(ind));

    // 2) 飲食店を選んで検索 → 最初は20件まで（1ページ目だけ）
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="cat"][data-v="food"]').click());
    await wait(page1, 300);
    await sr(() => {
      const input = document.getElementById('mlHost').shadowRoot.querySelector('#addr');
      input.value = 'テスト区';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="run-search"]').click());
    await wait(page1, 1000);
    ok('最初の検索は1ページ目（page 1）・分類は飲食店', calls.length === 1 && calls[0].page === 1 && calls[0].category === 'food', JSON.stringify(calls));
    ok('最初の検索で、業種の指定（industries）は送らない', calls.length === 1 && !calls[0].hasIndustries, '');
    const first = await cards();
    ok('最初の検索は1ページ目の20件（件数の指定はなし）', first.length === 20, first.length);
    const more1 = await moreBtn();
    ok('「追加で20件を見る」が出る（次のページがある）', more1 === 'enabled', more1);
    await page1.screenshot({ path: `${SHOTS}/r30-first.png` });

    // 3) 追加で20件：次のページを取り、候補と提案に足す（自動では取らない）
    const beforeAdd = calls.length;
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="more-results"]').click());
    await wait(page1, 1000);
    const afterAdd = await cards();
    ok('追加で20件を押すと、page 2 を取りに行く（1回だけ）', calls.length === beforeAdd + 1 && calls[calls.length - 1].page === 2, JSON.stringify(calls.slice(-1)));
    ok('追加ぶんが提案に増える（40件）', afterAdd.length === 40, afterAdd.length);
    ok('追加ぶんの候補（テストb）が出ている', afterAdd.some((n) => n.startsWith('テストb')), afterAdd.slice(0, 3).join(','));

    // 4) 手元の候補を業種で絞る：検索はしない
    const callsBeforeInd = calls.length;
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('#pInd .chip[data-name="寿司・割烹"]').click());
    await wait(page1, 500);
    const filtered = await cards();
    ok('業種で絞り込みは手元の候補で動く（検索しない）', calls.length === callsBeforeInd && filtered.length < 40 && filtered.length > 0, `calls=${calls.length} cards=${filtered.length}`);
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('#pInd .chip[data-name="寿司・割烹"]').click());
    await wait(page1, 500);

    // 5) 2回目の追加で上限（60件）。次がなくなり、ボタンは押せない
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="more-results"]').click());
    await wait(page1, 1000);
    const cap = await cards();
    const capBtn = await moreBtn();
    ok('上限（3ページ目で60件）。次がなくなりボタンは押せない', cap.length === 60 && capBtn === 'disabled', `cards=${cap.length} btn=${capBtn}`);
    ok('3ページ目を取りに行った（page 3）', calls.some((c) => c.page === 3), '');
    await page1.screenshot({ path: `${SHOTS}/r30-cap.png` });

    // 6) 再読み込み：追加ぶんが残る（検索し直さない）
    const callsBeforeReload = calls.length;
    await page1.reload({ waitUntil: 'domcontentloaded' });
    await wait(page1, 1200);
    await page1.click('.app-seg[data-app="ml"]'); await wait(page1, 1200);
    const reloaded = await cards();
    ok('再読み込みしても、追加ぶんが残る（60件）', reloaded.length === 60, reloaded.length);
    ok('再読み込みで、検索や追加の取り直しはしない', calls.length === callsBeforeReload, `calls=${calls.length}`);
    ok('再読み込み後も、次のページは無い（ボタンは押せない）', (await moreBtn()) === 'disabled', await moreBtn());

    ok('390px：横スクロールなし', !(await page1.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    ok('コンソールエラーなし', errors.length === 0, errors.join(' | '));
  } finally {
    await browser.close();
  }
  let fail = 0;
  for (const r of results) { if (!r.pass) fail++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? '  [' + r.extra + ']' : ''}`); }
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e.message.split('\n')[0]); process.exit(2); });
