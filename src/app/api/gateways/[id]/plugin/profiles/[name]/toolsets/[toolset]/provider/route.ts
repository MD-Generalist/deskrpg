import { NextRequest, NextResponse } from "next/server";

import {
  validateAuthSegment,
  validateToolProviderBody,
} from "@/lib/hermes/provider-auth-validation";
import { proxyFailure, resolveProfileRoute } from "@/lib/hermes/profile-route";

/**
 * 도구 프로바이더 선택 + 그 행의 API 키 저장(플러그인 0.10.0).
 *
 * 키 값은 이 라우트를 통과만 한다 — 본문을 로깅하지 않고 실패 응답에 싣지 않는다. 게이트웨이
 * 자격이라 소유자 전용이다(docs/security.md 권한표, 프로바이더 키 PUT 과 같다).
 * 순서: 세그먼트 검증 → 해석(소유자) → 본문 검증 → 플러그인 호출.
 */
type Ctx = { params: Promise<{ id: string; name: string; toolset: string }> };

function badRequest() {
  return NextResponse.json({ errorCode: "bad_request" }, { status: 400 });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  if (!validateAuthSegment(params.toolset)) return badRequest();
  const r = await resolveProfileRoute(req, params, { requireOwner: true });
  if ("error" in r) return r.error;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest();
  }
  const checked = validateToolProviderBody(body);
  if (!checked.ok) return NextResponse.json({ errorCode: checked.errorCode }, { status: 400 });
  const res = await r.client.putToolProvider(r.name, r.profileToken, params.toolset, {
    provider: checked.provider,
    env: checked.env,
  });
  if (!res.ok) return proxyFailure(res);
  return NextResponse.json(res.data);
}
