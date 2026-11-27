// 分類（飲食店・飲食店以外）とページの検索のテスト（ネットワークは使わない。Places の代わりに偽物、Cache API の代わりに Map）
import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryBaseKey, categoryBody, getCategoryPage, labelOf, CATEGORY_TEXT, pageKey } from "./category-search.js";

// Cache API の偽物（max-age で期限が切れる。本物と同じ）
function fakeCache(clock) {
  const store = new Map();
  return {
    async match(key) {
      const e = store.get(key);
      if (!e || clock.now >= e.expiresAt) return undefined;
      return new Response(e.body);
    },
    async put(key, res) {
      const m = /max-age=(\d+)/.exec(res.headers.get("Cache-Control") || "");
      if (m) store.set(key, { body: await res.text(), expiresAt: clock.now + Number(m[1]) * 1000 });
    },
  };
}

// Places の偽物：続きの印で次の20件を返す。3ページ目の後も印は続く（上限は呼び出し側で止める）
function fakePlaces({ expireToken = null } = {}) {
  const calls = [];
  let expired = false;
  const mk = (from) => Array.from({ length: 20 }, (_, i) => ({ id: `P${from + i}`, displayName: { text: `店${from + i}` }, location: { latitude: 35, longitude: 139 } }));
  const call = async (token) => {
    calls.push(token);
    if (token === expireToken && !expired) { expired = true; throw Object.assign(new Error("expired"), { reason: "INVALID_ARGUMENT" }); }
    if (token === "") return { places: mk(1), nextPageToken: "t1" };
    if (token === "t1") return { places: mk(21), nextPageToken: "t2" };
    if (token === "t2") return { places: mk(41), nextPageToken: "t3" };
    return { places: mk(61), nextPageToken: "" };
  };
  return { call, calls };
}

const GEO = { center: { lat: 35.8, lng: 139.67 }, radius: 1000, town: false, viewport: null };
const ids = (r) => r.places.map((p) => p.id);

test("分類ごとに検索語が変わり、地域（中心・半径）の指定は同じ", () => {
  const food = categoryBody("food", GEO);
  const other = categoryBody("other", GEO);
  assert.equal(food.textQuery, CATEGORY_TEXT.food);
  assert.equal(other.textQuery, CATEGORY_TEXT.other);
  assert.notEqual(food.textQuery, other.textQuery);
  assert.deepEqual(food.locationBias, other.locationBias);
  assert.equal(food.locationBias.circle.radius, 1000);
});

test("最初は1ページ目だけ取る。ページ指定で次の20件が取れる", async () => {
  const clock = { now: 0 };
  const cache = fakeCache(clock);
  const base = categoryBaseKey(GEO);
  const p = fakePlaces();
  const first = await getCategoryPage({ cache, base, category: "food", page: 1, now: 0, call: p.call });
  assert.equal(p.calls.length, 1); // 1ページ目だけ
  assert.equal(ids(first).length, 20);
  assert.equal(first.hasMore, true);
  const second = await getCategoryPage({ cache, base, category: "food", page: 2, now: 0, call: p.call });
  assert.equal(ids(second)[0], "P21");
  assert.equal(second.hasMore, true);
});

test("上限は3ページ（60件）。3ページ目の後は次がない", async () => {
  const cache = fakeCache({ now: 0 });
  const base = categoryBaseKey(GEO);
  const p = fakePlaces();
  const third = await getCategoryPage({ cache, base, category: "food", page: 3, now: 0, call: p.call });
  assert.equal(ids(third)[0], "P41");
  assert.equal(third.hasMore, false); // 印があっても、3ページ目の先は取らない
  assert.equal(p.calls.length, 3);
});

test("保存は分類とページごとに効く（2回目は取らない。別の分類・別のページは別に取る）", async () => {
  const clock = { now: 0 };
  const cache = fakeCache(clock);
  const base = categoryBaseKey(GEO);
  const p = fakePlaces();
  await getCategoryPage({ cache, base, category: "food", page: 2, now: 0, call: p.call });
  assert.equal(p.calls.length, 2); // 1ページ目と2ページ目
  await getCategoryPage({ cache, base, category: "food", page: 2, now: 0, call: p.call });
  assert.equal(p.calls.length, 2); // 2回目は保存から
  await getCategoryPage({ cache, base, category: "other", page: 1, now: 0, call: p.call });
  assert.equal(p.calls.length, 3); // 別の分類は別に取る
  assert.notEqual(pageKey(base, "food", 1), pageKey(base, "other", 1));
});

test("続きの印が切れていたら、1ページ目からやり直す（保存された古い印は使わない）", async () => {
  const clock = { now: 0 };
  const cache = fakeCache(clock);
  const base = categoryBaseKey(GEO);
  const p = fakePlaces({ expireToken: "t1" });
  await getCategoryPage({ cache, base, category: "food", page: 1, now: 0, call: p.call }); // 1ページ目は保存される（続きの印 t1 つき）
  const hits = [];
  const second = await getCategoryPage({ cache, base, category: "food", page: 2, now: 0, call: p.call, hits });
  assert.equal(ids(second)[0], "P21"); // やり直しても2ページ目が取れる
  assert.ok(hits.includes("RETRY"));
});

test("地域（中心・半径・町名）が変われば、別の保存になる", () => {
  const a = categoryBaseKey(GEO);
  assert.equal(a, categoryBaseKey({ ...GEO }));
  assert.notEqual(a, categoryBaseKey({ ...GEO, radius: 2000 }));
  assert.notEqual(a, categoryBaseKey({ ...GEO, center: { lat: 35.9, lng: 139.67 } }));
  assert.notEqual(a, categoryBaseKey({ ...GEO, town: true, viewport: { south: 1, west: 1, north: 2, east: 2 } }));
});

test("業種（店の種類）で判定する。飲食店以外の分類では、飲食店と判定される店を外せる", () => {
  assert.equal(labelOf({ types: ["restaurant"], displayName: { text: "x" } }, "other"), "飲食店");
  assert.equal(labelOf({ types: ["hair_salon"], displayName: { text: "x" } }, "other"), "美容院");
  assert.equal(labelOf({ types: [], displayName: { text: "ラーメン屋" } }, "food"), "飲食店");
});
