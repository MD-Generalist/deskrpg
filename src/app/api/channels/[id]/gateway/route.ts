import { isManagedSshUrl } from "@/lib/hermes/setup/transport-id";
import { db } from "@/db";
import { channels } from "@/db";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getUserId } from "@/lib/internal-rpc";
import { hireGatewayProfilesIntoChannel, sleepChannelNpcs } from "@/lib/npc-roster";
import {
  bindGatewayToChannel,
  decryptGatewayToken,
  getAccessibleGatewayResource,
  getChannelGatewayBinding,
  unbindGatewayFromChannel,
  upsertOwnedGatewayResource,
} from "@/lib/gateway-resources";
import internalTransport from "@/lib/internal-transport.js";
import { getGatewayConfigUpdatedHandler } from "@/lib/rpc-registry";
import { requestRefreshPollers } from "@/lib/automation-registry";

const { buildInternalAuthHeaders, getInternalSocketBaseUrl } = internalTransport as {
  buildInternalAuthHeaders: () => Record<string, string>;
  getInternalSocketBaseUrl: () => string;
};

/** 바인딩이 바뀌면 폴러 표를 다시 읽게 한다 — 기다리지 않고, 실패해도 응답에 섞지 않는다. */
function refreshPollersInBackground() {
  void requestRefreshPollers().catch((err: unknown) => {
    console.warn(
      `[gateway-route] refreshPollers failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
}

function buildResponseGatewayConfig(input: {
  userId: string;
  binding: Awaited<ReturnType<typeof getChannelGatewayBinding>>;
}) {
  const boundGateway = input.binding?.resource ?? null;
  const canEditCredentials = !boundGateway || boundGateway.ownerUserId === input.userId;

  // 복호화된 토큰은 응답에 싣지 않는다(하드 게이트 2). 소유자에게만 준다는 조건이 붙어도
  // 브라우저 메모리·프록시 로그·확장 프로그램으로 흘러간다. 화면이 실제로 필요한 것은
  // "키가 저장돼 있는가" 뿐이고, 바꿀 때는 새 값을 입력받는다.
  const hasToken = Boolean(boundGateway && decryptGatewayToken(boundGateway.tokenEncrypted).trim());

  return {
    gatewayId: boundGateway?.id ?? null,
    displayName: boundGateway?.displayName ?? null,
    url: boundGateway?.baseUrl ?? null,
    hasToken,
    canEditCredentials,
  };
}

async function emitGatewayConfigUpdated(channelId: string) {
  const localHandler = getGatewayConfigUpdatedHandler();
  if (localHandler) {
    await localHandler(channelId);
    return;
  }

  try {
    await fetch(`${getInternalSocketBaseUrl()}/_internal/emit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildInternalAuthHeaders(),
      },
      body: JSON.stringify({
        event: "gateway:config-updated",
        room: channelId,
        payload: { channelId },
      }),
    });
  } catch {
    console.warn("Failed to emit gateway:config-updated socket event");
  }
}

async function getChannelWithOwner(channelId: string) {
  const [channel] = await db
    .select({ ownerId: channels.ownerId })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  return channel ?? null;
}

