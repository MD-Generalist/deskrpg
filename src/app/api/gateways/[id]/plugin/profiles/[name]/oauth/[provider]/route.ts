import { NextRequest, NextResponse } from "next/server";

import { validateAuthSegment } from "@/lib/hermes/provider-auth-validation";
import { proxyFailure, resolveProfileRoute } from "@/lib/hermes/profile-route";

/**
 * 프로필의 OAuth 연결 해제(저장된 토큰 삭제).
 *
 * 소유자 전용(docs/security.md 44행). 순서: 세그먼트 검증 → 해석(소유자) → 플러그인 호출.
 */
type Ctx = { params: Promise<{ id: string; name: string; provider: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  if (!validateAuthSegment(params.provider)) {
    return NextResponse.json({ errorCode: "bad_request" }, { status: 400 });
  }
  const r = await resolveProfileRoute(req, params, { requireOwner: true });
  if ("error" in r) return r.error;
  const res = await r.client.disconnectOAuth(r.name, r.profileToken, params.provider);
  if (!res.ok) return proxyFailure(res);
  return NextResponse.json(res.data);
}
