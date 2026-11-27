// Round 33：三本線ボタンの位置に合わせて、メニューを出す（ボタンがいる端と反対の、画面の内側へ。被らず、画面の中に収める）（390px・変更箇所だけ）
// ボタンを右端・左端・上端・下端・角に置いて、メニューを開いて確かめる。Firebase は偽物
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

// 各ケース：ボタンの端と位置（0〜1）と、期待する側（panel が button のどちら側か）
const CASES = [
  { name: '右端', edge: 'right', pos: 0.5, side: 'left' },
  { name: '左端', edge: 'left', pos: 0.5, side: 'right' },
  { name: '上端', edge: 'top', pos: 0.5, side: 'below' },
  { name: '下端', edge: 'bottom', pos: 0.5, side: 'above' },
  { name: '右上の角', edge: 'right', pos: 0.02, side: 'left' },
  { name: '左下の角', edge: 'left', pos: 0.98, side: 'right' },
];

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('https://www.gstatic.com/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if (/\/api\/(demo-url|demo-queue|maps-info)$/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: {}, demos: [] }) });
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });

  try {
    for (const c of CASES) {
      await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
      await page.evaluate((v) => localStorage.setItem('menuBtnPos', JSON.stringify(v)), { edge: c.edge, pos: c.pos });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await wait(page, 1000);
      await page.click('#menuBtn'); await wait(page, 350);
      const g = await page.evaluate(() => {
        const b = document.getElementById('menuBtn').getBoundingClientRect();
        const p = document.getElementById('menuPanel').getBoundingClientRect();
        return {
          btn: { l: b.left, r: b.right, t: b.top, b: b.bottom },
          pan: { l: p.left, r: p.right, t: p.top, b: p.bottom },
          open: document.getElementById('menuLayer').classList.contains('open'),
        };
      });
      const { btn, pan } = g;
      const overlap = !(pan.r <= btn.l || pan.l >= btn.r || pan.b <= btn.t || pan.t >= btn.b);
      const inside = pan.l >= 0 && pan.r <= 390 && pan.t >= 0 && pan.b <= 844;
      let side = false;
      if (c.side === 'left') side = pan.r <= btn.l + 0.5;
      if (c.side === 'right') side = pan.l >= btn.r - 0.5;
      if (c.side === 'below') side = pan.t >= btn.b - 0.5;
      if (c.side === 'above') side = pan.b <= btn.t + 0.5;
      ok(`${c.name}：メニューは${({ left: 'ボタンの左側', right: 'ボタンの右側', below: 'ボタンの下', above: 'ボタンの上' })[c.side]}に出る`, g.open && side, JSON.stringify({ btn, pan }));
      ok(`${c.name}：メニューはボタンに被らない`, !overlap, '');
      ok(`${c.name}：メニューは画面の中に収まる`, inside, JSON.stringify(pan));
      await page.screenshot({ path: `${SHOTS}/r33-${c.edge}-${Math.round(c.pos * 100)}.png` });
      await page.keyboard.press('Escape'); await wait(page, 250);
    }
    ok('コンソールエラーなし', errors.length === 0, errors.join(' | '));
  } finally {
    await browser.close();
  }
  let fail = 0;
  for (const r of results) { if (!r.pass) fail++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? '  [' + r.extra + ']' : ''}`); }
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e.message.split('\n')[0]); process.exit(2); });