// GET /api/channels/:id/gateway — owner-only, returns bound gateway resource
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  if (!userId)
    return NextResponse.json({ errorCode: "unauthorized", error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const channel = await getChannelWithOwner(id);
  if (!channel)
    return NextResponse.json({ errorCode: "not_found", error: "not found" }, { status: 404 });
  if (channel.ownerId !== userId)
    return NextResponse.json({ errorCode: "forbidden", error: "forbidden" }, { status: 403 });

  const binding = await getChannelGatewayBinding(id);

  return NextResponse.json({
    gatewayConfig: buildResponseGatewayConfig({ userId, binding }),
  });
}

// PUT /api/channels/:id/gateway — owner-only, binds a gateway resource or creates an owned one
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  if (!userId)
    return NextResponse.json({ errorCode: "unauthorized", error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const channel = await getChannelWithOwner(id);
  if (!channel)
    return NextResponse.json({ errorCode: "not_found", error: "not found" }, { status: 404 });
  if (channel.ownerId !== userId)
    return NextResponse.json({ errorCode: "forbidden", error: "forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ errorCode: "invalid_json", error: "invalid JSON" }, { status: 400 });
  }

  if (!(typeof body.gatewayId === "string" && body.gatewayId.trim()) && isManagedSshUrl(body.url)) {
    return NextResponse.json(
      { errorCode: "setup_invalid_request", error: "setup_invalid_request" },
      { status: 400 },
    );
  }

  const currentBinding = await getChannelGatewayBinding(id);
  const requestedUrl = typeof body.url === "string" ? body.url.trim() || null : null;
  // 화면이 더 이상 기존 키를 받아 두지 않으므로, 본문에 token 이 없으면 "그대로 두라"는 뜻이다.
  // 예전처럼 빈 문자열로 덮어쓰면 URL 만 고친 저장이 키를 지워 버린다.
  const rawToken: unknown = body.token;
  const tokenProvided = typeof rawToken === "string";
  const requestedToken = tokenProvided ? rawToken.trim() || null : null;

  let nextGatewayId: string | null = currentBinding?.resource.id ?? null;
  if (typeof body.gatewayId === "string" && body.gatewayId.trim()) {
    const accessible = await getAccessibleGatewayResource(userId, body.gatewayId.trim());
    if (!accessible) {
      return NextResponse.json(
        { errorCode: "gateway_access_denied", error: "Gateway access denied" },
        { status: 403 },
      );
    }
    nextGatewayId = accessible.resource.id;
  } else if (Object.hasOwn(body, "url")) {
    if (!requestedUrl) {
      nextGatewayId = null;
    } else {
      const resource = await upsertOwnedGatewayResource({
        ownerUserId: userId,
        baseUrl: requestedUrl,
        token: tokenProvided ? (requestedToken ?? "") : undefined,
        displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      });
      nextGatewayId = resource.id;
    }
  }

  const previousGatewayId = currentBinding?.resource.id ?? null;
  const isBindingChanging = previousGatewayId !== nextGatewayId;

  if (nextGatewayId) {
    await bindGatewayToChannel({
      channelId: id,
      gatewayId: nextGatewayId,
      boundByUserId: userId,
    });
  } else {
    await unbindGatewayFromChannel(id);
  }

  // 게이트웨이 교체는 더 이상 NPC 를 지우지 않는다. 옛 게이트웨이의 NPC 는 자리를
  // 기억한 채 휴면하고(다시 연결하면 그 자리로 돌아온다), 새 게이트웨이의 프로필이
  // 출근한다. 회의록·작업 같은 채널 아티팩트도 그대로 남는다.
  if (previousGatewayId && previousGatewayId !== nextGatewayId) {
    await sleepChannelNpcs(id, previousGatewayId);
  }
  // 고용은 **연결이 바뀔 때만** 한다. 같은 게이트웨이를 다시 저장하는 PUT 이 매번
  // 고용을 돌면, 사용자가 개별적으로 재운 NPC 가 설정 저장 한 번에 조용히
  // 되살아난다(Task 7 의 NPC 별 토글이 그 상태를 만든다).
  if (nextGatewayId && isBindingChanging) {
    await hireGatewayProfilesIntoChannel(id, nextGatewayId);
  }

  await emitGatewayConfigUpdated(id);
  refreshPollersInBackground();

  const nextBinding = await getChannelGatewayBinding(id);
  // 다른 게이트웨이로 옮겼다 — 보드는 새 게이트웨이에 확보됐지만(bindGatewayToChannel 안에서),
  // 카드와 크론은 이전 게이트웨이에 남는다(R4). 사용자에게 그 사실을 알린다.
  const movedToAnotherGateway = Boolean(previousGatewayId && nextGatewayId && isBindingChanging);
  return NextResponse.json({
    ok: true,
    gatewayConfig: buildResponseGatewayConfig({ userId, binding: nextBinding }),
    ...(movedToAnotherGateway ? { warning: "previous_board_retained" as const } : {}),
  });
}

// DELETE /api/channels/:id/gateway — owner-only, unbinds the channel gateway and puts its NPCs to sleep
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  if (!userId)
    return NextResponse.json({ errorCode: "unauthorized", error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const channel = await getChannelWithOwner(id);
  if (!channel)
    return NextResponse.json({ errorCode: "not_found", error: "not found" }, { status: 404 });
  if (channel.ownerId !== userId)
    return NextResponse.json({ errorCode: "forbidden", error: "forbidden" }, { status: 403 });

  // 연결 해제도 교체와 같다 — 지우는 것이 아니라 재우는 것이다. 자리와 회의록은
  // 그대로 남고, 다시 연결하면 그 자리로 되돌아온다. 그래서 확인을 받을 일도
  // (예전의 409 gateway_disconnect_requires_npc_reset) 없다.
  const previousGatewayId = (await getChannelGatewayBinding(id))?.resource.id ?? null;

  await unbindGatewayFromChannel(id);
  if (previousGatewayId) {
    await sleepChannelNpcs(id, previousGatewayId);
  }
  await emitGatewayConfigUpdated(id);
  refreshPollersInBackground();

  return NextResponse.json({
    ok: true,
    gatewayConfig: buildResponseGatewayConfig({ userId, binding: null }),
  });
}
