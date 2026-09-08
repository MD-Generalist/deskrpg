import { NextRequest, NextResponse } from "next/server";
import { db, isPostgres } from "@/db";
import { npcs, channels } from "@/db";
import { eq } from "drizzle-orm";
import { getUserId } from "@/lib/internal-rpc";
import { setNpcActive } from "@/lib/npc-roster";
import { selectNpcById } from "@/lib/npc-projection";

async function verifyNpcOwnership(req: NextRequest, npcId: string) {
  const userId = getUserId(req);
  if (!userId) return { errorCode: "unauthorized", error: "Unauthorized", status: 401 };

  const [npc] = await db.select().from(npcs).where(eq(npcs.id, npcId));
  if (!npc) return { errorCode: "npc_not_found", error: "NPC not found", status: 404 };

  const [channel] = await db.select().from(channels).where(eq(channels.id, npc.channelId));
  if (!channel || channel.ownerId !== userId) {
    return {
      errorCode: "only_channel_owner_can_modify_npcs",
      error: "Only channel owner can modify NPCs",
      status: 403,
    };
  }

  return { npc, channel, userId };
}

/**
 * NPC 는 이제 "프로필의 채널별 자리" 다. 이 라우트가 바꿀 수 있는 것도 자리뿐이다 —
 * 이름·외형·페르소나는 Hermes 프로필이 정본이고 프로필 API 로만 바뀐다.
 *
 * 옛 필드를 조용히 무시하지 않고 400 으로 거절한다: 예전 PATCH 는 `body.name` 을
 * `npcs.name` 에 쓰면서 응답에는 투영된(프로필의) 이름을 실어, 이름을 바꿨다는 화면과
 * 아무것도 안 바뀐 DB 가 어긋난 채로 성공처럼 보였다.
 */
const PLACEMENT_FIELDS = new Set(["positionX", "positionY", "direction"]);
const DIRECTIONS = ["up", "down", "left", "right"];

async function updatePlacement(req: NextRequest, id: string) {
  const result = await verifyNpcOwnership(req, id);
  if ("error" in result) {
    return NextResponse.json(
      { errorCode: result.errorCode, error: result.error },
      { status: result.status },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const rejected = Object.keys(body).filter((k) => !PLACEMENT_FIELDS.has(k));
  if (rejected.length > 0) {
    return NextResponse.json(
      {
        errorCode: "unsupported_npc_field",
        error: `Unsupported NPC field(s): ${rejected.join(", ")}`,
        fields: rejected,
      },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = {
    updatedAt: (isPostgres ? new Date() : new Date().toISOString()) as unknown as Date,
  };
  if (typeof body.positionX === "number") updates.positionX = body.positionX;
  if (typeof body.positionY === "number") updates.positionY = body.positionY;
  if (typeof body.direction === "string") {
    updates.direction = DIRECTIONS.includes(body.direction) ? body.direction : "down";
  }

  await db.update(npcs).set(updates).where(eq(npcs.id, id));
  return NextResponse.json({ npc: await selectNpcById(id) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await updatePlacement(req, id);
  } catch (err) {
    console.error("Failed to update NPC:", err);
    return NextResponse.json(
      { errorCode: "failed_to_update_npc", error: "Failed to update NPC" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return PATCH(req, { params });
}

/**
 * 임시 shim — NPC 행을 지우지 않고 **퇴근**시킨다.
 *
 * NPC 는 프로필의 자리이고, 행을 지우면 다시 출근시킬 때 자리를 잃는다. 정본 경로는
 * 소켓 `npc:set-active` (회의 중 차단을 위해 회의 상태가 보이는 곳에 있어야 한다)이고,
 * 이 라우트는 아직 그 소켓을 쓰지 않는 GamePageClient 의 "해고" 버튼이 죽지 않게
 * 남겨 둔 것이다. Task 9 에서 클라이언트가 소켓으로 옮겨 가면 함께 지운다.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await verifyNpcOwnership(req, id);
    if ("error" in result) {
      return NextResponse.json(
        { errorCode: result.errorCode, error: result.error },
        { status: result.status },
      );
    }

    await setNpcActive(id, false);
    return NextResponse.json({ ok: true, active: false });
  } catch (err) {
    console.error("Failed to retire NPC:", err);
    return NextResponse.json(
      { errorCode: "failed_to_delete_npc", error: "Failed to retire NPC" },
      { status: 500 },
    );
  }
}
