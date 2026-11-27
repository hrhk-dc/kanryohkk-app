// Round 25：現在地を取ったら、その住所（何県・何市・何町）をボタンの下に出す。再読み込みしても残る。
// 提案の店カードの特徴の箇条書きを、データがあるかぎり4つにする（390px・変更箇所だけ）
// Firebase は偽物。API は差し替える（住所は既存の逆引きの応答を返す）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = process.env.SHOTS || '/tmp';
const BASE = process.argv[2] || 'http://localhost:8767';

const src = fs.readFileSync(path.join(__dirname, 'integration-test.js'), 'utf8');
const STUB = src.match(/const STUB = `([\s\S]*?)`;/)[1];

const LABEL = '東京都千代田区丸の内';
const DAYS = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((k) => [k, '11:00〜21:00']));
const SHOPS = [
  { id: 'p1', name: 'テスト寿司店', industry: '寿司・割烹', address: '東京都テスト区1-1', lat: 35.66, lng: 139.7, rating: 4.4, reviews: 120, opened: null, staff: null, insta: '', visited: false, hours: DAYS },
  { id: 'p2', name: 'テストラーメン店', industry: 'ラーメン・中華そば', address: '東京都テスト区2-2', lat: 35.661, lng: 139.701, rating: 4.0, reviews: 60, opened: null, staff: null, insta: '', visited: false, hours: DAYS },
  // データが少ない店（営業時間・SNSがない）：3つのままでよい
  // 営業時間は昼だけ（閉店が遅くない）、業種・SNSもない：データから作れる特徴は、評価・口コミ・近さの3つまで
  { id: 'p3', name: 'テスト定食店', industry: '', address: '東京都テスト区3-3', lat: 35.6602, lng: 139.7002, rating: 3.9, reviews: 40, opened: null, staff: null, insta: '', visited: false, hours: Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((k) => [k, '11:00〜15:00'])) },
];

const results = [];
const ok = (name, cond, extra = '') => results.push({ name, pass: !!cond, extra: String(extra) });
const wait = (page, ms) => page.waitForTimeout(ms);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, geolocation: { latitude: 35.66, longitude: 139.7 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('https://www.gstatic.com/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if (u.endsWith('/api/ml-geocode')) {
      let body = {};
      try { body = route.request().postDataJSON() || {}; } catch (e) { body = {}; }
      if (body.reverse) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, label: LABEL }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, lat: 35.66, lng: 139.7, label: 'テスト区', viewport: null }) });
    }
    if (u.endsWith('/api/ml-search')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, shops: SHOPS }) });
    if (u.endsWith('/api/ml-map')) return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
    if (/\/api\/(demo-url|demo-queue|maps-info)$/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: {}, demos: [] }) });
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });
  const sr = (fn, arg) => page.evaluate(fn, arg);
  const hereName = () => sr(() => document.getElementById('mlHost').shadowRoot.querySelector('#s-area .here-name')?.textContent.trim() || '');
  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await wait(page, 1000);

    // 1) 現在地を取る → ボタンの下に住所が出る
    await page.click('.app-seg[data-app="ml"]'); await wait(page, 1200);
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="area-mode"][data-v="gps"]').click());
    await wait(page, 300);
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="gps"]').click());
    await wait(page, 1000);
    const name1 = await hereName();
    ok('現在地を取ると、ボタンの下に住所（何県・何市・何町）が出る', name1 === LABEL, name1);
    const layout = await sr(() => {
      const btn = document.getElementById('mlHost').shadowRoot.querySelector('#s-area [data-act="gps"]').getBoundingClientRect();
      const here = document.getElementById('mlHost').shadowRoot.querySelector('#s-area .here').getBoundingClientRect();
      return { below: here.top >= btn.bottom - 1, width: Math.round(here.width) };
    });
    ok('住所の表示は、現在地のボタンのすぐ下にある', layout.below, JSON.stringify(layout));
    await page.screenshot({ path: `${SHOTS}/r25-here.png` });

    // 2) 再読み込みしても、住所が残る（検索条件と一緒に端末へ保存）
    await page.reload({ waitUntil: 'domcontentloaded' });
    await wait(page, 1200);
    await page.click('.app-seg[data-app="ml"]'); await wait(page, 1200);
    const name2 = await hereName();
    ok('再読み込みしても、住所が残る', name2 === LABEL, name2);

    // 3) 特徴の箇条書き：データがあれば4つ。データが少ない店は3つのまま
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="run-search"]').click());
    await wait(page, 1000);
    const counts = await sr(() => [...document.getElementById('mlHost').shadowRoot.querySelectorAll('#pList .shop')].map((c) => c.querySelectorAll('.reasons li').length));
    ok('特徴の箇条書き：4つの店がある', counts.some((n) => n === 4), JSON.stringify(counts));
    ok('特徴の箇条書き：5つ以上の店はない（4つまで）', counts.every((n) => n <= 4), JSON.stringify(counts));
    // 業種がない店には、業種の文を作らない（データが無いものは作らない）
    const noInd = await sr(() => {
      const card = [...document.getElementById('mlHost').shadowRoot.querySelectorAll('#pList .shop')].find((c) => c.querySelector('.shop-name').textContent.trim() === 'テスト定食店');
      return card ? card.querySelector('.reasons').textContent : null;
    });
    ok('特徴の箇条書き：業種がない店に、業種の文は出ない（データが無いものは作らない）', noInd !== null && !noInd.includes('業種は「'), (noInd || 'no card').slice(0, 60));
    const sample = await sr(() => [...document.getElementById('mlHost').shadowRoot.querySelector('#pList .shop .reasons').querySelectorAll('li')].map((li) => li.textContent.trim()).join(' / '));
    ok('特徴の内容が、店のデータから作られている（空の文ではない）', sample.length > 10 && !/undefined|null/.test(sample), sample.slice(0, 120));
    await page.screenshot({ path: `${SHOTS}/r25-reasons.png` });

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
