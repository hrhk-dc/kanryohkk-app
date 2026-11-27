// 古い形式（33業種の名前）の検索条件・保存データが混ざっても、検索が壊れないことを確かめる（ネットワークは使わない）
import { test } from "node:test";
import assert from "node:assert/strict";
import { searchAll, industryQuery } from "./vla-core.js";

// fetch を差し替えて、送られた検索語を記録する（Places の代わり）
async function withFetch(fn) {
  const bodies = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ places: [] }) };
  };
  try { await fn(); } finally { globalThis.fetch = real; }
  return bodies;
}

const CENTER = { lat: 35.8, lng: 139.67 };

test("古い業種の名前（33業種）のまま検索しても、例外にならず、業種ごとに検索する", async () => {
  const old = ["寿司・割烹", "美容室（ヘア）", "汎用（例：クリーニング）", "学習塾（個別指導・小中高）"];
  const bodies = await withFetch(() => searchAll("KEY", { center: CENTER, radius: 1000, town: false, viewport: null, industries: old }));
  assert.equal(bodies.length, old.length);
  // 検索語は、業種の名前から作られる（括弧などを外した形）
  assert.equal(industryQuery("汎用（例：クリーニング）"), "クリーニング");
  assert.ok(bodies.every((b) => typeof b.textQuery === "string" && b.textQuery.length > 0));
});

test("保存データに知らない業種名が混ざっていても、検索は止まらない（検索は2回とも行われる）", async () => {
  const bodies = await withFetch(() => searchAll("KEY", { center: CENTER, radius: 1000, town: false, viewport: null, industries: ["もう無い業種", ""] }));
  assert.equal(bodies.length, 2);
});
