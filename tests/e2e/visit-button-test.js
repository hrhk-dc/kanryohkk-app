// 訪問リストの「Maplist」ボタンの確認（テスト専用。Firebase は偽物に置き換える）
const { chromium } = require('playwright');
const SHOTS = process.env.SHOTS || '/tmp';
const BASE = process.argv[2] || 'http://localhost:8767';
const TARGET = 'https://maplist-app.pages.dev/';

const STUB = `
const user = { uid: 'u1', email: 'tester', emailVerified: true, providerData: [{ providerId: 'google.com' }] };
const members = { emails: ['tester'], admins: ['tester'] };
const emptySnap = { exists: () => false, data: () => ({}), docs: [], size: 0, empty: true, forEach() {} };
const ref = (...a) => ({ path: a.slice(1).filter((x) => typeof x === 'string').join('/') });
export const initializeApp = () => ({});
export const getAuth = () => ({});
export const onAuthStateChanged = (a, cb) => { setTimeout(() => cb(user), 0); return () => {}; };
export const signOut = async () => {};
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

const results = [];
const ok = (name, cond, extra = '') => results.push({ name, pass: !!cond, extra: String(extra) });

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
    if (u.startsWith(BASE)) return route.fallback();
    return route.abort();
  });
  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await page.click('#menuBtn'); await page.waitForTimeout(250);
    await page.click('#menuPanel [data-menu-tab="visits"]'); await page.waitForTimeout(400);

    const info = await page.evaluate(() => {
      const head = document.querySelector('#tab-visits .card-head');
      const h2 = document.getElementById('visitFormTitle');
      const btn = head && head.querySelector('.maplist-btn');
      const img = btn && btn.querySelector('img');
      const r = (el) => el && el.getBoundingClientRect();
      const hr = r(h2), br = r(btn), ir = r(img), card = r(head.closest('.card'));
      return {
        headText: h2 && h2.textContent.trim(),
        btnText: btn && btn.textContent.trim(),
        btnHref: btn && btn.getAttribute('href'), btnTarget: btn && btn.target, btnRel: btn && btn.rel,
        sameRow: hr && br && Math.abs(hr.top + hr.height / 2 - (br.top + br.height / 2)) < 12,
        headLeft: hr && hr.left < br.left,
        btnH: br && Math.round(br.height), btnW: br && Math.round(br.width),
        btnInsideCard: br && br.right <= card.right - 8 && br.left >= card.left,
        iconW: ir && Math.round(ir.width), iconH: ir && Math.round(ir.height),
        iconLoaded: img && img.complete && img.naturalWidth > 0,
        iconSrc: img && img.getAttribute('src'),
        hScroll: document.documentElement.scrollWidth > window.innerWidth,
        decoration: btn && getComputedStyle(btn).textDecorationLine,
      };
    });
    ok('見出し「訪問リストを入力」が左、ボタンが右の同じ行にある', info.headText === '訪問リストを入力' && info.sameRow && info.headLeft, JSON.stringify({ sameRow: info.sameRow, headLeft: info.headLeft }));
    ok('ボタンの文字は「Maplist」', info.btnText === 'Maplist', info.btnText);
    ok('ボタンは390pxのカードの中に収まる', info.btnInsideCard, `w=${info.btnW}`);
    ok('ボタンの高さは44px以上', info.btnH >= 44, `${info.btnH}px`);
    ok('アイコンが表示されている（24〜28px、読み込み済み）', info.iconLoaded && info.iconW >= 24 && info.iconW <= 28 && info.iconH >= 24 && info.iconH <= 28 && info.iconSrc === '/icons/maplist-icon.png', `${info.iconW}x${info.iconH} ${info.iconSrc}`);
    ok('タップ先・開き方：maplist-app.pages.dev・新しいタブ・noopener', info.btnHref === TARGET && info.btnTarget === '_blank' && info.btnRel.includes('noopener'), `${info.btnHref} ${info.btnTarget}`);
    ok('下線なし', info.decoration === 'none', info.decoration);
    ok('390pxで横スクロールなし', !info.hScroll);
    await page.screenshot({ path: `${SHOTS}/visit-maplist-button.png` });

    const [popup] = await Promise.all([
      ctx.waitForEvent('page', { timeout: 8000 }),
      page.click('.maplist-btn'),
    ]);
    await popup.waitForTimeout(500);
    ok('タップで maplist-app.pages.dev が新しいタブで開く', popup.url().startsWith(TARGET), popup.url());
    await popup.close().catch(() => {});
    ok('同じ画面は変わらない（訪問リストのまま）', await page.evaluate(() => !document.getElementById('tab-visits').classList.contains('hidden')));

    // ほかのタブ・カードには付けない
    const count = await page.evaluate(() => document.querySelectorAll('.maplist-btn').length);
    ok('ボタンはこのカードだけ（1つ）', count === 1, count);
    ok('コンソールエラーなし', errors.length === 0, errors.join(' | '));
  } finally {
    await browser.close();
  }
  let fail = 0;
  for (const r of results) { if (!r.pass) fail++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? '  [' + r.extra + ']' : ''}`); }
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
