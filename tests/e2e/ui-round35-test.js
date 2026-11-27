// Round 35：集計の「担当者別の成約率」：件数（報告◯件分の成約◯件）を消して、パーセントだけ。列（タブ）の並び・位置を揃える（390px・変更箇所だけ）
// 集計の画面は管理者だけなので、app.js の statTable をそのまま読んで、同じ CSS（style.css）で描く
const { chromium } = require('playwright');

const SHOTS = process.env.SHOTS || '/tmp';
const BASE = process.argv[2] || 'http://localhost:8767';

const results = [];
const ok = (name, cond, extra = '') => results.push({ name, pass: !!cond, extra: String(extra) });
const wait = (page, ms) => page.waitForTimeout(ms);

const ROWS = [
  { key: '田中', visits: 12, reports: 4, won: 3 },   // 75%
  { key: '佐藤', visits: 8, reports: 0, won: 0 },    // 報告0件 → —
  { key: '鈴木', visits: 20, reports: 10, won: 2 },  // 20%
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
    if (u.startsWith('https://www.gstatic.com/')) return route.abort();
    if (/\/api\/(demo-url|demo-queue|maps-info)$/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: {}, demos: [] }) });
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });
  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await wait(page, 800);
    // app.js から statTable（と成約率の決まり）を取り出して使う
    const made = await page.evaluate(async (rows) => {
      const src = await (await fetch('/app.js')).text();
      const start = src.indexOf('const rateOf =');
      const end = src.indexOf('const pct =');
      if (start < 0 || end < 0) return { error: 'marker not found' };
      const body = src.slice(start, end);
      const { statTable } = new Function('esc', body + '; return { statTable };')((s) => String(s));
      const host = document.getElementById('statsPerson');
      // 集計の画面を見える状態にする（テストのための表示だけ）
      for (let el = host; el; el = el.parentElement) {
        el.hidden = false; el.classList.remove('hidden');
        if (el.style && el.style.display === 'none') el.style.display = '';
      }
      host.innerHTML = statTable(rows, '担当者', true);
      return { ok: true };
    }, ROWS);
    ok('テストの準備：app.js の statTable を読めた', made.ok === true, JSON.stringify(made));
    await wait(page, 300);

    const m = await page.evaluate(() => {
      const t = document.querySelector('#statsPerson .stat-table.person');
      if (!t) return null;
      const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, h: r.height }; };
      const head = [...t.querySelectorAll('.st-head > span')];
      const rows = [...t.querySelectorAll('.st-row')].map((row) => [...row.children]);
      const rates = [...t.querySelectorAll('.st-row .st-rate')];
      return {
        width: t.getBoundingClientRect().width,
        scrollW: t.scrollWidth, clientW: t.clientWidth,
        headRights: head.map((el) => rect(el).r),
        rowRights: rows.map((cells) => cells.map((el) => rect(el).r)),
        rowHeights: rows.map((cells) => rect(cells[0].parentElement).h),
        rowTops: rows.map((cells) => rect(cells[0].parentElement).t),
        rateTexts: rates.map((el) => el.textContent.trim()),
        rateSmalls: rates.map((el) => el.querySelectorAll('small').length),
        rateBoxes: rates.map((el) => rect(el).r),
        headCount: head.length,
        rowCellCounts: rows.map((c) => c.length),
        personClass: t.classList.contains('person'),
        visible: t.getBoundingClientRect().width > 0,
      };
    });
    ok('担当者別の表が出ている（390px で見える）', m && m.visible, JSON.stringify(m && { width: m.width }));
    if (!m) throw new Error('担当者別の表がない');

    // 1) 件数の行は出ない。成約率はパーセントだけ
    ok('成約率はパーセントだけ（「75%」「—」のみ）', m.rateTexts.join('|') === '75%|—|20%', m.rateTexts.join('|'));
    ok('成約率の下に「成約◯ ／ 報告◯」の件数の文字がない', m.rateSmalls.every((n) => n === 0), JSON.stringify(m.rateSmalls));
    ok('担当者別の表に「報告◯件分の成約◯件」の文字が一つもない', !/成約\d+\s*／\s*報告\d+/.test(await page.evaluate(() => document.querySelector('#statsPerson').textContent)), '');

    // 2) タブ（列）の並びと位置がずれていない
    ok('見出しは5列・すべての行も5列', m.headCount === 5 && m.rowCellCounts.every((n) => n === 5), JSON.stringify(m.rowCellCounts));
    // 数字の列は右そろえ：見出しの右端と、各行の右端が同じ線（1px まで）
    const aligned = [1, 2, 3, 4].every((i) => m.rowRights.every((r) => Math.abs(r[i] - m.headRights[i]) <= 1));
    ok('数字の列（訪問・報告・成約・成約率）の右端が、見出しと全ての行でそろう', aligned, JSON.stringify({ head: m.headRights, rows: m.rowRights }));
    // 行の高さ・上の位置がそろう（件数の行がなくなり、どの行も同じ高さ）
    const h0 = m.rowHeights[0];
    ok('全ての担当者の行の高さがそろう', m.rowHeights.every((h) => Math.abs(h - h0) <= 1), JSON.stringify(m.rowHeights));
    const gaps = m.rowTops.slice(1).map((t, i) => Math.round(t - m.rowTops[i]));
    ok('行と行の間隔がそろう', gaps.every((g) => Math.abs(g - gaps[0]) <= 1), JSON.stringify(gaps));
    ok('成約率の右端が、全ての行でそろう', m.rateBoxes.every((r) => Math.abs(r - m.rateBoxes[0]) <= 1), JSON.stringify(m.rateBoxes));
    ok('390px：表の中で横にはみ出さない', m.scrollW <= m.clientW + 1, `scroll=${m.scrollW} client=${m.clientW}`);

    await page.evaluate(() => document.querySelector('#statsPerson').scrollIntoView({ block: 'center' }));
    await wait(page, 200);
    await page.screenshot({ path: `${SHOTS}/r35-person.png` });

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
