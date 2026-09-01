import { NextRequest, NextResponse } from "next/server";

import { db, hermesProfiles, users } from "@/db";
import { and, eq } from "drizzle-orm";
import { decryptGatewayToken, getAccessibleGatewayResource } from "@/lib/gateway-resources";
import { createPluginClient } from "@/lib/hermes/plugin-client";
import { isValidProfileName } from "@/lib/hermes/profile-name";
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

  // M-1: 이름을 검증 없이 원격 경로에 끼우면 encodeURIComponent 가 "." 을 이스케이프하지
  // 않아 name==".." 일 때 URL 정규화로 프로필 스코프가 조용히 사라진다(profile-name.ts
  // 의 경고 그대로). 삭제 대상은 *기존* 프로필이라 관대한 isValidProfileName 을 쓴다 —
  // 새 이름 문법(isCreatableProfileName)을 쓰면 과거에 만들어진 대문자·마침표 이름의
  // 프로필을 지울 수 없게 된다.
  if (!isValidProfileName(name)) {
    return NextResponse.json({ errorCode: "invalid_profile_name" }, { status: 400 });
  }

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
        upstreamStatus: res.status,
      },
      proxyInit(res.failure.code),
    );
  }

  // M-4: 원격 삭제가 성공했는데 로컬 등록 행을 남겨두면 게이트웨이에는 없는 프로필이
  // DeskRPG 목록에 계속 보이고, 거기 묶인 NPC 는 대화 시점에야 실패한다. 이 행이
  // 없어도(애초에 등록 안 된 프로필을 지운 경우) 삭제는 no-op 이라 안전하다.
  await db
    .delete(hermesProfiles)
    .where(and(eq(hermesProfiles.gatewayId, id), eq(hermesProfiles.profileName, name)));

  return NextResponse.json(res.data);
}
