// Round 31：地図は対話式（Leaflet＋OpenStreetMap）。店の番号ピンをタップで選ぶ。現在地の青い点。
// 並び替えは上に張り付く。半径は4択。業種は「全て・飲食店・飲食店以外」。三本線ボタンは指で動かして端に吸着・保存（390px・変更箇所だけ）
// Firebase は偽物。API は差し替える。地図のタイルは1×1の画像に差し替える（地図の画面が動くことを確かめる）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = process.env.SHOTS || '/tmp';
const BASE = process.argv[2] || 'http://localhost:8767';

const src = fs.readFileSync(path.join(__dirname, 'integration-test.js'), 'utf8');
const STUB = src.match(/const STUB = `([\s\S]*?)`;/)[1];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const DAYS = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((k) => [k, '11:00〜21:00']));
const SHOPS = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: 'm' + n, name: 'テスト地図' + n, industry: n % 2 ? '寿司・割烹' : 'ラーメン・中華そば', address: '東京都テスト区' + n,
  lat: 35.66 + n * 0.0004, lng: 139.7 + n * 0.0004, rating: 4.0 + n * 0.05, reviews: 60 + n * 10, priceLevel: 'PRICE_LEVEL_MODERATE',
  opened: null, staff: null, insta: '', visited: false, hours: DAYS,
}));

