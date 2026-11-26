// Round 20：マップリストの「訪問リスト」を「訪問予定」にし、マップリストから入れた訪問だけを出す（390px）
// Firebase は偽物（試験用に訪問の出し入れを窓から見せる）。API は差し替える。完了報告の「訪問リスト」は変えない
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = process.env.SHOTS || '/tmp';
const BASE = process.argv[2] || 'http://localhost:8767';

const src = fs.readFileSync(path.join(__dirname, 'integration-test.js'), 'utf8');
// 試験用：偽物の訪問の一覧と、更新の合図を窓から使えるようにする
const STUB = src.match(/const STUB = `([\s\S]*?)`;/)[1] + '\nwindow.__stubVisits = VISITS; window.__stubNotify = notify;\n';

const SHOTS_SHOPS = [
  { id: 'place-A', name: 'テスト寿司店', industry: '寿司・割烹', address: '東京都テスト区1-1', lat: 35.66, lng: 139.7, rating: 4.4, reviews: 120, opened: null, staff: null, insta: '', visited: false,
    hours: Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((k) => [k, '11:30〜14:00'])) },
  { id: 'place-B', name: 'テストラーメン店', industry: 'ラーメン・中華そば', address: '東京都テスト区2-2', lat: 35.661, lng: 139.701, rating: 4.0, reviews: 60, opened: null, staff: null, insta: '', visited: false,
    hours: Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((k) => [k, '10:00〜20:00'])) },
];

