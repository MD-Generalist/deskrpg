import { NextRequest, NextResponse } from "next/server";

import {
  proxyFailure,
  resolveProfileRoute,
  type ProfileRouteCtx,
} from "@/lib/hermes/profile-route";

/**
 * 스킬 목록을 중계한다. 읽기 전용이라 게이트웨이 접근 권한이면 충분하다.
 * 목록을 캐시하지 않는다 — 키 설정 여부는 사용자가 방금 바꿨을 수 있다.
 *
 * 해석기는 `resolveProfileRoute`(`@/lib/hermes/profile-route`)로 옮겼다.
 */
export async function GET(req: NextRequest, ctx: ProfileRouteCtx) {
  const r = await resolveProfileRoute(req, await ctx.params);
  if ("error" in r) return r.error;
  const res = await r.client.getSkills(r.name, r.profileToken);
  if (!res.ok) return proxyFailure(res);
  return NextResponse.json(res.data);
}
