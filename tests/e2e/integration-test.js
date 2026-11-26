// 完了報告 ⇄ マップリストの切り替えと、訪問リストの共有（テスト専用。Firebase は偽物。API は応答を差し替える）
const { chromium } = require('playwright');
const SHOTS = process.env.SHOTS || '/tmp';
const BASE = process.argv[2] || 'http://localhost:8767';

const STUB = `
const user = { uid: 'u1', email: 'tester', displayName: 'テスト', emailVerified: true, providerData: [{ providerId: 'google.com' }], getIdToken: async () => 'test-token' };
const members = { emails: ['tester'], admins: ['tester'], names: {} };
const VISITS = [];
const COUNTER = { last: 0 };
const subs = [];
const apps = [];
const emptySnap = { exists: () => false, data: () => ({}), docs: [], size: 0, empty: true, forEach() {} };
const notify = () => subs.forEach((s) => s());
const docsOf = (arr) => ({ docs: arr.map((x) => ({ id: x.id, data: () => { const { id, ...rest } = x; return rest; } })), size: arr.length, empty: !arr.length, forEach(f) { this.docs.forEach(f); } });
const pathOf = (...a) => a.map((x) => (typeof x === 'string' ? x : x && x.path)).filter(Boolean).join('/');
const ts = { toDate: () => new Date(), toMillis: () => Date.now() };
export const initializeApp = () => { const a = {}; apps.push(a); return a; };
export const getApps = () => apps;
export const getApp = () => apps[0];
export const getAuth = () => ({ currentUser: user });
export const onAuthStateChanged = (a, cb) => { setTimeout(() => cb(user), 0); return () => {}; };
export const signOut = async () => {};
export class GoogleAuthProvider { setCustomParameters() {} }
export const signInWithPopup = async () => ({});
export const getRedirectResult = async () => null;
export const signInWithEmailAndPassword = async () => ({});
export const createUserWithEmailAndPassword = async () => ({});
export const signInWithRedirect = async () => {};
export const sendEmailVerification = async () => {};
export const sendPasswordResetEmail = async () => {};
export const getFirestore = () => ({});
export const doc = (...a) => {
  const p = pathOf(...a);
  return { path: p.split('/').length === 1 ? p + '/' + Math.random().toString(36).slice(2, 10) : p };
};
export const collection = (...a) => ({ path: pathOf(...a) });
export const query = (...a) => a;
export const orderBy = () => ({});
export const serverTimestamp = () => ts;
export const arrayUnion = () => ({});
export const arrayRemove = () => ({});
export const setDoc = async () => {};
export const addDoc = async () => ({ id: 'x' });
export const updateDoc = async (ref, data) => {
  const id = ref.path.split('/').pop();
  const v = VISITS.find((x) => x.id === id);
  if (v) Object.assign(v, data);
  notify();
};
export const deleteDoc = async (ref) => {
  const id = ref.path.split('/').pop();
  const i = VISITS.findIndex((x) => x.id === id);
  if (i >= 0) VISITS.splice(i, 1);
  notify();
};
export const getDoc = async () => emptySnap;
export const getDocs = async () => docsOf([]);
export const getDocsFromServer = async () => emptySnap;
export const runTransaction = async (db, fn) => {
  const writes = [];
  const tx = {
    // 本物と同じに：カウンターは常にある。書類は、今ある訪問の中に同じ id があるかで決まる
    get: async (ref) => {
      if (ref.path.startsWith('counters/')) return { exists: () => true, data: () => ({ last: COUNTER.last }) };
      const id = ref.path.split('/').pop();
      const found = VISITS.find((x) => x.id === id);
      return { exists: () => !!found, data: () => { const { id: _i, ...rest } = found || {}; return rest; } };
    },
    set: (ref, data) => writes.push({ ref, data }),
  };
  const out = await fn(tx);
  for (const w of writes) {
    if (w.ref.path.startsWith('counters/')) { COUNTER.last = w.data.last; continue; }
    const id = w.ref.path.split('/').pop();
    VISITS.unshift({ id, ...w.data });
  }
  notify();
  return out;
};
export const writeBatch = () => ({ set() {}, update() {}, delete() {}, async commit() {} });
export const onSnapshot = (r, cb) => {
  const path = Array.isArray(r) ? r[0].path : r.path;
  const emit = () => {
    if (path === 'settings/members') cb({ exists: () => true, data: () => members });
    else if (path === 'visits') cb(docsOf(VISITS));
    else cb(emptySnap);
  };
  if (path === 'visits') subs.push(emit);
  setTimeout(emit, 0);
  return () => {};
};
`;

