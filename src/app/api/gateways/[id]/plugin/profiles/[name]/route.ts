import { NextRequest, NextResponse } from "next/server";

import { db, users } from "@/db";
import { eq } from "drizzle-orm";
import { decryptGatewayToken, getAccessibleGatewayResource } from "@/lib/gateway-resources";
import { createPluginClient } from "@/lib/hermes/plugin-client";
import { getUserId } from "@/lib/internal-rpc";
import { ERROR_CODE_HEADER } from "@/lib/i18n/error-codes";

/**
 * 프로필 삭제는 게이트웨이 전체를 다루는 default 키를 쓰므로 `system_admin` 전용이다.
 *
 * 플러그인이 `409 profile_has_service` 로 거절할 수 있다 — 그 프로필이 자기 systemd
 * 유닛을 가진 경우다. 그때 응답의 셸 명령을 **그대로** 화면에 옮긴다. 우리가
 * 대신 지우면 고아 유닛이 남고, Hermes 의 delete_profile 에 맡기면 게이트웨이가 죽는다.
 */
const proxyInit = (errorCode: string) => ({
  status: 200,
  headers: { [ERROR_CODE_HEADER]: errorCode },
});

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; name: string }> },
) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ errorCode: "unauthorized" }, { status: 401 });
  }
  const [row] = await db
    .select({ systemRole: users.systemRole })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (row?.systemRole !== "system_admin") {
    return NextResponse.json({ errorCode: "forbidden" }, { status: 403 });
  }

  const { id, name } = await ctx.params;
  const accessible = await getAccessibleGatewayResource(userId, id);
  if (!accessible) {
    return NextResponse.json({ errorCode: "not_found" }, { status: 404 });
  }

  const client = createPluginClient({
    baseUrl: accessible.resource.baseUrl,
    defaultToken: decryptGatewayToken(accessible.resource.tokenEncrypted),
  });
  const res = await client.deleteProfile(name);
  if (!res.ok) {
    return NextResponse.json(
      {
        errorCode: res.failure.code,
        error: res.failure.message,
        shellCommand: res.failure.showsShellCommand,
      },
      proxyInit(res.failure.code),
    );
  }
  return NextResponse.json(res.data);
}
