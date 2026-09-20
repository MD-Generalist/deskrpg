import assert from "node:assert/strict";
import test from "node:test";

import { formatRequester, parseRequester } from "./approval-requester";

test("직원이 요청하면 프로필 이름 그대로다", () => {
  assert.equal(formatRequester({ kind: "profile", profileName: "sophie" }), "sophie");
});

test("사람이 요청하면 user: 접두가 붙는다", () => {
  assert.equal(
    formatRequester({ kind: "user", userId: "7e0a0f1c-1111-4222-8333-444455556666" }),
    "user:7e0a0f1c-1111-4222-8333-444455556666",
  );
});

test("접두는 프로필 이름과 섞이지 않는다 — 프로필 이름에는 콜론이 못 들어간다", () => {
  // `^[a-z0-9][a-z0-9_-]{0,63}$` (host.ts:132). 그래서 `user:` 는 모호하지 않다.
  assert.deepEqual(parseRequester("sophie"), { kind: "profile", profileName: "sophie" });
  assert.deepEqual(parseRequester("user:abc"), { kind: "user", userId: "abc" });
});

test("되읽기가 왕복한다", () => {
  for (const r of [
    { kind: "profile", profileName: "noah" } as const,
    { kind: "user", userId: "u-1" } as const,
  ])
    assert.deepEqual(parseRequester(formatRequester(r)), r);
});

test("user: 뒤가 비어 있으면 프로필로 읽지 않는다 — 깨진 값을 사람으로 둔다", () => {
  assert.deepEqual(parseRequester("user:"), { kind: "user", userId: "" });
});

test("varchar(64) 에 들어간다", () => {
  const longest = formatRequester({ kind: "user", userId: "7e0a0f1c-1111-4222-8333-444455556666" });
  assert.ok(longest.length <= 64, `${longest.length}자`);
});
