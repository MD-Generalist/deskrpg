import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

/**
 * 비밀번호 변경 API 를 `/api/auth/` 아래에 두면 프록시가 공개 경로로 보고 `x-user-id` 를
 * 넣지 않는다 — 라우트는 로그인한 사용자에게도 401 을 돌려준다(2026-09-20 실측).
 * 그래서 `/api/account/` 아래에 있고, 이 테스트가 그 자리를 고정한다.
 */
test("비밀번호 변경 API 는 공개 경로가 아니라 로그인 검사를 거친다", async () => {
  const response = await proxy(
    new NextRequest("https://deskrpg.com/api/account/password", { method: "POST" }),
  );

  // 토큰이 없으니 통과시키지 않는다 — 공개 경로였다면 x-middleware-next 가 붙는다.
  assert.equal(response.headers.get("x-middleware-next"), null);
});
