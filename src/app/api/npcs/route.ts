import { deriveChannelMotionLayout } from "@/lib/channel-motion-layout";
import { isCreativeStudioMap } from "@/lib/effective-map-spawn";
// NPC 생성 라우트는 없다. NPC 는 사용자가 만드는 것이 아니라 "게이트웨이의 프로필이
// 채널에 갖는 자리" 이고, 그 자리는 게이트웨이 연결(hireGatewayProfilesIntoChannel)과
// 프로필 등록(hireProfileIntoBoundChannels)이 만든다. 여기서 다시 만들 수 있으면
// 프로필 없는 NPC 나 중복 자리가 생긴다.
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, channelMembers, channels } from "@/db";
import { getUserId } from "@/lib/internal-rpc";
import { getGatewayRuntimeStateForChannel } from "@/lib/gateway-resources";
import { selectChannelNpcs } from "@/lib/npc-projection";
import { channelSeats } from "@/lib/npc-seating";
import { seatNumberAt } from "@/lib/seat-assignment";
import { resolveMeetingMinutesAccess } from "../meetings/meeting-access";

export async function GET(req: NextRequest) {
  try {
    // 이 라우트는 오래도록 로그인만 확인하고 채널 소속은 보지 않았다. `roster=1` 이
    // 프로필의 소유자·게이트웨이까지 싣게 된 뒤로는 채널 UUID 만 알면 남의 사무실
    // 명부를 읽을 수 있었다. 회의록 라우트가 쓰는 것과 같은 경계를 건다.
    const userId = getUserId(req);
    if (!userId) {
      return NextResponse.json(
        { errorCode: "unauthorized", error: "unauthorized" },
        { status: 401 },
      );
    }

    const channelId = req.nextUrl.searchParams.get("channelId");
    // roster=1 은 "고용 명부" — 아직 자리를 못 잡았거나 퇴근한 NPC 까지 준다.
    // 기본 응답(맵용)은 예전 그대로 배치·출근한 것만 낸다.
    const roster = req.nextUrl.searchParams.get("roster") === "1";
    if (!channelId) {
      // 예전에는 channelId 가 없으면 전 채널의 NPC 를 통째로 돌려줬다. 호출부가
      // 하나도 없는 경로였고, 채널 경계를 넘어 새는 응답이었다.
      return NextResponse.json(
        { errorCode: "channel_id_required", error: "channelId required" },
        { status: 400 },
      );
    }

    const access = await resolveMeetingMinutesAccess({
      userId,
      channelId,
      deps: {
        loadChannelOwner: async (id) => {
          const [channel] = await db
            .select({ ownerId: channels.ownerId })
            .from(channels)
            .where(eq(channels.id, id))
            .limit(1);
          return channel?.ownerId ?? null;
        },
        loadMembership: async (id, uid) => {
          const [member] = await db
            .select({ role: channelMembers.role })
            .from(channelMembers)
            .where(and(eq(channelMembers.channelId, id), eq(channelMembers.userId, uid)))
            .limit(1);
          return Boolean(member);
        },
      },
    });
    if (!access.ok) {
      return NextResponse.json(
        { errorCode: access.errorCode, error: access.error },
        { status: access.status },
      );
    }

    const gatewayState = await getGatewayRuntimeStateForChannel(channelId, {
      forceRefresh: true,
    });
    if (gatewayState.status !== "valid") {
      return NextResponse.json({ npcs: [] });
    }

    const list = await selectChannelNpcs(channelId, { roster });
    // roster 는 "고용 명부" 화면이 자리 번호를 보여줘야 한다 — 맵용 기본 응답은 좌석을
    // 계산할 필요가 없으니 여기서만 채널 맵을 한 번 더 읽는다.
    const seats = roster ? await channelSeats(channelId) : null;
    const [mapChannel] = !roster
      ? await db
          .select({ mapData: channels.mapData })
          .from(channels)
          .where(eq(channels.id, channelId))
          .limit(1)
      : [];
    const runtimeHomes =
      mapChannel && isCreativeStudioMap(mapChannel.mapData)
        ? deriveChannelMotionLayout(
            mapChannel,
            list
              .filter((npc) => npc.positionX !== null && npc.positionY !== null)
              .map((npc) => ({ id: npc.id, positionX: npc.positionX!, positionY: npc.positionY! })),
          )?.npcs
        : undefined;
    const result = list.map((npc) => {
      const home = runtimeHomes?.find((home) => home.id === npc.id);
      const agentConfig = (npc.agentConfig ?? {}) as Record<string, unknown>;
      return {
        id: npc.id,
        name: npc.name,
        positionX: home ? Math.floor(home.x / 32) : npc.positionX,
        positionY: home ? Math.floor(home.y / 32) : npc.positionY,
        direction: npc.direction,
        appearance: npc.appearance,
        hasAgent: !!agentConfig.agentId,
        agentId: (agentConfig.agentId as string) || null,
        adapterType: npc.adapterType,
        hermesProfileId: npc.hermesProfileId,
        ...(roster
          ? {
              active: npc.active,
              placed: npc.positionX !== null,
              profile: npc.profile,
              seatNumber: seats ? seatNumberAt(seats, npc.positionX, npc.positionY) : null,
            }
          : {}),
      };
    });
    return NextResponse.json({ npcs: result });
  } catch (err) {
    console.error("Failed to fetch NPCs:", err);
    return NextResponse.json(
      { errorCode: "failed_to_fetch_npcs", error: "Failed to fetch NPCs" },
      { status: 500 },
    );
  }
}
