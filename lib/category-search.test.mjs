// 分類（飲食店・飲食店以外）の店舗検索のテスト（ネットワークは使わない。Places は偽物、Cache API は Map の偽物）
import { test } from "node:test";
import assert from "node:assert/strict";
import { categorySearchPage, INDUSTRIES_OF, categoryBaseKey } from "./category-search.js";
import { industryQuery } from "./vla-core.js";

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

// Places の偽物：業種の検索語ごとに3件返す（店名は全部ちがう。飲食の語なら restaurant、それ以外は hair_salon）
function fakePlaces() {
  const calls = [];
  let n = 0;
  const foodQueries = new Set(INDUSTRIES_OF.food.map(industryQuery));
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ body, headers: init.headers });
    const isFood = foodQueries.has(body.textQuery);
    const places = [0, 1, 2].map((i) => {
      n += 1;
      return {
        id: `id${n}`,
        displayName: { text: `${body.textQuery}店${n}` },
        formattedAddress: "日本、〒335-0000 埼玉県戸田市",
        location: { latitude: 35.8 + ((n * 37) % 101) * 0.0001, longitude: 139.75 }, // 業種が散らばるように位置を散らす
        types: isFood ? ["restaurant"] : ["hair_salon"],
        businessStatus: "OPERATIONAL",
      };
    });
    return { ok: true, status: 200, json: async () => ({ places }) };
  };
  return { fetch, calls };
}

async function withFakePlaces(fn) {
  const fake = fakePlaces();
  const real = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  try { await fn(fake); } finally { globalThis.fetch = real; }
}

const GEO = { center: { lat: 35.818024, lng: 139.75136 }, radius: 2000, town: false, viewport: null };
const JST = (y, m, d, h) => Date.UTC(y, m - 1, d, h - 9); // 日本時間を UTC のミリ秒にする

test("all の1ページ目は20件。飲食店と飲食店以外が混ざる", async () => {
  await withFakePlaces(async () => {
    const clock = { now: JST(2026, 11, 27, 10) };
    const r = await categorySearchPage({ key: "K", cache: fakeCache(clock), geo: GEO, category: "all", page: 1, now: clock.now });
    assert.equal(r.shops.length, 20);
    const labels = new Set(r.shops.map((s) => s.industry));
    assert.ok(labels.has("飲食店"), "飲食店が含まれる");
    assert.ok([...labels].some((l) => l !== "飲食店"), "飲食店以外も含まれる");
    assert.equal(r.hasMore, true);
  });
});

test("飲食店以外（other）でも実用的な件数が出る（10件以上）。飲食店は混ざらない", async () => {
  await withFakePlaces(async () => {
    const clock = { now: JST(2026, 11, 27, 10) };
    const r = await categorySearchPage({ key: "K", cache: fakeCache(clock), geo: GEO, category: "other", page: 1, now: clock.now });
    assert.ok(r.total >= 10, `件数 ${r.total}`);
    assert.ok(r.shops.every((s) => s.industry !== "飲食店"));
  });
});

test("2ページ目は保存された候補から返し、Google を呼ばない（終わりでは hasMore=false）", async () => {
  await withFakePlaces(async (fake) => {
    const clock = { now: JST(2026, 11, 27, 10) };
    const cache = fakeCache(clock);
    const p1 = await categorySearchPage({ key: "K", cache, geo: GEO, category: "food", page: 1, now: clock.now });
    const callsAfterFirst = fake.calls.length;
    assert.equal(callsAfterFirst, INDUSTRIES_OF.food.length); // 業種ごとに1回ずつ
    const p2 = await categorySearchPage({ key: "K", cache, geo: GEO, category: "food", page: 2, now: clock.now });
    assert.equal(fake.calls.length, callsAfterFirst); // 2ページ目では Google を呼ばない
    const ids1 = new Set(p1.shops.map((s) => s.id));
    assert.ok(p2.shops.every((s) => !ids1.has(s.id)), "2ページ目は1ページ目と重ならない");
    assert.equal(p2.hasMore, false); // 飲食店は36件。2ページ目で終わり
  });
});

test("店ごとの types を返す（画面の業種の絞り込みの材料）。Places の項目に types を含める", async () => {
  await withFakePlaces(async (fake) => {
    const clock = { now: JST(2026, 11, 27, 10) };
    const r = await categorySearchPage({ key: "K", cache: fakeCache(clock), geo: GEO, category: "food", page: 1, now: clock.now });
    assert.ok(r.shops.every((s) => Array.isArray(s.types) && s.types.includes("restaurant")));
    assert.match(fake.calls[0].headers["X-Goog-FieldMask"], /places\.types/);
  });
});

test("保存は1日（JST）で切れる。翌日になると、候補を取り直す", async () => {
  await withFakePlaces(async (fake) => {
    const clock = { now: JST(2026, 11, 27, 23) };
    const cache = fakeCache(clock);
    await categorySearchPage({ key: "K", cache, geo: GEO, category: "food", page: 1, now: clock.now });
    const first = fake.calls.length;
    clock.now = JST(2026, 11, 28, 0, 30);
    await categorySearchPage({ key: "K", cache, geo: GEO, category: "food", page: 1, now: clock.now });
    assert.equal(fake.calls.length, first * 2); // 翌日は取り直す
  });
});

test("地域（中心・半径）が変われば、別の保存になる", () => {
  const a = categoryBaseKey(GEO);
  assert.equal(a, categoryBaseKey({ ...GEO }));
  assert.notEqual(a, categoryBaseKey({ ...GEO, radius: 1000 }));
});

test("保存の印（MISS → HIT）が、呼び出し元の記録に残る（応答の X-Cache に出す）", async () => {
  await withFakePlaces(async () => {
    const clock = { now: JST(2026, 11, 27, 10) };
    const cache = fakeCache(clock);
    const h1 = [];
    await categorySearchPage({ key: "K", cache, geo: GEO, category: "food", page: 1, now: clock.now, hits: h1 });
    const h2 = [];
    await categorySearchPage({ key: "K", cache, geo: GEO, category: "food", page: 1, now: clock.now, hits: h2 });
    assert.deepEqual(h1, ["MISS"]);
    assert.deepEqual(h2, ["HIT"]);
  });
});
