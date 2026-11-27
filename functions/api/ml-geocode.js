// 住所・町名 → 座標（Cloudflare Pages Functions：POST /api/ml-geocode）
// データは OpenStreetMap（Nominatim）。Google は呼ばない。
// ログイン不要。1つのIPからの連続した大量リクエストは回数制限で止める（1分に30回まで）。
// 同じ住所・同じ場所は、その日（JST）のあいだ使い回す（Nominatim を呼び直さない）。
import { geocodeOsm, reverseLabelOsm } from "../../lib/nominatim.js";
import { hitLimit, clientIp, tooMany } from "../../lib/rate-limit.js";
import { cachedSearch } from "../../lib/search-cache.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

// 同じ条件の保存の鍵（住所・座標ごと）
const keyOf = (kind, parts) => `https://cache.local/nominatim/v1?kind=${kind}&k=${encodeURIComponent(JSON.stringify(parts))}`;

export async function onRequestPost({ request }) {
  const lim = hitLimit(`geocode:${clientIp(request)}`, 30, 60_000);
  if (!lim.ok) return tooMany(lim.retryAfter);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "住所が正しくありません" }, 400); }

  const cache = typeof caches !== "undefined" ? caches.default : null;

  // 座標 → 付近の地名（現在地の表示に使う）
  if (body?.reverse) {
    const lat = Number(body.reverse.lat), lng = Number(body.reverse.lng);
    if (!(lat >= 20 && lat <= 46 && lng >= 122 && lng <= 154)) return json({ ok: false, error: "現在地が正しくありません" }, 400);
    try {
      const { data: label } = await cachedSearch({ cache, key: keyOf("reverse", [lat.toFixed(4), lng.toFixed(4)]), run: () => reverseLabelOsm(lat, lng) });
      if (!label) return json({ ok: false, error: "付近の地名が見つかりませんでした" }, 404);
      return json({ ok: true, label });
    } catch (e) {
      return json({ ok: false, error: "付近の地名を取得できませんでした。時間をおいてもう一度お試しください" }, 502);
    }
  }

  const q = String(body?.q || "").trim().slice(0, 200);
  if (!q) return json({ ok: false, error: "住所か町名を入力してください" }, 400);

  try {
    const { data: hit } = await cachedSearch({ cache, key: keyOf("search", [q]), run: () => geocodeOsm(q) });
    if (!hit) return json({ ok: false, error: "場所が見つかりませんでした" }, 404);
    return json({ ok: true, ...hit });
  } catch (e) {
    return json({ ok: false, error: "場所の検索に失敗しました。時間をおいてもう一度お試しください" }, 502);
  }
}
