// Round 32：三本線ボタンを下へドラッグしても、引っ張って更新（更新中）が出ないこと。普通の引っ張って更新は今まで通り（390px・変更箇所だけ）
// タッチの動きは、ボタンの上・普通の場所で、それぞれ送って確かめる。Firebase は偽物
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
  page.on('response', (r) => { if (r.status() >= 400 && !/demo-url|demo-queue|maps-info/.test(r.url())) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('https://www.gstatic.com/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if (/\/api\/(demo-url|demo-queue|maps-info)$/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: {}, demos: [] }) });
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });

  // 指の動き（タッチ）を、指定した要素の上で送る。dy は下へ動かす量（px）
  const touchDrag = (sel, dy) => page.evaluate(async ({ sel, dy }) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const mk = (cy) => new Touch({ identifier: 7, target: el, clientX: x, clientY: cy, pageX: x, pageY: cy });
    const ev = (type, cy, list) => new TouchEvent(type, { touches: list, targetTouches: list, changedTouches: [mk(cy)], bubbles: true, cancelable: true });
    el.dispatchEvent(ev('touchstart', y, [mk(y)]));
    for (let i = 1; i <= 6; i++) {
      const cy = y + (dy * i) / 6;
      el.dispatchEvent(ev('touchmove', cy, [mk(cy)]));
    }
    const during = document.getElementById('pullIndicator')?.textContent || '';
    el.dispatchEvent(ev('touchend', y + dy, []));
    await new Promise((res) => setTimeout(res, 150));
    return { during, after: document.getElementById('pullIndicator')?.textContent || '' };
  }, { sel, dy });

  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await wait(page, 1200);
    const top = await page.evaluate(() => window.scrollY);
    ok('（試験の前提）画面は一番上にいる', top === 0, String(top));

    // 1) 三本線ボタンを下へドラッグ：「更新中」は出ない（再読み込みもしない）
    const menuDrag = await touchDrag('#menuBtn', 220);
    ok('三本線ボタンを下へドラッグしても、「更新中」は出ない', menuDrag.after !== '更新中…' && menuDrag.during !== '更新中…', JSON.stringify(menuDrag));
    await page.screenshot({ path: `${SHOTS}/r32-menu-drag.png` });

    // 2) 画面の普通の場所で、一番上から下へ引く：今まで通り「更新中」が出る
    const pull = await touchDrag('.app-title', 220);
    ok('普通に下へ引っ張ると、今まで通り「更新中」が出て更新される', pull.after === '更新中…', JSON.stringify(pull));

    // 3) ボタンのドラッグ（Round 31）は今まで通り：左の端に吸着して、位置を保存する
    await wait(page, 500);
    const bb = await page.evaluate(() => { const r = document.getElementById('menuBtn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(bb.x, bb.y); await page.mouse.down();
    await page.mouse.move(bb.x - 150, bb.y + 60, { steps: 6 });
    await page.mouse.move(14, 420, { steps: 6 });
    await page.mouse.up(); await wait(page, 500);
    const snap = await page.evaluate(() => Math.round(document.getElementById('menuBtn').getBoundingClientRect().left));
    const saved = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('menuBtnPos') || 'null'); } catch (e) { return null; } });
    ok('ボタンのドラッグで、左の端に吸着する（Round 31 のまま）', snap <= 10, String(snap));
    ok('吸着した位置を保存する（Round 31 のまま）', saved && saved.edge === 'left', JSON.stringify(saved));

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
