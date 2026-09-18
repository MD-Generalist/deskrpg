import { NextRequest, NextResponse } from "next/server";
import { db, isPostgres } from "@/db";
import { npcs, channels } from "@/db";
import { eq } from "drizzle-orm";
import { getUserId } from "@/lib/internal-rpc";
import { selectNpcById } from "@/lib/npc-projection";
import { isUniqueViolation } from "@/lib/db-unique-violation";
import { seatingMapFor, seatNumberAt } from "@/lib/seat-assignment";

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

  if (typeof body.positionX === "number" || typeof body.positionY === "number") {
    // 자리 변경은 데스크 좌석으로만. 서는 칸은 시스템 배정만 쓴다.
    // 좌석을 계산할 수 없는 맵(옛 커스텀 맵·맵 없음)은 예전처럼 통과시킨다.
    const seating = seatingMapFor(result.channel);
    const col = typeof body.positionX === "number" ? body.positionX : result.npc.positionX;
    const row = typeof body.positionY === "number" ? body.positionY : result.npc.positionY;
    if (seating && seating.seats.length > 0 && seatNumberAt(seating.seats, col, row) === null) {
      return NextResponse.json(
        { errorCode: "not_a_desk_seat", error: "NPC seats must be desk chairs" },
        { status: 400 },
      );
    }
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
    // 한 타일에 두 NPC 를 세울 수 없다 — `npcs_channel_position_unique` 가 막는다.
    // 클라이언트는 이 409 를 보고 배치 모드를 유지한 채 조용히 다른 칸을 기다린다.
    // 이 매핑이 없으면 같은 상황이 500 으로 나가 "배치 실패" 토스트만 뜬다.
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { errorCode: "tile_already_occupied", error: "This tile is already occupied" },
        { status: 409 },
      );
    }
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
