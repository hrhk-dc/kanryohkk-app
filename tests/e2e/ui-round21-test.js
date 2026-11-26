// Round 21：三本線メニューの中身を減らし、元に戻す・やり直すをヘッダーのタイトルの下へ（390px・変更箇所だけ）
// Firebase は偽物。API は差し替える。試験用に訪問の出し入れを窓から見せる
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = process.env.SHOTS || '/tmp';
const BASE = process.argv[2] || 'http://localhost:8767';

const src = fs.readFileSync(path.join(__dirname, 'integration-test.js'), 'utf8');
const STUB = src.match(/const STUB = `([\s\S]*?)`;/)[1] + '\nwindow.__stubVisits = VISITS; window.__stubNotify = notify;\n';

const SHOPS = [
  { id: 'place-A', name: 'テスト寿司店', industry: '寿司・割烹', address: '東京都テスト区1-1', lat: 35.66, lng: 139.7, rating: 4.4, reviews: 120, opened: null, staff: null, insta: '', visited: false,
    hours: Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((k) => [k, '11:30〜14:00'])) },
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
  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await wait(page, 1000);

    // 1) 三本線メニュー（完了報告）：残るのは リンクをコピー・名前を設定・ログアウト・メール だけ
    await page.click('#menuBtn'); await wait(page, 300);
    const menu = await page.evaluate(() => {
      const visible = (el) => !!el && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
      const items = [...document.querySelectorAll('#menuPanel .menu-item')].filter(visible).map((e) => e.textContent.trim());
      const email = document.getElementById('userEmail')?.textContent.trim() || '';
      return {
        items,
        email,
        tabsLeft: document.querySelectorAll('#menuPanel [data-menu-tab]:not([data-menu-tab="about"])').length,
        undoInMenu: !!document.querySelector('#menuPanel #undoBtn, #menuPanel #redoBtn'),
        maplistLink: !!document.querySelector('#menuPanel a[href*="maplist-app"]'),
        mlItemsVisible: [...document.querySelectorAll('#menuMl .menu-item')].filter(visible).length,
      };
    });
    const want = ['このアプリについて', 'リンクをコピー', '名前を設定', 'ログアウト'];
    ok('三本線メニュー：残るのは このアプリについて・リンクをコピー・名前を設定・ログアウト だけ', want.every((w) => menu.items.includes(w)) && menu.items.length === want.length, JSON.stringify(menu.items));
    ok('三本線メニュー：メールアドレスの表示が残る', menu.email.length > 0, menu.email);
    ok('三本線メニュー：下のタブと同じ項目（予定・訪問リスト・完了報告・報告一覧・集計・管理・このアプリについて）はない', menu.tabsLeft === 0, String(menu.tabsLeft));
    ok('三本線メニュー：元に戻す・やり直すは入っていない', !menu.undoInMenu, '');
    ok('三本線メニュー：マップリストアプリへのリンクは入っていない', !menu.maplistLink, '');
    await page.screenshot({ path: `${SHOTS}/r21-menu.png` });
    // 「このアプリについて」は残っていて、押すと説明の画面が出る
    await page.click('#menuPanel [data-menu-tab="about"]'); await wait(page, 500);
    const aboutShown = await page.evaluate(() => !document.getElementById('tab-about').classList.contains('hidden'));
    ok('三本線メニュー：「このアプリについて」を押すと説明の画面が出る', aboutShown, '');
    await page.click('#mainNav [data-tab="today"]'); await wait(page, 400);
    await page.click('#menuBtn'); await wait(page, 300);
    await page.keyboard.press('Escape'); await wait(page, 300);

    // 2) 元に戻す・やり直す：タイトルの下に、横一列・折り返さない
    const hist = await page.evaluate(() => {
      const bar = document.getElementById('histBar');
      const top = document.querySelector('header.topbar');
      const h1 = document.querySelector('header.topbar h1');
      const u = document.getElementById('undoBtn').getBoundingClientRect();
      const r = document.getElementById('redoBtn').getBoundingClientRect();
      const br = bar.getBoundingClientRect();
      const hr = h1.getBoundingClientRect();
      const btns = [...bar.querySelectorAll('.hist-btn')];
      return {
        inHeader: !!bar && top.contains(bar),
        barDisplay: getComputedStyle(bar).display,
        barLeftDiff: Math.round(br.left - hr.left),
        belowTitle: br.top >= hr.bottom - 1,
        sameRow: Math.abs(u.top - r.top) <= 1,
        sideBySide: u.right <= r.left + 1,
        labels: btns.map((b) => b.textContent.trim()),
        oneLine: btns.every((b) => b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().height <= 40),
        btnH: Math.round(u.height),
        undoDisabled: document.getElementById('undoBtn').disabled,
        topbarOpacity: getComputedStyle(top).opacity,
      };
    });
    ok('元に戻す・やり直す：ヘッダーの中にある（上のバーと一緒に動く）', hist.inHeader, '');
    ok('元に戻す・やり直す：タイトル「DC 完了報告」の下・左端がそろう', hist.belowTitle && Math.abs(hist.barLeftDiff) <= 2, JSON.stringify({ below: hist.belowTitle, left: hist.barLeftDiff }));
    ok('元に戻す・やり直す：2つが横一列に並ぶ', hist.sameRow && hist.sideBySide, '');
    ok('元に戻す・やり直す：文字は折り返さず1行（縦に潰れない）', hist.oneLine && hist.labels.join('/') === '元に戻す/やり直す', JSON.stringify(hist.labels));
    ok('元に戻す・やり直す：押せる高さ（36px以上）', hist.btnH >= 36, `${hist.btnH}px`);
    ok('元に戻す・やり直す：完了報告のときは表示される', hist.barDisplay !== 'none', hist.barDisplay);
    await page.screenshot({ path: `${SHOTS}/r21-header.png` });

    // 3) 完了報告の長い画面で、下にスクロールすると上のバー（元に戻す・やり直すを含む）が消え、少し上へ戻すと出る
    await page.click('#mainNav [data-tab="form"]'); await wait(page, 500);
    const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    ok('（試験の前提）完了報告の画面は下にスクロールできる', scrollable > 200, String(scrollable));
    await page.evaluate(() => window.scrollTo(0, 0)); await wait(page, 600);
    await page.evaluate(() => window.scrollTo(0, 400)); await wait(page, 900);
    const hidden = await page.evaluate(() => ({
      cls: document.querySelector('header.topbar').classList.contains('hide'),
      op: parseFloat(getComputedStyle(document.querySelector('header.topbar')).opacity),
    }));
    ok('下にスクロール：上のバー（元に戻す・やり直すを含む）が消える', hidden.cls && hidden.op <= 0.05, JSON.stringify(hidden));
    await page.evaluate(() => window.scrollTo(0, 380)); await wait(page, 900);
    const shown = await page.evaluate(() => ({
      cls: document.querySelector('header.topbar').classList.contains('hide'),
      op: parseFloat(getComputedStyle(document.querySelector('header.topbar')).opacity),
      histOp: parseFloat(getComputedStyle(document.getElementById('histBar')).opacity),
    }));
    ok('少し上へ戻すと：上のバーが出てくる（元に戻す・やり直すも一緒に）', !shown.cls && shown.op >= 0.95 && shown.histOp >= 0.95, JSON.stringify(shown));
    await page.screenshot({ path: `${SHOTS}/r21-scroll-up.png` });
    await page.evaluate(() => window.scrollTo(0, 0)); await wait(page, 400);

    // 4) 完了報告の表示：元に戻す・やり直すは押せる（履歴がないときは押せない表示）
    ok('元に戻す：履歴がないときは押せない（表示は薄く）', await page.evaluate(() => document.getElementById('undoBtn').disabled === true));

    // 5) マップリスト：元に戻す・やり直すは出ない。「完了報告へ」ボタンはどの画面にもない
    await page.evaluate(async () => {
      const shop = { id: 'place-A', name: 'テスト寿司店', industry: '寿司・割烹', address: '東京都テスト区1-1', hours: {}, rating: 4.4 };
      await window.dcVisitBridge.add(shop, '');
    });
    await wait(page, 300);
    await page.click('.app-seg[data-app="ml"]'); await wait(page, 1200);
    const mlHist = await page.evaluate(() => getComputedStyle(document.getElementById('histBar')).display);
    ok('マップリスト：元に戻す・やり直すは出ない', mlHist === 'none', mlHist);
    await page.evaluate(() => window.dcVisitBridge.setLater('place-A', true)).catch(() => {});
    await wait(page, 400);
    const goDcCount = {};
    for (const nav of ['search', 'proposal', 'list', 'later']) {
      await page.evaluate((n) => { document.querySelector(`#mainNav [data-ml-nav="${n}"]`).click(); }, nav);
      await wait(page, 300);
      goDcCount[nav] = await page.evaluate(() => document.getElementById('mlHost').shadowRoot.innerHTML.includes('完了報告へ'));
    }
    ok('マップリスト：検索・提案・訪問予定・後で訪問のどこにも「完了報告へ」がない', Object.values(goDcCount).every((v) => v === false), JSON.stringify(goDcCount));
    await page.screenshot({ path: `${SHOTS}/r21-ml-later.png` });
    ok('マップリストの三本線メニュー：訪問NG一覧・お気に入り条件は残る（マップリストの項目）', await page.evaluate(async () => {
      document.getElementById('menuBtn').click();
      await new Promise((r) => setTimeout(r, 300));
      const labels = [...document.querySelectorAll('#menuMl .menu-item')].map((e) => e.textContent.trim());
      const aboutHidden = getComputedStyle(document.querySelector('#menuPanel [data-menu-tab="about"]')).display === 'none';
      return labels.includes('訪問NG一覧') && labels.includes('お気に入り条件') && aboutHidden;
    }));
    await page.keyboard.press('Escape'); await wait(page, 300);

    // 6) 完了報告に戻ると、元に戻す・やり直すが出る。横スクロールなし・コンソールエラーなし
    await page.click('.app-seg[data-app="dc"]'); await wait(page, 700);
    const backDc = await page.evaluate(() => getComputedStyle(document.getElementById('histBar')).display);
    ok('完了報告に戻ると、元に戻す・やり直すが出る', backDc !== 'none', backDc);
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
