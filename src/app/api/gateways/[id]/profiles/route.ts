import { NextRequest, NextResponse } from "next/server";

import { getAccessibleGatewayResource } from "@/lib/gateway-resources";
import { listHermesProfiles, registerHermesProfile } from "@/lib/hermes-profiles";
import { getUserId } from "@/lib/internal-rpc";
import { hireProfileIntoBoundChannels } from "@/lib/npc-roster";

import { validateProfileRegistration } from "./validation";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ errorCode: "unauthorized", error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const accessible = await getAccessibleGatewayResource(userId, id);
  if (!accessible) {
    return NextResponse.json(
      { errorCode: "gateway_not_found", error: "Gateway not found" },
      { status: 404 },
    );
  }

  const profiles = await listHermesProfiles(userId, id);
  return NextResponse.json({ profiles });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ errorCode: "unauthorized", error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const accessible = await getAccessibleGatewayResource(userId, id);
  if (!accessible) {
    return NextResponse.json(
      { errorCode: "gateway_not_found", error: "Gateway not found" },
      { status: 404 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const validation = validateProfileRegistration(body);
  if (!validation.ok) {
    return NextResponse.json(
      { errorCode: validation.errorCode, error: validation.errorCode },
      { status: 400 },
    );
  }

  const displayName = typeof body.displayName === "string" ? body.displayName : undefined;

  const result = await registerHermesProfile({
    userId,
    gatewayId: id,
    profileName: validation.profileName,
    token: validation.token,
    displayName,
  });

  if ("error" in result) {
    return NextResponse.json({ errorCode: result.error, error: result.error }, { status: 403 });
  }

  // 프로필 = NPC 다. 이 게이트웨이가 이미 묶여 있는 채널에는 지금 바로 출근시킨다 —
  // 채널을 다시 열거나 게이트웨이를 다시 연결할 때까지 기다리지 않는다.
  //
  // 고용은 **부수효과**지 성공 조건이 아니다. 여기서 던지면 프로필은 이미 만들어진
  // 채로 500 이 나가고, 사용자는 같은 이름으로 다시 시도하다 충돌만 본다.
  // channels/route.ts 의 게이트웨이 바인딩과 같은 규약으로 삼킨다.
  try {
    await hireProfileIntoBoundChannels(result.profile.id);
  } catch (hireErr) {
    console.error(`Failed to hire new profile ${result.profile.id} into bound channels:`, hireErr);
  }

  // Never serialize tokenEncrypted — it is ciphertext of a credential.
  const { tokenEncrypted: _tokenEncrypted, ...safeProfile } = result.profile;

  return NextResponse.json({ profile: safeProfile }, { status: 201 });
}
