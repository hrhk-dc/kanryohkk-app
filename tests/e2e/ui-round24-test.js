// Round 24：地図画像をタップすると、全画面の画像ビューアが開く。拡大・縮小・移動・閉じる（390px・変更箇所だけ）
// Firebase は偽物。API は差し替える（地図は1×1の画像。拡大のときの取り直しは、送られた中心と拡大を記録して確かめる）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = process.env.SHOTS || '/tmp';
const BASE = process.argv[2] || 'http://localhost:8767';

const src = fs.readFileSync(path.join(__dirname, 'integration-test.js'), 'utf8');
const STUB = src.match(/const STUB = `([\s\S]*?)`;/)[1];

const DAYS = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((k) => [k, '11:00〜21:00']));
const SHOPS = [
  { id: 'p1', name: 'テスト寿司店', industry: '寿司・割烹', address: '東京都テスト区1-1', lat: 35.66, lng: 139.7, rating: 4.4, reviews: 120, opened: null, staff: null, insta: '', visited: false, hours: DAYS },
  { id: 'p2', name: 'テストラーメン店', industry: 'ラーメン・中華そば', address: '東京都テスト区2-2', lat: 35.661, lng: 139.701, rating: 4.0, reviews: 60, opened: null, staff: null, insta: '', visited: false, hours: DAYS },
  { id: 'p3', name: 'テスト焼鳥店', industry: '焼鳥・焼き鳥', address: '東京都テスト区3-3', lat: 35.662, lng: 139.702, rating: 3.9, reviews: 40, opened: null, staff: null, insta: '', visited: false, hours: DAYS },
];

