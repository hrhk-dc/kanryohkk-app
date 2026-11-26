// 下のタブ・上のバー・「提案リストを作る」の動き（両モード）の確認。Firebase は偽物、API は応答を差し替える
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = process.env.SHOTS || '/tmp';
const BASE = process.argv[2] || 'http://localhost:8767';

// 結合テストと同じ偽物・同じ店のデータを使う（テストごとに二重管理しない）
const src = fs.readFileSync(path.join(__dirname, 'integration-test.js'), 'utf8');
const STUB = src.match(/const STUB = `([\s\S]*?)`;/)[1];
const SHOPS = eval('(' + src.match(/const SHOPS = (\[[\s\S]*?\n\]);/)[1] + ')');

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
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon|apple-touch/.test(r.url())) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('https://www.gstatic.com/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if (u.endsWith('/api/ml-geocode')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, lat: 35.66, lng: 139.7, label: 'テスト区', viewport: null }) });
    if (u.endsWith('/api/ml-search')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, shops: SHOPS }) });
    if (/\/api\/(demo-url|demo-queue|maps-info)$/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: {}, demos: [] }) });
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });

  // 上のバーと下のタブの状態（ヘッダー・棒は、どこにあっても同じ要素）
  const state = () => page.evaluate(() => ({
    navHidden: document.querySelector('#mainNav').classList.contains('hide'),
    topHidden: document.querySelector('.topbar').classList.contains('hide'),
    dockDrop: getComputedStyle(document.documentElement).getPropertyValue('--dock-drop').trim(),
  }));
  // 下へ大きく動かして隠し、少しだけ上へ動かして出す（3px より少し大きい動き）
  const scrollDownThenUp = async () => {
    await page.evaluate(() => window.scrollTo(0, 300)); await wait(page, 700);
    const down = await state();
    await page.evaluate(() => window.scrollTo(0, 296)); await wait(page, 700); // 4px だけ上へ
    const up = await state();
    await page.evaluate(() => window.scrollTo(0, 0)); await wait(page, 500);
    return { down, up };
  };
  const longPage = () => page.evaluate(() => { document.body.style.minHeight = '2400px'; });

  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await wait(page, 1000);
    await longPage();

    // 1) 完了報告のモード：6つのタブが出て、マップリストの4つは出ない
    const dcTabs = await page.evaluate(() => [...document.querySelectorAll('#mainNav > .tab')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.textContent.trim()));
    ok('完了報告：下のタブは6つ（予定・訪問リスト・完了報告・報告一覧・集計・管理）', dcTabs.length === 6 && dcTabs[0] === '予定', JSON.stringify(dcTabs));

    // 2) 完了報告：下へ隠れ、少し上へで出る。上のバーも同じ
    const dc = await scrollDownThenUp();
    ok('完了報告：下へスクロールで下のタブと上のバーが隠れる', dc.down.navHidden && dc.down.topHidden, JSON.stringify(dc.down));
    ok('完了報告：4pxだけ上へ動かすと、下のタブと上のバーが出てくる', !dc.up.navHidden && !dc.up.topHidden, JSON.stringify(dc.up));

    // 3) マップリストへ切り替え：棒は同じ要素のまま body に出て、マップリストの4つになる
    await page.click('.app-seg[data-app="ml"]'); await wait(page, 1000);
    await longPage();
    const ml = await page.evaluate(() => {
      const nav = document.querySelector('#mainNav');
      const shown = [...nav.querySelectorAll(':scope > .tab')].filter((b) => getComputedStyle(b).display !== 'none');
      return {
        inBody: nav.parentElement === document.body,
        labels: shown.map((b) => b.textContent.trim()),
        active: shown.filter((b) => b.classList.contains('active')).map((b) => b.textContent.trim()),
        navStyle: { bg: getComputedStyle(nav).backgroundColor, pos: getComputedStyle(nav).position },
      };
    });
    ok('マップリスト：下のタブは4つ（検索・提案リスト・訪問予定・後で訪問）', ml.labels.join('/') === '検索/提案リスト/訪問予定/後で訪問', JSON.stringify(ml.labels));
    ok('マップリスト：棒は完了報告と同じ要素（body に出る・固定）', ml.inBody && ml.navStyle.pos === 'fixed', JSON.stringify(ml.navStyle));
    ok('マップリスト：最初の画面（検索）が選ばれている', ml.active.join() === '検索', ml.active.join());
    await page.screenshot({ path: `${SHOTS}/r17-ml-tabs.png` });

    // 4) マップリストの下のタブで画面が切り替わり、選ばれている印も移る
    await page.evaluate(() => document.querySelector('#mainNav [data-ml-nav="list"]').click()); await wait(page, 400);
    const afterTab = await page.evaluate(() => ({
      screen: document.getElementById('mlHost').shadowRoot.querySelector('.screen.active')?.dataset.screen || '',
      active: [...document.querySelectorAll('#mainNav .ml-tab.active')].map((b) => b.dataset.mlNav),
    }));
    ok('マップリスト：下のタブで「訪問予定」の画面に切り替わり、印も移る', afterTab.screen === 'list' && afterTab.active.join() === 'list', JSON.stringify(afterTab));

    // 5) マップリストのモードでも、同じ動き（隠れて、少し上で出る。上のバーも）
    await page.evaluate(() => document.querySelector('#mainNav [data-ml-nav="search"]').click()); await wait(page, 400);
    const mlScroll = await scrollDownThenUp();
    ok('マップリスト：下へスクロールで下のタブと上のバーが隠れる', mlScroll.down.navHidden && mlScroll.down.topHidden, JSON.stringify(mlScroll.down));
    ok('マップリスト：4pxだけ上へ動かすと、下のタブと上のバーが出てくる', !mlScroll.up.navHidden && !mlScroll.up.topHidden, JSON.stringify(mlScroll.up));

    // 6) 「提案リストを作る」：下のタブが隠れると、ボタンが下へずれる。出てくると元の位置へ戻る（スライド）
    const dockAt = () => page.evaluate(() => {
      const d = document.getElementById('mlHost').shadowRoot.querySelector('.dock');
      const m = getComputedStyle(d).transform;
      return { transform: m, trans: getComputedStyle(d).transition };
    });
    await page.evaluate(() => window.scrollTo(0, 300)); await wait(page, 700);
    const dockHidden = await dockAt();
    const ty = dockHidden.transform === 'none' ? 0 : parseFloat(dockHidden.transform.split(',')[5]);
    ok('提案リストを作る：下のタブが隠れると、ボタンが下へずれる（約74px）', ty > 60 && ty < 90, JSON.stringify(dockHidden));
    ok('提案リストを作る：ずれるのはゆっくり（0.45秒のスライド）', /transform 0\.45s/.test(dockHidden.trans), dockHidden.trans);
    await page.evaluate(() => window.scrollTo(0, 296)); await wait(page, 700);
    const dockBack = await dockAt();
    const back = dockBack.transform === 'none' ? 0 : parseFloat(dockBack.transform.split(',')[5]);
    ok('提案リストを作る：上へ動かして下のタブが出ると、元の位置に戻る', back === 0, JSON.stringify(dockBack));
    await page.evaluate(() => window.scrollTo(0, 0)); await wait(page, 500);

    // 7) 完了報告へ戻すと、完了報告の6タブが元どおり出る（マップリストの4つは隠れる）
    await page.click('.app-seg[data-app="dc"]'); await wait(page, 900);
    const back2 = await page.evaluate(() => ({
      dc: [...document.querySelectorAll('#mainNav > .tab')].filter((b) => getComputedStyle(b).display !== 'none').length,
      ml: [...document.querySelectorAll('#mainNav > .ml-tab')].filter((b) => getComputedStyle(b).display !== 'none').length,
      inApp: document.getElementById('appView').contains(document.getElementById('mainNav')),
    }));
    ok('完了報告に戻る：6つのタブが戻り、マップリストの4つは出ない', back2.dc === 6 && back2.ml === 0 && back2.inApp, JSON.stringify(back2));
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
