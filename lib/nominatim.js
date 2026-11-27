// 住所 ⇄ 座標（OpenStreetMap の Nominatim）。Google は呼ばない
// 利用の決まり：識別できる User-Agent を付ける、1秒に1回まで（呼び出し側の回数制限と当日キャッシュで抑える）
const NOMINATIM = "https://nominatim.openstreetmap.org";
const UA = "dc-maplist/1.0 (kanryohkk-app)";

const clean = (s) => String(s || "").replace(/^日本[、,]\s*/, "").replace(/^〒?\s*\d{3}-?\d{4}\s*/, "").trim();

async function getJson(url, fetchImpl = fetch) {
  const r = await fetchImpl(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" } });
  if (!r.ok) throw Object.assign(new Error(`Nominatim ${r.status}`), { status: r.status });
  return r.json();
}

// 住所・町名 → 座標と範囲（見つからなければ null）
export async function geocodeOsm(q, fetchImpl = fetch) {
  const j = await getJson(`${NOMINATIM}/search?format=jsonv2&limit=1&countrycodes=jp&accept-language=ja&q=${encodeURIComponent(q)}`, fetchImpl);
  const hit = Array.isArray(j) ? j[0] : null;
  if (!hit) return null;
  const bb = Array.isArray(hit.boundingbox) ? hit.boundingbox.map(Number) : null; // [南, 北, 西, 東]
  return {
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    label: clean(hit.display_name) || q,
    viewport: bb && bb.length === 4 && bb.every(Number.isFinite)
      ? { south: bb[0], north: bb[1], west: bb[2], east: bb[3] }
      : null,
  };
}

// 座標 → 付近の地名（現在地の表示）
export async function reverseLabelOsm(lat, lng, fetchImpl = fetch) {
  const j = await getJson(`${NOMINATIM}/reverse?format=jsonv2&zoom=16&accept-language=ja&lat=${lat}&lon=${lng}`, fetchImpl);
  return clean(j?.display_name);
}

// 座標 → 都道府県・市・区・町（店の住所の項目に使う）
export async function reverseAddressOsm(lat, lng, fetchImpl = fetch) {
  const j = await getJson(`${NOMINATIM}/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=ja&lat=${lat}&lon=${lng}`, fetchImpl);
  const a = j?.address || {};
  const prefecture = a.state || a.province || "";
  const city = a.city || a.town || a.village || a.municipality || a.county || "";
  const ward = a.city_district || a.borough || (a.city && a.suburb) || "";
  const town = a.quarter || a.neighbourhood || a.suburb || a.hamlet || "";
  return { prefecture, city: ward ? (a.city || "") : city, ward, town, display: clean(j?.display_name) };
}
