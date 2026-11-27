// 店舗検索（Cloudflare Pages Functions：POST /api/ml-search）
// ログイン不要。1つのIPからの連続した大量リクエストは回数制限で止める（1分に10回まで）。
// Places の結果を「ウェブサイトなし・チェーン除外」にして返す。
//
// 新しい方式：category（food＝飲食店／other＝飲食店以外／all＝両方）と page（1から。1ページ20件、最大3ページ）で取る。
//   応答には hasMore（次のページがあるか）を付ける。
// 古い方式：industries（業種の配列）で取る。今の画面が使っている間は、そのまま動く。
import { keyOf, searchAll, buildShops, placesErrorText, PLACES_CAP } from "../../lib/vla-core.js";
import { hitLimit, clientIp, tooMany } from "../../lib/rate-limit.js";
import { searchCacheKey, cachedSearch } from "../../lib/search-cache.js";
import { categorySearchPage, CATEGORY_CHOICES } from "../../lib/category-search.js";
const MAX_PAGES = 3;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });


export async function onRequestPost({ request, env }) {
  const lim = hitLimit(`search:${clientIp(request)}`, 10, 60_000);
  if (!lim.ok) return tooMany(lim.retryAfter);

  const key = keyOf(env);
  if (!key) return json({ ok: false, error: "店舗検索の設定がまだです（管理者がAPIキーを設定してください）" }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "検索条件が正しくありません" }, 400); }
  const { center, radius, town, viewport, industries, category, page } = body || {};
  if (!center || typeof center.lat !== "number" || typeof center.lng !== "number") {
    return json({ ok: false, error: "中心の場所がありません" }, 400);
  }
  const geo = { center, radius: Number(radius) || 1000, town: !!town, viewport };
  const cache = typeof caches !== "undefined" ? caches.default : null;

  // 新しい方式：分類とページで取る（業種ごとの検索を合わせた候補を、距離順に20件ずつ返す）
  if (category !== undefined) {
    if (!CATEGORY_CHOICES.includes(category)) return json({ ok: false, error: "分類は food・other・all のどれかです" }, 400);
    const pg = page === undefined ? 1 : Number(page);
    if (!Number.isInteger(pg) || pg < 1 || pg > MAX_PAGES) return json({ ok: false, error: `ページは1から${MAX_PAGES}までです` }, 400);
    try {
      const hits = [];
      const { shops, hasMore } = await categorySearchPage({ key, cache, geo, category, page: pg, hits });
      const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
      if (hits.length) headers["X-Cache"] = hits.join(",");
      return new Response(JSON.stringify({ ok: true, shops, hasMore, page: pg, category }), { headers });
    } catch (e) {
      return json({ ok: false, error: placesErrorText(e, key, "店舗の取得に失敗しました。時間をおいてもう一度お試しください") }, 502);
    }
  }

  // 古い方式：業種の配列で取る（今の画面が使っている間は、そのまま動く）
  const list = Array.isArray(industries) ? industries.filter((n) => typeof n === "string") : [];
  if (!list.length) return json({ ok: false, error: "業種を選んでください" }, 400);

  try {
    // 同じ条件の検索は、その日（JST）のあいだ前回の結果を返す（Places を呼ばない）。失敗した検索は保存しない
    const cacheKey = searchCacheKey({ center, radius: geo.radius, town: geo.town, viewport, industries: list });
    const { data, hit } = await cachedSearch({
      cache,
      key: cacheKey,
      run: async () => {
        const { raw, industryOf } = await searchAll(key, { center, radius: geo.radius, town: geo.town, viewport, industries: list });
        return { ok: true, shops: buildShops(raw, industryOf).slice(0, PLACES_CAP * 4) };
      },
    });
    console.log(`ml-search cache ${hit ? "HIT" : "MISS"} industries=${list.length}`);
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Cache": hit ? "HIT" : "MISS" } });
  } catch (e) {
    return json({ ok: false, error: placesErrorText(e, key, "店舗の取得に失敗しました。時間をおいてもう一度お試しください") }, 502);
  }
}
