import { NextRequest, NextResponse } from "next/server";

import { validateAuthSegment } from "@/lib/hermes/provider-auth-validation";
import { proxyFailure, resolveProfileRoute } from "@/lib/hermes/profile-route";

/**
 * 도구 프로바이더 행(플러그인 0.10.0)을 중계한다. 읽기 전용이라 게이트웨이 접근 권한이면
 * 충분하다 — 키 값은 오지 않고 설정 여부만 온다. 캐시하지 않는다(방금 키를 넣었을 수 있다).
 */
type Ctx = { params: Promise<{ id: string; name: string; toolset: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  if (!validateAuthSegment(params.toolset)) {
    return NextResponse.json({ errorCode: "bad_request" }, { status: 400 });
  }
  const r = await resolveProfileRoute(req, params);
  if ("error" in r) return r.error;
  const res = await r.client.getToolProviders(r.name, r.profileToken, params.toolset);
  if (!res.ok) return proxyFailure(res);
  return NextResponse.json(res.data);
}