const results = [];
const ok = (name, cond, extra = '') => results.push({ name, pass: !!cond, extra: String(extra) });

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
    if (u.endsWith('/api/ml-search')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, shops: SHOTS_SHOPS }) });
    if (/\/api\/(demo-url|demo-queue|maps-info)$/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: {}, demos: [] }) });
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });
  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // 1) 完了報告（DC）の「訪問リスト」は変わらない（メニューと下のタブ）
    const dcLabels = await page.evaluate(() => ({
      menu: document.querySelector('#menuPanel [data-menu-tab="visits"] span')?.textContent.trim() || '',
      bar: document.querySelector('#mainNav [data-tab="visits"] span')?.textContent.trim() || '',
    }));
    ok('完了報告：メニューの「訪問リスト」は変わらない', dcLabels.menu === '訪問リスト', dcLabels.menu);
    ok('完了報告：下のタブの「訪問リスト」は変わらない', dcLabels.bar === '訪問リスト', dcLabels.bar);

    // 2) 手で入れた完了報告の訪問（マップリストの印なし）を、試験用に直接置く
    await page.evaluate(() => {
      window.__stubVisits.unshift({
        id: 'manual1', caseNo: 'M001', visitDate: '', order: 0, authorUid: 'u1', authorEmail: 'tester',
        items: [
          { id: 'shopName', label: '店舗名', type: 'text', value: 'DC手入力店' },
          { id: 'mapsUrl', label: 'GoogleマップのURL', type: 'maps', value: 'https://www.google.com/maps/place/?q=place_id:ChIJmanual' },
        ],
      });
      window.__stubNotify();
    });
    await page.waitForTimeout(400);

    // 3) マップリストに切り替え、検索 → 提案 → 「訪問予定に追加」（マップリストから入れる）
    await page.click('.app-seg[data-app="ml"]');
    await page.waitForTimeout(1200);
    const navItems = await page.evaluate(() => [...document.querySelectorAll('#mainNav .ml-tab')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.textContent.trim()));
    ok('マップリスト：下のタブの3つ目は「訪問予定」', navItems.join('/') === '検索/提案リスト/訪問予定/後で訪問', navItems.join('/'));
    await page.evaluate(() => {
      const sr = document.getElementById('mlHost').shadowRoot;
      const input = sr.querySelector('#addr');
      input.value = 'テスト区';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="run-search"]').click());
    await page.waitForTimeout(900);
    await page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('#pList [data-act="add"][data-id="place-A"]').click());
    await page.waitForTimeout(900);

    // 4) マップリストの「訪問予定」の画面：見出し・中身
    await page.evaluate(() => { document.querySelector('#mainNav [data-ml-nav="list"]').click(); });
    await page.waitForTimeout(300);
    const mlList = await page.evaluate(() => {
      const sr = document.getElementById('mlHost').shadowRoot;
      const active = sr.querySelector('.screen.active')?.dataset.screen || '';
      const sec = sr.querySelector('section[data-screen="list"]');
      return {
        active,
        heading: sec ? sec.querySelector('h1')?.textContent.trim() : '',
        ariaLabel: sec ? sec.getAttribute('aria-label') : '',
        names: [...sr.querySelectorAll('#lList .shop-name')].map((e) => e.textContent.trim()),
        hScroll: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    ok('マップリスト：下のタブを押すと「訪問予定」の画面が出る', mlList.active === 'list', mlList.active);
    ok('マップリスト：画面の見出しは「訪問予定」', mlList.heading === '訪問予定' && mlList.ariaLabel === '訪問予定', JSON.stringify({ h: mlList.heading, a: mlList.ariaLabel }));
    ok('マップリスト訪問予定：マップリストから入れた店が出る', mlList.names.includes('テスト寿司店'), JSON.stringify(mlList.names));
    ok('マップリスト訪問予定：手で入れた完了報告の訪問は出ない', !mlList.names.includes('DC手入力店'), JSON.stringify(mlList.names));
    ok('390px：マップリストの訪問予定で横スクロールなし', !mlList.hScroll);
    await page.screenshot({ path: `${SHOTS}/r20-ml-plan.png` });

    // 5) 窓口の一覧も同じ：マップリストから入れた訪問だけ
    const bridgeIds = await page.evaluate(() => window.dcVisitBridge.list().map((x) => x.id));
    ok('窓口の訪問予定：マップリストの店だけ（手で入れた訪問は入らない）', bridgeIds.includes('place-A') && !bridgeIds.includes('manual1') && !bridgeIds.includes('ChIJmanual'), JSON.stringify(bridgeIds));

    // 6) 後で訪問は変わらない：移すと後で訪問に出て、訪問予定からは外れる。戻すと訪問予定に戻る
    await page.evaluate(() => window.dcVisitBridge.setLater('place-A', true));
    await page.waitForTimeout(300);
    const laterState = await page.evaluate(() => ({
      plan: window.dcVisitBridge.list().map((x) => x.id),
      later: window.dcVisitBridge.laterList().map((x) => x.id),
    }));
    ok('後で訪問：移すと、訪問予定から外れて後で訪問に入る', !laterState.plan.includes('place-A') && laterState.later.includes('place-A'), JSON.stringify(laterState));
    await page.evaluate(() => window.dcVisitBridge.setLater('place-A', false));
    await page.waitForTimeout(300);
    const backState = await page.evaluate(() => ({
      plan: window.dcVisitBridge.list().map((x) => x.id),
      later: window.dcVisitBridge.laterList().map((x) => x.id),
    }));
    ok('後で訪問：戻すと、訪問予定に戻って後で訪問からは外れる', backState.plan.includes('place-A') && !backState.later.includes('place-A'), JSON.stringify(backState));

    // 7) 完了報告に戻る：手で入れた訪問は完了報告の一覧に残り、マップリストの店は予定にも報告の自動入力にも出る
    await page.click('.app-seg[data-app="dc"]');
    await page.waitForTimeout(700);
    await page.click('#menuBtn'); await page.waitForTimeout(250);
    await page.click('#menuPanel [data-menu-tab="visits"]'); await page.waitForTimeout(400);
    await page.click('#visitShowAll'); await page.waitForTimeout(400);
    const dcList = await page.textContent('#visitList');
    ok('完了報告の訪問リスト：手で入れた訪問も出る（変わらない）', dcList.includes('DC手入力店'), dcList.slice(0, 120));
    ok('完了報告の訪問リスト：マップリストの店も出る（変わらない）', dcList.includes('テスト寿司店'), dcList.slice(0, 120));
    await page.click('#menuBtn'); await page.waitForTimeout(250);
    await page.click('#menuPanel [data-menu-tab="today"]'); await page.waitForTimeout(400);
    await page.click('#todaySeg [data-day="1"]'); await page.waitForTimeout(400);
    const tomorrow = await page.textContent('#todayVisits');
    ok('完了報告の予定（明日）：マップリストの店が出る', tomorrow.includes('テスト寿司店'), tomorrow.slice(0, 80));
    await page.click('#menuBtn'); await page.waitForTimeout(250);
    await page.click('#menuPanel [data-menu-tab="form"]'); await page.waitForTimeout(400);
    await page.fill('#reportCases [data-field-id="caseNo"]', 'A001');
    await page.dispatchEvent('#reportCases [data-field-id="caseNo"]', 'change');
    await page.waitForTimeout(250);
    const autoName = await page.$eval('#reportCases [data-field-id="visitTo"]', (el) => el.value).catch(() => '');
    ok('完了報告の自動入力：A001で訪問先「テスト寿司店」が入る', autoName === 'テスト寿司店', autoName);
    ok('390px：完了報告で横スクロールなし', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));

    ok('コンソールエラーなし', errors.length === 0, errors.join(' | '));
  } finally {
    await browser.close();
  }
  let fail = 0;
  for (const r of results) { if (!r.pass) fail++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? '  [' + r.extra + ']' : ''}`); }
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e.message.split('\n')[0]); process.exit(2); });
