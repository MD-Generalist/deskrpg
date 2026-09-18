import { NextRequest, NextResponse } from "next/server";

import { db, hermesProfiles } from "@/db";
import { eq } from "drizzle-orm";
import { decryptGatewayToken, getAccessibleGatewayResource } from "@/lib/gateway-resources";
import { createPluginClient, type PluginClient } from "@/lib/hermes/plugin-client";
import { selectProfileToken, type ProfileTokenResult } from "@/lib/hermes/plugin-profile-access";
import { proxyFailureBody } from "@/lib/hermes/profile-proxy";
import type { PluginFailure } from "@/lib/hermes/plugin-errors";
import { getUserId } from "@/lib/internal-rpc";
import { ERROR_CODE_HEADER } from "@/lib/i18n/error-codes";

/**
 * `/api/gateways/[id]/plugin/profiles/[name]/*` 프록시 라우트가 공통으로 반복하던
 * 인증/토큰 해석을 한 곳으로 모은다(catalog·toolsets·skills 가 그대로 복제하고
 * 있었다). `requireOwner` 는 이번 배치에서 옮기는 자격 증명 라우트(키 PUT/DELETE,
 * OAuth start/poll/cancel/disconnect)를 위한 옵션이다 — 카탈로그류는 읽기 전용이라
 * 게이트웨이 접근 권한이면 충분해 여전히 기본값(false)을 쓴다.
 *
 * 판정 순서는 `decideProfileRouteAccess` 가 결정한다 — 401 → 게이트웨이 접근(404
 * not_found) → 소유자(403 forbidden) → 프로필 토큰(404 no_profile). 소유자 거절이
 * 프로필 토큰 조회보다 먼저이므로, 호출부는 토큰을 판정 전에 미리 구하지 않는다.
 */

export type ProfileRouteCtx = { params: Promise<{ id: string; name: string }> };

export type ResolvedProfileRoute = {
  client: PluginClient;
  name: string;
  profileToken: string;
  isOwner: boolean;
};

export type ProfileRouteDecision = { status: number; errorCode: string } | null;

/**
 * DB 접근 없이 판정 순서만 고정하는 순수 함수. 라우트별 시나리오(로그인 없음 /
 * 게이트웨이 접근 없음 / 소유자 필요인데 공유 사용자 / 프로필 미등록 / 통과)를
 * DB 없이 테스트하기 위해 분리했다.
 */
export function decideProfileRouteAccess(input: {
  userId: string | null;
  accessible: { isOwner: boolean } | null;
  requireOwner: boolean;
  token: ProfileTokenResult;
}): ProfileRouteDecision {
  if (!input.userId) return { status: 401, errorCode: "unauthorized" };
  if (!input.accessible) return { status: 404, errorCode: "not_found" };
  if (input.requireOwner && !input.accessible.isOwner) {
    return { status: 403, errorCode: "forbidden" };
  }
  if (!input.token.ok) return { status: 404, errorCode: input.token.reason };
  return null;
}

export async function resolveProfileRoute(
  req: NextRequest,
  params: { id: string; name: string },
  options?: { requireOwner?: boolean },
): Promise<ResolvedProfileRoute | { error: NextResponse }> {
  const requireOwner = options?.requireOwner ?? false;
  const userId = getUserId(req);
  const { id, name } = params;

  const accessible = userId ? await getAccessibleGatewayResource(userId, id) : null;

  // 소유자 거절이 프로필 토큰 조회보다 먼저다. 토큰을 아직 구하지 않았으므로,
  // 최종 판정과 같은 함수로 "아직 조회 전"을 뜻하는 실패 토큰을 넣어 먼저 검사한다
  // — 401·not_found·forbidden 중 하나가 나오면 토큰을 구할 필요조차 없다.
  const notFetchedYet: ProfileTokenResult = { ok: false, reason: "no_profile" };
  const preDecision = decideProfileRouteAccess({
    userId,
    accessible: accessible ? { isOwner: accessible.isOwner } : null,
    requireOwner,
    token: notFetchedYet,
  });
  if (preDecision && preDecision.errorCode !== "no_profile") {
    return {
      error: NextResponse.json(
        { errorCode: preDecision.errorCode },
        { status: preDecision.status },
      ),
    };
  }
  // 여기까지 왔다는 것은 userId·accessible·owner 검사를 모두 통과했다는 뜻이다
  // (그렇지 않으면 preDecision 이 401/404 not_found/403 중 하나였을 것이다).
  // accessible 은 이제 확실히 non-null 이다.
  const gatewayAccess = accessible!;

  const rows = await db
    .select({
      profileName: hermesProfiles.profileName,
      tokenEncrypted: hermesProfiles.tokenEncrypted,
    })
    .from(hermesProfiles)
    .where(eq(hermesProfiles.gatewayId, id));

  const token = selectProfileToken({ rows, profileName: name, decrypt: decryptGatewayToken });
  if (!token.ok) {
    return { error: NextResponse.json({ errorCode: token.reason }, { status: 404 }) };
  }

  const client = createPluginClient({
    baseUrl: gatewayAccess.resource.baseUrl,
    defaultToken: decryptGatewayToken(gatewayAccess.resource.tokenEncrypted),
  });
  return { client, name, profileToken: token.profileToken, isOwner: gatewayAccess.isOwner };
}

/**
 * `proxyFailureBody` + `ERROR_CODE_HEADER` 로 실패를 HTTP 200 관례로 옮긴다.
 *
 * catalog 라우트는 0.9.0 이전부터 있어 404 가 "라우트 없음"일 수 없으므로, 구버전
 * 판정(`isMissingPluginRoute` 업그레이드 승격)을 적용하면 안 된다. 그런 라우트는
 * `upgradeOnMissingRoute: false` 로 기존 본문 모양을 유지한다(기본값은 true).
 */
export function proxyFailure(
  res: { status: number; failure: PluginFailure },
  options?: { upgradeOnMissingRoute?: boolean },
): NextResponse {
  const upgradeOnMissingRoute = options?.upgradeOnMissingRoute ?? true;
  if (!upgradeOnMissingRoute) {
    return NextResponse.json(
      { errorCode: res.failure.code, error: res.failure.message, upstreamStatus: res.status },
      { status: 200, headers: { [ERROR_CODE_HEADER]: res.failure.code } },
    );
  }
  const failed = proxyFailureBody(res);
  return NextResponse.json(failed.body, {
    status: 200,
    headers: { [ERROR_CODE_HEADER]: failed.errorCode },
  });
}
