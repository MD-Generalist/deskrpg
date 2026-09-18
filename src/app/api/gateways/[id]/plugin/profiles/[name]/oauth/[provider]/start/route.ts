import { NextRequest, NextResponse } from "next/server";

import { validateAuthSegment } from "@/lib/hermes/provider-auth-validation";
import { proxyFailure, resolveProfileRoute } from "@/lib/hermes/profile-route";

/**
 * 프로필의 OAuth 디바이스 로그인 시작. 본문 없음.
 *
 * 토큰·계정 정보는 이 라우트를 통과만 한다 — 로깅하지 않는다. 소유자 전용
 * (docs/security.md 44행). 순서: 세그먼트 검증 → 해석(소유자) → 플러그인 호출.
 */
type Ctx = { params: Promise<{ id: string; name: string; provider: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  if (!validateAuthSegment(params.provider)) {
    return NextResponse.json({ errorCode: "bad_request" }, { status: 400 });
  }
  const r = await resolveProfileRoute(req, params, { requireOwner: true });
  if ("error" in r) return r.error;
  const res = await r.client.startOAuth(r.name, r.profileToken, params.provider);
  if (!res.ok) return proxyFailure(res);
  return NextResponse.json(res.data);
}
