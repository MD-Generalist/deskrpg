import { NextRequest, NextResponse } from "next/server";

import { validateAuthSegment, validateKeyBody } from "@/lib/hermes/provider-auth-validation";
import { proxyFailure, resolveProfileRoute } from "@/lib/hermes/profile-route";

/**
 * 프로필의 프로바이더 API 키 저장(PUT)·삭제(DELETE).
 *
 * 키 값은 이 라우트를 통과만 한다 — 본문을 로깅하지 않고, 실패 응답에 요청 본문을
 * 섞지 않는다. 소유자 전용(docs/security.md 44행 — 게이트웨이 자격은 소유자만).
 * 순서: 세그먼트 검증 → 해석(소유자) → 본문 검증 → 플러그인 호출.
 */
type Ctx = { params: Promise<{ id: string; name: string; provider: string }> };

function badRequest() {
  return NextResponse.json({ errorCode: "bad_request" }, { status: 400 });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  if (!validateAuthSegment(params.provider)) return badRequest();
  const r = await resolveProfileRoute(req, params, { requireOwner: true });
  if ("error" in r) return r.error;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest();
  }
  const checked = validateKeyBody(body);
  if (!checked.ok) return NextResponse.json({ errorCode: checked.errorCode }, { status: 400 });
  const res = await r.client.putProviderKey(r.name, r.profileToken, params.provider, checked.value);
  if (!res.ok) return proxyFailure(res);
  return NextResponse.json(res.data);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  if (!validateAuthSegment(params.provider)) return badRequest();
  const r = await resolveProfileRoute(req, params, { requireOwner: true });
  if ("error" in r) return r.error;
  const res = await r.client.deleteProviderKey(r.name, r.profileToken, params.provider);
  if (!res.ok) return proxyFailure(res);
  return NextResponse.json(res.data);
}
