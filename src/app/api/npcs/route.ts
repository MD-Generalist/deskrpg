// NPC 생성 라우트는 없다. NPC 는 사용자가 만드는 것이 아니라 "게이트웨이의 프로필이
// 채널에 갖는 자리" 이고, 그 자리는 게이트웨이 연결(hireGatewayProfilesIntoChannel)과
// 프로필 등록(hireProfileIntoBoundChannels)이 만든다. 여기서 다시 만들 수 있으면
// 프로필 없는 NPC 나 중복 자리가 생긴다.
import { NextRequest, NextResponse } from "next/server";
import { getGatewayRuntimeStateForChannel } from "@/lib/gateway-resources";
import { selectChannelNpcs } from "@/lib/npc-projection";

export async function GET(req: NextRequest) {
  try {
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

    const gatewayState = await getGatewayRuntimeStateForChannel(channelId, {
      forceRefresh: true,
    });
    if (gatewayState.status !== "valid") {
      return NextResponse.json({ npcs: [] });
    }

    const list = await selectChannelNpcs(channelId, { roster });
    const result = list.map((npc) => {
      const agentConfig = (npc.agentConfig ?? {}) as Record<string, unknown>;
      return {
        id: npc.id,
        name: npc.name,
        positionX: npc.positionX,
        positionY: npc.positionY,
        direction: npc.direction,
        appearance: npc.appearance,
        hasAgent: !!agentConfig.agentId,
        agentId: (agentConfig.agentId as string) || null,
        adapterType: npc.adapterType,
        hermesProfileId: npc.hermesProfileId,
        ...(roster
          ? { active: npc.active, placed: npc.positionX !== null, profile: npc.profile }
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
