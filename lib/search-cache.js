// マップリストの店舗検索（/api/ml-search）の結果を、同じ条件のあいだ使い回す（Google Places の呼び出しを減らす）
//
// 方針：
//  - 同じ条件（中心・半径・町名の範囲・業種の組み合わせ）の検索は、前回の結果を返す（Places を呼ばない）。
//  - 有効期限は「その日中」（日本時間の0時まで）。日付が変われば新しく検索する。
//  - Google の規約に合わせ、保存は30日を超えない（上限は30日）。
//  - 失敗（エラー）した検索は保存しない。成功（候補が0件も含む）だけ保存する。
//  - 保存先は Cloudflare の Cache API（caches.default）。チームの誰の検索でも使い回せる（同じデータセンターの中で共有）。
//    Cache API は各データセンターごとに持つため、別の場所からの検索は、そこで初めて Places を呼ぶことがある。

export const MAX_TTL_SECONDS = 30 * 24 * 3600; // Google の規約：保存は30日まで
const JST_OFFSET_MS = 9 * 3600 * 1000;
const CACHE_ORIGIN = "https://cache.local/ml-search/v1"; // 保存の鍵に使う仮の住所（実際には接続しない）

// 同じ条件なら同じ鍵になるように、数字は丸め、業種は並べ替えて重複を消す
export function searchCacheKey({ center, radius, town, viewport, industries }) {
  const r5 = (n) => Number(n).toFixed(5);
  const parts = [
    `c=${r5(center.lat)},${r5(center.lng)}`,
    `r=${Math.round(Number(radius) || 0)}`,
    `t=${town ? 1 : 0}`,
    viewport ? `v=${r5(viewport.south)},${r5(viewport.west)},${r5(viewport.north)},${r5(viewport.east)}` : "v=",
    `i=${[...new Set(industries)].sort().map(encodeURIComponent).join("|")}`,
  ];
  return `${CACHE_ORIGIN}?${parts.join("&")}`;
}

// 今から、次の日本時間の0時までの秒数（上限は30日）
export function ttlSeconds(now = Date.now()) {
  const jst = new Date(now + JST_OFFSET_MS);
  const nextJstMidnight = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + 1) - JST_OFFSET_MS;
  const sec = Math.floor((nextJstMidnight - now) / 1000);
  return Math.min(Math.max(sec, 0), MAX_TTL_SECONDS);
}

// 検索結果を返す。cache は { match(url), put(url, response) }（Cache API と同じ形）。
// run() は Places を呼ぶ関数（失敗したら例外を投げる）。戻り値は { data, hit }。
export async function cachedSearch({ cache, key, now = Date.now(), run }) {
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return { data: await hit.json(), hit: true };
  }
  const data = await run(); // 失敗したらここで例外になり、保存されない
  const ttl = ttlSeconds(now);
  if (cache && ttl > 0) {
    await cache.put(key, new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${ttl}` },
    }));
  }
  return { data, hit: false };
}
