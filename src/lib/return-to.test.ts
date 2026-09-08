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

test("탭 문자가 섞인 값은 폴백으로 떨어진다", () => {
  // 브라우저의 URL 파서는 탭·개행을 URL 에서 **제거한다**. `/\t/evil.com` 은
  // 첫 글자가 `/` 이고 `//` 도 아니라 옛 검사를 통과했지만, 렌더된 href 를
  // 브라우저는 `//evil.com` 으로 읽어 다른 오리진으로 나갔다.
  assert.equal(safeReturnTo("/\t/evil.com"), "/channels");
  assert.equal(safeReturnTo("/" + String.fromCharCode(9) + "/evil.com"), "/channels");
});

test("오리진 검사를 더해도 평범한 경로는 그대로 통과한다", () => {
  // 벨트-앤-브레이스로 넣은 `new URL(value, "http://x")` 검사가 정상 경로를
  // 막으면 안 된다 — 쿼리·해시·인코딩된 문자가 다 살아 있어야 한다.
  assert.equal(
    safeReturnTo("/gateways?new=1&returnTo=%2Fgame"),
    "/gateways?new=1&returnTo=%2Fgame",
  );
  assert.equal(safeReturnTo("/game#top"), "/game#top");
});