const results = [];
const ok = (name, cond, extra = '') => results.push({ name, pass: !!cond, extra: String(extra) });
const wait = (page, ms) => page.waitForTimeout(ms);
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  const mapReqs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('https://www.gstatic.com/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if (u.endsWith('/api/ml-geocode')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, lat: 35.66, lng: 139.7, label: 'テスト区', viewport: null }) });
    if (u.endsWith('/api/ml-search')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, shops: SHOPS }) });
    if (u.endsWith('/api/ml-map')) {
      let body = {};
      try { body = route.request().postDataJSON() || {}; } catch (e) { body = {}; }
      mapReqs.push({ center: body.center || null, zoom: Number.isInteger(body.zoom) ? body.zoom : null });
      return route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG });
    }
    if (/\/api\/(demo-url|demo-queue|maps-info)$/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: {}, demos: [] }) });
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });
  const sr = (fn, arg) => page.evaluate(fn, arg);
  const viewerOpen = () => sr(() => !!document.getElementById('mlHost').shadowRoot.querySelector('.mv'));
  const zoomLabel = () => sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.mv .mv-zoom')?.textContent.trim() || '');
  const pct = (s) => parseInt(String(s).replace('%', ''), 10) || 0;
  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await wait(page, 1000);

    // マップリストで検索 → 提案リスト → 「地図で見る」
    await page.click('.app-seg[data-app="ml"]'); await wait(page, 1200);
    await sr(() => {
      const input = document.getElementById('mlHost').shadowRoot.querySelector('#addr');
      input.value = 'テスト区';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="run-search"]').click());
    await wait(page, 900);
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('#pView [data-v="map"]').click());
    await wait(page, 900);
    const hasMap = await sr(() => !!document.getElementById('mlHost').shadowRoot.querySelector('.map-open img.map-img'));
    ok('地図：「地図で見る」の画像が出る（タップできる）', hasMap, '');
    const firstReq = mapReqs[0] || null;
    ok('地図：最初の画像は、店が全部入る中心と拡大で取る', firstReq && firstReq.center && Number.isInteger(firstReq.zoom), JSON.stringify(firstReq));
    await page.screenshot({ path: `${SHOTS}/r24-map.png` });

    // 1) 地図画像をタップすると、全画面のビューアが開く
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.map-open').click());
    await wait(page, 500);
    ok('タップすると、全画面の画像ビューアが開く', await viewerOpen(), '');
    const full = await sr(() => {
      const el = document.getElementById('mlHost').shadowRoot.querySelector('.mv');
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), z: getComputedStyle(el).position };
    });
    ok('ビューアは画面いっぱい（390px）', full.w === 390 && full.h === 844 && full.z === 'fixed', JSON.stringify(full));
    // 画面の右上（三本線のボタンがある辺り）で、一番手前にあるのはビューアか
    const topIsViewer = await sr(() => {
      const root = document.getElementById('mlHost').shadowRoot;
      const el = root.elementFromPoint(380, 40);
      return !!(el && el.closest('.mv'));
    });
    ok('ビューアは、上の三本線などのボタンより手前にある', topIsViewer, '');
    await page.screenshot({ path: `${SHOTS}/r24-viewer.png` });

    // 2) 拡大・縮小（＋／−）と、全体に戻す
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.mv [data-mv="in"]').click());
    await wait(page, 400);
    const z1 = pct(await zoomLabel());
    ok('＋ボタン：拡大される（100%より大きい）', z1 > 100, String(z1));
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.mv [data-mv="out"]').click());
    await wait(page, 400);
    const z0 = pct(await zoomLabel());
    ok('−ボタン：縮小される（元に戻る）', z0 === 100, String(z0));
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.mv [data-mv="in"]').click());
    await wait(page, 400);
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.mv [data-mv="reset"]').click());
    await wait(page, 400);
    ok('全体：元の大きさに戻る', pct(await zoomLabel()) === 100, await zoomLabel());

    // 3) ダブルタップで拡大（同じ場所を続けて押す）
    const box = await sr(() => {
      const r = document.getElementById('mlHost').shadowRoot.querySelector('.mv .mv-stage').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(box.x, box.y);
    await page.mouse.click(box.x, box.y);
    await wait(page, 500);
    const zd = pct(await zoomLabel());
    ok('ダブルタップで拡大する', zd > 100, String(zd));

    // 4) ホイール（ピンチの代わりに、マウスでも拡大・縮小できる）
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.mv [data-mv="reset"]').click());
    await wait(page, 400);
    await page.mouse.move(box.x, box.y);
    await page.mouse.wheel(0, -300);
    await wait(page, 500);
    ok('ホイールで拡大できる', pct(await zoomLabel()) > 100, await zoomLabel());

    // 5) 拡大したあと、ドラッグで移動できる（画像の位置が変わる）
    const tf = () => sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.mv .mv-pic').style.transform);
    const before = await tf();
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 40, { steps: 6 });
    await page.mouse.up();
    // 指を離してすぐ読む（離したあとは、詳しい地図を取り直して、中心を合わせ直す）
    await wait(page, 120);
    const after = await tf();
    ok('拡大したあと、ドラッグで位置が動く', before !== after, `${before} → ${after}`);

    // 6) 拡大して見るとき、詳しい地図を取り直す（中心と拡大を指定して、既存の /api/ml-map に送る）
    const lastReq = mapReqs[mapReqs.length - 1] || null;
    ok('拡大したら、詳しい地図を中心と拡大つきで取り直す', !!lastReq && lastReq.center && lastReq.zoom > firstReq.zoom, JSON.stringify({ first: firstReq, last: lastReq }));

    // 7) 閉じる：下へスワイプ（元の大きさのとき）
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.mv [data-mv="reset"]').click());
    await wait(page, 500);
    const sbox = await sr(() => {
      const r = document.getElementById('mlHost').shadowRoot.querySelector('.mv .mv-stage').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 150 };
    });
    await page.mouse.move(sbox.x, sbox.y);
    await page.mouse.down();
    await page.mouse.move(sbox.x, sbox.y + 220, { steps: 8 });
    await page.mouse.up();
    await wait(page, 400);
    ok('下へスワイプすると閉じる', !(await viewerOpen()), '');

    // 8) 閉じる：× ボタン
    await page.click('.map-open'); await wait(page, 400);
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.mv .mv-close').click());
    await wait(page, 300);
    ok('× ボタンで閉じる', !(await viewerOpen()), '');

    // 9) 閉じる：Esc キー
    await page.click('.map-open'); await wait(page, 400);
    await page.keyboard.press('Escape'); await wait(page, 300);
    ok('Escキーで閉じる', !(await viewerOpen()), '');

    // 10) 一覧と地図の切り替え・ピンの番号と店の並びは、そのまま
    const order = await sr(() => [...document.getElementById('mlHost').shadowRoot.querySelectorAll('.map-order .pin-no')].map((e) => e.textContent.trim()).join(''));
    ok('地図の番号（ピン）と店の並びは、そのまま（1, 2, 3…）', order.startsWith('123'), order);
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('#pView [data-v="list"]').click());
    await wait(page, 500);
    const listNow = await sr(() => !!document.getElementById('mlHost').shadowRoot.querySelector('#pList .shop'));
    ok('一覧に戻せる', listNow, '');

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
