// Round 18：スクロールの飛び・横の縁・提案ボタンの色・現在地の表示（Maplist）。Firebase は偽物、API は差し替える
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = process.env.SHOTS || '/tmp';
const BASE = process.argv[2] || 'http://localhost:8767';

// 結合テストと同じ偽物・同じ店のデータを使う
const src = fs.readFileSync(path.join(__dirname, 'integration-test.js'), 'utf8');
const STUB = src.match(/const STUB = `([\s\S]*?)`;/)[1];
const SHOPS = eval('(' + src.match(/const SHOPS = (\[[\s\S]*?\n\]);/)[1] + ')');

const results = [];
const ok = (name, cond, extra = '') => results.push({ name, pass: !!cond, extra: String(extra) });
const wait = (page, ms) => page.waitForTimeout(ms);

async function run(reverseMode) {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, permissions: ['geolocation'], geolocation: { latitude: 35.6812, longitude: 139.7671 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon|apple-touch/.test(r.url())) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('https://www.gstatic.com/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if (u.endsWith('/api/ml-geocode')) {
      const body = route.request().postData() || '';
      if (body.includes('reverse')) {
        if (reverseMode === 'fail') return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: '付近の地名が見つかりませんでした' }) });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, label: '東京都テスト区テスト町' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, lat: 35.66, lng: 139.7, label: 'テスト区', viewport: null }) });
    }
    if (u.endsWith('/api/ml-search')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, shops: SHOPS }) });
    if (/\/api\/(demo-url|demo-queue|maps-info)$/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: {}, demos: [] }) });
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });
  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await wait(page, 900);
    await page.click('.app-seg[data-app="ml"]'); await wait(page, 900);
    await page.evaluate(() => { document.body.style.minHeight = '3000px'; });

    // 1) お気に入り条件は Round 34 でなくした（この確認は外す）

    // 2) 横の縁：横に並ぶ行の両端にグレーの縁（グラデーション）が出ない
    const edges = await page.evaluate(() => {
      const sr = document.getElementById('mlHost').shadowRoot;
      const rows = [...sr.querySelectorAll('.hwrap')];
      rows.forEach((w) => { w.classList.add('edge-l', 'edge-r'); });
      const res = rows.map((w) => ({ before: getComputedStyle(w, '::before').content, after: getComputedStyle(w, '::after').content }));
      return res;
    });
    ok('横の縁：横に並ぶ行の端に、グレーの縁（擬似要素）がない', edges.length > 0 && edges.every((e) => (e.before === 'none' || e.before === 'normal' || e.before === '') && (e.after === 'none' || e.after === 'normal' || e.after === '')), JSON.stringify(edges.slice(0, 2)));

    // 3) 「提案リストを作る」の色：明るいオーロラ、暗い塗りつぶしにしない
    await page.evaluate(() => window.scrollTo(0, 0)); await wait(page, 300);
    const btn = await page.evaluate(() => {
      const b = document.getElementById('mlHost').shadowRoot.querySelector('.dock .btn.primary');
      const cs = getComputedStyle(b), dock = getComputedStyle(b.parentElement);
      return { bg: cs.backgroundImage, color: cs.color, dockBg: dock.backgroundImage, text: b.textContent.trim() };
    });
    ok('提案リストを作る：文字は「提案リストを作る」', btn.text === '提案リストを作る', btn.text);
    ok('提案リストを作る：明るいオーロラ（シアン・バイオレット・マゼンタ）', btn.bg.includes('rgb(0, 229, 255)') && btn.bg.includes('rgb(255, 46, 136)') && !btn.bg.includes('0.55'), btn.bg.slice(0, 120));
    ok('提案リストを作る：文字は白', btn.color === 'rgb(255, 255, 255)', btn.color);
    ok('提案リストを作る：まわりに黒い帯を敷かない', btn.dockBg === 'none', btn.dockBg);
    await page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('.dock').scrollIntoView({ block: 'center' }));
    await wait(page, 200);
    await page.screenshot({ path: `${SHOTS}/r18-search-${reverseMode}.png` });

    // 4) 現在地：取得すると、付近の地名を出す（取れないときは元の文のまま）
    await page.evaluate(() => { document.getElementById('mlHost').shadowRoot.querySelector('[data-act="area-mode"][data-v="gps"]').click(); });
    await wait(page, 300);
    await page.evaluate(() => { document.getElementById('mlHost').shadowRoot.querySelector('[data-act="gps"]').click(); });
    await wait(page, 1200);
    // 住所は、現在地のボタンの下の「今いる場所」の箱に出す（Round 25）
    const here = await page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('#s-area .here-name')?.textContent.trim() || '');
    if (reverseMode === 'ok') {
      ok('現在地：付近の地名が出る（「東京都テスト区テスト町」）', here === '東京都テスト区テスト町', here);
    } else {
      ok('現在地：付近の地名が取れないときは「住所は取れませんでした」と出る', here === '住所は取れませんでした', here);
    }

    ok('390px：横スクロールなし', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    // 取れない場合のテストでは、わざと返した 404（ml-geocode）だけは想定どおりなので除く
    const unexpected = errors.filter((e) => !(reverseMode === 'fail' && (e.includes('/api/ml-geocode') || e.includes('status of 404'))));
    ok(`コンソールエラーなし（${reverseMode}）`, unexpected.length === 0, unexpected.join(' | '));
  } finally {
    await browser.close();
  }
}

(async () => {
  try {
    await run('ok');
    await run('fail');
  } catch (e) {
    console.error(e.message.split('\n')[0]);
  }
  let fail = 0;
  for (const r of results) { if (!r.pass) fail++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? '  [' + r.extra + ']' : ''}`); }
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exitCode = fail ? 1 : 0;
})();
