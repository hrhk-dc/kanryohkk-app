// 店の詳細（Place Details）まわりのテスト（ネットワークは使わない。fetch を差し替えて、呼ばれた URL を数える）
import { test } from "node:test";
import assert from "node:assert/strict";
import { searchAll } from "./vla-core.js";
import { cachedSearch, placeCacheKey } from "./search-cache.js";

// Cache API の偽物（期限は max-age で切れる。本物と同じ）
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

// fetch を差し替えて、呼ばれた URL を記録する
async function withFetchLog(fn) {
  const urls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ places: [] }) };
  };
  try { await fn(); } finally { globalThis.fetch = real; }
  return urls;
}

const CENTER = { lat: 35.8, lng: 139.67 };

test("候補の一覧を作るときは、店の詳細（Place Details）を全店分は取らない（検索の1回だけ）", async () => {
  const urls = await withFetchLog(() =>
    searchAll("KEY", { center: CENTER, radius: 1000, town: false, viewport: null, industries: ["カフェ・喫茶", "そば・うどん"] })
  );
  assert.ok(urls.length > 0);
  // 店の詳細は「/v1/places/<店のID>」。検索（:searchText）だけのはず
  for (const u of urls) {
    assert.match(u, /:searchText$/, `詳細の呼び出しが混ざっている: ${u}`);
  }
});

test("同じ店の詳細は、その日のあいだ取り直さない（2回目は使い回す）", async () => {
  const clock = { now: 0 };
  const cache = fakeCache(clock);
  let calls = 0;
  const run = async () => { calls += 1; return { name: "テスト店", address: "東京都テスト区" }; };
  const key = placeCacheKey("id", "ChIJtest");
  clock.now = Date.UTC(2026, 10, 27, 1); // 日本時間 10:00
  const a = await cachedSearch({ cache, key, now: clock.now, run });
  clock.now += 3600_000;
  const b = await cachedSearch({ cache, key, now: clock.now, run });
  assert.equal(calls, 1);
  assert.equal(b.hit, true);
  assert.deepEqual(b.data, a.data); // 既存の表示の中身は変わらない
});

test("店の詳細の鍵は、店ごと・種類ごとに分かれる。エラーになった詳細は保存しない", async () => {
  assert.notEqual(placeCacheKey("id", "A"), placeCacheKey("id", "B"));
  assert.notEqual(placeCacheKey("id", "A"), placeCacheKey("q", "A"));
  const clock = { now: Date.UTC(2026, 10, 27, 1) };
  const cache = fakeCache(clock);
  const key = placeCacheKey("id", "ChIJerr");
  await assert.rejects(cachedSearch({ cache, key, now: clock.now, run: async () => { throw new Error("503"); } }), /503/);
  let calls = 0;
  await cachedSearch({ cache, key, now: clock.now, run: async () => { calls += 1; return {}; } });
  assert.equal(calls, 1);
});
