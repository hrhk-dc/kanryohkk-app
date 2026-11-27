// lib/search-cache.js のテスト（ネットワークは使わない。Places の代わりに数える関数、Cache API の代わりに Map を使う）
import { test } from "node:test";
import assert from "node:assert/strict";
import { searchCacheKey, cachedSearch, ttlSeconds, MAX_TTL_SECONDS } from "./search-cache.js";

// Cache API と同じ形（match・put）の偽物。Cache-Control の max-age で期限切れになる（本物と同じ）
function fakeCache(clock) {
  const store = new Map(); // key -> { body, expiresAt }
  return {
    store,
    async match(key) {
      const e = store.get(key);
      if (!e || clock.now >= e.expiresAt) return undefined;
      return new Response(e.body);
    },
    async put(key, res) {
      const m = /max-age=(\d+)/.exec(res.headers.get("Cache-Control") || "");
      if (!m) return;
      store.set(key, { body: await res.text(), expiresAt: clock.now + Number(m[1]) * 1000 });
    },
  };
}

const COND = { center: { lat: 35.8, lng: 139.67 }, radius: 1000, town: false, viewport: null, industries: ["カフェ・喫茶", "そば・うどん"] };
const JST = (y, m, d, h, mi = 0) => Date.UTC(y, m - 1, d, h - 9, mi); // 日本時間の時刻を UTC のミリ秒にする

test("同じ条件なら同じ鍵（業種の順番・重複・小数の細かい差を無視）、条件が違えば別の鍵", () => {
  const a = searchCacheKey(COND);
  const b = searchCacheKey({ ...COND, industries: ["そば・うどん", "カフェ・喫茶", "カフェ・喫茶"] });
  const c = searchCacheKey({ ...COND, center: { lat: 35.800001, lng: 139.670001 } });
  const d = searchCacheKey({ ...COND, radius: 2000 });
  assert.equal(a, b);
  assert.equal(a, c);
  assert.notEqual(a, d);
});

test("2回目の同じ検索は Places を呼ばず、同じ結果を返す", async () => {
  const clock = { now: 0 };
  const cache = fakeCache(clock);
  let calls = 0;
  const run = async () => { calls += 1; return { ok: true, shops: [{ id: "A", name: "テスト店" }] }; };
  const now = JST(2026, 11, 27, 10);
  const key = searchCacheKey(COND);
  clock.now = now;
  const first = await cachedSearch({ cache, key, now, run });
  clock.now = now + 60_000;
  const second = await cachedSearch({ cache, key, now: now + 60_000, run });
  assert.equal(calls, 1);
  assert.equal(first.hit, false);
  assert.equal(second.hit, true);
  assert.deepEqual(second.data, first.data); // 既存の結果は変わらない
});

test("日付（日本時間）が変わると、新しく検索する", async () => {
  const clock = { now: 0 };
  const cache = fakeCache(clock);
  let calls = 0;
  const run = async () => { calls += 1; return { ok: true, shops: [] }; };
  const key = searchCacheKey(COND);
  clock.now = JST(2026, 11, 27, 23, 50);
  await cachedSearch({ cache, key, now: clock.now, run });
  clock.now = JST(2026, 11, 28, 0, 10);
  const next = await cachedSearch({ cache, key, now: clock.now, run });
  assert.equal(calls, 2);
  assert.equal(next.hit, false);
});

test("エラーになった検索は保存しない（次の検索でまた Places を呼ぶ）", async () => {
  const clock = { now: 0 };
  const cache = fakeCache(clock);
  let calls = 0;
  const failing = async () => { calls += 1; throw new Error("boom"); };
  const key = searchCacheKey(COND);
  const now = JST(2026, 11, 27, 10);
  clock.now = now;
  await assert.rejects(cachedSearch({ cache, key, now, run: failing }), /boom/);
  assert.equal(cache.store.size, 0);
  const ok = async () => { calls += 1; return { ok: true, shops: [] }; };
  const r = await cachedSearch({ cache, key, now, run: ok });
  assert.equal(calls, 2);
  assert.equal(r.hit, false);
});

test("有効期限は日本時間の0時まで、上限は30日", () => {
  assert.equal(ttlSeconds(JST(2026, 11, 27, 0, 0)), 24 * 3600); // 0時ちょうどなら、次の0時まで24時間
  assert.equal(ttlSeconds(JST(2026, 11, 27, 23, 0)), 3600);
  assert.ok(ttlSeconds(JST(2026, 11, 27, 9, 0)) <= MAX_TTL_SECONDS);
  assert.equal(MAX_TTL_SECONDS, 30 * 24 * 3600);
});

test("cache が無い環境（ローカル）でも、検索は普通に行う", async () => {
  let calls = 0;
  const run = async () => { calls += 1; return { ok: true, shops: [] }; };
  const r = await cachedSearch({ cache: null, key: "k", run });
  assert.equal(calls, 1);
  assert.equal(r.hit, false);
});
