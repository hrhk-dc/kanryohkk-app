// Round 26：おすすめ順の評価。取れない項目（新しさ・成約しやすさ）は3で埋めず、平均から外す（390px・変更箇所だけ）
// Firebase は偽物。API は差し替える。店の開業年・従業員数は Places に無いので、この2項目は取れない
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = process.env.SHOTS || '/tmp';
const BASE = process.argv[2] || 'http://localhost:8767';

const src = fs.readFileSync(path.join(__dirname, 'integration-test.js'), 'utf8');
const STUB = src.match(/const STUB = `([\s\S]*?)`;/)[1];

const DAYS = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((k) => [k, '11:00〜21:00']));
// 評価4.4・口コミ120件 → 評価4点・口コミ4点。平均は4点、10点満点で8.0
const SHOPS = [
  { id: 'p1', name: 'テスト寿司店', industry: '寿司・割烹', address: '東京都テスト区1-1', lat: 35.66, lng: 139.7, rating: 4.4, reviews: 120, opened: null, staff: null, insta: '', visited: false, hours: DAYS },
  // 評価4.0・口コミ60件 → 4点と3点。平均3.5点、10点満点で7.0
  { id: 'p2', name: 'テストラーメン店', industry: 'ラーメン・中華そば', address: '東京都テスト区2-2', lat: 35.661, lng: 139.701, rating: 4.0, reviews: 60, opened: null, staff: null, insta: '', visited: false, hours: DAYS },
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
      scores: [...c.querySelectorAll('.scores .score')].map((b) => ({ label: b.querySelector('span').textContent.trim(), value: b.querySelector('b').textContent.trim() })),
    })));
    const p1 = cards.find((c) => c.name === 'テスト寿司店');
    const p2 = cards.find((c) => c.name === 'テストラーメン店');

    // 1) 取れない項目（新しさ・成約しやすさ）は「—」で、3点で埋めない
    const fresh = p1 && p1.scores.find((s) => s.label === '新しさ');
    const fit = p1 && p1.scores.find((s) => s.label === '成約しやすさ');
    ok('新しさ・成約しやすさは、3点で埋めず「—」になる', fresh && fresh.value === '—' && fit && fit.value === '—', JSON.stringify({ fresh, fit }));
    ok('取れた項目（評価・口コミ）は、そのまま点数が出る', p1 && p1.scores.find((s) => s.label === '評価').value === '4' && p1.scores.find((s) => s.label === '口コミ').value === '4', '');

    // 2) おすすめ順の点数は、取れた項目（評価・口コミ）だけの平均になる
    ok('おすすめ順：取れた項目だけの平均（テスト寿司店 8.0）', p1 && p1.overall === '8.0', p1 && p1.overall);
    ok('おすすめ順：取れた項目だけの平均（テストラーメン店 7.0）', p2 && p2.overall === '7.0', p2 && p2.overall);

    // 3) 点数の計算を開くと、取れなかった項目は「未取得（平均に入れない）」
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.shop .overall').click());
    await wait(page, 400);
    const calc = await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.shop table.calc')?.textContent || '');
    ok('点数の計算：取れなかった項目は「未取得（平均に入れない）」と出る', calc.includes('未取得（平均に入れない）'), calc.slice(0, 80));
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.shop .overall').click());
    await wait(page, 300);

    // 4) 成約しやすさを開くと、未取得と分かる
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.shop .score[data-k="fit"]').click());
    await wait(page, 400);
    const fitDetail = await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.shop .detail-title')?.textContent || '');
    ok('成約しやすさを開くと「未取得（平均に入れていません）」と出る', fitDetail.includes('未取得（平均に入れていません）'), fitDetail);
    await page.screenshot({ path: `${SHOTS}/r26-scores.png` });

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
