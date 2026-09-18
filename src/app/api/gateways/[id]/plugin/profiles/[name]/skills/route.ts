import { NextRequest, NextResponse } from "next/server";

import { db, hermesProfiles } from "@/db";
import { eq } from "drizzle-orm";
import { decryptGatewayToken, getAccessibleGatewayResource } from "@/lib/gateway-resources";
import { createPluginClient } from "@/lib/hermes/plugin-client";
import { selectProfileToken } from "@/lib/hermes/plugin-profile-access";
import { proxyFailureBody } from "@/lib/hermes/profile-proxy";
import { getUserId } from "@/lib/internal-rpc";
import { ERROR_CODE_HEADER } from "@/lib/i18n/error-codes";

/**
 * 스킬 목록을 중계한다. 읽기 전용이라 게이트웨이 접근 권한이면 충분하다.
 * 목록을 캐시하지 않는다 — 키 설정 여부는 사용자가 방금 바꿨을 수 있다.
 *
 * `resolve` 는 `catalog/route.ts` 를 그대로 복제한다 — 각 라우트가 독립적으로
 * 읽히는 편이 낫다(기존 판단을 따른다).
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
  const res = await r.client.getSkills(r.name, r.profileToken);
  if (!res.ok) {
    const failed = proxyFailureBody(res);
    return NextResponse.json(failed.body, proxyInit(failed.errorCode));
  }
  return NextResponse.json(res.data);
}
