// マップリストの店舗検索を「2分類（飲食店・飲食店以外）」で行い、ページで返す
//
//  - 分類：food（飲食店）／other（飲食店以外）／all（両方）
//  - 中身：業種ごとに検索して合わせ、重複を除いた「候補のプール」を作る（1業種＝1回の検索、20件まで）。
//    1分類の業種は、画面の GROUPS と同じ分け方（food＝飲食店の12業種、other＝それ以外の21業種）。
//  - プールは分類・地域ごとに、その日（JST）のあいだ保存する。2ページ目以降は保存から返し、Google を呼ばない。
//  - ページ：プールを距離（中心から）の近い順に並べ、20件ずつ返す。hasMore はプールの残りで判定。
//  - 応答に店ごとの types を付ける（画面の「業種で絞り込み」の材料）。Places の項目は、今の検索と同じ課金区分の中で足す。
//  - 保存は cachedSearch と同じ（JST当日・30日以内・エラーは保存しない）。
import { classifyIndustry } from "../public/industry.js";
import { SEARCH_FIELDS, industryQuery, buildShops } from "./vla-core.js";
import { cachedSearch } from "./search-cache.js";

export const PAGE_SIZE = 20;
export const CATEGORIES = ["food", "other"];
export const CATEGORY_CHOICES = ["food", "other", "all"]; // 外から受け付ける分類（all は両方）

// 業種の分け方（画面の GROUPS と同じ。変えるときは両方）
const FOOD_INDUSTRIES = [
  "寿司・割烹", "焼き鳥・やきとん", "ラーメン・中華そば", "居酒屋・大衆酒場", "カフェ・喫茶", "焼肉・ホルモン",
  "そば・うどん", "パン・洋菓子・和菓子", "イタリアン・フレンチ・ビストロ", "中華・餃子", "定食・食堂・とんかつ・洋食", "バー・スナック",
];
const OTHER_INDUSTRIES = [
  "美容室（ヘア）", "理容室・バーバー", "ネイル・まつげ", "エステ・脱毛",
  "セレクト・婦人服", "古着", "呉服・着物", "靴・バッグ・小物",
  "整骨院・接骨院", "整体・カイロ", "鍼灸", "リラクゼーション",
  "賃貸仲介", "売買・買取",
  "工務店・注文住宅・リフォーム", "外壁・屋根塗装", "水道・電気・設備", "外構・造園", "土木・解体",
  "学習塾（個別指導・小中高）", "汎用（例：クリーニング）",
];
export const INDUSTRIES_OF = { food: FOOD_INDUSTRIES, other: OTHER_INDUSTRIES };

const PLACES = "https://places.googleapis.com/v1/places:searchText";
const FIELDS_WITH_TYPES = `${SEARCH_FIELDS},places.types`;
const CACHE_ORIGIN = "https://cache.local/ml-search/v3";

// 地域（中心・半径・町名の範囲）から、保存の鍵の前半を作る。同じ地域なら同じ鍵
export function categoryBaseKey({ center, radius, town, viewport }) {
  const r5 = (n) => Number(n).toFixed(5);
  const parts = [
    `c=${r5(center.lat)},${r5(center.lng)}`,
    `r=${Math.round(Number(radius) || 0)}`,
    `t=${town ? 1 : 0}`,
    viewport ? `v=${r5(viewport.south)},${r5(viewport.west)},${r5(viewport.north)},${r5(viewport.east)}` : "v=",
  ];
  return `${CACHE_ORIGIN}?${parts.join("&")}`;
}

// 業種の検索の中身（検索語と地域の指定）
export function industryBody(name, { center, radius, town, viewport }) {
  const textQuery = industryQuery(name);
  if (town && viewport) {
    return { textQuery, locationRestriction: { rectangle: {
      low: { latitude: viewport.south, longitude: viewport.west },
      high: { latitude: viewport.north, longitude: viewport.east },
    } } };
  }
  return { textQuery, locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(radius, 50000) } } };
}

// Places（Text Search）を1回呼ぶ（1ページ＝20件まで）
export async function placesSearch(key, body) {
  const r = await fetch(PLACES, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS_WITH_TYPES },
    body: JSON.stringify({ languageCode: "ja", regionCode: "JP", pageSize: PAGE_SIZE, ...body }),
  });
  const j = await r.json();
  if (!r.ok) {
    const reason = j?.error?.details?.find((d) => d.reason)?.reason || j?.error?.status || "";
    const err = new Error(j?.error?.message || `Places API ${r.status}`);
    err.reason = reason;
    err.status = r.status;
    err.detail = j?.error?.message || "";
    throw err;
  }
  return j.places || [];
}

// 分類の候補プール（業種ごとの検索を合わせ、重複を除く）。その日のあいだ保存する
export async function poolFor({ key, cache, base, geo, category, now = Date.now(), hits = null }) {
  const names = INDUSTRIES_OF[category];
  const { data } = await cachedSearch({
    cache, key: `${base}&pool=${category}`, now,
    run: async () => {
      const items = [];
      const seen = new Set();
      for (let i = 0; i < names.length; i += 5) {
        const batch = names.slice(i, i + 5); // 同時に5件まで
        const results = await Promise.all(batch.map(async (name) => ({ name, places: await placesSearch(key, industryBody(name, geo)) })));
        for (const { name, places } of results) {
          for (const p of places) {
            if (!p.id || seen.has(p.id)) continue;
            seen.add(p.id);
            items.push({ p, industry: name });
          }
        }
      }
      return { items };
    },
  }, hits);
  return data.items;
}

// 店の業種：店の種類と店名から判定し、決まらなければ検索した業種の名前
function industryOfItem(p, fallback) {
  const types = Array.isArray(p.types) ? p.types.join(" ") : "";
  const c = classifyIndustry(types, p.displayName?.text || "");
  return c && c !== "その他" ? c : fallback;
}

// 中心からの距離（メートル。近似）
function distanceM(center, shop) {
  if (shop.lat == null || shop.lng == null) return Infinity;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(shop.lat - center.lat);
  const dLng = toRad(shop.lng - center.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(center.lat)) * Math.cos(toRad(shop.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 分類（food／other／all）の、指定したページの店。プールを距離順に並べ、20件ずつ返す
export async function categorySearchPage({ key, cache, geo, category, page, now = Date.now(), hits = null }) {
  const base = categoryBaseKey(geo);
  const cats = category === "all" ? CATEGORIES : [category];
  const pools = await Promise.all(cats.map((c) => poolFor({ key, cache, base, geo, category: c, now, hits })));

  const raw = [];
  const industryOf = new Map();
  const typesOf = new Map();
  cats.forEach((c, i) => {
    for (const { p, industry } of pools[i]) {
      const label = industryOfItem(p, industry);
      if (c === "other" && label === "飲食店") continue; // 飲食店以外の分類では、飲食店と判定された店を外す
      if (industryOf.has(p.id)) continue;
      raw.push(p);
      industryOf.set(p.id, label);
      typesOf.set(p.id, Array.isArray(p.types) ? p.types : []);
    }
  });

  // チェーン・ウェブサイトありなどを外す（プール全体で判定する）
  const shops = buildShops(raw, industryOf)
    .map((s) => ({ ...s, types: typesOf.get(s.id) || [] }))
    .sort((a, b) => distanceM(geo.center, a) - distanceM(geo.center, b));

  const start = (page - 1) * PAGE_SIZE;
  return {
    shops: shops.slice(start, start + PAGE_SIZE),
    hasMore: shops.length > start + PAGE_SIZE,
    total: shops.length,
  };
}

