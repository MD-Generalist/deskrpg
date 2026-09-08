import assert from "node:assert/strict";
import test from "node:test";

import { safeReturnTo } from "./return-to";

test("같은 오리진의 경로는 그대로 통과한다", () => {
  assert.equal(safeReturnTo("/game?channelId=1"), "/game?channelId=1");
});

test("절대 URL 은 폴백으로 떨어진다", () => {
  assert.equal(safeReturnTo("https://evil.com"), "/channels");
});

test("프로토콜 상대 URL 은 폴백으로 떨어진다", () => {
  // `//evil.com` 은 `/` 로 시작하지만 브라우저는 https://evil.com 으로 나간다.
  assert.equal(safeReturnTo("//evil.com"), "/channels");
  assert.equal(safeReturnTo("/\\evil.com"), "/channels");
});

test("빈 값은 폴백으로 떨어지고, 폴백은 바꿀 수 있다", () => {
  assert.equal(safeReturnTo(null), "/channels");
  assert.equal(safeReturnTo(undefined), "/channels");
  assert.equal(safeReturnTo(""), "/channels");
  assert.equal(safeReturnTo(null, "/"), "/");
});

test("개행이 섞인 값은 폴백으로 떨어진다", () => {
  assert.equal(safeReturnTo("/game\r\nSet-Cookie: a=b"), "/channels");
});
