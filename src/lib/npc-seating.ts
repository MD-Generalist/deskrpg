import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db, channels, npcs, nowForDb } from "@/db";
import { isUniqueViolation } from "./db-unique-violation";
import { planPlacements, seatingMapFor, type DeskSeat, type SeatingMap } from "./seat-assignment";

export type PlacementResult = { seated: number; standing: number; failed: number };

const MAX_REPLANS = 3;

async function loadSeatingMap(channelId: string): Promise<SeatingMap | null> {
  const [channel] = await db
    .select({ mapData: channels.mapData, mapConfig: channels.mapConfig })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  return channel ? seatingMapFor(channel) : null;
}

/** 출근부가 좌석 번호를 붙일 때 쓴다. 맵을 읽을 수 없으면 null. */
export async function channelSeats(channelId: string): Promise<DeskSeat[] | null> {
  return (await loadSeatingMap(channelId))?.seats ?? null;
}

/**
 * 출근했는데 자리가 없는 직원을 전부 배치한다 — 빈 데스크 좌석 먼저, 만석이면 서는 칸.
 *
 * 시스템 배정 경로다. 사용자의 자리 변경은 `PATCH /api/npcs/[id]` 하나뿐이지만, 고용은
 * 채널 소유자의 요청 없이도 일어나므로(공유 게이트웨이에 프로필 추가) 여기서 직접 쓴다.
 * 어떤 실패도 고용을 깨뜨리지 않는다 — `failed` 로 세고 끝낸다.
 */
export async function placeUnplacedNpcs(channelId: string): Promise<PlacementResult> {
  let result: PlacementResult;
  try {
    result = await placeUnplacedNpcsInternal(channelId);
  } catch (err) {
    console.error("[seating] placement failed", { channelId, err });
    const failed = await countActiveUnplaced(channelId).catch(() => 0);
    result = { seated: 0, standing: 0, failed };
  }
  if (result.failed > 0) {
    console.warn("[seating] active NPCs left without a spot", { channelId, failed: result.failed });
  }
  return result;
}

async function countActiveUnplaced(channelId: string): Promise<number> {
  const left = await db
    .select({ id: npcs.id })
    .from(npcs)
    .where(
      and(
        eq(npcs.channelId, channelId),
        eq(npcs.active, true),
        or(isNull(npcs.positionX), isNull(npcs.positionY)),
      ),
    );
  return left.length;
}

/**
 * 대표석에 앉아 있는 직원을 자리 없음으로 되돌린다 — 곧바로 아래 배치가 빈 좌석에 앉힌다.
 *
 * 대표석이 1번 자리이던 시절(2026.920.7 이전)에 배치된 직원이 대표 의자에 앉아 있다.
 * 대표석은 이제 좌석 목록에 없어 사용자가 "자리 변경" 으로 옮길 수도 없으므로 시스템이 옮긴다.
 */
async function vacateReservedSeats(channelId: string, map: SeatingMap): Promise<void> {
  for (const tile of map.reserved) {
    await db
      .update(npcs)
      .set({ positionX: null, positionY: null, updatedAt: nowForDb() })
      .where(
        and(
          eq(npcs.channelId, channelId),
          eq(npcs.positionX, tile.col),
          eq(npcs.positionY, tile.row),
        ),
      );
  }
}

async function placeUnplacedNpcsInternal(channelId: string): Promise<PlacementResult> {
  const result: PlacementResult = { seated: 0, standing: 0, failed: 0 };
  const map = await loadSeatingMap(channelId);
  if (map) await vacateReservedSeats(channelId, map);

  for (let attempt = 0; attempt < MAX_REPLANS; attempt += 1) {
    const roster = await db
      .select({
        id: npcs.id,
        active: npcs.active,
        positionX: npcs.positionX,
        positionY: npcs.positionY,
      })
      .from(npcs)
      .where(eq(npcs.channelId, channelId))
      .orderBy(asc(npcs.id));
    const unplaced = roster.filter(
      (npc) => npc.active && !(Number.isInteger(npc.positionX) && Number.isInteger(npc.positionY)),
    );
    if (unplaced.length === 0) return result;
    if (!map) return { ...result, failed: unplaced.length };

    const plan = planPlacements(unplaced, map, roster);
    let conflict = false;
    for (const step of plan) {
      try {
        const updated = await db
          .update(npcs)
          .set({ positionX: step.col, positionY: step.row, updatedAt: nowForDb() })
          .where(and(eq(npcs.id, step.npcId), or(isNull(npcs.positionX), isNull(npcs.positionY))))
          .returning({ id: npcs.id });
        if (updated.length === 0) continue;
        if (step.seated) result.seated += 1;
        else result.standing += 1;
      } catch (err) {
        // 다른 요청이 같은 칸을 먼저 잡았다(npcs_channel_position_unique) — 다시 읽고 재계획.
        if (!isUniqueViolation(err)) throw err;
        conflict = true;
        break;
      }
    }
    if (!conflict) return { ...result, failed: unplaced.length - plan.length };
  }

  const left = await countActiveUnplaced(channelId);
  return { ...result, failed: left };
}

/**
 * 서버 부팅 때 1회 — 자리 없이 만들어진 직원과 대표석에 앉은 직원을 이행한다. 멱등.
 *
 * 출근한 직원이 있는 채널을 모두 돈다. 대표석에 앉은 직원은 좌표가 있어 "미배치" 로는
 * 걸러지지 않고, 어느 칸이 대표석인지는 채널 맵을 읽어야 알기 때문이다.
 */
export async function placeAllUnplacedNpcs(): Promise<PlacementResult & { channels: number }> {
  const rows = await db
    .selectDistinct({ channelId: npcs.channelId })
    .from(npcs)
    .where(eq(npcs.active, true));
  const total = { seated: 0, standing: 0, failed: 0, channels: rows.length };
  for (const { channelId } of rows) {
    const one = await placeUnplacedNpcs(channelId);
    total.seated += one.seated;
    total.standing += one.standing;
    total.failed += one.failed;
  }
  return total;
}
