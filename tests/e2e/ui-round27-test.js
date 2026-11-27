// Round 27：ヘッダーの切り替えを大きく／三本線メニューの一番上にもう一方のモードへ／検索画面の見出しの上の空白を詰める／
// 「ログイン中」のカードを消す／「提案リストを作る」を少し短く（390px・変更箇所だけ）
// Firebase は偽物。API は差し替える
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = process.env.SHOTS || '/tmp';
const BASE = process.argv[2] || 'http://localhost:8767';

const src = fs.readFileSync(path.join(__dirname, 'integration-test.js'), 'utf8');
const STUB = src.match(/const STUB = `([\s\S]*?)`;/)[1];

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
    if (/\/api\/(demo-url|demo-queue|maps-info)$/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: {}, demos: [] }) });
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });
  const sr = (fn, arg) => page.evaluate(fn, arg);
  const menuGoLabels = () => page.evaluate(() => [...document.querySelectorAll('#menuPanel .menu-go-btn')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.textContent.trim()));
  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await wait(page, 1000);

    // 1) ヘッダーの切り替えを大きく。タイトル・三本線ボタンとぶつからない
    const hdr = await page.evaluate(() => {
      const segs = [...document.querySelectorAll('.app-seg')].map((b) => b.getBoundingClientRect());
      const title = document.getElementById('appName').getBoundingClientRect();
      const menu = document.getElementById('menuBtn').getBoundingClientRect();
      const fs = getComputedStyle(document.querySelector('.app-seg')).fontSize;
      return {
        heights: segs.map((r) => Math.round(r.height)),
        font: fs,
        left: Math.round(Math.min(...segs.map((r) => r.left))),
        right: Math.round(Math.max(...segs.map((r) => r.right))),
        titleRight: Math.round(title.right),
        menuLeft: Math.round(menu.left),
      };
    });
    ok('切り替え：押しやすい高さ（40px）と大きな文字（14px）', hdr.heights.every((h) => h >= 38) && parseInt(hdr.font, 10) >= 14, JSON.stringify(hdr));
    ok('切り替え：三本線ボタンとぶつからない（右端が手前）', hdr.right <= hdr.menuLeft - 4, `${hdr.right} / ${hdr.menuLeft}`);
    ok('切り替え：タイトルと重ならない', hdr.titleRight <= hdr.left + 1, `${hdr.titleRight} / ${hdr.left}`);
    await page.screenshot({ path: `${SHOTS}/r27-header.png` });

    // 2) 三本線メニューの一番上：完了報告のときは「Maplistへ」だけ
    await page.click('#menuBtn'); await wait(page, 300);
    const dcGo = await menuGoLabels();
    ok('完了報告のとき、メニューの一番上は「Maplistへ」だけ', dcGo.join('/') === 'Maplistへ', dcGo.join('/'));
    const firstDc = await page.evaluate(() => document.querySelector('#menuPanel .menu-item')?.textContent.trim() || '');
    ok('メニューの一番上にある', firstDc === 'Maplistへ', firstDc);
    await page.screenshot({ path: `${SHOTS}/r27-menu-dc.png` });
    await page.click('#menuPanel .menu-go-btn:visible'); await wait(page, 1000);
    const toMl = await page.evaluate(() => document.body.classList.contains('mode-ml'));
    ok('「Maplistへ」を押すと、マップリストに切り替わる（メニューは閉じる）', toMl, '');

    // 3) マップリストのとき：メニューの一番上は「完了報告へ」だけ
    await page.click('#menuBtn'); await wait(page, 300);
    const mlGo = await menuGoLabels();
    ok('マップリストのとき、メニューの一番上は「完了報告へ」だけ', mlGo.join('/') === '完了報告へ', mlGo.join('/'));
    await page.keyboard.press('Escape'); await wait(page, 300);

    // 4) 検索画面の見出し：上の空白を詰める（上のバーから見出しまでが近い）
    const head = await sr(() => {
      const bar = document.querySelector('header.topbar').getBoundingClientRect();
      const h1 = document.getElementById('mlHost').shadowRoot.querySelector('.screen[data-screen="search"] .hero h1').getBoundingClientRect();
      return Math.round(h1.top - bar.bottom);
    });
    ok('検索画面：見出し「マップリスト」の上の空白が詰まっている（30px以下）', head <= 30, `${head}px`);

    // 5) 「ログイン中」のカードはない（検索画面に）
    const card = await sr(() => {
      const root = document.getElementById('mlHost').shadowRoot;
      return { el: !!root.querySelector('#account'), text: /ログイン中|株式会社DC/.test(root.querySelector('.screen[data-screen="search"]')?.textContent || '') };
    });
    ok('検索画面：「ログイン中」のカードがない', !card.el && !card.text, JSON.stringify(card));

    // 6) 「提案リストを作る」は、横いっぱいではなく少し短い
    const btn = await sr(() => {
      const b = document.getElementById('mlHost').shadowRoot.querySelector('.screen[data-screen="search"] .dock .btn.wide').getBoundingClientRect();
      return Math.round(b.width);
    });
    ok('「提案リストを作る」が少し短い（300〜340px）', btn >= 300 && btn <= 340, `${btn}px`);
    await page.screenshot({ path: `${SHOTS}/r27-search.png` });

    // 7) 完了報告へ戻すと、メニューの一番上は「Maplistへ」（完了報告の画面）
    await page.click('#menuBtn'); await wait(page, 300);
    await page.click('#menuPanel .menu-go-btn:visible'); await wait(page, 900);
    const backDc = await page.evaluate(() => !document.body.classList.contains('mode-ml'));
    ok('「完了報告へ」を押すと、完了報告に戻る', backDc, '');

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
