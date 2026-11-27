// Round 34：件数の選択とお気に入り条件をなくす（提案は1ページ目20件＋追加ぶん）。下のタブ・ヘッダーの隠れる速さを揃える（390px・変更箇所だけ）
// Firebase は偽物。API（ml-geocode・ml-search）は差し替える。ml-search は page ごとに、重ならない20件を返す
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = process.env.SHOTS || '/tmp';
const BASE = process.argv[2] || 'http://localhost:8767';

const src = fs.readFileSync(path.join(__dirname, 'integration-test.js'), 'utf8');
const STUB = src.match(/const STUB = `([\s\S]*?)`;/)[1];
const SHOPS = eval('(' + src.match(/const SHOPS = (\[[\s\S]*?\n\]);/)[1] + ')');

const results = [];
const ok = (name, cond, extra = '') => results.push({ name, pass: !!cond, extra: String(extra) });
const wait = (page, ms) => page.waitForTimeout(ms);
const jstDay = (plus = 0) => new Date(Date.now() + 9 * 3600e3 + plus * 86400e3).toISOString().slice(0, 10);

// 1ページ目・2ページ目で重ならない店を、SHOPS[0] の形のまま作る
function makeShops(page, n) {
  return Array.from({ length: n }, (_, i) => ({ ...SHOPS[0], id: `p${page}-${i}`, name: `テスト店${page}-${i}`, hours: { ...SHOPS[0].hours } }));
}

