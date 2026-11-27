// 店舗検索（Cloudflare Pages Functions：POST /api/ml-search）
// データは OpenStreetMap（Overpass API）。Google は呼ばない。
// ログイン不要。1つのIPからの連続した大量リクエストは回数制限で止める（1分に10回まで）。
// ウェブサイトのある店・チェーンは外す（今までの決まり）。
//
// 分類：category（food＝飲食店／other＝飲食店以外／all＝両方）と page（1から。1ページ20件、最大3ページ）。
//   応答には hasMore（次のページがあるか）を付ける。店の取得は、同じ地域なら当日のあいだ使い回す（OSM を呼び直さない）。
// 旧形式：industries（業種の名前の配列）。今の画面が使っている間は、そのまま動く。
import { hitLimit, clientIp, tooMany } from "../../lib/rate-limit.js";
import { loadPool, filterByCategory, pageOf, filterByIndustries, sortByDistance, CATEGORY_CHOICES, MAX_PAGES } from "../../lib/osm-search.js";
import { PLACES_CAP } from "../../lib/vla-core.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

export async function onRequestPost({ request }) {
  const lim = hitLimit(`search:${clientIp(request)}`, 10, 60_000);
  if (!lim.ok) return tooMany(lim.retryAfter);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "検索条件が正しくありません" }, 400); }
  const { center, radius, town, viewport, industries, category, page } = body || {};
  if (!center || typeof center.lat !== "number" || typeof center.lng !== "number") {
    return json({ ok: false, error: "中心の場所がありません" }, 400);
  }
  const geo = { center, radius: Math.min(Number(radius) || 1000, 10000), town: !!town, viewport };
  const cache = typeof caches !== "undefined" ? caches.default : null;

  // 分類とページで取る
  if (category !== undefined) {
    if (!CATEGORY_CHOICES.includes(category)) return json({ ok: false, error: "分類は food・other・all のどれかです" }, 400);
    const pg = page === undefined ? 1 : Number(page);
    if (!Number.isInteger(pg) || pg < 1 || pg > MAX_PAGES) return json({ ok: false, error: `ページは1から${MAX_PAGES}までです` }, 400);
    try {
      const hits = [];
      const shops = await loadPool({ cache, geo, hits });
      const sorted = filterByCategory(shops, category, center);
      const { shops: list, hasMore, total } = pageOf(sorted, pg);
      const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
      if (hits.length) headers["X-Cache"] = hits.join(",");
      return new Response(JSON.stringify({ ok: true, shops: list, hasMore, total, page: pg, category }), { headers });
    } catch (e) {
      return json({ ok: false, error: "店舗の取得に失敗しました（地図のデータ・OpenStreetMap が混みあっています）。時間をおいてもう一度お試しください" }, 502);
    }
  }

  // 旧形式：業種の名前で切る（今の画面の間は、そのまま動く）
  const list = Array.isArray(industries) ? industries.filter((n) => typeof n === "string") : [];
  if (!list.length) return json({ ok: false, error: "業種を選んでください" }, 400);
  try {
    const hitsOld = [];
    const shops = await loadPool({ cache, geo, hits: hitsOld });
    const out = sortByDistance(filterByIndustries(shops, list), center).slice(0, PLACES_CAP * 4);
    const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
    if (hitsOld.length) headers["X-Cache"] = hitsOld.join(",");
    return new Response(JSON.stringify({ ok: true, shops: out }), { headers });
  } catch (e) {
    return json({ ok: false, error: "店舗の取得に失敗しました（地図のデータ・OpenStreetMap が混みあっています）。時間をおいてもう一度お試しください" }, 502);
  }
}
