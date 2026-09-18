import { NextRequest, NextResponse } from "next/server";

import { db, users } from "@/db";
import { eq } from "drizzle-orm";
import { decryptGatewayToken, getAccessibleGatewayResource } from "@/lib/gateway-resources";
import { registerHermesProfile } from "@/lib/hermes-profiles";
import { createPluginClient } from "@/lib/hermes/plugin-client";
import { attachKeyStorage, stripApiKey } from "@/lib/hermes/plugin-provision";
import { getUserId } from "@/lib/internal-rpc";
import { hireProfileIntoBoundChannels } from "@/lib/npc-roster";
import { ERROR_CODE_HEADER } from "@/lib/i18n/error-codes";

import { validateCreatableProfileName, validateCreateOptions } from "../validation";

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
      { errorCode: res.failure.code, error: res.failure.message, upstreamStatus: res.status },
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

  // 복제 원본은 지금 `default` 뿐이다 — 원격이 400 을 내기 전에 여기서 이유를 분명히 한다.
  const options = validateCreateOptions(payload);
  if (!options.ok) {
    return NextResponse.json(
      { errorCode: options.errorCode, error: options.errorCode },
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
  const res = await client.createProfile(
    nameCheck.name,
    options.cloneFrom ? { cloneFrom: options.cloneFrom, cloneKeys: options.cloneKeys } : undefined,
  );
  if (!res.ok) {
    return NextResponse.json(
      { errorCode: res.failure.code, error: res.failure.message, upstreamStatus: res.status },
      proxyInit(res.failure.code),
    );
  }

  // 판정 B: 키가 나왔으면 **즉시** 저장한다. 다시 조회할 방법이 없어서, 여기서
  // 놓치면 프로필은 있는데 말을 걸 수 없는 상태가 영구히 남는다. `registerHermesProfile`
  // 은 게이트웨이 소유자가 아니면 `{error:"forbidden"}` 을 돌려주는데, 라우트는
  // system_admin 만 검사하므로 그 실패를 삼키지 않고 응답에 실어 보낸다.
  let keyStorage: { ok: true } | { ok: false; reason: string } | null;
  // 이 프로필이 실제로 **몇 개 채널에 출근했는지**. 출근은 그 게이트웨이가 이미 붙어 있는
  // 채널에만 일어난다 — 화면이 "이미 출근했습니다" 를 조건 없이 말하지 않도록 사실을 함께 보낸다.
  let attendedChannels = 0;
  if (!res.data.keyIssued) {
    // 애초에 발급이 없었다 — attachKeyStorage 가 이 경우를 null 로 구분한다.
    keyStorage = null;
  } else if (!res.data.apiKey) {
    // M-3: keyIssued:true 인데 apiKey 가 비어 왔다 — "발급 자체가 없었다"(null)와
    // 다른 상황이니 이유 없이 keyStored:false 만 나가면 안 된다. 코드로 보낸다 —
    // 최종 리뷰 M-3, 화면이 wizard-error-codes 사전으로 번역한다.
    keyStorage = { ok: false, reason: "key_missing_after_issue" };
  } else {
    const stored = await registerHermesProfile({
      userId,
      gatewayId: id,
      profileName: res.data.name,
      token: res.data.apiKey,
      // 최종 리뷰 I-2: 이 라우트만 이 프로필을 실제로 만든다 — 마법사가 세운
      // 표시라는 사실을 여기서 명시적으로 넘긴다. 수동 등록(profiles/route.ts,
      // 다른 파일)은 이 인자를 넘기지 않아 false 로 남는다.
      provisionedByDeskrpg: true,
    });
    if ("error" in stored) {
      keyStorage = { ok: false, reason: "key_store_forbidden" };
    } else {
      // 마법사가 만든 프로필도 곧바로 출근시킨다(수동 등록과 같은 규약).
      //
      // 고용 실패로 500 을 내면 원격 Hermes 에는 프로필이 남고 사용자는 같은 이름으로
      // 다시 만들 수 없다 — 되돌릴 수 없는 상태를 만드는 대신 삼키고 로그만 남긴다.
      try {
        attendedChannels = (await hireProfileIntoBoundChannels(stored.profile.id)).created;
      } catch (hireErr) {
        console.error(
          `Failed to hire wizard profile ${stored.profile.id} into bound channels:`,
          hireErr,
        );
      }
      keyStorage = { ok: true };
    }
  }

  // `stripApiKey` 는 `apiKey` 를 절대 옮기지 않는다 — `cloned`/`needsLogin`/`cloneError`
  // 는 그 함수가 모르는 필드라 여기서 **있을 때만** 따로 얹는다(값을 지어내지 않는다).
  const cloneFields: Record<string, unknown> = {};
  if (res.data.cloned !== undefined) cloneFields.cloned = res.data.cloned;
  if (res.data.needsLogin !== undefined) cloneFields.needsLogin = res.data.needsLogin;
  if (res.data.cloneError !== undefined) cloneFields.cloneError = res.data.cloneError;

  return NextResponse.json(
    { ...attachKeyStorage(stripApiKey(res.data), keyStorage), attendedChannels, ...cloneFields },
    { status: 201 },
  );
}
