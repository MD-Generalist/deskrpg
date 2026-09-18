import { NextRequest, NextResponse } from "next/server";

import { validateAuthSegment } from "@/lib/hermes/provider-auth-validation";
import { proxyFailure, resolveProfileRoute } from "@/lib/hermes/profile-route";

/**
 * 진행 중인 OAuth 디바이스 로그인 취소. 정적 `sessions` 세그먼트라 형제
 * `oauth/[provider]` 보다 먼저 매칭된다.
 *
 * 소유자 전용(docs/security.md 44행). 순서: 세그먼트 검증 → 해석(소유자) → 플러그인 호출.
 */
type Ctx = { params: Promise<{ id: string; name: string; sessionId: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  if (!validateAuthSegment(params.sessionId)) {
    return NextResponse.json({ errorCode: "bad_request" }, { status: 400 });
  }
  const r = await resolveProfileRoute(req, params, { requireOwner: true });
  if ("error" in r) return r.error;
  const res = await r.client.cancelOAuth(r.name, r.profileToken, params.sessionId);
  if (!res.ok) return proxyFailure(res);
  return NextResponse.json(res.data);
}