async function makeCtx(browser, calls, errors) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('https://www.gstatic.com/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if (u.endsWith('/api/ml-geocode')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, lat: 35.66, lng: 139.7, label: 'テスト区', viewport: null }) });
    if (u.endsWith('/api/ml-search')) {
      const body = JSON.parse(route.request().postData() || '{}');
      calls.push(body);
      const p = body.page || 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, shops: makeShops(p, 20), hasMore: p < 2 }) });
    }
    if (/\/api\/(demo-url|demo-queue|maps-info)$/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: {}, demos: [] }) });
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const errors = [];
  const calls = [];
  try {
    // ---- 1) 件数とお気に入り条件が、画面からなくなっている ----
    {
      const { ctx, page } = await makeCtx(browser, calls, errors);
      await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
      await wait(page, 900);
      await page.click('.app-seg[data-app="ml"]'); await wait(page, 900);
      const ui = await page.evaluate(() => {
        const sr = document.getElementById('mlHost').shadowRoot;
        const heads = [...sr.querySelectorAll('h2')].map((h) => h.textContent.trim());
        return {
          countHead: heads.some((t) => t.includes('件数')),
          presetHead: heads.some((t) => t.includes('お気に入り')),
          countBtn: !!sr.querySelector('[data-act="count-open"]'),
          countSlot: !!sr.querySelector('#s-count'),
          presetSlot: !!sr.querySelector('#s-presets'),
          presetSave: !!sr.querySelector('[data-act="preset-save"]'),
          menuPreset: !!document.querySelector('[data-ml-act="presets"]'),
          menuPresetText: document.getElementById('menuPanel').textContent.includes('お気に入り条件'),
          menuBlock: !!document.querySelector('[data-ml-act="block"]'),
        };
      });
      ok('件数：検索画面に「件数」の見出しと選ぶボタンがない', !ui.countHead && !ui.countBtn && !ui.countSlot, JSON.stringify(ui));
      ok('お気に入り条件：検索画面に「お気に入り条件」の見出しと保存ボタンがない', !ui.presetHead && !ui.presetSlot && !ui.presetSave, JSON.stringify(ui));
      ok('お気に入り条件：三本線メニューに「お気に入り条件」の項目がない', !ui.menuPreset && !ui.menuPresetText, JSON.stringify(ui));
      ok('三本線メニューの「訪問NG一覧」は残っている', ui.menuBlock, '');
      await ctx.close();
    }

    // ---- 2) 提案は1ページ目の20件から作る。追加で20件を見ると、その分も提案に入る ----
    {
      const { ctx, page } = await makeCtx(browser, calls, errors);
      await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
      await wait(page, 900);
      await page.click('.app-seg[data-app="ml"]'); await wait(page, 900);
      await page.evaluate(() => {
        const i = document.getElementById('mlHost').shadowRoot.querySelector('#addr');
        i.value = 'テスト区'; i.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="run-search"]').click());
      await wait(page, 1000);
      // 開店の確認で店が隠れないように、「営業している店のみ」を外してから数える
      await page.evaluate(() => { const o = document.getElementById('mlHost').shadowRoot.querySelector('[data-act="open-only"]'); if (o) o.click(); });
      await wait(page, 400);
      const p1 = await page.evaluate(() => {
        const sr = document.getElementById('mlHost').shadowRoot;
        return { ranks: sr.querySelectorAll('#pList .rank').length, summary: sr.querySelector('#pSummary')?.textContent || '' };
      });
      ok('提案：最初は1ページ目の20件から作る（検索は page 1 だけ）', p1.ranks === 20 && calls.length === 1 && calls[0].page === 1, JSON.stringify({ ranks: p1.ranks, calls: calls.map((c) => c.page) }));
      ok('提案：検索の送信に「件数」は含まれない', calls.length >= 1 && !('count' in calls[0]), JSON.stringify(calls[0] || {}));
      ok('提案：概要文の件数は、実際の候補の数（候補 20件）', p1.summary.includes('候補 20件') && !/\d+件\s*\/\s*訪問日/.test(p1.summary), p1.summary);

      await page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('[data-act="more-results"]').click());
      await wait(page, 1000);
      const p2 = await page.evaluate(() => {
        const sr = document.getElementById('mlHost').shadowRoot;
        return { ranks: sr.querySelectorAll('#pList .rank').length, summary: sr.querySelector('#pSummary')?.textContent || '', more: sr.querySelector('#pList .more')?.textContent || '' };
      });
      ok('追加で20件：候補が増え、その分も提案に入る（40件）', p2.ranks === 40 && calls.length === 2 && calls[1].page === 2, JSON.stringify({ ranks: p2.ranks, calls: calls.map((c) => c.page) }));
      ok('追加で20件：概要文も 候補 40件 に変わる', p2.summary.includes('候補 40件'), p2.summary);
      ok('追加で20件：次がないと「これ以上の候補はありません」', p2.more.includes('これ以上の候補はありません'), p2.more.slice(0, 60));
      await page.screenshot({ path: `${SHOTS}/r34-proposal.png` });
      await ctx.close();
    }

    // ---- 3) 古い保存データ（件数・お気に入り条件が入ったまま）があっても、画面は壊れない ----
    {
      const { ctx, page } = await makeCtx(browser, calls, errors);
      await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
      await wait(page, 600);
      await page.evaluate(([ui, presets]) => {
        localStorage.setItem('vla:ui', JSON.stringify(ui));
        localStorage.setItem('vla:presets', JSON.stringify(presets));
      }, [
        {
          day: jstDay(), at: Date.now(), area: { mode: 'address', address: 'テスト区', lat: null, lng: null }, radius: '1km', count: 5, date: jstDay(1),
          poolKey: null, poolDay: null, category: 'all', searchArgs: null, nextPage: 1, hasMore: false, pool: [],
          snap: { area: 'テスト区', radius: '1km', count: 5, industry: '寿司・割烹' },
          pSort: 'rec', pView: 'list', pIndustries: [], pIndOpen: false, openOnly: true, expanded: [], listSort: 'default', screen: 'search',
        },
        [{ name: '旧条件', area: { mode: 'address', address: 'テスト区' }, radius: '1km', count: 10, category: 'food' }],
      ]);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await wait(page, 1000);
      await page.click('.app-seg[data-app="ml"]'); await wait(page, 900);
      const old = await page.evaluate(() => {
        const sr = document.getElementById('mlHost').shadowRoot;
        return {
          host: !!sr,
          search: !!sr.querySelector('#s-area'),
          countBtn: !!sr.querySelector('[data-act="count-open"]'),
          presetText: sr.textContent.includes('旧条件'),
          run: !!sr.querySelector('[data-act="run-search"]'),
        };
      });
      ok('古い保存データ：画面が出て、検索のボタンもある', old.host && old.search && old.run, JSON.stringify(old));
      ok('古い保存データ：件数の選択・お気に入り条件（旧条件）は出ない', !old.countBtn && !old.presetText, JSON.stringify(old));
      await ctx.close();
    }

    // ---- 4) 下のタブ・ヘッダーの隠れる速さ（今の約1.5倍）が、両方のモードで同じ。隠れる・出る動作は今まで通り ----
    {
      const { ctx, page } = await makeCtx(browser, calls, errors);
      await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
      await wait(page, 900);
      await page.evaluate(() => { document.body.style.minHeight = '3000px'; });
      const durDc = await page.evaluate(() => ({
        topbar: getComputedStyle(document.querySelector('.topbar')).transitionDuration,
        tabs: getComputedStyle(document.querySelector('.tabs')).transitionDuration,
      }));
      ok('速さ（完了報告）：ヘッダー・下のタブは 0.68s', durDc.topbar.split(',').every((d) => d.trim() === '0.68s') && durDc.tabs.split(',').every((d) => d.trim() === '0.68s'), JSON.stringify(durDc));

      // 下へ：ヘッダーと下のタブが隠れる → 上へ少し戻す：両方出る
      await page.evaluate(() => window.scrollTo(0, 0)); await wait(page, 400);
      await page.evaluate(() => window.scrollTo(0, 400)); await wait(page, 1000);
      const dcHidden = await page.evaluate(() => ({ top: document.querySelector('.topbar').classList.contains('hide'), tabs: document.querySelector('.tabs').classList.contains('hide') }));
      ok('隠れる（完了報告）：下へスクロールすると、ヘッダーと下のタブが隠れる', dcHidden.top && dcHidden.tabs, JSON.stringify(dcHidden));
      await page.evaluate(() => window.scrollTo(0, 300)); await wait(page, 1000);
      const dcShown = await page.evaluate(() => ({ top: document.querySelector('.topbar').classList.contains('hide'), tabs: document.querySelector('.tabs').classList.contains('hide') }));
      ok('出る（完了報告）：少し上へ戻すと、ヘッダーと下のタブが出る', !dcShown.top && !dcShown.tabs, JSON.stringify(dcShown));

      // マップリストのモード：同じ速さ、同じ動き
      await page.evaluate(() => window.scrollTo(0, 0)); await wait(page, 400);
      await page.click('.app-seg[data-app="ml"]'); await wait(page, 900);
      await page.evaluate(() => { document.body.style.minHeight = '3000px'; });
      const durMl = await page.evaluate(() => ({
        topbar: getComputedStyle(document.querySelector('.topbar')).transitionDuration,
        tabs: getComputedStyle(document.querySelector('.tabs')).transitionDuration,
        sort: getComputedStyle(document.querySelector('.ml-sort-wrap') || document.body).transitionDuration,
      }));
      ok('速さ（マップリスト）：ヘッダー・下のタブ・並び替えのバーも 0.68s', [durMl.topbar, durMl.tabs].every((v) => v.split(',').every((d) => d.trim() === '0.68s')) && durMl.sort.split(',').every((d) => d.trim() === '0.68s' || d.trim() === '0s'), JSON.stringify(durMl));
      await page.evaluate(() => window.scrollTo(0, 0)); await wait(page, 400);
      await page.evaluate(() => window.scrollTo(0, 400)); await wait(page, 1000);
      const mlHidden = await page.evaluate(() => ({ top: document.querySelector('.topbar').classList.contains('hide'), tabs: document.querySelector('.tabs').classList.contains('hide') }));
      ok('隠れる（マップリスト）：下へスクロールすると、ヘッダーと下のタブが隠れる', mlHidden.top && mlHidden.tabs, JSON.stringify(mlHidden));
      await page.evaluate(() => window.scrollTo(0, 300)); await wait(page, 1000);
      const mlShown = await page.evaluate(() => ({ top: document.querySelector('.topbar').classList.contains('hide'), tabs: document.querySelector('.tabs').classList.contains('hide') }));
      ok('出る（マップリスト）：少し上へ戻すと、ヘッダーと下のタブが出る', !mlShown.top && !mlShown.tabs, JSON.stringify(mlShown));
      await ctx.close();
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
