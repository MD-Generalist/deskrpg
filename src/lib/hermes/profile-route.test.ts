import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideProfileRouteAccess } from "./profile-route";

const ok = { ok: true as const, profileToken: "pt" };
describe("프로필 라우트 접근 판정", () => {
  it("로그인 없음 → 401", () => {
    assert.deepEqual(
      decideProfileRouteAccess({ userId: null, accessible: null, requireOwner: false, token: ok }),
      { status: 401, errorCode: "unauthorized" },
    );
  });
  it("게이트웨이 접근 없음 → 404", () => {
    assert.deepEqual(
      decideProfileRouteAccess({ userId: "u", accessible: null, requireOwner: false, token: ok }),
      { status: 404, errorCode: "not_found" },
    );
  });
  it("소유자 필요인데 공유 사용자 → 403 (프로필 토큰보다 먼저)", () => {
    assert.deepEqual(
      decideProfileRouteAccess({
        userId: "u",
        accessible: { isOwner: false },
        requireOwner: true,
        token: { ok: false, reason: "no_profile" },
      }),
      { status: 403, errorCode: "forbidden" },
    );
  });
  it("프로필 토큰 없음 → 404 no_profile", () => {
    assert.deepEqual(
      decideProfileRouteAccess({
        userId: "u",
        accessible: { isOwner: true },
        requireOwner: true,
        token: { ok: false, reason: "no_profile" },
      }),
      { status: 404, errorCode: "no_profile" },
    );
  });
  it("통과", () => {
    assert.equal(
      decideProfileRouteAccess({
        userId: "u",
        accessible: { isOwner: false },
        requireOwner: false,
        token: ok,
      }),
      null,
    );
  });
});
