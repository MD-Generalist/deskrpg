import { NextRequest, NextResponse } from "next/server";

import { getAccessibleGatewayResource } from "@/lib/gateway-resources";
import { deleteHermesProfile, profileUsage, updateHermesProfile } from "@/lib/hermes-profiles";
import { getUserId } from "@/lib/internal-rpc";

/**
 * 프로필 조회·수정·삭제.
 *
 * 수정·삭제가 없어서, 토큰을 잘못 넣은 프로필은 화면에서 손댈 방법이 없었다 —
 * 만들 수만 있고 고칠 수도 지울 수도 없는 막다른 길이었다.
 */

/** 삭제 확인 문구가 "NPC 2개 · 채널 2곳이 사라집니다"라고 말할 수 있도록 수치를 준다. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; profileId: string }> },
) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ errorCode: "unauthorized", error: "unauthorized" }, { status: 401 });
  }
  const { id, profileId } = await params;
  // 수치도 게이트웨이에 접근할 수 있는 사람만 본다 — 남의 인격이 어느 채널에
  // 몇 개 나가 있는지는 알려 줄 이유가 없다.
  if (!(await getAccessibleGatewayResource(userId, id))) {
    return NextResponse.json({ errorCode: "not_found", error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ usage: await profileUsage(profileId) });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> },
) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ errorCode: "unauthorized", error: "unauthorized" }, { status: 401 });
  }
  const { profileId } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    token?: unknown;
    displayName?: unknown;
    appearance?: unknown;
  };

  const result = await updateHermesProfile(userId, profileId, {
    // 토큰은 보낼 때만 바뀐다 — 화면이 빈 칸을 아예 보내지 않는 규약이다.
    token: typeof body.token === "string" ? body.token : undefined,
    displayName: typeof body.displayName === "string" ? body.displayName : undefined,
    // 외형도 보낼 때만 바뀐다. 소유자만 쓸 수 있다(updateHermesProfile 이 판정한다).
    appearance: Object.hasOwn(body, "appearance") ? body.appearance : undefined,
  });

  if (!result.ok) {
    return NextResponse.json(
      { errorCode: result.errorCode, error: result.errorCode },
      { status: result.errorCode === "forbidden" ? 403 : 404 },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> },
) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ errorCode: "unauthorized", error: "unauthorized" }, { status: 401 });
  }
  const { profileId } = await params;

  const result = await deleteHermesProfile(userId, profileId);
  if (!result.ok) {
    return NextResponse.json(
      { errorCode: result.errorCode, error: result.errorCode },
      { status: result.errorCode === "forbidden" ? 403 : 404 },
    );
  }
  // 프로필을 지우면 그 NPC 행도 CASCADE 로 함께 사라진다 — 몇 개가 몇 채널에서
  // 없어졌는지 돌려준다.
  return NextResponse.json({
    ok: true,
    deletedNpcs: result.deletedNpcs,
    channels: result.channels,
  });
}

// 화면이 외형 저장에 PUT 을 쓰든 PATCH 를 쓰든 같은 핸들러로 받는다 — 부분 수정
// 규약(보낸 필드만 바뀐다)은 둘 다 동일하다.
export const PUT = PATCH;
