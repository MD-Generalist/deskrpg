import { NextRequest, NextResponse } from "next/server";

import {
  proxyFailure,
  resolveProfileRoute,
  type ProfileRouteCtx,
} from "@/lib/hermes/profile-route";

/**
 * 모델·프로바이더·추론 강도 목록을 중계한다. 읽기 전용이라 게이트웨이 접근 권한이면
 * 충분하다(생성·삭제와 달리 system_admin 을 요구하지 않는다).
 *
 * 목록을 캐시하지 않는다. 플러그인 뒤의 Hermes 가 models.dev 를 20분 TTL 로 캐시하고
 * 있으므로, 여기서 또 캐시하면 그 갱신 주기가 두 배로 늘어난다 — "매번 최신"이라는
 * 요구를 우리가 깨는 셈이다.
 *
 * 해석기는 `resolveProfileRoute`(`@/lib/hermes/profile-route`)로 옮겼다 — 이 라우트는
 * 0.9.0 이전부터 있어 404 가 "라우트 없음"일 수 없으므로, 실패 본문은
 * `upgradeOnMissingRoute: false` 로 기존 모양(구버전 판정 없음)을 그대로 유지한다.
 * config·identity 라우트는 이번에 옮기지 않는다.
 */
export async function GET(req: NextRequest, ctx: ProfileRouteCtx) {
  const r = await resolveProfileRoute(req, await ctx.params);
  if ("error" in r) return r.error;
  const res = await r.client.getCatalog(r.name, r.profileToken);
  if (!res.ok) return proxyFailure(res, { upgradeOnMissingRoute: false });
  return NextResponse.json(res.data);
}
