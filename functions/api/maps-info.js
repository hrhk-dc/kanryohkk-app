// Googleマップのリンクから店舗の情報を読み取る（Cloudflare Pages Functions：GET /api/maps-info?url=…）
// データは OpenStreetMap（座標の住所：Nominatim、店のタグ：Overpass）。Google は呼ばない。
//
// 注意：Googleの短縮リンク（maps.app.goo.gl・goo.gl）は、中身を調べるのにGoogleへの接続が要るため読めない。
//   「共有」→「リンクをコピー」で出る長いURL（座標や店名を含むもの）だけ読める。
import { overpassQuery, overpassFetch, shopsOfElements, hoursText } from "../../lib/osm.js";
import { reverseAddressOsm } from "../../lib/nominatim.js";
import { cachedSearch } from "../../lib/search-cache.js";

const SHORT = /^(maps\.app\.goo\.gl|goo\.gl)$/i;
const ALLOWED = /^((www\.)?google\.[a-z.]+|maps\.google\.[a-z.]+)$/i;

// Googleマップの長いURLから、店名・座標・店舗IDを取り出す（通信はしない）
export function parseMapsUrl(u) {
  const out = {};
  const url = new URL(u);
  const place = url.pathname.match(/\/maps\/place\/([^/@]+)/);
  if (place) {
    let n = place[1].replace(/\+/g, " ");
    for (let k = 0; k < 2 && /%[0-9A-F]{2}/i.test(n); k++) { try { n = decodeURIComponent(n); } catch { break; } }
    out.name = n.trim();
  }
  const dec = (() => { try { return decodeURIComponent(u); } catch { return u; } })();
  const pin = dec.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  const at = dec.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  const q = url.searchParams.get("q") || url.searchParams.get("query") || "";
  const qll = q.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  const ll = pin || at || qll;
  if (ll) { out.lat = parseFloat(ll[1]); out.lng = parseFloat(ll[2]); }
  if (!out.name && q && !qll && !/^\s*place_id:/i.test(q)) out.name = q.trim();
  return out;
}

// 店名が一致する要素（なければ、一番近いもの）を探す（80m以内）
function pickShop(shops, name, lat, lng) {
  if (!shops.length) return null;
  const n = String(name || "").replace(/\s+/g, "");
  const same = n ? shops.find((s) => s.name.replace(/\s+/g, "") === n || s.name.includes(n) || n.includes(s.name.replace(/\s+/g, ""))) : null;
  if (same) return same;
  if (lat == null) return null;
  return shops.slice().sort((a, b) => (a.lat - lat) ** 2 + (a.lng - lng) ** 2 - ((b.lat - lat) ** 2 + (b.lng - lng) ** 2))[0] || null;
}

async function handle(req) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  const hits = [];
  try {
    const link = new URL(req.url).searchParams.get("url") || "";
    let host = "";
    try { host = new URL(link).hostname; } catch { /* 下で判定 */ }
    if (!ALLOWED.test(host) && !SHORT.test(host)) {
      return new Response(JSON.stringify({ ok: false, error: "GoogleマップのURLではありません" }), { status: 400, headers });
    }
    if (SHORT.test(host)) {
      return new Response(JSON.stringify({ ok: false, finalUrl: link, notes: [], error: "短縮リンク（maps.app.goo.gl）は読めません。Googleマップで「共有」→「リンクをコピー」を押し、出てきた長いURLを貼ってください" }), { status: 200, headers });
    }

    const info = parseMapsUrl(link);
    const notes = [];
    const out = { name: info.name || "", lat: info.lat ?? null, lng: info.lng ?? null, prefecture: "", city: "", ward: "", town: "", area: "", address: "", category: "", categoryRaw: "", categorySource: "", phone: "", hours: "", website: "", insta: "" };

    if (out.lat != null && out.lng != null) {
      try {
        const a = await cachedSearch({ cache: typeof caches !== "undefined" ? caches.default : null, key: `https://cache.local/nominatim-addr/v1?k=${out.lat.toFixed(4)},${out.lng.toFixed(4)}`, run: () => reverseAddressOsm(out.lat, out.lng) }, hits);
        Object.assign(out, { prefecture: a.data.prefecture, city: a.data.city, ward: a.data.ward, town: a.data.town });
        out.address = a.data.display;
      } catch { notes.push("住所（県・市区）を取得できませんでした"); }

      try {
        const key = `https://cache.local/osm-near/v1?k=${out.lat.toFixed(4)},${out.lng.toFixed(4)}`;
        const near = await cachedSearch({ cache: typeof caches !== "undefined" ? caches.default : null, key, run: async () => {
          const els = await overpassFetch(overpassQuery({ center: { lat: out.lat, lng: out.lng }, radius: 80 }));
          return { els: els.map((e) => ({ el: e, tags: e.tags || {} })) };
        } }, hits);
        const shops = shopsOfElements(near.data.els.map((x) => x.el));
        const s = pickShop(shops, out.name, out.lat, out.lng);
        if (s) {
          const tags = near.data.els.find((x) => `osm:${x.el.type}/${x.el.id}` === s.id)?.tags || {};
          out.category = s.industry;
          out.categoryRaw = [tags.cuisine, tags.shop, tags.amenity, tags.healthcare, tags.craft, tags.office].filter(Boolean).join(" ");
          out.categorySource = "OpenStreetMap のタグ";
          out.phone = s.phone || "";
          out.website = s.website || "";
          out.insta = s.insta || "";
          if (s.hasHours) out.hours = hoursText(s.hours);
          if (s.address) out.address = s.address;
          if (!out.name) out.name = s.name;
        } else {
          notes.push("業種・営業時間・電話番号は、OpenStreetMap にこの店のデータがありませんでした（手で入れてください）");
        }
      } catch { notes.push("店のデータ（OpenStreetMap）を取得できませんでした。時間をおいてもう一度お試しください"); }
    } else {
      notes.push("リンクに場所（座標）がありませんでした");
    }

    out.area = [out.prefecture, out.city, out.ward].filter(Boolean).join("");
    if (!out.address && out.area) out.address = out.area + (out.town || "");
    const found = !!(out.name || out.area);
    if (hits.length) headers["X-Cache"] = hits.join(",");
    return new Response(JSON.stringify({ ok: found, ...out, finalUrl: link, notes, error: found ? "" : "このリンクから店舗の情報を読み取れませんでした" }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "読み取り中にエラーが起きました：" + e.message }), { status: 200, headers });
  }
}

export const onRequestGet = ({ request }) => handle(request);
