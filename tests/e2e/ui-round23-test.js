// Round 23：提案リストの並び替えは上のバーのすぐ下（スクロールで連動）、一覧／地図はドックに、
// 「条件を変えてもう一度」「訪問予定を見る」は無し、業種の絞り込みは最初は閉じる（390px・変更箇所だけ）
// Firebase は偽物。API は差し替える
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
  { id: 'p4', name: 'テストカフェ', industry: 'カフェ', address: '東京都テスト区4-4', lat: 35.663, lng: 139.703, rating: 4.6, reviews: 210, opened: null, staff: null, insta: '', visited: false, hours: DAYS },
  { id: 'p5', name: 'テスト定食店', industry: '定食・食堂', address: '東京都テスト区5-5', lat: 35.664, lng: 139.704, rating: 4.1, reviews: 75, opened: null, staff: null, insta: '', visited: false, hours: DAYS },
  { id: 'p6', name: 'テストイタリアン', industry: 'イタリアン', address: '東京都テスト区6-6', lat: 35.665, lng: 139.705, rating: 3.8, reviews: 30, opened: null, staff: null, insta: '', visited: false, hours: DAYS },
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
    // 地図の画像（1×1の透明な PNG を返す。本番では地図の画像）
    if (u.endsWith('/api/ml-map')) return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });
  const sr = (fn, arg) => page.evaluate(fn, arg);
  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await wait(page, 1000);

    // マップリストで検索して、提案リストを出す
    await page.click('.app-seg[data-app="ml"]'); await wait(page, 1200);
    await sr(() => {
      const input = document.getElementById('mlHost').shadowRoot.querySelector('#addr');
      input.value = 'テスト区';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="run-search"]').click());
    await wait(page, 1000);

    // 1) 並び替えは、上のバーの中（タイトルのすぐ下）にある
    const bar = await page.evaluate(() => {
      const el = document.getElementById('mlSortBar');
      const top = document.querySelector('header.topbar');
      const h1 = document.querySelector('header.topbar h1');
      const r = el.getBoundingClientRect(), hr = h1.getBoundingClientRect();
      return {
        inHeader: top.contains(el),
        display: getComputedStyle(el).display,
        labels: [...el.querySelectorAll('.ml-sort-btn')].map((b) => b.textContent.trim()),
        on: [...el.querySelectorAll('.ml-sort-btn.on')].map((b) => b.textContent.trim()),
        belowTitle: r.top >= hr.bottom - 1 && r.top - hr.bottom < 40,
      };
    });
    ok('並び替え：上のバーの中にある（提案リストを開いているとき）', bar.inHeader && bar.display !== 'none', JSON.stringify({ in: bar.inHeader, d: bar.display }));
    ok('並び替え：タイトルのすぐ下に、おすすめ順・近い順・評価順', bar.belowTitle && bar.labels.join('/') === 'おすすめ順/近い順/評価順', JSON.stringify(bar.labels));
    ok('並び替え：今の並び（おすすめ順）に印がつく', bar.on.join() === 'おすすめ順', bar.on.join());
    const oldSort = await sr(() => !!document.getElementById('mlHost').shadowRoot.querySelector('#pSort'));
    ok('並び替え：提案リストの中の古い並び替えはない', !oldSort, '');
    await page.screenshot({ path: `${SHOTS}/r23-header.png` });

    // 2) 下にスクロールすると、上のバー（並び替えを含む）が消え、少し上へ戻すと出る
    const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    ok('（試験の前提）提案リストは下にスクロールできる', scrollable > 200, String(scrollable));
    await page.evaluate(() => window.scrollTo(0, 0)); await wait(page, 600);
    await page.evaluate(() => window.scrollTo(0, 400)); await wait(page, 900);
    const hid = await page.evaluate(() => ({
      cls: document.querySelector('header.topbar').classList.contains('hide'),
      op: parseFloat(getComputedStyle(document.querySelector('header.topbar')).opacity),
    }));
    ok('下にスクロール：並び替えを含む上のバーが消える', hid.cls && hid.op <= 0.05, JSON.stringify(hid));
    await page.evaluate(() => window.scrollTo(0, 380)); await wait(page, 900);
    const shown = await page.evaluate(() => ({
      cls: document.querySelector('header.topbar').classList.contains('hide'),
      op: parseFloat(getComputedStyle(document.querySelector('header.topbar')).opacity),
    }));
    ok('少し上へ戻すと：並び替えを含む上のバーが出てくる', !shown.cls && shown.op >= 0.95, JSON.stringify(shown));
    await page.evaluate(() => window.scrollTo(0, 0)); await wait(page, 500);

    // 3) 並び替えを押すと、並びが変わって印が移る
    await page.click('#mlSortBar [data-ml-sort="dist"]'); await wait(page, 600);
    const onAfter = await page.evaluate(() => [...document.querySelectorAll('#mlSortBar .ml-sort-btn.on')].map((b) => b.textContent.trim()).join());
    ok('並び替え：近い順を押すと、上のバーの印が近い順に移る', onAfter === '近い順', onAfter);
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelectorAll('#pList .shop-name').length);

    // 4) ドック：一覧／地図の切り替え（ドックの中）。「条件を変えてもう一度」「訪問予定を見る」はない
    const dock = await sr(() => {
      const sec = document.getElementById('mlHost').shadowRoot.querySelector('section[data-screen="proposal"]');
      const d = sec.querySelector('.dock');
      const r = d.getBoundingClientRect();
      const tabs = document.getElementById('mainNav').getBoundingClientRect();
      return {
        viewLabels: [...d.querySelectorAll('#pView button')].map((b) => b.textContent.trim()),
        on: [...d.querySelectorAll('#pView button.on')].map((b) => b.textContent.trim()).join(),
        aboveTabs: r.bottom <= tabs.top + 2,
        oldBtns: [...sec.querySelectorAll('button')].filter((b) => /条件を変えてもう一度|訪問予定を見る/.test(b.textContent)).length,
      };
    });
    ok('ドック：一覧／地図で見るの切り替えが、画面下のドックにある', dock.viewLabels.join('/') === '一覧/地図で見る' && dock.aboveTabs, JSON.stringify(dock));
    ok('ドック：「条件を変えてもう一度」「訪問予定を見る」はない', dock.oldBtns === 0, String(dock.oldBtns));
    await page.click('.app-seg[data-app="ml"]'); // 念のため：マップリストの中のまま
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('#pView [data-v="map"]').click());
    await wait(page, 700);
    const mapOn = await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('#pView button.on')?.dataset.v || '');
    ok('ドック：地図で見るに切り替えると、印が移る', mapOn === 'map', mapOn);
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('#pView [data-v="list"]').click());
    await wait(page, 500);
    const listOn = await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('#pView button.on')?.dataset.v || '');
    ok('ドック：一覧に戻せる', listOn === 'list', listOn);

    // 5) 業種で絞り込み：最初は閉じている。押すと開いて、チップが見える
    const fold1 = await sr(() => {
      const f = document.getElementById('mlHost').shadowRoot.querySelector('#pIndFold');
      return { open: f.open, sum: f.querySelector('#pIndSum').textContent.trim() };
    });
    ok('業種で絞り込み：最初は閉じている（選んだ業種がないときは「全業種」）', fold1.open === false && fold1.sum === '全業種', JSON.stringify(fold1));
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('#pIndFold > summary').click());
    await wait(page, 400);
    const fold2 = await sr(() => {
      const f = document.getElementById('mlHost').shadowRoot.querySelector('#pIndFold');
      return { open: f.open, chips: f.querySelectorAll('.chip').length };
    });
    ok('業種で絞り込み：押すと開いて、業種のチップが並ぶ', fold2.open === true && fold2.chips >= 3, JSON.stringify(fold2));
    await page.screenshot({ path: `${SHOTS}/r23-industry-open.png` });
    // 業種を1つ選ぶと、閉じていても名前が出る
    await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('#pInd .chip[data-name="寿司・割烹"]').click());
    await wait(page, 400);
    const picked = await sr(() => document.getElementById('mlHost').shadowRoot.querySelector('#pIndSum').textContent.trim());
    ok('業種で絞り込み：選んだ業種の名前が、閉じた行に小さく出る', picked === '寿司・割烹', picked);

    // 6) 再読み込み：開閉の状態と、選んだ業種が残る
    await page.reload({ waitUntil: 'domcontentloaded' });
    await wait(page, 1200);
    await page.click('.app-seg[data-app="ml"]'); await wait(page, 1200);
    const afterReload = await sr(() => {
      const f = document.getElementById('mlHost').shadowRoot.querySelector('#pIndFold');
      return { active: document.getElementById('mlHost').shadowRoot.querySelector('.screen.active')?.dataset.screen || '', open: f ? f.open : null, sum: f ? f.querySelector('#pIndSum').textContent.trim() : '' };
    });
    ok('再読み込み後：業種の一覧は開いたまま、選んだ業種も残る', afterReload.active === 'proposal' && afterReload.open === true && afterReload.sum === '寿司・割烹', JSON.stringify(afterReload));
    ok('再読み込み後：上のバーの並び替えの印が戻る（近い順）', (await page.evaluate(() => [...document.querySelectorAll('#mlSortBar .ml-sort-btn.on')].map((b) => b.textContent.trim()).join())) === '近い順', '');

    // 7) 完了報告に戻ると、並び替えのバーは出ない（マップリストの中だけ）
    await page.click('.app-seg[data-app="dc"]'); await wait(page, 700);
    const dcBar = await page.evaluate(() => getComputedStyle(document.getElementById('mlSortBar')).display);
    ok('完了報告に戻ると、並び替えのバーは出ない', dcBar === 'none', dcBar);

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
