import { NextRequest, NextResponse } from "next/server";

import { db, users } from "@/db";
import { eq } from "drizzle-orm";
import { decryptGatewayToken, getAccessibleGatewayResource } from "@/lib/gateway-resources";
import { registerHermesProfile } from "@/lib/hermes-profiles";
import { createPluginClient } from "@/lib/hermes/plugin-client";
import { attachKeyStorage, stripApiKey } from "@/lib/hermes/plugin-provision";
import { getUserId } from "@/lib/internal-rpc";
import { ERROR_CODE_HEADER } from "@/lib/i18n/error-codes";

import { validateCreatableProfileName } from "../validation";

/**
 * 프로필 생성·목록은 **default 키**를 쓴다 — 게이트웨이 전체를 다루는 자격이라
 * `system_admin` 만 부를 수 있다. 인격·설정(프로필 스코프)은 이 제한을 받지 않는다.
 *
 * 프록시 실패는 200 + errorCode 로 돌려준다(gateways/[id]/test/route.ts 의 이유와 동일 —
 * Cloudflare 가 5xx 본문을 자기 에러 페이지로 갈아치운다).
 */
const proxyInit = (errorCode: string) => ({
  status: 200,
  headers: { [ERROR_CODE_HEADER]: errorCode },
});

async function requireSystemAdmin(userId: string) {
  const [row] = await db
    .select({ systemRole: users.systemRole })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.systemRole === "system_admin";
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ errorCode: "unauthorized", error: "unauthorized" }, { status: 401 });
  }
  if (!(await requireSystemAdmin(userId))) {
    return NextResponse.json({ errorCode: "forbidden", error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const accessible = await getAccessibleGatewayResource(userId, id);
  if (!accessible) {
    return NextResponse.json({ errorCode: "not_found", error: "not found" }, { status: 404 });
  }

  const client = createPluginClient({
    baseUrl: accessible.resource.baseUrl,
    defaultToken: decryptGatewayToken(accessible.resource.tokenEncrypted),
  });
  const res = await client.listProfiles();
  if (!res.ok) {
    return NextResponse.json(
      { errorCode: res.failure.code, error: res.failure.message },
      proxyInit(res.failure.code),
    );
  }
  return NextResponse.json(res.data);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ errorCode: "unauthorized", error: "unauthorized" }, { status: 401 });
  }
  if (!(await requireSystemAdmin(userId))) {
    return NextResponse.json({ errorCode: "forbidden", error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { errorCode: "bad_request", error: "body must be JSON" },
      { status: 400 },
    );
  }

  // 판정 A: 새로 만들 이름은 `isCreatableProfileName`(엄격) 을 쓴다 — 기존 프로필
  // 등록용 `PROFILE_NAME_RE`(관대) 를 쓰면 로컬 검증은 통과하고 원격이 400 을 내는데
  // 그 이유가 화면까지 오지 않는다.
  const nameCheck = validateCreatableProfileName(payload);
  if (!nameCheck.ok) {
    return NextResponse.json(
      { errorCode: nameCheck.errorCode, error: nameCheck.errorCode },
      { status: 400 },
    );
  }

  const accessible = await getAccessibleGatewayResource(userId, id);
  if (!accessible) {
    return NextResponse.json({ errorCode: "not_found", error: "not found" }, { status: 404 });
  }

  const client = createPluginClient({
    baseUrl: accessible.resource.baseUrl,
    defaultToken: decryptGatewayToken(accessible.resource.tokenEncrypted),
  });
  const res = await client.createProfile(nameCheck.name);
  if (!res.ok) {
    return NextResponse.json(
      { errorCode: res.failure.code, error: res.failure.message },
      proxyInit(res.failure.code),
    );
  }

  // 판정 B: 키가 나왔으면 **즉시** 저장한다. 다시 조회할 방법이 없어서, 여기서
  // 놓치면 프로필은 있는데 말을 걸 수 없는 상태가 영구히 남는다. `registerHermesProfile`
  // 은 게이트웨이 소유자가 아니면 `{error:"forbidden"}` 을 돌려주는데, 라우트는
  // system_admin 만 검사하므로 그 실패를 삼키지 않고 응답에 실어 보낸다.
  const keyStorage =
    res.data.keyIssued && res.data.apiKey
      ? await registerHermesProfile({
          userId,
          gatewayId: id,
          profileName: res.data.name,
          token: res.data.apiKey,
        }).then((stored) =>
          "error" in stored
            ? {
                ok: false as const,
                reason: "게이트웨이 소유자가 아니라 발급된 키를 저장하지 못했습니다.",
              }
            : { ok: true as const },
        )
      : null;

  return NextResponse.json(attachKeyStorage(stripApiKey(res.data), keyStorage), { status: 201 });
}
