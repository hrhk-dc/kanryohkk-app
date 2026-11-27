// Round 28：おすすめ順の評価は4つ（評価・口コミ・価格帯・情報の充実度）。新しさ・成約しやすさは出さない。
// 価格帯がない店は、その項目を平均から外す（390px・変更箇所だけ）。Firebase は偽物。API は差し替える
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = process.env.SHOTS || '/tmp';
const BASE = process.argv[2] || 'http://localhost:8767';

const src = fs.readFileSync(path.join(__dirname, 'integration-test.js'), 'utf8');
const STUB = src.match(/const STUB = `([\s\S]*?)`;/)[1];

const DAYS = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((k) => [k, '11:00〜21:00']));
const SHOPS = [
  // 評価4.4→4、口コミ120件→4、価格帯「高い」→4、情報は4つ揃う→5。平均4.25点、10点満点で8.5
  { id: 'p1', name: 'テスト寿司店', industry: '寿司・割烹', address: '東京都テスト区1-1', lat: 35.66, lng: 139.7, rating: 4.4, reviews: 120, priceLevel: 'PRICE_LEVEL_EXPENSIVE', opened: null, staff: null, insta: '', visited: false, hours: DAYS },
  // 価格帯なし→平均から外す。評価4.0→4、口コミ60件→3、情報5。平均4.0点、10点満点で8.0
  { id: 'p2', name: 'テストラーメン店', industry: 'ラーメン・中華そば', address: '東京都テスト区2-2', lat: 35.661, lng: 139.701, rating: 4.0, reviews: 60, opened: null, staff: null, insta: '', visited: false, hours: DAYS },
  // 業種なし（情報は4つ揃わず3）、価格帯「普通」→3、評価3.9→3、口コミ40件→2。平均3.0点、10点満点で6.0
  { id: 'p3', name: 'テスト定食店', industry: '', address: '東京都テスト区3-3', lat: 35.6602, lng: 139.7002, rating: 3.9, reviews: 40, priceLevel: 'PRICE_LEVEL_MODERATE', opened: null, staff: null, insta: '', visited: false, hours: DAYS },
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
  const sr = (fn, arg) => page.evaluate(fn, arg);
  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await wait(page, 1000);
    await page.click('.app-seg[data-app="ml"]'); await wait(page, 1200);
    await sr(() => {
      const input = document.getElementById('mlHost').shadowRoot.querySelector('#addr');
      input.value = 'テスト区';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="run-search"]').click());
    await wait(page, 1000);

    const cards = await sr(() => [...document.getElementById('mlHost').shadowRoot.querySelectorAll('#pList .shop')].map((c) => ({
      name: c.querySelector('.shop-name').textContent.trim(),
      overall: c.querySelector('.overall b').textContent.trim(),
      labels: [...c.querySelectorAll('.scores .score span')].map((e) => e.textContent.trim()),
      values: [...c.querySelectorAll('.scores .score b')].map((e) => e.textContent.trim()),
      text: c.textContent,
    })));
    const p1 = cards.find((c) => c.name === 'テスト寿司店');
    const p2 = cards.find((c) => c.name === 'テストラーメン店');
    const p3 = cards.find((c) => c.name === 'テスト定食店');

    // 1) 評価の項目は4つ（評価・口コミ・価格帯・情報の充実度）
    const want = ['評価', '口コミ', '価格帯', '情報の充実度'];
    ok('評価の項目は4つ：評価・口コミ・価格帯・情報の充実度', p1 && p1.labels.join('/') === want.join('/'), p1 && p1.labels.join('/'));
    // 2) 「新しさ」「成約しやすさ」は画面に出ない
    const bad = cards.some((c) => /新しさ|成約しやすさ/.test(c.text));
    ok('「新しさ」「成約しやすさ」は、画面のどこにも出ない', !bad, '');

    // 3) 価格帯がない店は、その項目を平均から外す（テストラーメン店は 8.0）
    const p2Price = p2 && p2.values[p2.labels.indexOf('価格帯')];
    ok('価格帯がない店は、価格帯を「—」にする', p2Price === '—', p2Price);
    ok('価格帯がない店は、評価・口コミ・情報だけの平均（8.0）', p2 && p2.overall === '8.0', p2 && p2.overall);

    // 4) 価格帯がある店は、4つの平均（テスト寿司店は 8.5）
    ok('価格帯「高い」は4点で、4つの平均になる（テスト寿司店 8.5）', p1 && p1.overall === '8.5' && p1.values[p1.labels.indexOf('価格帯')] === '4', p1 && `${p1.overall} / ${p1.values[2]}`);
    // 5) 営業時間がない店は、情報の充実度が下がる（テスト定食店は 6.0）
    ok('業種がない店は情報の充実度が1つ下がる（テスト定食店 6.0）', p3 && p3.overall === '6.0', p3 && p3.overall);

    // 6) 点数の計算：価格帯が取れない店（テストラーメン店）は「未取得（平均に入れない）」
    const ramen = await sr(() => {
      const card = [...document.getElementById('mlHost').shadowRoot.querySelectorAll('#pList .shop')].find((c) => c.querySelector('.shop-name').textContent.trim() === 'テストラーメン店');
      card.querySelector('.overall').click();
      return true;
    });
    await wait(page, 400);
    const calc = await sr(() => {
      const card = [...document.getElementById('mlHost').shadowRoot.querySelectorAll('#pList .shop')].find((c) => c.querySelector('.shop-name').textContent.trim() === 'テストラーメン店');
      return card.querySelector('table.calc')?.textContent || '';
    });
    ok('点数の計算：価格帯が取れない店は「未取得（平均に入れない）」', ramen && calc.includes('未取得（平均に入れない）'), calc.slice(0, 60));
    await sr(() => {
      const card = [...document.getElementById('mlHost').shadowRoot.querySelectorAll('#pList .shop')].find((c) => c.querySelector('.shop-name').textContent.trim() === 'テストラーメン店');
      card.querySelector('.overall').click();
    });
    await wait(page, 300);

    // 7) 価格帯の詳細：根拠が出る
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.shop .score[data-k="price"]').click());
    await wait(page, 400);
    const detail = await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.shop .detail')?.textContent || '');
    ok('価格帯を開くと、根拠（価格帯：高い）が出る', detail.includes('価格帯：高い'), detail.slice(0, 80));
    await page.screenshot({ path: `${SHOTS}/r28-scores.png` });

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
