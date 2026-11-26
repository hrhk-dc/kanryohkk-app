// 三本線メニューの動作確認（テスト専用。Firebase は偽物に置き換える）
const { chromium } = require('playwright');
const SHOTS = process.env.SHOTS || '/tmp';
const BASE = process.argv[2] || 'http://localhost:8765';
const ONLY = process.argv[3] || ''; // 例: "baseline" でコンソールエラーだけ確認

const FAKE = 'tester';
// Firebase の代わり。役割（role）は URL の ?role= で決める
const STUB = `
const p = new URLSearchParams(location.search);
const role = p.get('role') || 'admin';
const user = role === 'logged-out' ? null : { uid: 'u1', email: '${FAKE}', emailVerified: true, providerData: [{ providerId: 'google.com' }] };
const members = role === 'admin' ? { emails: ['${FAKE}'], admins: ['${FAKE}'] }
  : role === 'member' ? { emails: ['${FAKE}'], admins: [] } : { emails: [], admins: [] };
const emptySnap = { exists: () => false, data: () => ({}), docs: [], size: 0, empty: true, forEach() {} };
const ref = (...a) => ({ path: a.slice(1).filter((x) => typeof x === 'string').join('/') });
export const initializeApp = () => ({});
export const getAuth = () => ({});
export const onAuthStateChanged = (a, cb) => { setTimeout(() => cb(user), 0); return () => {}; };
export const signOut = async () => { window.__signedOut = true; };
export class GoogleAuthProvider { setCustomParameters() {} }
export const getRedirectResult = async () => null;
export const signInWithEmailAndPassword = async () => ({});
export const createUserWithEmailAndPassword = async () => ({});
export const signInWithRedirect = async () => {};
export const sendEmailVerification = async () => {};
export const sendPasswordResetEmail = async () => {};
export const getFirestore = () => ({});
export const doc = (...a) => ref(...a);
export const collection = (...a) => ref(...a);
export const query = (...a) => a;
export const orderBy = () => ({});
export const serverTimestamp = () => ({});
export const arrayUnion = () => ({});
export const arrayRemove = () => ({});
export const setDoc = async () => {};
export const addDoc = async () => ({ id: 'x' });
export const updateDoc = async () => {};
export const deleteDoc = async () => {};
export const getDoc = async () => emptySnap;
export const getDocsFromServer = async () => emptySnap;
export const runTransaction = async () => {};
export const writeBatch = () => ({ set() {}, update() {}, delete() {}, async commit() {} });
export const onSnapshot = (r, cb) => {
  setTimeout(() => {
    if (r.path === 'settings/members') cb({ exists: () => true, data: () => members });
    else cb(emptySnap);
  }, 0);
  return () => {};
};
`;

// Round 16：元に戻す・やり直すは三本線メニューの中へ移った（ヘッダーからは外れた）
const LABELS_ADMIN = ['予定', '訪問リスト', '完了報告', '報告一覧', '集計', '管理', 'このアプリについて', '元に戻す', 'やり直す', 'マップリストアプリ', 'リンクをコピー', '名前を設定', 'ログアウト'];
const LABELS_MEMBER = ['予定', '訪問リスト', '完了報告', '報告一覧', 'このアプリについて', '元に戻す', 'やり直す', 'マップリストアプリ', 'リンクをコピー', '名前を設定', 'ログアウト'];
const LABELS_PENDING = ['元に戻す', 'やり直す', 'マップリストアプリ', 'リンクをコピー', '名前を設定', 'ログアウト'];

const results = [];
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); };

