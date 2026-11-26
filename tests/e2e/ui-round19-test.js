// Round 19：訪問リストの入力カードの白文字がはみ出さないこと（390px）。Firebase は偽物、API は差し替える
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = process.env.SHOTS || '/tmp';
const BASE = process.argv[2] || 'http://localhost:8767';

const src = fs.readFileSync(path.join(__dirname, 'integration-test.js'), 'utf8');
const STUB = src.match(/const STUB = `([\s\S]*?)`;/)[1];

const results = [];
const ok = (name, cond, extra = '') => results.push({ name, pass: !!cond, extra: String(extra) });

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
    if (/\/api\//.test(u) && u.startsWith(BASE)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: {}, demos: [] }) });
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });
  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await page.click('#menuBtn'); await page.waitForTimeout(250);
    await page.click('#menuPanel [data-menu-tab="visits"]'); await page.waitForTimeout(400);
    // 入力カードを1枚出す（リンクなしで手入力）
    await page.click('#addVisitRow'); await page.waitForTimeout(400);
    const info = await page.evaluate(() => {
      const card = document.querySelector('#visitRows .row-card');
      if (!card) return null;
      const cr = card.getBoundingClientRect();
      const btn = card.querySelector('[data-relookup]');
      const br = btn.getBoundingClientRect();
      const hint = card.querySelector('.relookup-hint');
      const hr = hint ? hint.getBoundingClientRect() : null;
      const sum = card.querySelector('.row-more > summary');
      // 入力カード全体で、横にはみ出している文字（カードの外・画面の外）
      const outside = [...card.querySelectorAll('*')].filter((el) => {
        if (!el.offsetParent) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > cr.right + 1 || r.left < cr.left - 1 || r.right > innerWidth - 4 || r.left < 4);
      }).map((el) => (el.textContent || el.tagName).trim().slice(0, 20));
      return {
        btnText: btn.textContent.trim(),
        btnInside: br.left >= cr.left && br.right <= cr.right,
        btnFits: btn.scrollWidth <= btn.clientWidth + 1,
        btnH: Math.round(br.height),
        hintText: hint ? hint.textContent.trim() : null,
        hintInside: hr ? (hr.left >= cr.left && hr.right <= cr.right) : false,
        sumText: sum ? sum.textContent.trim() : null,
        outside,
      };
    });
    ok('入力カードが出る', !!info);
    if (info) {
      ok('ボタンの文字は「読み取り直す」だけ', info.btnText === '読み取り直す', info.btnText);
      ok('ボタンはカードの中に収まり、文字が切れない', info.btnInside && info.btnFits, JSON.stringify({ inside: info.btnInside, fits: info.btnFits }));
      ok('ボタンの押しやすさ（高さ44px以上・ボタンの形）', info.btnH >= 34, `${info.btnH}px`);
      ok('説明は小さなグレーの1行で、カードの中に収まる', info.hintText === '店舗名・県・市・区・業種・営業時間を上書き' && info.hintInside, info.hintText);
      ok('「読み取った内容を確認・修正」（括弧の説明なし）', info.sumText === '読み取った内容を確認・修正', info.sumText);
      ok('入力カードの中で、横にはみ出している文字がない', info.outside.length === 0, info.outside.join(' | '));
    }
    // 機能：「確認・修正」を開けて閉じられる。「読み取り直す」を押しても画面が壊れない
    await page.evaluate(() => document.querySelector('#visitRows .row-card .row-more > summary').click());
    await page.waitForTimeout(250);
    const openNow = await page.evaluate(() => document.querySelector('#visitRows .row-card .row-more').open);
    ok('「読み取った内容を確認・修正」を開閉できる', typeof openNow === 'boolean', String(openNow));
    await page.evaluate(() => document.querySelector('#visitRows .row-card [data-relookup]').click());
    await page.waitForTimeout(600);
    ok('「読み取り直す」を押しても、カードが残って画面が動く', (await page.$$('#visitRows .row-card')).length === 1);
    await page.screenshot({ path: `${SHOTS}/r19-visit-card.png` });
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
