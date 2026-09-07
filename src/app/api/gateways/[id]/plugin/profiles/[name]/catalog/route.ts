import { NextRequest, NextResponse } from "next/server";

import { db, hermesProfiles } from "@/db";
import { eq } from "drizzle-orm";
import { decryptGatewayToken, getAccessibleGatewayResource } from "@/lib/gateway-resources";
import { createPluginClient } from "@/lib/hermes/plugin-client";
import { selectProfileToken } from "@/lib/hermes/plugin-profile-access";
import { getUserId } from "@/lib/internal-rpc";
import { ERROR_CODE_HEADER } from "@/lib/i18n/error-codes";


/**
 * 모델·프로바이더·추론 강도 목록을 중계한다. 읽기 전용이라 게이트웨이 접근 권한이면
 * 충분하다(생성·삭제와 달리 system_admin 을 요구하지 않는다).
 *
 * 목록을 캐시하지 않는다. 플러그인 뒤의 Hermes 가 models.dev 를 20분 TTL 로 캐시하고
 * 있으므로, 여기서 또 캐시하면 그 갱신 주기가 두 배로 늘어난다 — "매번 최신"이라는
 * 요구를 우리가 깨는 셈이다.
 *
 * `resolve` 는 config·identity 라우트와 같은 형태를 그대로 복제한다 — 각 라우트가
 * 독립적으로 읽히는 편이 낫다(기존 판단을 따른다).
 */
const proxyInit = (errorCode: string) => ({
  status: 200,
  headers: { [ERROR_CODE_HEADER]: errorCode },
});

type Ctx = { params: Promise<{ id: string; name: string }> };

async function resolve(req: NextRequest, ctx: Ctx) {
  const userId = getUserId(req);
  if (!userId) return { error: NextResponse.json({ errorCode: "unauthorized" }, { status: 401 }) };
  const { id, name } = await ctx.params;

  const accessible = await getAccessibleGatewayResource(userId, id);
  if (!accessible) return { error: NextResponse.json({ errorCode: "not_found" }, { status: 404 }) };

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
    baseUrl: accessible.resource.baseUrl,
    defaultToken: decryptGatewayToken(accessible.resource.tokenEncrypted),
  });
  return { client, name, profileToken: token.profileToken };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const r = await resolve(req, ctx);
  if ("error" in r) return r.error;
  const res = await r.client.getCatalog(r.name, r.profileToken);
  if (!res.ok) {
    return NextResponse.json(
      {
        errorCode: res.failure.code,
        error: res.failure.message,
        upstreamStatus: res.status,
      },
      proxyInit(res.failure.code),
    );
  }
  return NextResponse.json(res.data);
}