async function openPage(browser, role) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errors.push(m.text()); }); // 外部（フォント等）を止めた分の ERR_FAILED は除外（ベースラインにも同じ行がある）
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('https://www.gstatic.com/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });
  await page.goto(`${BASE}/index.html?role=${role}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  return { ctx, page, errors };
}

const menuOpen = (page) => page.evaluate(() => document.getElementById('menuLayer').classList.contains('open'));
const menuLabels = (page) => page.evaluate(() => [...document.querySelectorAll('#menuPanel .menu-item')]
  .filter((e) => getComputedStyle(e).display !== 'none' && !e.closest('.hidden')
    && (!e.closest('.menu-group') || getComputedStyle(e.closest('.menu-group')).display !== 'none'))
  .map((e) => e.textContent.trim()));
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function runAdmin(browser) {
  const { ctx, page, errors } = await openPage(browser, 'admin');
  const hdr = await page.evaluate(() => {
    const h = document.querySelector('header.topbar');
    return { height: h.getBoundingClientRect().height, ids: [...h.querySelectorAll('[id]')].map((e) => e.id), texts: h.textContent.replace(/\s+/g, '') };
  });
  ok('ヘッダーに4つの操作がない', !['copyAppLink', 'myNameLabel', 'logoutBtn', 'userEmail'].some((id) => hdr.ids.includes(id)), JSON.stringify(hdr.ids));
  ok('ヘッダーは1行（高さ80px以下）', hdr.height <= 80, `height=${hdr.height}`);
  ok('元に戻す・やり直すはヘッダーから外れる（三本線メニューに移る）', !hdr.ids.includes('undoBtn') && !hdr.ids.includes('redoBtn'));
  const btn = await page.evaluate(() => { const r = document.getElementById('menuBtn').getBoundingClientRect(); return { w: r.width, h: r.height, top: r.top, right: r.right, display: getComputedStyle(document.getElementById('menuBtn')).display, position: getComputedStyle(document.getElementById('menuBtn')).position }; });
  ok('三本線ボタンは fixed・直径44px以上・右上', btn.position === 'fixed' && btn.w >= 44 && btn.h >= 44 && btn.right <= 390 && btn.right > 340 && btn.top < 30, JSON.stringify(btn));
  ok('390pxで横スクロールなし（予定）', await noHorizontalScroll(page));
  ok('コンソールに出る前の確認：メニューは閉じている', !(await menuOpen(page)));

  // 開く
  await page.click('#menuBtn');
  await page.waitForTimeout(300);
  ok('タップでメニューが開く', await menuOpen(page));
  ok('aria-expanded=true', (await page.getAttribute('#menuBtn', 'aria-expanded')) === 'true');
  const labels = await menuLabels(page);
  ok('項目の並び（管理者）', JSON.stringify(labels) === JSON.stringify(LABELS_ADMIN), JSON.stringify(labels));
  const email = await page.textContent('#userEmail');
  ok('最後にログイン中のメールだけ表示（押せない文字）', email.includes(FAKE) && email.includes('（管理者）'), email);
  const panel = await page.evaluate(() => { const r = document.getElementById('menuPanel').getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, t: r.top, vh: innerHeight }; });
  ok('メニューが画面内に収まる', panel.l >= 0 && panel.r <= 390 && panel.b <= panel.vh, JSON.stringify(panel));
  const underTab = await page.evaluate(() => {
    const t = document.querySelector('.tabs .tab[data-tab="today"]').getBoundingClientRect();
    const el = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2);
    return el ? (el.closest('#menuLayer') ? 'menu' : el.className || el.tagName) : null;
  });
  ok('開いている間は後ろの下のタブを触れない（幕が覆う）', underTab === 'menu', underTab);
  ok('開いている間は本体が inert', await page.evaluate(() => document.querySelector('main').inert === true && document.querySelector('header.topbar').inert === true));
  await page.screenshot({ path: `${SHOTS}/menu-open-admin.png` });

  // 項目をタップ → そのタブへ移動して閉じる
  await page.click('#menuPanel [data-menu-tab="visits"]');
  await page.waitForTimeout(300);
  ok('訪問リストへ移動して閉じる', !(await menuOpen(page)) && await page.evaluate(() => !document.getElementById('tab-visits').classList.contains('hidden') && document.getElementById('tab-today').classList.contains('hidden')));

  await page.click('#menuBtn'); await page.waitForTimeout(250);
  await page.click('#menuPanel [data-menu-tab="list"]'); await page.waitForTimeout(300);
  ok('報告一覧へ移動して閉じる', !(await menuOpen(page)) && await page.evaluate(() => !document.getElementById('tab-list').classList.contains('hidden')));

  await page.click('#menuBtn'); await page.waitForTimeout(250);
  await page.click('#menuPanel [data-menu-tab="form"]'); await page.waitForTimeout(300);
  ok('完了報告へ移動して閉じる', !(await menuOpen(page)) && await page.evaluate(() => !document.getElementById('tab-form').classList.contains('hidden')));

  await page.click('#menuBtn'); await page.waitForTimeout(250);
  await page.click('#menuPanel [data-menu-tab="stats"]'); await page.waitForTimeout(300);
  ok('集計へ移動（管理者）', !(await menuOpen(page)) && await page.evaluate(() => !document.getElementById('tab-stats').classList.contains('hidden')));

  // 閉じ方：幕のタップ・Esc・三本線（×）
  await page.click('#menuBtn'); await page.waitForTimeout(250);
  await page.mouse.click(20, 780); await page.waitForTimeout(300);
  ok('幕をタップで閉じる', !(await menuOpen(page)));

  await page.click('#menuBtn'); await page.waitForTimeout(250);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  ok('Escで閉じる', !(await menuOpen(page)));

  await page.click('#menuBtn'); await page.waitForTimeout(250);
  ok('開くと三本線が×に変わる（aria-label）', (await page.getAttribute('#menuBtn', 'aria-label')) === 'メニューを閉じる');
  await page.click('#menuBtn'); await page.waitForTimeout(300);
  ok('もう一度三本線（×）をタップで閉じる', !(await menuOpen(page)) && (await page.getAttribute('#menuBtn', 'aria-expanded')) === 'false');

  // 名前を設定：閉じてから名前の入力欄を開く
  await page.click('#menuBtn'); await page.waitForTimeout(250);
  await page.click('#menuPanel #myNameLabel'); await page.waitForTimeout(300);
  ok('名前を設定：メニューが閉じ、入力欄が開く', !(await menuOpen(page)) && await page.evaluate(() => !document.getElementById('namePanel').classList.contains('hidden')));
  await page.click('#cancelMyName'); await page.waitForTimeout(150);

  // リンクをコピー：メニューが閉じる（クリップボードは権限がないので失敗しても閉じることだけ確認）
  await page.click('#menuBtn'); await page.waitForTimeout(250);
  await page.click('#menuPanel #copyAppLink'); await page.waitForTimeout(300);
  ok('リンクをコピー：メニューが閉じる', !(await menuOpen(page)));

  // ログアウト
  await page.click('#menuBtn'); await page.waitForTimeout(250);
  await page.click('#menuPanel #logoutBtn'); await page.waitForTimeout(300);
  ok('ログアウト：呼び出され、メニューが閉じる', (await page.evaluate(() => window.__signedOut === true)) && !(await menuOpen(page)));

  // スクロールしても三本線は残る（上のバーは隠れる）
  await page.evaluate(() => { document.body.style.minHeight = '2400px'; });
  await page.evaluate(() => document.querySelector('[data-tab="list"]') && 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForTimeout(700);
  const sc = await page.evaluate(() => {
    const b = document.getElementById('menuBtn'); const r = b.getBoundingClientRect();
    const top = document.querySelector('header.topbar');
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { hideTop: top.classList.contains('hide'), opacity: getComputedStyle(b).opacity, top: r.top, hit: hit && (hit.id === 'menuBtn' || !!hit.closest('#menuBtn')), y: scrollY };
  });
  ok('スクロールで上のバーは隠れても三本線は出たまま', sc.hideTop && sc.opacity === '1' && sc.top < 30 && sc.hit, JSON.stringify(sc));
  ok('スクロール後も390pxで横スクロールなし', await noHorizontalScroll(page));
  await page.screenshot({ path: `${SHOTS}/menu-scrolled-admin.png` });
  ok('コンソールエラーなし（管理者）', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function runRole(browser, role, expectLabels, name) {
  const { ctx, page, errors } = await openPage(browser, role);
  if (role === 'logged-out') {
    const d = await page.evaluate(() => ({ btn: getComputedStyle(document.getElementById('menuBtn')).display, layer: getComputedStyle(document.getElementById('menuLayer')).display }));
    ok(`${name}：ログアウト中は三本線を出さない`, d.btn === 'none' && d.layer === 'none', JSON.stringify(d));
  } else {
    await page.click('#menuBtn'); await page.waitForTimeout(300);
    const labels = await menuLabels(page);
    ok(`${name}：項目の並び`, JSON.stringify(labels) === JSON.stringify(expectLabels), JSON.stringify(labels));
    ok(`${name}：横スクロールなし`, await noHorizontalScroll(page));
    await page.screenshot({ path: `${SHOTS}/menu-open-${role}.png` });
    await page.keyboard.press('Escape');
  }
  ok(`${name}：コンソールエラーなし`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    if (ONLY === 'baseline') {
      const { ctx, page, errors } = await openPage(browser, 'admin');
      console.log('baseline errors:', JSON.stringify(errors));
      await ctx.close();
    } else {
      await runAdmin(browser);
      await runRole(browser, 'member', LABELS_MEMBER, '作業員');
      await runRole(browser, 'pending', LABELS_PENDING, '承認待ち');
      await runRole(browser, 'logged-out', [], 'ログアウト中');
    }
  } finally {
    await browser.close();
  }
  let fail = 0;
  for (const r of results) { if (!r.pass) fail++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? '  [' + r.extra + ']' : ''}`); }
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
