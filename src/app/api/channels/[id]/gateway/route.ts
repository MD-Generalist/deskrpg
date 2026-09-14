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
  updateChannelTaskAutomationSettings,
  upsertOwnedGatewayResource,
} from "@/lib/gateway-resources";
import { buildGatewayConfig, mergeGatewayConfig } from "@/lib/task-reporting";
import internalTransport from "@/lib/internal-transport.js";
import { getGatewayConfigUpdatedHandler } from "@/lib/rpc-registry";

const { buildInternalAuthHeaders, getInternalSocketBaseUrl } = internalTransport as {
  buildInternalAuthHeaders: () => Record<string, string>;
  getInternalSocketBaseUrl: () => string;
};

function buildResponseGatewayConfig(input: {
  userId: string;
  channelGatewayConfig: unknown;
  binding: Awaited<ReturnType<typeof getChannelGatewayBinding>>;
}) {
  const taskAutomation = buildGatewayConfig(input.channelGatewayConfig).taskAutomation;
  const boundGateway = input.binding?.resource ?? null;
  const canEditCredentials = !boundGateway || boundGateway.ownerUserId === input.userId;

  return {
    gatewayId: boundGateway?.id ?? null,
    displayName: boundGateway?.displayName ?? null,
    url: boundGateway?.baseUrl ?? null,
    token:
      boundGateway && canEditCredentials ? decryptGatewayToken(boundGateway.tokenEncrypted) : null,
    canEditCredentials,
    taskAutomation,
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
    .select({ ownerId: channels.ownerId, gatewayConfig: channels.gatewayConfig })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  return channel ?? null;
}

// GET /api/channels/:id/gateway — owner-only, returns bound gateway resource + task automation
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
    gatewayConfig: buildResponseGatewayConfig({
      userId,
      channelGatewayConfig: channel.gatewayConfig,
      binding,
    }),
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
  const mergedGatewayConfig = mergeGatewayConfig(channel.gatewayConfig, body);

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
    if (!mergedGatewayConfig.url) {
      nextGatewayId = null;
    } else {
      const resource = await upsertOwnedGatewayResource({
        ownerUserId: userId,
        baseUrl: mergedGatewayConfig.url,
        token: mergedGatewayConfig.token ?? "",
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
  // 고용은 **연결이 바뀔 때만** 한다. taskAutomation 만 저장하는 PUT 이 매번
  // 고용을 돌면, 사용자가 개별적으로 재운 NPC 가 설정 저장 한 번에 조용히
  // 되살아난다(Task 7 의 NPC 별 토글이 그 상태를 만든다).
  if (nextGatewayId && isBindingChanging) {
    await hireGatewayProfilesIntoChannel(id, nextGatewayId);
  }

  await updateChannelTaskAutomationSettings(id, {
    taskAutomation: mergedGatewayConfig.taskAutomation,
  });

  await emitGatewayConfigUpdated(id);

  const nextBinding = await getChannelGatewayBinding(id);
  return NextResponse.json({
    ok: true,
    gatewayConfig: buildResponseGatewayConfig({
      userId,
      channelGatewayConfig: {
        taskAutomation: mergedGatewayConfig.taskAutomation,
      },
      binding: nextBinding,
    }),
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

  return NextResponse.json({
    ok: true,
    gatewayConfig: buildResponseGatewayConfig({
      userId,
      channelGatewayConfig: channel.gatewayConfig,
      binding: null,
    }),
  });
}
