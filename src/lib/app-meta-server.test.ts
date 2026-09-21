import assert from "node:assert/strict";
import test from "node:test";

import { createAppMetaCache } from "./app-meta-server";

const REPO = "https://api.github.com/repos/dandacompany/deskrpg";

function fakeFetch(responses: Record<string, unknown>) {
  const calls: string[] = [];
  const fetchJson = async (url: string) => {
    calls.push(url);
    const r = responses[url];
    if (r instanceof Error) throw r;
    return r;
  };
  return { fetchJson, calls };
}

test("Star 수와 최신 릴리스 태그를 돌려주고 TTL 안에서는 다시 묻지 않는다", async () => {
  let now = 0;
  const { fetchJson, calls } = fakeFetch({
    [REPO]: { stargazers_count: 1234 },
    [`${REPO}/releases/latest`]: { tag_name: "2026.922.0" },
  });
  const cache = createAppMetaCache({ fetchJson, now: () => now, ttlMs: 1000, failureTtlMs: 100 });
  const first = await cache.get();
  assert.equal(first.stars, 1234);
  assert.equal(first.latestVersion, "2026.922.0");
  await cache.get();
  assert.equal(calls.length, 2);
  now = 1001;
  await cache.get();
  assert.equal(calls.length, 4);
});

test("한쪽 호출이 실패해도 다른 쪽 값은 남고, 실패는 짧게 캐시한다", async () => {
  let now = 0;
  const { fetchJson, calls } = fakeFetch({
    [REPO]: new Error("rate limited"),
    [`${REPO}/releases/latest`]: { tag_name: "v2026.922.0" },
  });
  const cache = createAppMetaCache({ fetchJson, now: () => now, ttlMs: 1000, failureTtlMs: 100 });
  const meta = await cache.get();
  assert.equal(meta.stars, null);
  assert.equal(meta.latestVersion, "2026.922.0");
  now = 101;
  await cache.get();
  assert.equal(calls.length, 4);
});

test("형식이 맞지 않는 응답은 null 로 본다", async () => {
  const { fetchJson } = fakeFetch({
    [REPO]: { stargazers_count: "many" },
    [`${REPO}/releases/latest`]: {},
  });
  const meta = await createAppMetaCache({ fetchJson, now: () => 0 }).get();
  assert.deepEqual([meta.stars, meta.latestVersion], [null, null]);
});
