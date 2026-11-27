// 提案の地図画像（Cloudflare Pages Functions：POST /api/ml-map）
// 地図はOpenStreetMapの地図（staticmap.openstreetmap.de）。Google は呼ばない。
// ログイン不要。1つのIPからの連続した大量リクエストは回数制限で止める（1分に30回まで）。
// 店の位置をピンで並べた画像（PNG）を返す。ピンの番号は付かない（OSMの静的地図の仕様）。
//  ※利用は少量の用途に限る。大量に使うなら、画面側でOSMの地図タイル（Leaflet）に替えること。
import { hitLimit, clientIp, tooMany } from "../../lib/rate-limit.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

const MAX_POINTS = 20;
const UA = "dc-maplist/1.0 (kanryohkk-app)";

// 店の位置から、中心と拡大率（広がりに合わせる）を決める
function viewOf(points) {
  const lats = points.map((p) => p.lat), lngs = points.map((p) => p.lng);
  const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs));
  const zoom = span > 0.2 ? 11 : span > 0.05 ? 13 : span > 0.02 ? 14 : 15;
  return { lat, lng, zoom };
}

export async function onRequestPost({ request }) {
  const lim = hitLimit(`map:${clientIp(request)}`, 30, 60_000);
  if (!lim.ok) return tooMany(lim.retryAfter);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "地図に出す店が正しくありません" }, 400); }
  const points = Array.isArray(body?.points)
    ? body.points.filter((p) => typeof p?.lat === "number" && typeof p?.lng === "number").slice(0, MAX_POINTS)
    : [];
  if (!points.length) return json({ ok: false, error: "地図に出す店がありません" }, 400);

  // 拡大して見るとき：中心（center）と拡大（zoom）を指定できる
  const c = body?.center;
  const auto = viewOf(points);
  const view = c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.abs(c.lat) <= 85 && Math.abs(c.lng) <= 180
    && Number.isInteger(body?.zoom) && body.zoom >= 0 && body.zoom <= 18
    ? { lat: c.lat, lng: c.lng, zoom: body.zoom }
    : auto;

  const markers = points.map((p) => `${p.lat},${p.lng},lightblue1`).join("|");
  const url = `https://staticmap.openstreetmap.de/staticmap.php?center=${view.lat},${view.lng}&zoom=${view.zoom}&size=640x440&maptype=mapnik&markers=${encodeURIComponent(markers)}`;

  let r;
  try {
    r = await fetch(url, { headers: { "User-Agent": UA } });
  } catch {
    return json({ ok: false, error: "地図を取得できませんでした。時間をおいてもう一度お試しください" }, 502);
  }
  if (!r.ok) {
    return json({ ok: false, error: "地図を取得できませんでした（OpenStreetMapの地図サービスに接続できません）" }, 502);
  }
  return new Response(r.body, {
    headers: { "Content-Type": r.headers.get("Content-Type") || "image/png", "Cache-Control": "no-store" },
  });
}
