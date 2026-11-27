// マップリストの店舗検索を「2分類（飲食店・飲食店以外）」で行う。ページは1ページ（20件）ずつ取る
//
//  - 分類：food（飲食店）／other（飲食店以外）／all（両方）
//  - ページ：1から。最初は1ページ目だけ。続きが必要なときだけ次のページを取る
//  - Google の上限は1分類あたり60件（3ページ）。それ以上は取らない
//  - 次のページを取るには、前のページの続きの印（nextPageToken）が要る。ページごとに保存し、
//    続きの印が無効になっていたら1ページ目からやり直す（保存は使わず、取り直した結果だけ保存する）
//  - 保存は cachedSearch と同じ（その日（JST）のあいだ・30日以内・エラーは保存しない）
import { classifyIndustry } from "../public/industry.js";
import { SEARCH_FIELDS } from "./vla-core.js";
import { cachedSearch } from "./search-cache.js";

export const CATEGORIES = ["food", "other"];
export const MAX_PAGES = 3;
export const PAGE_SIZE = 20;

// 分類ごとの検索語（1分類＝1つの検索）
export const CATEGORY_TEXT = {
  food: "飲食店 カフェ 居酒屋 ラーメン 寿司 焼肉 そば 中華 定食 パン",
  other: "美容室 理容室 ネイル エステ 整体 整骨院 不動産 工務店 学習塾 アパレル 古着 クリーニング",
};
const CATEGORY_LABEL = { food: "飲食店", other: "" };

const PLACES = "https://places.googleapis.com/v1/places:searchText";
const CACHE_ORIGIN = "https://cache.local/ml-search/v2";

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

// 分類・ページごとの鍵
export const pageKey = (base, category, page) => `${base}&cat=${category}&p=${page}`;

// 分類の検索の中身（検索語と、地域の指定）
export function categoryBody(category, { center, radius, town, viewport }) {
  const textQuery = CATEGORY_TEXT[category];
  if (town && viewport) {
    return { textQuery, locationRestriction: { rectangle: {
      low: { latitude: viewport.south, longitude: viewport.west },
      high: { latitude: viewport.north, longitude: viewport.east },
    } } };
  }
  return { textQuery, locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(radius, 50000) } } };
}

// Places（Text Search）を1ページ呼ぶ。pageToken を付けると、その続きを取る
export async function placesPage(key, body, pageToken) {
  const payload = { languageCode: "ja", regionCode: "JP", pageSize: PAGE_SIZE, ...body, ...(pageToken ? { pageToken } : {}) };
  const r = await fetch(PLACES, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": `${SEARCH_FIELDS},nextPageToken` },
    body: JSON.stringify(payload),
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
  return { places: j.places || [], nextPageToken: j.nextPageToken || "" };
}

// 分類の、指定したページの候補を取る（1ページ目から続けて。取れたページは、ページごとに保存する）
// call(pageToken) は Places を1ページ呼ぶ関数。戻り値は { places, hasMore }（hasMore は次のページがあるか）
export async function getCategoryPage({ cache, base, category, page, now = Date.now(), call, hits = null }) {
  const chain = async (force) => {
    let token = "";
    for (let p = 1; p <= page; p++) {
      const rec = (await cachedSearch({
        cache, key: pageKey(base, category, p), now, force,
        run: () => call(p > 1 ? token : ""),
      }, hits)).data;
      if (p === page) return { places: rec.places || [], hasMore: !!rec.nextPageToken && page < MAX_PAGES };
      token = rec.nextPageToken || "";
      if (!token) return { places: [], hasMore: false }; // これより先のページは無い
    }
    return { places: [], hasMore: false };
  };
  try {
    return await chain(false);
  } catch (e) {
    // 途中のページの続きの印が切れていた場合は、1ページ目からやり直す（保存された古い印は使わない）
    if (page === 1 || !cache) throw e;
    hits?.push("RETRY");
    return await chain(true);
  }
}

// 候補ごとの業種（店の種類と店名から）。飲食店以外の分類では、飲食店と判定されたものを外す
export function labelOf(p, category) {
  const types = Array.isArray(p.types) ? p.types.join(" ") : "";
  const name = p.displayName?.text || "";
  return classifyIndustry(types, name) || CATEGORY_LABEL[category] || "";
}