const results = [];
const ok = (name, cond, extra = '') => results.push({ name, pass: !!cond, extra: String(extra) });
const wait = (page, ms) => page.waitForTimeout(ms);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1,
    geolocation: { latitude: 35.66, longitude: 139.7 }, permissions: ['geolocation'],
  });
  const page = await ctx.newPage();
  const errors = [];
  let tiles = 0;
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('https://www.gstatic.com/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if (u.startsWith('https://tile.openstreetmap.org/')) { tiles += 1; return route.fulfill({ status: 200, contentType: 'image/png', body: PNG }); }
    if (u.endsWith('/api/ml-geocode')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, lat: 35.66, lng: 139.7, label: 'テスト区', viewport: null }) });
    if (u.endsWith('/api/ml-search')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, shops: SHOPS, hasMore: false }) });
    if (/\/api\/(demo-url|demo-queue|maps-info)$/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: {}, demos: [] }) });
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });
  const sr = (fn, arg) => page.evaluate(fn, arg);
  const root = () => sr(() => document.getElementById('mlHost').shadowRoot.querySelector('.leaflet-container') ? 'yes' : 'no');
  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await wait(page, 1000);
    await page.click('.app-seg[data-app="ml"]'); await wait(page, 1200);

    // 1) 半径は4択（1km・2km・3km・5km）。業種は「全て・飲食店・飲食店以外」
    const choices = await sr(() => ({
      radius: [...document.getElementById('mlHost').shadowRoot.querySelectorAll('[data-act="radius"]')].map((b) => b.textContent.trim()),
      ind: [...document.getElementById('mlHost').shadowRoot.querySelectorAll('#s-ind .seg button')].map((b) => b.textContent.trim()),
    }));
    ok('半径は4択：1km・2km・3km・5km', choices.radius.join('/') === '1km/2km/3km/5km', choices.radius.join('/'));
    ok('業種は3択の並び：全て・飲食店・飲食店以外', choices.ind.join('/') === '全て/飲食店/飲食店以外', choices.ind.join('/'));

    // 2) 地図：対話式（Leaflet）。タイルを読み、店の番号ピンが並ぶ
    await sr(() => {
      const input = document.getElementById('mlHost').shadowRoot.querySelector('#addr');
      input.value = 'テスト区';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="run-search"]').click());
    await wait(page, 900);
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('#pView [data-v="map"]').click());
    await wait(page, 1500);
    ok('地図は対話式（Leaflet の地図が出ている）', (await root()) === 'yes', '');
    const pins = await sr(() => document.getElementById('mlHost').shadowRoot.querySelectorAll('.lp-pin').length);
    const listN = await sr(() => document.getElementById('mlHost').shadowRoot.querySelectorAll('#pList ol.map-order li').length);
    ok('店の番号ピンが、一覧と同じ数だけ並ぶ（件数の指定はなし・候補の数どおり）', pins === listN && pins > 0, `pins=${pins} list=${listN}`);
    ok('地図のタイルは OpenStreetMap から読んでいる', tiles > 0, String(tiles));
    ok('自分の位置の青い点は、まだ出ない（現在地を取っていない）', (await sr(() => document.getElementById('mlHost').shadowRoot.querySelectorAll('.lp-me').length)) === 0, '');

    // 3) ピンをタップすると、その店が選ばれる（店名・一覧の印が同じになる）
    // 番号「2」のピンを押す（ピンは緯度の順に並ぶので、番号で探す）。期待するのは、番号「2」の行の店
    const twoName = await sr(() => {
      const root = document.getElementById('mlHost').shadowRoot;
      const name = root.querySelectorAll('.map-order li')[1].querySelector('.map-name').textContent.trim();
      const pin = [...root.querySelectorAll('.lp-pin')].find((p) => p.textContent.trim() === '2');
      if (pin) pin.click();
      return name;
    });
    await wait(page, 400);
    const sel = await sr(() => ({
      text: document.getElementById('mlHost').shadowRoot.querySelector('#mapSel').textContent,
      on: [...document.getElementById('mlHost').shadowRoot.querySelectorAll('.map-order li.on .map-name')].map((e) => e.textContent.trim()),
      pinOn: [...document.getElementById('mlHost').shadowRoot.querySelectorAll('.lp-pin.on')].length,
    }));
    ok('ピンをタップすると、その店名が下に出る', sel.text.includes(twoName), sel.text);
    ok('ピンと一覧の印が、同じ店になる', sel.on.join() === twoName && sel.pinOn === 1, JSON.stringify(sel));
    await page.screenshot({ path: `${SHOTS}/r31-map.png` });

    // 4) 一覧の店を押すと、その店が選ばれ、地図もその店へ動く
    const fourName = await sr(() => {
      const li = document.getElementById('mlHost').shadowRoot.querySelectorAll('.map-order li')[3];
      const name = li.querySelector('.map-name').textContent.trim();
      li.click();
      return name;
    });
    await wait(page, 500);
    const pick = await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('#mapSel').textContent);
    ok('一覧の店を押すと、その店が選ばれる', pick.includes(fourName), pick);

    // 5) 現在地を取得すると、地図に青い点が出る
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="area-mode"][data-v="gps"]').click());
    await wait(page, 300);
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="gps"]').click());
    await wait(page, 900);
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="run-search"]').click());
    await wait(page, 900);
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('#pView [data-v="map"]').click());
    await wait(page, 1200);
    ok('現在地を取得済みのとき、地図に自分の位置（青い点）が出る', (await sr(() => document.getElementById('mlHost').shadowRoot.querySelectorAll('.lp-me').length)) === 1, '');

    // 6) 全画面の地図（× か Esc で閉じる）
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="map-full"]').click());
    await wait(page, 1200);
    ok('「全画面で見る」で、全画面の地図が開く', (await sr(() => document.getElementById('mlHost').shadowRoot.querySelectorAll('.mapfull .leaflet-container').length)) === 1, '');
    await page.keyboard.press('Escape'); await wait(page, 400);
    ok('Esc で、全画面の地図が閉じる', (await sr(() => document.getElementById('mlHost').shadowRoot.querySelectorAll('.mapfull').length)) === 0, '');

    // 7) 並び替えは上に張り付く（一覧の表示で、下へスクロールしても出たまま）
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('#pView [data-v="list"]').click());
    await wait(page, 500);
    await page.evaluate(() => window.scrollTo(0, 0)); await wait(page, 500);
    await page.evaluate(() => window.scrollTo(0, 500)); await wait(page, 900);
    const stick = await page.evaluate(() => {
      const w = document.querySelector('.ml-sort-wrap');
      const r = w.getBoundingClientRect();
      return { pos: getComputedStyle(w).position, top: Math.round(r.top), op: getComputedStyle(w).opacity, display: getComputedStyle(w).display, hdrHidden: document.querySelector('header.topbar').classList.contains('hide') };
    });
    ok('下へスクロールしても、並び替えは上に張り付いたまま見える', stick.pos === 'sticky' && stick.display !== 'none' && stick.top <= 1 && stick.op === '1' && stick.hdrHidden, JSON.stringify(stick));
    await page.evaluate(() => window.scrollTo(0, 0)); await wait(page, 500);

    // 8) 三本線ボタン：指で動かして端に吸着。位置は保存（再読み込みで同じ）。タップはメニューを開く
    const before = await page.evaluate(() => document.getElementById('menuBtn').getBoundingClientRect().left);
    const bb = await page.evaluate(() => { const r = document.getElementById('menuBtn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(bb.x, bb.y); await page.mouse.down();
    await page.mouse.move(bb.x - 150, bb.y + 60, { steps: 6 });
    await page.mouse.move(14, 420, { steps: 6 });
    await page.mouse.up(); await wait(page, 500);
    const snap = await page.evaluate(() => { const r = document.getElementById('menuBtn').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; });
    const saved = await page.evaluate(() => localStorage.getItem('menuBtnPos'));
    ok('三本線ボタンは、指で動かすと、左の端に吸着する', snap.left <= 10 && before > 200, JSON.stringify({ before, snap }));
    ok('吸着した端と位置を、端末に保存する', saved && JSON.parse(saved).edge === 'left', saved);
    await page.reload({ waitUntil: 'domcontentloaded' }); await wait(page, 1200);
    const again = await page.evaluate(() => { const r = document.getElementById('menuBtn').getBoundingClientRect(); return Math.round(r.left); });
    ok('再読み込みしても、同じ位置（左の端）に出る', again <= 10, String(again));
    await page.click('#menuBtn'); await wait(page, 300);
    ok('タップ（動かさない）は、今まで通りメニューを開く', (await page.evaluate(() => document.getElementById('menuLayer').classList.contains('open'))), '');
    await page.keyboard.press('Escape'); await wait(page, 300);

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
