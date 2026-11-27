// Round 36：ヘッダーの「完了報告／Maplist」の切り替えを右端に寄せる（三本線ボタンがヘッダーの右端にあるときだけ、右を空ける）（390px・変更箇所だけ）
// 切り替えの大きさ・中身は変えない。切り替えが動くことも確かめる。Firebase は偽物
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

// 三本線ボタンの置き場所（保存値）と、ヘッダーの右側を空けるはずかどうか
const CASES = [
  { name: '初期（右上）', saved: null, reserve: true },
  { name: '右の端・上寄り（右上の角）', saved: { edge: 'right', pos: 0.02 }, reserve: true },
  { name: '上の端・右寄り', saved: { edge: 'top', pos: 0.95 }, reserve: true },
  { name: '左の端', saved: { edge: 'left', pos: 0.5 }, reserve: false },
  { name: '下の端', saved: { edge: 'bottom', pos: 0.5 }, reserve: false },
  { name: '右の端・真ん中', saved: { edge: 'right', pos: 0.6 }, reserve: false },
];

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const errors = [];
  try {
    for (const c of CASES) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      await page.route('**/*', (route) => {
        const u = route.request().url();
        if (u.startsWith('https://www.gstatic.com/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
        if (/\/api\/(demo-url|demo-queue|maps-info)$/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: {}, demos: [] }) });
        if (u.startsWith(BASE)) return route.fallback();
        return route.abort();
      });
      await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
      await page.evaluate((saved) => {
        if (saved) localStorage.setItem('menuBtnPos', JSON.stringify(saved));
        else localStorage.removeItem('menuBtnPos');
      }, c.saved);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await wait(page, 900);
      // ログイン中の表示にする（切り替えはメンバーだけに出る）
      await page.evaluate(() => document.body.classList.add('member'));
      await wait(page, 400);

      const m = await page.evaluate(() => {
        const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
        const sw = document.querySelector('.app-switch');
        const btn = document.querySelector('.menu-btn');
        const title = document.querySelector('.app-title');
        const top = document.querySelector('.topbar');
        return {
          sw: r(sw), btn: r(btn), title: r(title),
          swVisible: getComputedStyle(sw).display !== 'none',
          inHeader: document.body.classList.contains('menu-in-header'),
          topPadR: parseFloat(getComputedStyle(top).paddingRight),
          topR: r(top).r,
          active: document.querySelector('.app-seg.on')?.dataset.app,
        };
      });
      const flushRight = m.sw.r >= 368 && m.sw.r <= 374;
      const overlapsBtn = !(m.sw.r <= m.btn.l || m.sw.l >= m.btn.r || m.sw.b <= m.btn.t || m.sw.t >= m.btn.b);
      ok(`${c.name}：切り替えが表示されている`, m.swVisible && m.sw.w > 0, JSON.stringify(m.sw));
      ok(`${c.name}：切り替えの大きさは今まで通り（高さ46px・幅はそのまま）`, Math.abs(m.sw.h - 46) <= 2, `h=${m.sw.h}`);
      ok(`${c.name}：ヘッダーの右側を空けるかどうかは、三本線ボタンの位置どおり（${c.reserve ? '空ける' : '空けない'}）`, m.inHeader === c.reserve, `inHeader=${m.inHeader}`);
      if (c.reserve) {
        ok(`${c.name}：三本線ボタンと重ならず、切り替えはその左に出る`, !overlapsBtn && m.sw.r <= m.btn.l + 1, JSON.stringify({ sw: m.sw.r, btnL: m.btn.l }));
      } else {
        ok(`${c.name}：切り替えは右端に寄る（右の端から約18px）`, flushRight, `right=${m.sw.r} topbar=${m.topR}`);
      }
      ok(`${c.name}：タイトルと切り替えが重ならない`, m.title.r <= m.sw.l + 1, JSON.stringify({ titleR: m.title.r, swL: m.sw.l }));

      // 切り替え操作：Maplist → 完了報告 → Maplist と、今まで通り動く
      await page.click('.app-seg[data-app="ml"]'); await wait(page, 1200);
      const toMl = await page.evaluate(() => ({ mode: document.body.classList.contains('mode-ml'), on: document.querySelector('.app-seg.on')?.dataset.app }));
      await page.click('.app-seg[data-app="dc"]'); await wait(page, 900);
      const toDc = await page.evaluate(() => ({ mode: document.body.classList.contains('mode-ml'), on: document.querySelector('.app-seg.on')?.dataset.app }));
      ok(`${c.name}：切り替えが動く（Maplist → 完了報告 → Maplist の順に切り替わる）`, toMl.mode && toMl.on === 'ml' && !toDc.mode && toDc.on === 'dc', JSON.stringify({ toMl, toDc }));

      if (c.name.startsWith('初期')) await page.screenshot({ path: `${SHOTS}/r36-default.png`, clip: { x: 0, y: 0, width: 390, height: 110 } });
      if (c.name.startsWith('左')) await page.screenshot({ path: `${SHOTS}/r36-left.png`, clip: { x: 0, y: 0, width: 390, height: 110 } });
      await ctx.close();
    }
    ok('コンソールエラーなし', errors.length === 0, errors.join(' | '));
  } catch (e) {
    ok('テストが最後まで走った', false, e.message.split('\n')[0]);
  } finally {
    await browser.close();
  }
  let fail = 0;
  for (const r of results) { if (!r.pass) fail++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? '  [' + r.extra + ']' : ''}`); }
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exitCode = fail ? 1 : 0;
})();
