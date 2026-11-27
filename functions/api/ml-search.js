// 店舗検索（Cloudflare Pages Functions：POST /api/search）
// ログイン不要。1つのIPからの連続した大量リクエストは回数制限で止める（1分に10回まで）。
// Places の結果を「ウェブサイトなし・チェーン除外」にして返す。
import { keyOf, searchAll, buildShops, placesErrorText, PLACES_CAP } from "../../lib/vla-core.js";
import { hitLimit, clientIp, tooMany } from "../../lib/rate-limit.js";
import { searchCacheKey, cachedSearch } from "../../lib/search-cache.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

export async function onRequestPost({ request, env }) {
  const lim = hitLimit(`search:${clientIp(request)}`, 10, 60_000);
  if (!lim.ok) return tooMany(lim.retryAfter);

  const key = keyOf(env);
  if (!key) return json({ ok: false, error: "店舗検索の設定がまだです（管理者がAPIキーを設定してください）" }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "検索条件が正しくありません" }, 400); }
  const { center, radius, town, viewport, industries } = body || {};
  if (!center || typeof center.lat !== "number" || typeof center.lng !== "number") {
    return json({ ok: false, error: "中心の場所がありません" }, 400);
  }
  const list = Array.isArray(industries) ? industries.filter((n) => typeof n === "string") : [];
  if (!list.length) return json({ ok: false, error: "業種を選んでください" }, 400);

  try {
    // 同じ条件の検索は、その日（JST）のあいだ前回の結果を返す（Places を呼ばない）。失敗した検索は保存しない
    const cacheKey = searchCacheKey({ center, radius: Number(radius) || 1000, town: !!town, viewport, industries: list });
    const cache = typeof caches !== "undefined" ? caches.default : null;
    const { data, hit } = await cachedSearch({
      cache,
      key: cacheKey,
      run: async () => {
        const { raw, industryOf } = await searchAll(key, { center, radius: Number(radius) || 1000, town: !!town, viewport, industries: list });
        return { ok: true, shops: buildShops(raw, industryOf).slice(0, PLACES_CAP * 4) };
      },
    });
    console.log(`ml-search cache ${hit ? "HIT" : "MISS"} industries=${list.length}`);
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Cache": hit ? "HIT" : "MISS" } });
  } catch (e) {
    return json({ ok: false, error: placesErrorText(e, key, "店舗の取得に失敗しました。時間をおいてもう一度お試しください") }, 502);
  }
}
