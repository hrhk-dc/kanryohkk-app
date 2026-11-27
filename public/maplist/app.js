(function () {
  'use strict';

  // ---------- 小さな道具 ----------
  // 完了報告アプリの中に、影の根（shadow root）として組み込まれている。この画面の中の要素・クリックだけを扱う
  const root = window.__mlRoot;
  const $ = (s, r = root) => r.querySelector(s);
  const $$ = (s, r = root) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const D = window.VLA_DATA;

  // ---------- 日付（すべて日本時間 JST 基準） ----------
  const JST_MS = 9 * 3600 * 1000;
  const pad = (n) => String(n).padStart(2, '0');
  const WD_JP = ['日', '月', '火', '水', '木', '金', '土'];
  const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 月曜始まりで表示
  const ymdOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const todayJst = () => ymdOf(new Date(Date.now() + JST_MS));
  const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return ymdOf(new Date(Date.UTC(y, m - 1, d + n))); };
  const wdOf = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
  const weekKey = (s) => DAY_KEYS[wdOf(s)];
  const fmtDate = (s) => { const [, m, d] = s.split('-').map(Number); return `${m}月${d}日（${WD_JP[wdOf(s)]}）`; };

  // ---------- 定数 ----------
  const RADIUS = [
    ['500m', '500m', 500],
    ['1km', '1km', 1000],
    ['2km', '2km', 2000],
    ['3km', '3km', 3000],
    ['town', '町名まるごと', 1500], // 町名まるごとの実際の範囲はバックエンドで決める（仮の値）
  ];
  const COUNTS = [3, 5, 10, 15, 20];
  const ITEM_H = 44;
  const REASONS_BLOCK = ['出禁', '廃業・閉店', 'ターゲット外'];
  const SCREENS = ['search', 'proposal', 'list', 'later'];
  const NAV = [['search', '検索', 'search'], ['proposal', '提案', 'target'], ['list', '訪問予定', 'list'], ['later', '後で訪問', 'later']];
  const SITE_URL = 'https://kanryohkk-app.pages.dev';

  // ---------- 線のアイコン（1.5px・塗りつぶしなし） ----------
  const ICON_PATHS = {
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    later: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>',
    map: '<path d="M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4z"/><path d="M9 4v14M15 6v14"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    cal: '<rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    insta: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.6"/><path d="M16.8 7.2h.01"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
    gps: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
    block: '<circle cx="12" cy="12" r="8.5"/><path d="M6 18L18 6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    next: '<path d="M9 6l6 6-6 6"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  };
  const ic = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;

  // ---------- 保存（端末内。訪問リストの本番保存は別途） ----------
  const LS = {
    get(k, def) { try { const v = localStorage.getItem('vla:' + k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem('vla:' + k, JSON.stringify(v)); } catch (e) { /* 保存できない端末では無視 */ } },
  };

  // ---------- おすすめの点数（基準は暫定。バックエンド担当と確定させる） ----------
  // 評価の4項目（同じ重み）。取れない項目は平均から外す（3点で埋めない）
  const KEYS = ['rating', 'reviews', 'price', 'info'];
  const W = { rating: 0.25, reviews: 0.25, price: 0.25, info: 0.25 };
  const LABEL = { rating: '評価', reviews: '口コミ', price: '価格帯', info: '情報の充実度' };
  const CRIT = {
    rating: '4.5以上＝5点／4.0以上＝4点／3.5以上＝3点／3.0以上＝2点／それ未満＝1点',
    reviews: '200件以上＝5点／100件以上＝4点／50件以上＝3点／10件以上＝2点／9件以下＝1点',
    price: 'Googleの価格帯：無料・安い＝1〜2点／普通＝3点／高い＝4点／とても高い＝5点。価格帯が分からない店は平均に入れない',
    info: '営業時間・住所・業種・評価のうち揃っている数に1を足す（4つすべてで5点）',
  };
  const WHY = {
    rating: '口コミ評価が高く、店の信頼が見込める',
    reviews: '口コミが多く、集客の実績がある',
    price: '客単価が高い店ほど、営業先として有望と考えられる',
    info: '情報が揃っている店は、事前に確認しやすく、訪問の準備がしやすい',
  };
  // Places の価格帯 → 点数（高いほど高得点）。分からないものは null
  const PRICE_POINTS = { PRICE_LEVEL_FREE: 1, PRICE_LEVEL_INEXPENSIVE: 2, PRICE_LEVEL_MODERATE: 3, PRICE_LEVEL_EXPENSIVE: 4, PRICE_LEVEL_VERY_EXPENSIVE: 5 };
  const PRICE_NAME = { 1: '無料・安い', 2: '安い', 3: '普通', 4: '高い', 5: 'とても高い' };

  // 情報の充実度：営業時間・住所・業種・評価が揃っている数
  function infoCount(s) {
    const hasHours = Object.values(s.hours || {}).some((t) => typeof t === 'string' && t.trim() !== '');
    return [hasHours, !!s.address, !!s.industry, s.rating > 0].filter(Boolean).length;
  }

  function subScores(s) {
    const pts = PRICE_POINTS[s.priceLevel];
    return {
      rating: s.rating >= 4.5 ? 5 : s.rating >= 4 ? 4 : s.rating >= 3.5 ? 3 : s.rating >= 3 ? 2 : 1,
      reviews: s.reviews >= 200 ? 5 : s.reviews >= 100 ? 4 : s.reviews >= 50 ? 3 : s.reviews >= 10 ? 2 : 1,
      price: pts == null ? null : pts,
      info: 1 + infoCount(s),
    };
  }

  function evidence(s, k) {
    if (k === 'rating') return `評価 ${s.rating}（5点満点）`;
    if (k === 'reviews') return `口コミ ${s.reviews}件`;
    if (k === 'price') return PRICE_POINTS[s.priceLevel] == null ? '価格帯は未取得' : `価格帯：${PRICE_NAME[PRICE_POINTS[s.priceLevel]]}`;
    return `営業時間・住所・業種・評価のうち ${infoCount(s)} 件が揃っている`;
  }

  // 理由の文章（点数ごとに、シンプルな項目は短く、大事な項目は詳しく書く）
  function reasonDetail(s, k) {
    const v = s.sub[k];
    if (k === 'rating') {
      if (v === 5) return `Googleの評価が${s.rating}と非常に高く、口コミ${s.reviews}件に支えられた信頼のあるお店です`;
      if (v === 4) return `評価${s.rating}と高めで、初めての訪問でも話を聞いてもらいやすいお店です`;
      if (v === 3) return `評価${s.rating}は平均的で、無理のない訪問先です`;
      return `評価${s.rating}はやや低めです。訪問前に店の強みを確認してから回ると安心です`;
    }
    if (k === 'reviews') {
      if (v === 5) return `口コミが${s.reviews}件と多く、地域で長く選ばれている実績があります`;
      if (v === 4) return `口コミが${s.reviews}件あり、お客さんに選ばれている実績があります`;
      if (v === 3) return `口コミは${s.reviews}件で、一定の実績があります`;
      return `口コミは${s.reviews}件と少なめです`;
    }
    if (k === 'price') {
      if (v >= 4) return `価格帯が${PRICE_NAME[v]}お店で、客単価が高く、営業先として見込みがあります`;
      if (v === 3) return '価格帯は普通で、無理のない訪問先です';
      return `価格帯は${PRICE_NAME[v]}お店です`;
    }
    // 情報の充実度
    if (v === 5) return '営業時間・住所・業種・評価がすべて揃っていて、訪問前に確認しやすいお店です';
    return `営業時間・住所・業種・評価のうち${v - 1}件が揃っています`;
  }

  // 理由は3〜5項目。点数4以上の項目を詳しく書く（足りないときは上位3つまで広げる）。
  // 近い店（1km以内）には、移動の負担が少ないことも理由に足す。
  function buildReasons(s, sub) {
    const known = KEYS.filter((k) => sub[k] != null); // 取れた項目だけで理由を選ぶ
    const ranked = known.slice().sort((a, b) => sub[b] - sub[a]);
    let picked = ranked.filter((k) => sub[k] >= 4);
    if (picked.length < 3) picked = ranked.slice(0, 3);
    const list = picked.slice(0, 4).map((k) => reasonDetail({ ...s, sub }, k));
    // 4つにそろえる：近い店（1km以内）の移動の話 → 店のデータから作る特徴（作れなければ、そのままの数）
    if (s.distance <= 1000 && list.length < 4) {
      const near = s.distance < 300 ? 'すぐ近くにあり' : `現在地から${fmtDist(s.distance)}と近く`;
      list.push(`${near}、移動の負担が少なく回れます`);
    }
    for (const f of featureFill(s)) { if (list.length >= 4) break; list.push(f); }
    return list.slice(0, 4);
  }

  // 店のデータから作る、その店らしい特徴（取れているものだけ。無いものは作らない）
  function featureFill(s) {
    const out = [];
    // 営業時間の閉店（「11:00〜21:00」の後ろの時刻）が遅いか
    const closes = Object.values(s.hours || {})
      .map((t) => (typeof t === 'string' ? (t.match(/〜\s*(\d{1,2})/) || [])[1] : null))
      .filter(Boolean).map(Number);
    const latest = closes.length ? Math.max(...closes) : null;
    if (latest != null && latest >= 21) out.push(`閉店が${latest}時と遅く、夜の時間帯にも訪問しやすいお店です`);
    if (s.insta) out.push('SNSで店の情報を発信しています');
    if (s.industry) out.push(`業種は「${s.industry}」のお店です`);
    return out;
  }

  function withScores(s) {
    const sub = subScores(s);
    // 取れた項目だけで平均する（取れなかった項目は3で埋めず、平均に入れない）
    const usable = KEYS.filter((k) => sub[k] != null);
    const wSum = usable.reduce((a, k) => a + W[k], 0);
    const total5 = usable.reduce((a, k) => a + sub[k] * W[k], 0) / wSum;
    const overall = Math.round(total5 * 2 * 10) / 10;
    return { ...s, sub, total5, overall, reasons: buildReasons(s, sub) };
  }

  const SORTERS = {
    rec: (a, b) => b.overall - a.overall || a.distance - b.distance,
    dist: (a, b) => a.distance - b.distance,
    rating: (a, b) => b.rating - a.rating || b.reviews - a.reviews,
  };

  // ---------- 状態 ----------
  const today = todayJst();
  const state = {
    area: { mode: 'address', address: '', lat: null, lng: null },
    radius: '1km',
    count: 5,
    date: addDays(today, 1), // 訪問する日（デフォルトは翌日・JST）
    industries: new Set(),   // 検索画面で選んだ業種（空＝全業種）
    indTab: 0,
    presets: LS.get('presets', []),
    user: null,              // ログイン中の利用者（{name}）。未ログインは null
    blocks: [],
    pool: [],                // 検索で取得した候補（おすすめ点つき）
    snap: null,              // 検索時の条件（提案画面の要約用）
    pSort: 'rec',
    pView: 'list',           // 提案の表示：一覧（list）か地図（map）
    pIndustries: new Set(),  // 提案画面の業種絞り込み（空＝全業種）
    pIndOpen: false,         // 業種の一覧を開いているか（最初は閉じる）
    openOnly: true,
    expanded: new Set(),
    visit: [],                   // [{id, shop, visitDate}]。完了報告アプリの訪問リスト（visits）と同じもの（syncVisits で読む）
    later: [],                   // 後で訪問：完了報告の visits（ml_later の印）。syncVisits で読む
    listSort: 'default',
    userPos: null,
  };
  let pendingCount = 5;
  let dateCb = null;

  // ---------- 再読み込みしても消えないように（端末内。検索条件・提案の候補・表示の状態） ----------
  // 訪問予定・後で訪問は完了報告の visits（Firestore）から読むので、ここには入れない。
  // 候補（提案）は、同じ日（JST）のものだけ戻す。前の日の候補は消して、もう一度検索してもらう。
  const UI_KEY = 'ui';
  let uiSaveTimer = null;
  function saveUi() {
    LS.set(UI_KEY, {
      day: today, at: Date.now(),
      area: state.area, radius: state.radius, count: state.count, date: state.date,
      industries: [...state.industries], indTab: state.indTab,
      pool: state.pool, snap: state.snap,
      pSort: state.pSort, pView: state.pView, pIndustries: [...state.pIndustries], pIndOpen: state.pIndOpen,
      openOnly: state.openOnly, expanded: [...state.expanded], listSort: state.listSort,
      screen: curScreen,
    });
  }
  function saveUiSoon() { clearTimeout(uiSaveTimer); uiSaveTimer = setTimeout(saveUi, 300); }
  // 戻せたら true。前の日の候補があって消したときは 'stale' を返す
  function restoreUi() {
    const d = LS.get(UI_KEY, null);
    if (!d || typeof d !== 'object') return null;
    const sameDay = d.day === today;
    const arr = (v) => (Array.isArray(v) ? v : []);
    if (d.area && typeof d.area === 'object') state.area = { ...state.area, ...d.area };
    if (RADIUS.some((r) => r[0] === d.radius)) state.radius = d.radius;
    if (Number.isFinite(d.count)) state.count = d.count;
    state.date = sameDay && d.date ? d.date : addDays(today, 1);
    state.industries = new Set(arr(d.industries));
    if (Number.isFinite(d.indTab)) state.indTab = d.indTab;
    if (Object.prototype.hasOwnProperty.call(SORTERS, d.pSort)) state.pSort = d.pSort;
    if (d.pView === 'map' || d.pView === 'list') state.pView = d.pView;
    state.pIndustries = new Set(arr(d.pIndustries));
    state.pIndOpen = d.pIndOpen === true;
    if (typeof d.openOnly === 'boolean') state.openOnly = d.openOnly;
    state.expanded = new Set(arr(d.expanded));
    if (typeof d.listSort === 'string') state.listSort = d.listSort;
    if (SCREENS.includes(d.screen)) curScreen = d.screen;
    if (sameDay && arr(d.pool).length) { state.pool = d.pool; state.snap = d.snap || null; return 'restored'; }
    return arr(d.pool).length ? 'stale' : 'restored';
  }

  // ---------- 共通の部品 ----------
  const weekRange = (k) => { const d = addDays(today, k); return d; };
  const mapUrl = (s) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.name + ' ' + s.address)}`;
  const fmtDist = (m) => (m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`);
  const isOpenOn = (s, date) => !!s.hours[weekKey(date)];
  const findIn = (list, id) => list.find((x) => x.id === id);
  const findShop = (id) => findIn(state.pool, id) || (findIn(state.visit, id) || {}).shop || (findIn(state.later, id) || {}).shop;
  const inVisit = (id) => state.visit.some((x) => x.id === id);
  const inLater = (id) => state.later.some((x) => x.id === id);
  const industryLabel = (set) => (set.size ? `${set.size}業種` : '全業種');

  function distM(a, b) {
    const R = 6371000, rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function hoursRow(s, date) {
    const wk = date ? weekKey(date) : '';
    return `<div class="hours">${DAY_ORDER.map((i) => {
      const k = DAY_KEYS[i];
      const h = s.hours[k];
      return `<span class="hpill${h ? '' : ' closed'}${k === wk ? ' sel' : ''}"><b>${WD_JP[i]}</b>${h ? esc(h) : '定休日'}</span>`;
    }).join('')}</div>`;
  }

  // ---------- 日付：今日・明日＋カレンダー（月をまたいで選べる） ----------
  // 選べる範囲：2日前〜120日先（JST）
  const DATE_MIN = () => addDays(todayJst(), -2);
  const DATE_MAX = () => addDays(todayJst(), 120);
  const CAL = { search: null, sheet: null }; // 表示中の月（YYYY-MM）
  const CAL_OPEN = { search: false, sheet: false }; // カレンダーを開いているか（普段は閉じている）

  // 選んだ日付だけの簡易表示。タップするとカレンダーが開く（もう一度で閉じる）
  function calToggleHTML(kind, sel) {
    const open = CAL_OPEN[kind];
    return `<button class="cal-toggle${open ? ' open' : ''}" data-act="cal-toggle" data-kind="${kind}" aria-expanded="${open}">
      <span>${fmtDate(sel)}</span>${ic('down')}</button>`;
  }
  let dateCtx = null;                        // 訪問日シートの対象 {id, kind, sel}

  function shiftMonth(ym, d) {
    const [y, m] = ym.split('-').map(Number);
    return ymdOf(new Date(Date.UTC(y, m - 1 + d, 1))).slice(0, 7);
  }

  // 今日・明日のボタン（選ばれている日は縁を光らせる）
  function quickDates(sel, act, extra = '') {
    const t = todayJst();
    return `<div class="quick">${[['今日', t], ['明日', addDays(t, 1)]].map(([l, d]) =>
      `<button class="pill-btn${d === sel ? ' on' : ''}" data-act="${act}" data-date="${d}" ${extra}>${l}　${Number(d.slice(5, 7))}/${Number(d.slice(8))}</button>`).join('')}</div>`;
  }

  // カレンダー（kind は 'search' か 'sheet'）
  function calHTML(kind, sel, act, extra = '') {
    const min = DATE_MIN(), max = DATE_MAX(), t = todayJst();
    if (!CAL[kind]) CAL[kind] = (sel || t).slice(0, 7);
    const ym = CAL[kind];
    const [y, m] = ym.split('-').map(Number);
    const last = ymdOf(new Date(Date.UTC(y, m, 0)));
    const prevOk = last >= min;
    const nextOk = addDays(last, 1) <= max;
    let cells = '';
    for (let i = 0; i < wdOf(`${ym}-01`); i++) cells += '<span></span>';
    for (let day = 1; day <= Number(last.slice(8)); day++) {
      const d = `${ym}-${pad(day)}`;
      const off = d < min || d > max;
      cells += `<button class="cal-day${d === sel ? ' on' : ''}${d === t ? ' today' : ''}" data-act="${act}" data-date="${d}" ${extra}${off ? ' disabled' : ''} aria-label="${fmtDate(d)}">${day}</button>`;
    }
    return `<div class="cal">
      <div class="cal-head">
        <button class="icon-btn cal-nav" data-act="cal-nav" data-kind="${kind}" data-d="-1" ${prevOk ? '' : 'disabled'} aria-label="前の月">${ic('back')}</button>
        <b>${y}年${m}月</b>
        <button class="icon-btn cal-nav" data-act="cal-nav" data-kind="${kind}" data-d="1" ${nextOk ? '' : 'disabled'} aria-label="次の月">${ic('next')}</button>
      </div>
      <div class="cal-grid">${WD_JP.map((w) => `<span class="cal-wd">${w}</span>`).join('')}${cells}</div>
    </div>`;
  }

  // 横にスクロールする行の端に、続きがある合図（グラデーション）を出す
  function markEdges() {
    $$('.hscroll').forEach((el) => {
      const w = el.parentElement;
      if (!w) return;
      const max = el.scrollWidth - el.clientWidth;
      w.classList.toggle('edge-l', el.scrollLeft > 4);
      w.classList.toggle('edge-r', max > 4 && el.scrollLeft < max - 4);
    });
  }
  root.addEventListener('scroll', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('hscroll')) markEdges();
  }, true);
  window.addEventListener('resize', markEdges);

  // （旧）日付チップ行。新しい日付の表示では使わない
  function dateStrip(sel, act, extra = '') {
    const t = todayJst();
    let h = '';
    for (let k = -2; k <= 7; k++) {
      const d = addDays(t, k);
      const lab = k === 0 ? '今日' : k === 1 ? '明日' : ' ';
      h += `<button class="dchip${d === sel ? ' on' : ''}" data-act="${act}" data-date="${d}" ${extra}><small>${lab}</small><b>${Number(d.slice(5, 7))}/${Number(d.slice(8))}</b><span>${WD_JP[wdOf(d)]}</span></button>`;
    }
    return `<div class="dstrip">${h}</div>`;
  }

  function copyText(text, msg = 'コピーしました') {
    const fallback = () => {
      const t = document.createElement('textarea');
      t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      t.remove();
      toast(ok ? msg : 'コピーできませんでした');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast(msg), fallback);
    } else fallback();
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function openSheet(title, html) {
    const sheet = $('#sheet');
    sheet.innerHTML = `<div class="scrim" data-close></div><section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="閉じる">${ic('x')}</button></header><div class="sheet-body">${html}</div></section>`;
    sheet.hidden = false;
    root.host.classList.add('lock'); // 開いている間は、後ろの画面を動かさない（完了報告アプリ側のクラス）
    return sheet;
  }
  function closeSheet() {
    const sheet = $('#sheet');
    sheet.hidden = true;
    sheet.innerHTML = '';
    root.host.classList.remove('lock');
    dateCb = null;
  }

  // ---------- 検索画面 ----------
  function renderArea() {
    const a = state.area;
    $('#s-area').innerHTML = `
      <div class="seg two">
        <button class="${a.mode === 'address' ? 'on' : ''}" data-act="area-mode" data-v="address">住所・町名</button>
        <button class="${a.mode === 'gps' ? 'on' : ''}" data-act="area-mode" data-v="gps">現在地</button>
      </div>
      ${a.mode === 'address'
        ? `<label class="field"><span class="sr">住所・町名</span><input id="addr" type="text" placeholder="例：〇〇区〇〇" value="${esc(a.address)}" autocomplete="off"></label>`
        : `<button class="btn wide" data-act="gps">${ic('gps')}${a.lat == null ? '現在地を取得する' : '現在地を取得済み（取り直す）'}</button>
           ${a.lat == null ? '<p class="hint">位置情報を許可すると、今いる場所の周りから探します。</p>' : hereHTML(a)}`}`;
  }
  // 取った現在地の住所（何県・何市・何町）を、ボタンの下にはっきり出す。調べ中・取れなかったときも分かるように
  function hereHTML(a) {
    const name = a.place ? esc(a.place) : (a.place === '' ? '住所は取れませんでした' : '住所を調べています…');
    return `<div class="here" aria-live="polite">
        <span class="here-label">${ic('gps')}今いる場所</span>
        <strong class="here-name">${name}</strong>
        <p class="hint">この場所の周りから探します。</p>
      </div>`;
  }

  function renderRadius() {
    $('#s-radius').innerHTML = `<div class="hwrap"><div class="seg scroll hscroll">${RADIUS.map(([k, l]) =>
      `<button class="${state.radius === k ? 'on' : ''}" data-act="radius" data-v="${k}">${l}</button>`).join('')}</div></div>`;
  }

  function renderCount() {
    $('#s-count').innerHTML = `<button class="pick" data-act="count-open"><b>${state.count}</b>件 ${ic('down')}</button>`;
  }

  function renderDate() {
    const el = $('#s-date');
    el.innerHTML = `${calToggleHTML('search', state.date)}${quickDates(state.date, 'search-date')}${CAL_OPEN.search ? calHTML('search', state.date, 'search-date') : ''}`;
  }

  function renderInd() {
    const g = D.GROUPS[state.indTab];
    const cnt = (gi) => D.GROUPS[gi].items.filter((n) => state.industries.has(n)).length;
    const tabs = D.GROUPS.map((gr, i) => {
      const c = cnt(i);
      return `<button class="htab${i === state.indTab ? ' on' : ''}" data-act="ind-tab" data-i="${i}">${esc(gr.name)}${c ? `<span class="cnt">${c}</span>` : ''}</button>`;
    }).join('');
    const all = g.items.every((n) => state.industries.has(n));
    // 「全て」：33業種すべてが選ばれていれば「解除」に切り替える
    const everyIndustry = D.GROUPS.every((gr) => gr.items.every((n) => state.industries.has(n)));
    const allBtn = $('#allInd');
    if (allBtn) {
      allBtn.textContent = everyIndustry ? '解除' : '全て';
      allBtn.classList.toggle('on', everyIndustry);
    }
    $('#s-ind').innerHTML = `
      <div class="hwrap"><div class="htabs hscroll" role="tablist">${tabs}</div></div>
      <div class="ind-head"><span class="sub">${esc(g.name)}（${g.items.length}業種）</span>
        <button class="pill-btn${all ? ' on' : ''}" data-act="ind-group">${all ? 'まるごと解除' : 'まるごと選択'}</button></div>
      <div class="chips">${g.items.map((n) => `<button class="chip${state.industries.has(n) ? ' on' : ''}" data-act="ind" data-name="${esc(n)}">${esc(n)}</button>`).join('')}</div>
      <p class="hint">${state.industries.size ? `選択中 ${state.industries.size}業種` : '未選択なら全業種が対象です'}</p>`;
  }

  // 条件の中身を一行で（一覧の説明文）
  function presetSummary(p) {
    const place = p.area && p.area.mode === 'gps' ? '現在地' : ((p.area && p.area.address) || '住所未入力');
    const rad = RADIUS.find((r) => r[0] === p.radius);
    const inds = (p.industries || []).length ? `${p.industries.length}業種` : '全業種';
    return `${place}・${rad ? rad[1] : p.radius}・${p.count}件・${inds}`;
  }

  function renderPresets() {
    const rows = state.presets.map((p, i) => `
      <li class="prow">
        <button class="prow-main" data-act="preset-apply" data-i="${i}">
          <b>${esc(p.name)}</b><small>${esc(presetSummary(p))}</small>
        </button>
        <button class="btn small danger" data-act="preset-del" data-i="${i}" aria-label="${esc(p.name)}を削除">${ic('x')}削除</button>
      </li>`).join('');
    $('#s-presets').innerHTML = `${rows
      ? `<ul class="plist">${rows}</ul>`
      : '<p class="hint">よく使う条件を、名前を付けて保存できます（例：渋谷・飲食店）</p>'}
      <div class="stack-row"><button class="btn small" data-act="preset-save">今の条件に名前を付けて保存</button></div>`;
  }


  // ---------- 提案リスト ----------
  function visibleList() {
    let list = state.pool.slice().sort(SORTERS[state.pSort]);
    if (state.pIndustries.size) list = list.filter((s) => state.pIndustries.has(s.industry));
    if (state.openOnly) list = list.filter((s) => isOpenOn(s, state.date));
    return list.slice(0, state.count);
  }

  function renderProposal() {
    const sn = state.snap;
    // 並び替えは、完了報告アプリの上のバーに出す（その並びの印を合わせる）
    window.dispatchEvent(new CustomEvent('ml-proposal', { detail: { sort: state.pSort } }));
    if (!sn) {
      $('#pSummary').textContent = 'まだ提案がありません。';
      $('#pView').innerHTML = '';
      $('#pInd').innerHTML = '';
      $('#pOpenLabel').textContent = '';
      $('#pList').innerHTML = `<div class="empty"><p>まだ提案がありません。</p><button class="btn primary" data-act="go-search">条件を決める</button></div>`;
      return;
    }
    $('#pSummary').textContent = `${sn.area}／半径 ${sn.radius}／${sn.count}件／訪問日 ${fmtDate(state.date)}／${sn.industry}`;
    // 一覧／地図の切り替えは、画面の下のドックに出す
    $('#pView').innerHTML = [['list', '一覧'], ['map', '地図で見る']].map(([k, l]) =>
      `<button class="${state.pView === k ? 'on' : ''}" data-act="p-view" data-v="${k}">${l}</button>`).join('');

    const inds = [...new Set(state.pool.map((s) => s.industry))];
    $('#pInd').innerHTML = inds.map((n) => `<button class="chip${state.pIndustries.has(n) ? ' on' : ''}" data-act="p-ind" data-name="${esc(n)}">${esc(n)}</button>`).join('')
      || '<p class="hint">候補がありません</p>';
    // 業種は折りたたみ。閉じているときも、選んだ業種が分かるように小さく出す
    const picked = [...state.pIndustries];
    $('#pIndSum').textContent = picked.length ? `${picked.slice(0, 2).join('・')}${picked.length > 2 ? ` ほか${picked.length - 2}件` : ''}` : '全業種';
    $('#pIndFold').open = !!state.pIndOpen;

    $('#pOpenLabel').textContent = `${fmtDate(state.date)}営業している店のみ`;
    const sw = $('#pOpen');
    sw.setAttribute('aria-checked', String(state.openOnly));

    const list = visibleList();
    if (state.pView === 'map') {
      $('#pList').innerHTML = mapPanelHTML(list);
      loadMap(list);
      return;
    }
    $('#pList').innerHTML = list.length
      ? list.map((s, i) => proposalCard(s, i + 1)).join('')
      : `<div class="empty"><p>条件に合う店がありませんでした。</p><p class="hint">半径を広げるか、条件を変えてもう一度お試しください。</p></div>`;
  }

  function overallDetail(s) {
    const rows = KEYS.map((k) => (s.sub[k] == null
      ? `<tr><td>${LABEL[k]}</td><td>未取得（平均に入れない）</td><td>—</td></tr>`
      : `<tr><td>${LABEL[k]}</td><td>${s.sub[k]}点・重み${Math.round(W[k] * 100)}%</td><td>${(s.sub[k] * W[k]).toFixed(2)}</td></tr>`)).join('');
    return `<div class="detail"><p class="detail-title">点数の計算</p>
      <table class="calc">${rows}
        <tr class="sum"><td>合計（5点満点）</td><td></td><td>${s.total5.toFixed(2)}</td></tr>
        <tr class="sum"><td>10点満点にする</td><td>2倍</td><td>${s.overall.toFixed(1)}</td></tr>
      </table>
      <p class="hint">4項目の重み：評価25%・口コミ25%・価格帯25%・情報の充実度25%。各項目は5点満点です。取れなかった項目は平均に入れず、取れた項目だけで割ります。</p></div>`;
  }

  function scoreDetail(s, k) {
    const score = s.sub[k] == null ? '未取得（平均に入れていません）' : `${s.sub[k]}点／5点`;
    return `<div class="detail"><p class="detail-title">${LABEL[k]}：${score}</p>
      <dl><dt>根拠</dt><dd>${esc(evidence(s, k))}</dd>
      <dt>理由</dt><dd>${esc(WHY[k])}</dd>
      <dt>点数の決め方（基準）</dt><dd>${esc(CRIT[k])}</dd></dl></div>`;
  }

  function proposalCard(s, rank) {
    const open = isOpenOn(s, state.date);
    const exp = (k) => state.expanded.has(s.id + ':' + k);
    const inList = inVisit(s.id) || inLater(s.id);
    const banner = s.visited
      ? `<div class="banner">${ic('info')}訪問済みの店です</div>`
      : inList ? `<div class="banner">${ic('info')}訪問予定に入っています</div>` : '';
    return `<article class="card shop">
      ${banner}
      <div class="shop-head">
        <span class="rank">${rank}位</span><span class="tag">${esc(s.industry)}</span>
        <button class="overall${exp('overall') ? ' open' : ''}" data-act="p-expand" data-id="${s.id}" data-k="overall" aria-label="${s.overall.toFixed(1)}点（詳しく見る）"><b>${s.overall.toFixed(1)}</b><small>/ 10</small></button>
      </div>
      <h3 class="shop-name">${esc(s.name)}</h3>
      ${exp('overall') ? overallDetail(s) : ''}
      <div class="scores">${KEYS.map((k) => `<button class="score${exp(k) ? ' open' : ''}" data-act="p-expand" data-id="${s.id}" data-k="${k}"><span>${LABEL[k]}</span><b>${s.sub[k] == null ? '—' : s.sub[k]}</b><small>/5</small></button>`).join('')}</div>
      ${KEYS.map((k) => (exp(k) ? scoreDetail(s, k) : '')).join('')}
      <ul class="reasons">${s.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      <p class="meta">${ic('pin')}<span>${esc(s.address)}</span></p>
      <div class="meta-row">
        <span class="dist">${fmtDist(s.distance)}</span>
        ${open ? `<span class="vtime">${esc(s.hours[weekKey(state.date)])}</span>` : '<span class="vtime closed">選択日は定休日</span>'}
        ${s.insta ? `<a class="pill-btn" href="https://www.instagram.com/${esc(s.insta)}" target="_blank" rel="noopener">${ic('insta')}@${esc(s.insta)}</a>` : ''}
      </div>
      <div class="actions">
        <button class="btn" data-act="add" data-id="${s.id}" ${inVisit(s.id) ? 'disabled' : ''}>${ic('plus')}${inVisit(s.id) ? '追加済み' : '訪問予定に追加'}</button>
        <button class="btn" data-act="copy-map" data-id="${s.id}">${ic('copy')}Map URLコピー</button>
        <a class="btn icon" href="${esc(mapUrl(s))}" target="_blank" rel="noopener" aria-label="地図で開く">${ic('map')}</a>
        <button class="btn text" data-act="block" data-id="${s.id}">${ic('block')}訪問NG</button>
      </div>
    </article>`;
  }

  // ---------- 訪問リスト・後で訪問 ----------
  function visitCard(it, kind) {
    const s = it.shop;
    const date = it.visitDate;
    const dateTag = date ? `<span class="vdate">${fmtDate(date)}</span>` : '<span class="vdate none">日付未定</span>';
    const common = `
      <button class="btn" data-act="copy-map" data-id="${s.id}">${ic('copy')}Map URLコピー</button>
      <a class="btn icon" href="${esc(mapUrl(s))}" target="_blank" rel="noopener" aria-label="地図で開く">${ic('map')}</a>`;
    const actions = kind === 'visit'
      ? `${common}<button class="btn" data-act="later-move" data-id="${s.id}">後で訪問</button>
         <button class="btn danger" data-act="remove" data-src="visit" data-id="${s.id}">${ic('x')}外す</button>`
      : `<button class="btn" data-act="back-visit" data-id="${s.id}">${ic('back')}訪問予定に戻す</button>
         ${common}
         <button class="btn danger" data-act="remove" data-src="later" data-id="${s.id}">${ic('x')}外す</button>`;
    return `<article class="card visit">
      <div class="visit-top">${dateTag}<button class="pill-btn" data-act="pick-date" data-id="${s.id}" data-kind="${kind}">${ic('cal')}日付を変える</button></div>
      <h3 class="shop-name">${esc(s.name)}</h3>
      <div class="row"><span class="tag">${esc(s.industry)}</span></div>
      <p class="meta">${ic('pin')}<span>${esc(s.address)}</span></p>
      ${hoursRow(s, date)}
      <div class="actions">${actions}</div>
    </article>`;
  }

  function sortForList(items) {
    if (state.listSort === 'dist' && state.userPos) {
      return items.slice().sort((a, b) => distM(state.userPos, a.shop) - distM(state.userPos, b.shop));
    }
    return items;
  }

  function renderVisitList() {
    const items = state.visit;
    $('#lCount').textContent = `${items.length}件`;
    if (!items.length) {
      $('#lList').innerHTML = `<div class="empty"><p>訪問予定は空です。</p><p class="hint">提案リストから店を追加できます。</p></div>`;
      return;
    }
    const groups = new Map();
    items.forEach((it) => {
      const k = it.visitDate || '';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    });
    const keys = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a < b ? -1 : a > b ? 1 : 0));
    $('#lList').innerHTML = keys.map((k) => {
      const list = sortForList(groups.get(k));
      return `<h2 class="date-head">${k ? fmtDate(k) : '日付未定'}<span class="cnt">${list.length}件</span></h2>${list.map((it) => visitCard(it, 'visit')).join('')}`;
    }).join('');
  }

  function renderLaterList() {
    const items = state.later;
    $('#gCount').textContent = `${items.length}件`;
    $('#gList').innerHTML = items.length
      ? items.map((it) => visitCard(it, 'later')).join('')
      : `<div class="empty"><p>後で訪問の店はありません。</p><p class="hint">訪問予定の「後で訪問」から移せます。</p></div>`;
  }

  // 下のタブは、完了報告アプリの下のタブ（同じ棒・同じ見た目）を使う。ここでは作らない（app.js の mlTabs）
  function renderNav() {}
  function renderBadges() {
    const n = { list: state.visit.length, later: state.later.length };
    $$('[data-badge]').forEach((el) => { const c = n[el.dataset.badge]; el.textContent = c ? String(c) : ''; });
  }

  // ---------- ログイン（Googleログインのみ） ----------
  function renderAccount() {
    const el = $('#account');
    if (!el) return;
    const u = state.user;
    el.innerHTML = u
      ? `<div class="acct"><div class="acct-who"><span class="sub">ログイン中</span><b>${esc(u.name)}</b></div>
           <button class="btn small" data-act="logout">ログアウト</button></div>`
      : `<div class="acct"><div class="acct-who"><span class="sub">ログインしてください</span></div>
           <button class="btn small" data-act="login">Googleでログイン</button></div>`;
  }

  // ログインの状態を読み直す（未ログインなら一覧は空・候補も消す）
  // 後から始めた読み直しを優先する（古い結果が新しいログイン結果を上書きしない）
  let userSeq = 0;
  async function refreshUser() {
    const mine = ++userSeq;
    let user = null;
    try {
      const u = await D.currentUser();
      user = u ? { name: u.displayName || u.email || 'ログイン中' } : null;
    } catch (e) {
      user = null;
    }
    if (mine !== userSeq) return; // より新しい読み直しがあれば、この結果は捨てる
    state.user = user;
    state.blocks = await D.getBlocks(); // 未ログインでも、この端末の訪問NGを使う
    renderAll();
  }

  async function login() {
    try {
      await D.signIn();
      await refreshUser();
      if (state.user) toast('ログインしました');
    } catch (e) {
      toast(e && e.code === 'auth/popup-closed-by-user' ? 'ログインを中止しました' : 'ログインできませんでした。もう一度お試しください');
    }
  }

  async function logout() {
    try {
      await D.signOut();
      await refreshUser();
      toast('ログアウトしました');
    } catch (e) {
      toast('ログアウトできませんでした。もう一度お試しください');
    }
  }

  function renderAll() {
    renderAccount();
    requestAnimationFrame(markEdges);
    renderArea(); renderRadius(); renderCount(); renderDate(); renderInd(); renderPresets();
    renderProposal(); renderVisitList(); renderLaterList(); renderBadges();
  }

  // ---------- 画面の切り替え ----------
  // 画面の名前は、この画面の中で持つ（完了報告アプリの URL の # は使わない）
  let curScreen = 'search';
  function currentName() {
    return SCREENS.includes(curScreen) ? curScreen : 'search';
  }
  function showScreen() {
    const name = currentName();
    $$('.screen').forEach((s) => s.classList.toggle('active', s.dataset.screen === name));
    renderAll();
    window.scrollTo(0, 0);
    // 下のタブ（完了報告アプリの棒）の選ばれている印を合わせる
    window.dispatchEvent(new CustomEvent('ml-screen', { detail: name }));
  }
  function go(name) {
    curScreen = name;
    showScreen();
  }

  // ---------- 検索の実行 ----------
  async function runSearch() {
    const a = state.area;
    let center, viewport = null;
    const btn = $('[data-act="run-search"]');
    btn.disabled = true; btn.textContent = '探しています…';
    try {
      if (a.mode === 'address') {
        const text = a.address.trim();
        if (!text) return toast('住所か町名を入力してください');
        center = await D.geocode(text);
        if (!center) return toast('場所が見つかりませんでした');
        viewport = center.viewport || null;
      } else {
        if (a.lat == null) return toast('先に現在地を取得してください');
        center = { lat: a.lat, lng: a.lng };
      }
      const town = state.radius === 'town';
      const radiusM = RADIUS.find((r) => r[0] === state.radius)[2];
      const raw = await D.searchShops({ center, radius: radiusM, town, viewport: town ? viewport : null, industries: [...state.industries] });
      const blocked = new Set(state.blocks.map((b) => b.id));
      state.pool = raw.filter((s) => !blocked.has(s.id)).map(withScores);
      state.snap = {
        area: a.mode === 'address' ? a.address.trim() : '現在地',
        radius: RADIUS.find((r) => r[0] === state.radius)[1],
        count: state.count,
        industry: industryLabel(state.industries),
      };
      state.pIndustries = new Set(state.industries);
      state.openOnly = true;
      state.expanded = new Set();
      go('proposal');
      saveUiSoon();
    } catch (e) {
      toast(e && e.message ? e.message : '取得に失敗しました。時間をおいてもう一度お試しください');
    } finally {
      btn.disabled = false; btn.textContent = '提案リストを作る';
    }
  }

  function locate(done) {
    if (!navigator.geolocation) return toast('この端末では現在地を使えません');
    toast('現在地を取得しています');
    navigator.geolocation.getCurrentPosition((p) => {
      state.area.lat = p.coords.latitude;
      state.area.lng = p.coords.longitude;
      state.area.place = null;
      state.userPos = { lat: p.coords.latitude, lng: p.coords.longitude };
      renderArea();
      toast('現在地を取得しました');
      saveUiSoon();
      resolvePlace();
      if (done) done();
    }, () => toast('現在地を取得できませんでした'), { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }

  // 現在地の住所（何県・何市・何町）を取る。取れたら表示して端末に保存する。取れなければ「取れませんでした」と出す
  function resolvePlace() {
    const at = { lat: state.area.lat, lng: state.area.lng };
    if (at.lat == null) return;
    const same = () => state.area.lat === at.lat && state.area.lng === at.lng; // 取り直していたら、古い結果は捨てる
    state.area.place = null;
    renderArea();
    D.placeName(at).then((name) => {
      if (!same()) return;
      state.area.place = name || '';
      renderArea();
      saveUiSoon();
    }).catch(() => {
      if (!same()) return;
      state.area.place = '';
      renderArea();
      saveUiSoon();
    });
  }

  // ---------- 数字選択（件数）・日付選択 ----------
  function openCountWheel() {
    pendingCount = state.count;
    const sheetEl = openSheet('件数', `
      <div class="wheel-wrap"><div class="wheel-hi"></div>
        <div class="wheel" id="wheel">${COUNTS.map((n) => `<div class="wi" data-act="wi" data-n="${n}">${n}件</div>`).join('')}</div>
      </div>
      <p class="hint">数字をスクロールして選び、「決める」を押してください。</p>
      <div class="stack"><button class="btn primary wide" data-act="count-ok">決める</button></div>`);
    const w = $('#wheel', sheetEl);
    const idx = COUNTS.indexOf(state.count);
    w.scrollTop = idx * ITEM_H;
    const mark = (i) => $$('.wi', w).forEach((el, j) => el.classList.toggle('on', j === i));
    mark(idx);
    w.addEventListener('scroll', () => {
      const i = Math.min(Math.max(Math.round(w.scrollTop / ITEM_H), 0), COUNTS.length - 1);
      pendingCount = COUNTS[i];
      mark(i);
    }, { passive: true });
  }

  function openDatePick(id, kind) {
    const it = findIn(kind === 'later' ? state.later : state.visit, id);
    if (!it) return;
    dateCb = (d) => setVisitDate(id, d, kind);
    dateCtx = { id, kind, sel: it.visitDate || state.date };
    CAL.sheet = null; // 選ばれている日の月から表示
    CAL_OPEN.sheet = false; // 普段は閉じておく
    openSheet('訪問予定日', '<div id="dateBody"></div>');
    renderDateSheet();
  }

  // 訪問日シートの中身（今日・明日＋カレンダー）
  function renderDateSheet() {
    const el = $('#dateBody');
    if (!el || !dateCtx) return;
    const { id, kind, sel } = dateCtx;
    const extra = `data-id="${id}" data-kind="${kind}"`;
    el.innerHTML = `${calToggleHTML('sheet', sel)}${quickDates(sel, 'dpick', extra)}${CAL_OPEN.sheet ? calHTML('sheet', sel, 'dpick', extra) : ''}
      <div class="stack"><button class="btn text wide" data-act="dpick-none" data-id="${id}" data-kind="${kind}">日付未定にする</button></div>`;
  }

  async function setVisitDate(id, date) {
    try {
      await D.visits.setDate(id, date); // 訪問リスト・後で訪問とも、同じ visits の日付を変える
    } catch (e) {
      toast((e && e.message) || '日付を変えられませんでした。もう一度お試しください');
    }
    // 表示は、完了報告アプリの変更を受けて読み直す（dc-visits-changed）
  }

  // ---------- 訪問リストの操作 ----------
  // 保存は、完了報告アプリの visits に対して行う（この端末には何も保存しない）
  function saveAll() {}

  // 訪問リストと後で訪問の読み直し（完了報告アプリの visits が変わったとき・画面を開いたとき）
  function syncVisits() {
    state.visit = D.visits.list();
    state.later = D.visits.laterList();
  }

  function addVisit(id) {
    const s = findIn(state.pool, id) || findShop(id);
    if (!s || inVisit(id)) return;
    D.visits.add(stripScores(s), state.date)
      .then(() => toast('訪問予定に追加しました'))
      .catch((e) => toast((e && e.message) || '訪問予定に追加できませんでした。もう一度お試しください'));
  }

  function stripScores(s) {
    const { sub, total5, overall, reasons, ...rest } = s; // 一覧に必要な店の情報だけ残す
    return rest;
  }

  // 訪問リスト ⇄ 後で訪問。訪問リストに出し入れするときは、完了報告アプリの visits を変える
  async function moveList(id, from, to) {
    const src = from === 'visit' ? state.visit : state.later;
    const it = findIn(src, id);
    if (!it) return;
    try {
      // 同じ訪問のまま、後で訪問の印だけを付け外しする（訪問リストと同じデータ）
      await D.visits.setLater(id, to === 'later');
      syncVisits();
      toast(to === 'later' ? '後で訪問に移しました' : '訪問予定に戻しました');
    } catch (e) {
      toast((e && e.message) || '移せませんでした。もう一度お試しください');
    }
    renderAll();
  }

  async function removeFrom(id, src) {
    if (!window.confirm('この店を外しますか？')) return;
    try {
      await D.visits.remove(id); // 訪問リストでも後で訪問でも、同じ visits から外す
      toast('外しました');
    } catch (e) {
      toast((e && e.message) || '外せませんでした。もう一度お試しください');
    }
    renderAll();
  }

  function copyAll(src) {
    const list = src === 'visit' ? state.visit : state.later;
    if (!list.length) return toast('コピーする店がありません');
    const text = list.map((x, i) => `${i + 1}. ${x.shop.name}\n${mapUrl(x.shop)}`).join('\n\n');
    copyText(text, `${list.length}件のリンクをコピーしました`);
  }

  function sortByDistance() {
    const apply = () => { state.listSort = 'dist'; renderVisitList(); toast('近い順に並べました'); };
    if (state.userPos) return apply();
    locate(apply);
  }

  // ---------- 訪問NG（永久ブロック） ----------
  // ログインしていない人への案内（訪問NGは、メンバーがログインしたときだけ使える）
  function openLoginPrompt(message) {
    openSheet('ログインが必要です', `
      <p class="sub">${esc(message)}</p>
      <p class="hint">検索や提案リストは、ログインしなくても使えます。</p>
      <div class="stack">
        <button class="btn primary wide" data-act="login-from-sheet">Googleでログイン</button>
        <button class="btn text wide" data-close>あとで</button>
      </div>`);
  }

  function openBlockSheet(id) {
    if (!state.user) return openLoginPrompt('訪問NGの登録には、ログインが必要です。');
    const s = findShop(id);
    if (!s) return;
    openSheet('訪問NGに登録', `<p class="sub">${esc(s.name)}</p>
      <p class="hint">登録すると、以降の提案から永久に除外されます。</p>
      <div class="stack">
        ${REASONS_BLOCK.map((r) => `<button class="btn wide" data-act="block-reason" data-id="${id}" data-r="${esc(r)}">${esc(r)}</button>`).join('')}
        <button class="btn text wide" data-close>スキップ</button>
      </div>`);
  }

  async function doBlock(id, reason) {
    const s = findShop(id);
    if (!s) return;
    state.blocks = await D.addBlock({ id, name: s.name, reason, at: Date.now() });
    state.pool = state.pool.filter((x) => x.id !== id);
    closeSheet();
    toast('訪問NGに登録しました');
    renderAll();
  }

  async function openBlockList() {
    if (!state.user) return openLoginPrompt('訪問NGの一覧は、ログインすると見られます。');
    state.blocks = await D.getBlocks();
    const body = state.blocks.length
      ? `<ul class="blist">${state.blocks.map((b) => `<li><div><b>${esc(b.name)}</b><small>${esc(b.reason)}</small></div>
          <button class="btn small" data-act="unblock" data-id="${esc(b.id)}">解除</button></li>`).join('')}</ul>`
      : '<p class="hint">登録した店はありません</p>';
    openSheet('訪問NG一覧', body);
  }

  async function unblock(id) {
    state.blocks = await D.removeBlock(id);
    toast('解除しました（次の検索から表示されます）');
    renderSearchBlocks();
    openBlockList();
  }

  // ---------- お気に入り条件 ----------
  // いまの検索条件（保存する中身）
  function currentConditions() {
    return {
      area: { mode: state.area.mode, address: state.area.address },
      radius: state.radius, count: state.count, industries: [...state.industries],
    };
  }

  // 名前を入力して保存（同じ名前は重ねて保存しない）
  function savePreset() {
    openSheet('条件に名前を付けて保存', `
      <label class="field"><span class="sub">名前（例：渋谷・飲食店）</span>
        <input id="presetName" type="text" maxlength="20" placeholder="渋谷・飲食店" autocomplete="off"></label>
      <p class="hint">${esc(presetSummary(currentConditions()))}</p>
      <div class="stack"><button class="btn primary wide" data-act="preset-save-ok">保存する</button></div>`);
    setTimeout(() => { const i = $('#presetName'); if (i) i.focus(); }, 60);
  }

  function confirmSavePreset() {
    const name = (($('#presetName') || {}).value || '').trim();
    if (!name) return toast('名前を入力してください');
    if (state.presets.some((p) => p.name === name)) return toast('同じ名前の条件があります。別の名前にしてください');
    state.presets.push({ name, ...currentConditions() });
    LS.set('presets', state.presets);
    closeSheet();
    renderPresets();
    toast(`「${name}」を保存しました`);
  }

  function applyPreset(i) {
    const p = state.presets[i];
    if (!p) return;
    state.area = { mode: p.area.mode, address: p.area.address, lat: null, lng: null };
    state.radius = p.radius;
    state.count = p.count;
    state.industries = new Set(p.industries);
    renderAll();
    toast(`「${p.name}」を反映しました`);
  }

  function deletePreset(i) {
    const p = state.presets[i];
    if (!p) return;
    if (!window.confirm(`「${p.name}」を削除しますか？`)) return;
    state.presets.splice(i, 1);
    LS.set('presets', state.presets);
    renderPresets();
    toast('削除しました');
  }

  // ---------- 地図で見る（店の位置を番号つきのピンで並べる） ----------
  const PIN = '123456789ABCDEFGHIJK'; // 番号（画面の並びと地図のピンが一致する）
  const SORT_LABEL = { rec: 'おすすめ順', dist: '近い順', rating: '評価順' };
  let mapKey = '';   // 直前に取得した地図の店の並び（同じなら取り直さない）
  let mapCur = null;    // 今の地図：{ points, base（店が全部入る中心と拡大）, img（今見えている画像：x, y, zoom, url）}
  let mapReq = 0;

  function mapPanelHTML(list) {
    if (!list.length) return `<div class="empty"><p>条件に合う店がありませんでした。</p></div>`;
    return `<div class="map-card">
      <div class="map-box" id="mapBox"><p class="hint">地図を読み込んでいます…</p></div>
      <p class="hint">並び順は「${SORT_LABEL[state.pSort]}」です。番号の順に回ると効率的です。</p>
      <ol class="map-order">${list.map((s, i) => `<li><span class="pin-no">${PIN[i]}</span><span class="map-name">${esc(s.name)}</span><small>${fmtDist(s.distance)}</small></li>`).join('')}</ol>
    </div>`;
  }

  // 世界の地図を 0〜1 の数字で扱う（ズームしても位置がずれない）
  const MV_W = 640, MV_H = 440;   // 静止画の大きさ（論理px。scale=2 で、きれいな2倍の画像になる）
  const MV_MAX_ZOOM = 19;
  const nxOf = (lng) => (lng + 180) / 360;
  const nyOf = (lat) => { const s = Math.sin((lat * Math.PI) / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
  const latOf = (ny) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * ny))) * 180) / Math.PI;
  const lngOf = (nx) => nx * 360 - 180;
  const worldPx = (z) => 256 * 2 ** z; // 拡大 z のときの、世界の1辺（論理px）
  const latLngOf = (v) => ({ lat: latOf(v.y), lng: lngOf(v.x) });
  // 店が全部、枠の中に入る中心と拡大を決める（ビューアの基準になる）
  function fitView(points) {
    const xs = points.map((p) => nxOf(p.lng)), ys = points.map((p) => nyOf(p.lat));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (let z = 17; z >= 1; z--) {
      const w = worldPx(z);
      if ((x1 - x0) * w <= MV_W - 80 && (y1 - y0) * w <= MV_H - 80) return { x: cx, y: cy, zoom: z };
    }
    return { x: cx, y: cy, zoom: 1 };
  }

  async function loadMap(list) {
    const points = list.map((s) => ({ lat: s.lat, lng: s.lng }));
    const key = points.map((p) => `${p.lat},${p.lng}`).join('|');
    const req = ++mapReq;
    const show = () => {
      const box = $('#mapBox');
      if (box && mapCur) box.innerHTML = `<button class="map-open" type="button" data-act="map-open" aria-label="地図を大きく見る"><img class="map-img" src="${mapCur.img.url}" alt="店の位置の地図（番号は下の一覧と同じ）"></button>`;
    };
    if (key === mapKey && mapCur) return show(); // 同じ店なら取り直さない
    try {
      const base = fitView(points);
      const blob = await D.mapImage(points, { center: latLngOf(base), zoom: base.zoom });
      if (req !== mapReq) return; // 新しい表示があれば、この結果は捨てる
      mvClose(); // 表示中のビューアは閉じてから、古い画像を捨てる
      if (mapCur) URL.revokeObjectURL(mapCur.img.url);
      mapCur = { points, base, img: { x: base.x, y: base.y, zoom: base.zoom, url: URL.createObjectURL(blob) } };
      mapKey = key;
      show();
    } catch (e) {
      if (req !== mapReq) return;
      const box = $('#mapBox');
      if (box) box.innerHTML = `<p class="hint">${esc(e.message)}</p>`;
    }
  }

  // ---------- 地図の画像ビューア（画像アプリのように、拡大・縮小・移動・閉じる） ----------
  // 画面の中心を、世界の上の位置（vc）と拡大（zv）で持つ。画像は img（どの位置・拡大で取ったか）の分だけ伸ばして出す。
  let mv = null;
  const mvK0 = () => Math.min(mv.el.clientWidth / MV_W, mv.el.clientHeight / MV_H); // 画面px / 論理px（画面の幅か高さに入る大きさ）

  function mvApply() {
    if (!mv) return;
    const k0 = mvK0(), w = worldPx(mv.zv) * k0;
    const dx = (mv.img.x - mv.vc.x) * w, dy = (mv.img.y - mv.vc.y) * w;
    const sc = k0 * 2 ** (mv.zv - mv.img.zoom);
    if (mv.pic.getAttribute('src') !== mv.img.url) mv.pic.src = mv.img.url;
    mv.pic.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${sc.toFixed(4)})`;
    mv.zoomEl.textContent = `${Math.round(2 ** (mv.zv - mv.base.zoom) * 100)}%`;
  }
  // 画面の (px, py)（中心からの位置）の下にある場所を動かさずに拡大・縮小する
  function mvZoomAt(nz, px, py) {
    const z = Math.min(MV_MAX_ZOOM, Math.max(mv.base.zoom - 2, nz));
    const k0 = mvK0(), w0 = worldPx(mv.zv) * k0, w1 = worldPx(z) * k0;
    const under = { x: mv.vc.x + px / w0, y: mv.vc.y + py / w0 };
    mv.zv = z;
    mv.vc = { x: under.x - px / w1, y: under.y - py / w1 };
    mvApply();
  }
  function mvPan(dx, dy) {
    const w = worldPx(mv.zv) * mvK0();
    mv.vc = { x: mv.vc.x - dx / w, y: mv.vc.y - dy / w };
    mvApply();
  }
  // 今見えている画像では粗い（拡大しすぎ・中心がずれた）ときだけ、取り直す
  function mvNeedFetch() {
    if (Math.abs(mv.zv - mv.img.zoom) >= 0.5) return true;
    if (mv.zv <= mv.base.zoom + 0.05) return false; // 元の大きさのままなら、取り直さない
    const w = worldPx(mv.zv) * mvK0();
    return Math.abs(mv.img.x - mv.vc.x) * w > 140 || Math.abs(mv.img.y - mv.vc.y) * w > 100;
  }
  function mvScheduleFetch() {
    if (!mv) return;
    clearTimeout(mv.timer);
    if (mvNeedFetch()) mv.timer = setTimeout(mvFetch, 280);
  }
  function mvNote(text) { if (mv) mv.note.textContent = text; }
  // 今の中心・拡大で、詳しい地図を取り直す（既存の /api/ml-map に中心と拡大を渡す）
  function mvFetch() {
    if (!mv) return;
    const z = Math.round(Math.min(MV_MAX_ZOOM, Math.max(mv.base.zoom - 2, mv.zv)));
    const c = { x: mv.vc.x, y: mv.vc.y };
    const seq = ++mv.seq;
    mvNote('詳しい地図を読み込んでいます…');
    D.mapImage(mv.points, { center: latLngOf(c), zoom: z }).then((blob) => {
      if (!mv || seq !== mv.seq) return; // 後から別の取り直しが始まっていれば、この結果は捨てる
      const prev = mv.own;
      mv.own = URL.createObjectURL(blob);
      mv.img = { x: c.x, y: c.y, zoom: z, url: mv.own };
      mvApply();
      if (prev) URL.revokeObjectURL(prev);
      mvNote('');
    }).catch((e) => {
      if (!mv || seq !== mv.seq) return;
      mvNote((e && e.message) || '詳しい地図を取れませんでした。もう一度お試しください');
    });
  }
  function mvReset() {
    const prev = mv.own;
    mv.own = null; mv.img = mv.baseImg; mv.seq++;
    clearTimeout(mv.timer);
    mv.zv = mv.base.zoom; mv.vc = { x: mv.base.x, y: mv.base.y };
    mvApply();
    if (prev) URL.revokeObjectURL(prev);
    mvNote('');
  }
  function mvAnim(fn) {
    mv.stage.classList.add('anim');
    fn();
    clearTimeout(mv.animT);
    mv.animT = setTimeout(() => { if (mv) mv.stage.classList.remove('anim'); }, 240);
  }
  function mvCenterOf(e) {
    const r = mv.el.getBoundingClientRect();
    return { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) };
  }
  function mvPinchState() {
    const [a, b] = [...mv.ptrs.values()];
    const r = mv.el.getBoundingClientRect();
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2 - (r.left + r.width / 2), y: (a.y + b.y) / 2 - (r.top + r.height / 2) } };
  }
  function mvDown(e) {
    if (!mv) return;
    mv.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    mv.stage.setPointerCapture(e.pointerId);
    mv.stage.classList.remove('anim');
    if (mv.ptrs.size === 1) {
      mv.startY = e.clientY;
      const now = Date.now();
      // ダブルタップ：同じ場所を続けて押すと、そこを一段拡大する
      if (mv.lastTap && now - mv.lastTap.t < 320 && Math.hypot(e.clientX - mv.lastTap.x, e.clientY - mv.lastTap.y) < 30) {
        mv.lastTap = null;
        const p = mvCenterOf(e);
        mvAnim(() => mvZoomAt(mv.zv + 1, p.x, p.y));
        mvScheduleFetch();
      } else {
        mv.lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
    } else if (mv.ptrs.size === 2) {
      mv.lastTap = null;
      mv.pinch = mvPinchState();
    }
  }
  function mvMove(e) {
    if (!mv || !mv.ptrs.has(e.pointerId)) return;
    const prev = mv.ptrs.get(e.pointerId);
    mv.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mv.ptrs.size === 1) {
      if (mv.zv > mv.base.zoom + 0.05) {
        // 拡大しているとき：ドラッグで移動
        mv.stage.classList.add('drag');
        mvPan(e.clientX - prev.x, e.clientY - prev.y);
      } else {
        // 元の大きさのとき：下へスワイプすると、閉じる途中の見た目になる
        const dy = e.clientY - mv.startY;
        if (dy > 0) {
          mv.sheet.style.transform = `translateY(${dy}px)`;
          mv.el.style.background = `rgba(5, 6, 9, ${Math.max(0.25, 0.96 - dy / 500).toFixed(2)})`;
        }
      }
    } else if (mv.ptrs.size === 2 && mv.pinch) {
      // 2本指：指の中心の移動と、指の開き・閉じで拡大・縮小（指の下の場所は動かない）
      mv.stage.classList.add('drag');
      const now = mvPinchState();
      mvPan(now.mid.x - mv.pinch.mid.x, now.mid.y - mv.pinch.mid.y);
      if (mv.pinch.dist > 0 && now.dist > 0) mvZoomAt(mv.zv + Math.log2(now.dist / mv.pinch.dist), now.mid.x, now.mid.y);
      mv.pinch = now;
    }
  }
  function mvUp(e) {
    if (!mv || !mv.ptrs.has(e.pointerId)) return;
    mv.ptrs.delete(e.pointerId);
    if (mv.ptrs.size === 1) mv.pinch = null;
    if (mv.ptrs.size !== 0) return;
    mv.stage.classList.remove('drag');
    const dy = e.clientY - mv.startY;
    if (mv.zv <= mv.base.zoom + 0.05 && dy > 110) return mvClose();
    mv.sheet.style.transform = '';
    mv.el.style.background = '';
    mvScheduleFetch();
  }
  function mvWheel(e) {
    if (!mv) return;
    e.preventDefault();
    const p = mvCenterOf(e);
    mvZoomAt(mv.zv - Math.sign(e.deltaY) * 0.5, p.x, p.y);
    mvScheduleFetch();
  }
  function mvKey(e) { if (e.key === 'Escape') mvClose(); }

  function openMapViewer() {
    if (!mapCur || mv) return;
    const el = document.createElement('div');
    el.className = 'mv';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', '地図（拡大して見られます）');
    el.innerHTML = `<div class="mv-sheet">
        <div class="mv-stage"><img class="mv-pic" alt="店の位置の地図（番号は一覧と同じ）" draggable="false"></div>
        <div class="mv-top">
          <span class="mv-title">店の位置</span>
          <button type="button" class="mv-btn mv-close" aria-label="閉じる">${ic('x')}</button>
        </div>
        <div class="mv-bottom">
          <p class="mv-hint">ピンチで拡大・縮小 ／ ダブルタップで拡大 ／ 下にスワイプで閉じる</p>
          <div class="mv-tools">
            <button type="button" class="mv-btn" data-mv="out" aria-label="縮小">${ic('minus')}</button>
            <button type="button" class="mv-btn mv-wide" data-mv="reset">全体</button>
            <button type="button" class="mv-btn" data-mv="in" aria-label="拡大">${ic('plus')}</button>
            <span class="mv-zoom">100%</span>
          </div>
          <p class="mv-note" aria-live="polite"></p>
        </div>
      </div>`;
    root.appendChild(el);
    mv = {
      el, sheet: el.querySelector('.mv-sheet'), stage: el.querySelector('.mv-stage'), pic: el.querySelector('.mv-pic'),
      zoomEl: el.querySelector('.mv-zoom'), note: el.querySelector('.mv-note'),
      points: mapCur.points, base: mapCur.base, baseImg: mapCur.img,
      img: mapCur.img, own: null, zv: mapCur.base.zoom, vc: { x: mapCur.base.x, y: mapCur.base.y },
      seq: 0, timer: null, animT: null, ptrs: new Map(), pinch: null, startY: 0, lastTap: null,
    };
    mv.stage.addEventListener('pointerdown', mvDown);
    mv.stage.addEventListener('pointermove', mvMove);
    mv.stage.addEventListener('pointerup', mvUp);
    mv.stage.addEventListener('pointercancel', mvUp);
    mv.stage.addEventListener('wheel', mvWheel, { passive: false });
    el.querySelector('.mv-close').addEventListener('click', mvClose);
    el.querySelectorAll('[data-mv]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.mv;
      if (k === 'reset') return mvAnim(mvReset);
      mvAnim(() => mvZoomAt(mv.zv + (k === 'in' ? 1 : -1), 0, 0));
      mvScheduleFetch();
    }));
    document.addEventListener('keydown', mvKey);
    mvApply();
  }

  function mvClose() {
    if (!mv) return;
    clearTimeout(mv.timer); clearTimeout(mv.animT);
    if (mv.own) URL.revokeObjectURL(mv.own);
    document.removeEventListener('keydown', mvKey);
    mv.el.remove();
    mv = null;
  }

  // ---------- 固定ヘッダーのメニュー ----------
  // メニューは完了報告アプリの三本線メニュー（右上）に出す。その中の「訪問NG一覧」「お気に入り条件」は
  // 下の mlActions から呼ばれる。ここでは何もしない（旧・この画面の中のメニューは使わない）
  function closeMenu() {}

  // お気に入り条件（検索画面の、お気に入りの場所へ移動する）
  // メニューの「お気に入り条件」は、検索の画面を上から開くだけ（勝手に下へスクロールしない）
  function goPresets() {
    go('search');
  }

  // 下のタブの出し入れ（ゆっくり隠れる・少し上に動かすと出る）は、完了報告アプリ側（app.js）が両方のモードで行う

  // ---------- 操作の登録（クリックの委任） ----------
  const ACT = {
    login: () => login(),
    logout: () => logout(),
    'area-mode': (el) => { state.area.mode = el.dataset.v; renderArea(); },
    gps: () => locate(() => renderArea()),
    radius: (el) => { state.radius = el.dataset.v; renderRadius(); },
    'count-open': openCountWheel,
    wi: (el) => { const w = $('#wheel'); if (w) w.scrollTo({ top: COUNTS.indexOf(Number(el.dataset.n)) * ITEM_H, behavior: 'smooth' }); },
    'count-ok': () => { state.count = pendingCount; closeSheet(); renderCount(); renderProposal(); },
    'search-date': (el) => { state.date = el.dataset.date; CAL_OPEN.search = false; renderDate(); }, // 選んだら閉じる
    'cal-toggle': (el) => {
      const kind = el.dataset.kind;
      CAL_OPEN[kind] = !CAL_OPEN[kind];
      if (kind === 'search') renderDate(); else renderDateSheet();
    },
    'cal-nav': (el) => {
      const kind = el.dataset.kind;
      CAL[kind] = shiftMonth(CAL[kind], Number(el.dataset.d));
      if (kind === 'search') renderDate(); else renderDateSheet();
    },
    'menu-close': () => closeMenu(),
    'go-dc': () => { if (window.dcSwitchApp) window.dcSwitchApp('dc'); }, // 完了報告の画面に戻る（同じ画面の中で切り替える）
    'menu-block': () => { closeMenu(); openBlockList(); },
    'login-from-sheet': () => { closeSheet(); login(); },
    'menu-presets': () => { closeMenu(); goPresets(); },
    'menu-logout': () => { closeMenu(); logout(); },
    'menu-login': () => { closeMenu(); login(); },
    'p-view': (el) => { state.pView = el.dataset.v; renderProposal(); },
    'map-open': () => openMapViewer(),
    'preset-save-ok': () => confirmSavePreset(),
    'ind-tab': (el) => { state.indTab = Number(el.dataset.i); renderInd(); },
    ind: (el) => { const n = el.dataset.name; state.industries.has(n) ? state.industries.delete(n) : state.industries.add(n); renderInd(); },
    'ind-all': () => {
      const everyIndustry = D.GROUPS.every((gr) => gr.items.every((n) => state.industries.has(n)));
      state.industries.clear();
      if (!everyIndustry) D.GROUPS.forEach((gr) => gr.items.forEach((n) => state.industries.add(n)));
      renderInd();
    },
    'ind-group': () => {
      const g = D.GROUPS[state.indTab].items;
      const all = g.every((n) => state.industries.has(n));
      g.forEach((n) => (all ? state.industries.delete(n) : state.industries.add(n)));
      renderInd();
    },
    'preset-save': savePreset,
    'preset-apply': (el) => applyPreset(Number(el.dataset.i)),
    'preset-del': (el) => deletePreset(Number(el.dataset.i)),
    'block-list': openBlockList,
    'run-search': runSearch,
    'go-search': () => go('search'),
    'go-list': () => go('list'),
    'p-sort': (el) => { state.pSort = el.dataset.v; renderProposal(); },
    'p-ind': (el) => { const n = el.dataset.name; state.pIndustries.has(n) ? state.pIndustries.delete(n) : state.pIndustries.add(n); renderProposal(); },
    'open-only': () => { state.openOnly = !state.openOnly; renderProposal(); },
    'p-expand': (el) => {
      const id = el.dataset.id, k = el.dataset.k;
      const key = id + ':' + k;
      if (k === 'overall') {
        state.expanded.has(key) ? state.expanded.delete(key) : state.expanded.add(key);
      } else {
        // 内訳は1つだけ開く：別の項目を押したら、今開いている方は閉じる
        const wasOpen = state.expanded.has(key);
        KEYS.forEach((x) => state.expanded.delete(id + ':' + x));
        if (!wasOpen) state.expanded.add(key);
      }
      renderProposal();
    },
    add: (el) => addVisit(el.dataset.id),
    'copy-map': (el) => { const s = findShop(el.dataset.id); if (s) copyText(mapUrl(s), 'Map URLをコピーしました'); },
    block: (el) => openBlockSheet(el.dataset.id),
    'block-reason': (el) => doBlock(el.dataset.id, el.dataset.r),
    unblock: (el) => unblock(el.dataset.id),
    'later-move': (el) => moveList(el.dataset.id, 'visit', 'later'),
    'back-visit': (el) => moveList(el.dataset.id, 'later', 'visit'),
    remove: (el) => removeFrom(el.dataset.id, el.dataset.src),
    'copy-all': (el) => copyAll(el.dataset.src),
    'sort-dist': sortByDistance,
    'pick-date': (el) => openDatePick(el.dataset.id, el.dataset.kind),
    dpick: (el) => { if (dateCb) dateCb(el.dataset.date); closeSheet(); },
    'dpick-none': (el) => { setVisitDate(el.dataset.id, null, el.dataset.kind); closeSheet(); },
  };

  // クリックは、この画面（shadow root）の中だけで受ける。下のタブ（data-nav）も、ここで画面を切り替える
  root.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { e.preventDefault(); go(nav.dataset.nav); return; }
    if (e.target.closest('[data-close]')) { closeSheet(); return; }
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = ACT[el.dataset.act];
    if (fn) fn(el);
  });

  root.addEventListener('input', (e) => {
    if (e.target.id === 'addr') state.area.address = e.target.value;
  });

  // ---------- 起動 ----------
  // 完了報告アプリの訪問リストが変わったら、この画面も読み直す（同じデータを見る）
  function visitsChanged() {
    syncVisits();
    renderAll();
  }
  async function init() {
    renderNav();
    const note = $('#demoNote');
    if (note) note.hidden = !D.isSample;
    const restored = restoreUi();
    // 再読み込みしても、保存した現在地の位置と住所が戻る（住所が取れていなかったときは、もう一度取る）
    if (state.area.lat != null) {
      state.userPos = { lat: state.area.lat, lng: state.area.lng };
      if (state.area.place == null) setTimeout(resolvePlace, 0);
    }
    syncVisits();
    renderAll();
    showScreen();
    // 操作のたびに、条件・候補・表示の状態を端末に保存する（再読み込みしても戻る）
    ['input', 'change', 'click'].forEach((ev) => root.addEventListener(ev, saveUiSoon));
    // 業種の一覧を開いた・閉じたときも覚える（toggle は泡立たないので、捕まえる段階で受ける）
    root.addEventListener('toggle', (e) => {
      if (e.target && e.target.id === 'pIndFold') { state.pIndOpen = e.target.open; saveUiSoon(); }
    }, true);
    if (restored === 'stale') toast('前の日の提案は消しました。もう一度検索してください');
    D.onVisitsChange(visitsChanged);
    D.onAuthChange(() => refreshUser());
    // 完了報告アプリの三本線メニューから呼ぶ（訪問NG一覧・お気に入り条件）
    window.mlActions = {
      blockList: () => openBlockList(),
      presets: () => goPresets(),
      // 完了報告アプリの上のバーから、提案リストの並び順を変える
      sort: (v) => { if (Object.prototype.hasOwnProperty.call(SORTERS, v)) { state.pSort = v; saveUiSoon(); renderProposal(); } },
      go: (name) => go(name), // 下のタブ（完了報告アプリの棒）から画面を切り替える
    };
    await refreshUser(); // 画面は先に出し、ログイン状態は後から反映する
  }
  init();
})();