const SHOPS = [
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
    if (u.endsWith('/api/ml-search')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, shops: SHOPS }) });
    // 完了報告側の Pages Functions（デモURL）は、静的な試験サーバーには無いので応答を用意する（本番には実物がある）
    if (/\/api\/(demo-url|demo-queue|maps-info)$/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: {}, demos: [] }) });
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });
  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // 1) ヘッダー：切り替えが出る（メンバーのログイン時）・1行・横にはみ出さない
    const hdr = await page.evaluate(() => {
      const h = document.querySelector('header.topbar');
      const sw = document.querySelector('.app-switch');
      const segs = [...document.querySelectorAll('.app-seg')].map((b) => b.getBoundingClientRect());
      return {
        height: Math.round(h.getBoundingClientRect().height),
        switchVisible: !!sw && getComputedStyle(sw).display !== 'none',
        segs: segs.map((r) => ({ l: Math.round(r.left), r: Math.round(r.right), h: Math.round(r.height) })),
        titleText: document.getElementById('appName').textContent,
        hScroll: document.documentElement.scrollWidth > window.innerWidth,
        overlapMenu: segs.length ? segs[segs.length - 1].right > window.innerWidth - 56 : true,
      };
    });
    ok('ヘッダー：切り替え（完了報告／Maplist）が出る', hdr.switchVisible && hdr.segs.length === 2, JSON.stringify(hdr.segs));
    ok('ヘッダー：タイトルは「DC 完了報告」', hdr.titleText === 'DC 完了報告', hdr.titleText);
    ok('ヘッダー：1行（高さ80px以下）', hdr.height <= 80, `${hdr.height}px`);
    ok('ヘッダー：右端の三本線ボタンと重ならない', !hdr.overlapMenu, JSON.stringify(hdr.segs));
    ok('390px：横スクロールなし（完了報告）', !hdr.hScroll);
    await page.screenshot({ path: `${SHOTS}/integ-dc-header.png` });

    // 2) マップリストに切り替える（同じ画面の中・再読み込みなし）
    const before = await page.evaluate(() => window.performance.navigation.type);
    await page.click('.app-seg[data-app="ml"]');
    await page.waitForTimeout(1200);
    const ml = await page.evaluate(() => {
      const host = document.getElementById('mlHost');
      const sr = host.shadowRoot;
      const navItems = sr ? [...sr.querySelectorAll('#nav a')].map((a) => a.textContent.trim()) : [];
      const activeScreen = sr ? (sr.querySelector('.screen.active')?.dataset.screen || '') : '';
      return {
        mode: document.body.classList.contains('mode-ml'),
        title: document.getElementById('appName').textContent,
        hostVisible: getComputedStyle(host).display !== 'none',
        dcHidden: getComputedStyle(document.getElementById('appView')).display === 'none',
        hasShadow: !!sr,
        navItems,
        activeScreen,
        selected: document.querySelector('.app-seg[data-app="ml"]').getAttribute('aria-selected'),
        hScroll: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    ok('切り替え：マップリストの画面になる（タイトル・切り替えの選択）', ml.mode && ml.title === 'マップリスト' && ml.selected === 'true', JSON.stringify({ title: ml.title, selected: ml.selected }));
    ok('切り替え：完了報告の画面は隠れ、マップリストの画面が出る', ml.dcHidden && ml.hostVisible && ml.hasShadow, JSON.stringify({ dcHidden: ml.dcHidden, hostVisible: ml.hostVisible }));
    ok('マップリスト：下のタブ（検索・提案・訪問リスト・後で訪問）', ml.navItems.join('/') === '検索/提案/訪問リスト/後で訪問', ml.navItems.join('/'));
    ok('マップリスト：最初は検索の画面', ml.activeScreen === 'search', ml.activeScreen);
    ok('390px：マップリストで横スクロールなし', !ml.hScroll);
    await page.screenshot({ path: `${SHOTS}/integ-ml-search.png` });

    // 3) 三本線メニュー：マップリストの項目
    await page.click('#menuBtn'); await page.waitForTimeout(300);
    const menu = await page.evaluate(() => {
      const vis = (id) => { const el = document.getElementById(id) || document.querySelector(id); return !!el && getComputedStyle(el).display !== 'none'; };
      const labels = [...document.querySelectorAll('#menuPanel .menu-item')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.textContent.trim());
      return { labels, tabs: vis('#menuTabs'), history: vis('#menuHistory'), ml: vis('#menuMl') };
    });
    ok('三本線メニュー（マップリスト）：完了報告のタブ・元に戻す・やり直すは出ない', !menu.tabs && !menu.history, JSON.stringify(menu.labels));
    ok('三本線メニュー（マップリスト）：訪問NG一覧・お気に入り条件が出る', menu.ml && menu.labels.includes('訪問NG一覧') && menu.labels.includes('お気に入り条件'), JSON.stringify(menu.labels));
    await page.keyboard.press('Escape'); await page.waitForTimeout(250);

    // 4) 検索 → 提案リスト（マップリストの画面の中で操作する）
    const search = async (sel, act) => {
      await page.evaluate(([s, a]) => {
        const sr = document.getElementById('mlHost').shadowRoot;
        sr.querySelector(s)?.click();
      }, [sel, act]);
    };
    await page.evaluate(() => {
      const sr = document.getElementById('mlHost').shadowRoot;
      const input = sr.querySelector('#addr');
      input.value = 'テスト区';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await search('[data-act="run-search"]');
    await page.waitForTimeout(900);
    const prop = await page.evaluate(() => {
      const sr = document.getElementById('mlHost').shadowRoot;
      return { active: sr.querySelector('.screen.active')?.dataset.screen || '', cards: sr.querySelectorAll('#pList .shop').length, names: [...sr.querySelectorAll('#pList .shop-name')].map((e) => e.textContent.trim()) };
    });
    ok('検索：提案リストに2件出る', prop.active === 'proposal' && prop.cards === 2, JSON.stringify(prop));

    // 5) 訪問リストに追加 → 完了報告の visits に入る（同じデータ）
    await page.evaluate(() => {
      const sr = document.getElementById('mlHost').shadowRoot;
      sr.querySelector('#pList [data-act="add"][data-id="place-A"]').click();
    });
    await page.waitForTimeout(900);
    const dbCount = await page.evaluate(() => window.__visitsCount ?? null);
    const listed = await page.evaluate(() => {
      const sr = document.getElementById('mlHost').shadowRoot;
      return [...sr.querySelectorAll('#lList .shop-name')].map((e) => e.textContent.trim());
    });
    ok('提案→訪問リストに追加：マップリストの訪問リストに出る', listed.includes('テスト寿司店'), JSON.stringify(listed));

    // 5b) マップリストの残りの画面（訪問リスト・後で訪問）も切り替わる
    for (const [nav, want] of [['list', 'list'], ['later', 'later'], ['proposal', 'proposal']]) {
      await page.evaluate((n) => { document.getElementById('mlHost').shadowRoot.querySelector(`#nav a[data-nav="${n}"]`).click(); }, nav);
      await page.waitForTimeout(250);
      const act = await page.evaluate(() => document.getElementById('mlHost').shadowRoot.querySelector('.screen.active')?.dataset.screen || '');
      ok(`マップリストの下のタブ：${want} に切り替わる`, act === want, act);
    }

    // 6) 完了報告の画面に戻して、同じ訪問リストが見えるか（予定の訪問・訪問リストタブ）
    await page.click('.app-seg[data-app="dc"]');
    await page.waitForTimeout(700);
    const dcState = await page.evaluate(() => ({
      mode: document.body.classList.contains('mode-ml'),
      title: document.getElementById('appName').textContent,
      appVisible: getComputedStyle(document.getElementById('appView')).display !== 'none',
    }));
    ok('完了報告に戻る：完了報告の画面・タイトルに戻る', !dcState.mode && dcState.title === 'DC 完了報告' && dcState.appVisible, JSON.stringify(dcState));
    await page.click('#menuBtn'); await page.waitForTimeout(250);
    await page.click('#menuPanel [data-menu-tab="visits"]'); await page.waitForTimeout(400);
    await page.click('#visitShowAll'); await page.waitForTimeout(400);
    const dcList = await page.textContent('#visitList');
    ok('完了報告の訪問リストに、マップリストで入れた店が出る（同じデータ）', dcList.includes('テスト寿司店'), dcList.slice(0, 120));
    ok('完了報告の訪問リストに、マップリストの内部項目（ml_）は出ない', !dcList.includes('マップリストの店情報') && !dcList.includes('マップリストID'), '');
    ok('完了報告の訪問リスト：横スクロールなし', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    // 予定（明日）にも出る。完了報告の案件番号を入れると、訪問日が自動で入る
    await page.click('#menuBtn'); await page.waitForTimeout(250);
    await page.click('#menuPanel [data-menu-tab="today"]'); await page.waitForTimeout(400);
    await page.click('#todaySeg [data-day="1"]'); await page.waitForTimeout(400);
    const tomorrowCard = await page.textContent('#todayVisits');
    ok('完了報告の予定（明日）にも、マップリストで入れた店が出る', tomorrowCard.includes('テスト寿司店'), tomorrowCard.slice(0, 80));
    await page.click('#menuBtn'); await page.waitForTimeout(250);
    await page.click('#menuPanel [data-menu-tab="form"]'); await page.waitForTimeout(400);
    await page.fill('#reportCases [data-field-id="caseNo"]', 'A001');
    await page.dispatchEvent('#reportCases [data-field-id="caseNo"]', 'change');
    await page.waitForTimeout(250);
    const autoDate = await page.$eval('#reportCases [data-field-id="visitDate"]', (el) => el.value).catch(() => '');
    const autoName = await page.$eval('#reportCases [data-field-id="visitTo"]', (el) => el.value).catch(() => '');
    ok('完了報告：案件番号A001で、訪問日と訪問先が自動で入る', autoDate.length === 10 && autoName === 'テスト寿司店', `${autoDate} / ${autoName}`);
    await page.screenshot({ path: `${SHOTS}/integ-dc-visits.png` });

    // 7) もう一度マップリストに戻っても、訪問リストと入力中の内容が残る
    await page.click('.app-seg[data-app="ml"]');
    await page.waitForTimeout(600);
    const again = await page.evaluate(() => {
      const sr = document.getElementById('mlHost').shadowRoot;
      return [...sr.querySelectorAll('#lList .shop-name')].map((e) => e.textContent.trim());
    });
    ok('もう一度マップリスト：訪問リストが残っている（読み直しなし）', again.includes('テスト寿司店'), JSON.stringify(again));

    // 窓口：同じ店を2回入れても1件（場所IDで書類を決める）・後で訪問の往復（ml_later の印）
    const bridge = async (fn) => page.evaluate(fn);
    await bridge(async () => { const shop = { id: 'place-A', name: 'テスト寿司店', industry: '寿司・割烹', address: '東京都テスト区1-1', hours: {}, rating: 4.4 }; await window.dcVisitBridge.add(shop, ''); await window.dcVisitBridge.add(shop, ''); });
    await page.waitForTimeout(300);
    const dup = await bridge(() => window.dcVisitBridge.list().filter((x) => x.id === 'place-A').length);
    ok('窓口：同じ店を2回入れても、訪問リストは1件', dup === 1, String(dup));
    await bridge(() => window.dcVisitBridge.setLater('place-A', true));
    await page.waitForTimeout(300);
    const later1 = await bridge(() => ({ list: window.dcVisitBridge.list().map((x) => x.id), later: window.dcVisitBridge.laterList().map((x) => x.id) }));
    ok('後で訪問に移す：訪問リストから外れ、後で訪問に入る', !later1.list.includes('place-A') && later1.later.includes('place-A'), JSON.stringify(later1));
    await bridge(() => window.dcVisitBridge.setLater('place-A', false));
    await page.waitForTimeout(300);
    const later2 = await bridge(() => ({ list: window.dcVisitBridge.list().map((x) => x.id), later: window.dcVisitBridge.laterList().map((x) => x.id) }));
    ok('訪問リストに戻す：訪問リストに戻り、後で訪問からは外れる', later2.list.includes('place-A') && !later2.later.includes('place-A'), JSON.stringify(later2));

    ok('コンソールエラーなし', errors.length === 0, errors.join(' | '));
  } finally {
    await browser.close();
  }
  let fail = 0;
  for (const r of results) { if (!r.pass) fail++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? '  [' + r.extra + ']' : ''}`); }
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e.message.split('\n')[0]); for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? '  [' + r.extra + ']' : ''}`); process.exit(2); });
