import { deriveChannelMotionLayout, CHANNEL_TILE_SIZE } from "./channel-motion-layout";
import { parseDbJson } from "./db-json";
import { effectiveMapSpawn } from "./effective-map-spawn";

/**
 * 직원 자리 배정의 **순수 로직**. DB 도 `fetch` 도 여기 들어오지 않는다.
 *
 * 좌석 번호는 저장하지 않는다 — 채널 맵의 데스크 의자를 row→col 로 세어 매번 계산한다.
 * 어느 의자가 데스크 좌석인지는 `seating.ts` 의 `deskSeats` 가 정하고, 여기는 그 결과
 * (`ChannelMotionLayout.deskSeatTiles`)를 받아 번호·서는 칸·배정 계획만 만든다.
 */
export type Tile = { col: number; row: number };
export type DeskSeat = Tile & { number: number };
/** `reserved` 는 대표석 — 번호도 없고 서는 칸도 아니다. 이미 앉은 직원은 이행 때 옮긴다. */
export type SeatingMap = { seats: DeskSeat[]; standing: Tile[]; reserved: Tile[] };
export type Placement = { npcId: string; col: number; row: number; seated: boolean };

const key = (tile: Tile) => `${tile.col},${tile.row}`;

export function seatingMapFor(channel: {
  mapData: unknown;
  mapConfig?: unknown;
}): SeatingMap | null {
  const data = parseDbJson(channel.mapData);
  if (!data || typeof data !== "object") return null;
  // Tiled 여부를 따지지 않는다 — `projectMeetingMap` 이 옛 형식 맵도 투영하므로, 레이아웃이
  // 나오면 옛 커스텀 맵의 직원도 배치된다. 투영할 수 없는 맵은 레이아웃이 null 이다.
  const layout = deriveChannelMotionLayout(channel, []);
  if (!layout) return null;

  const seats = layout.deskSeatTiles.map((tile, index) => ({ ...tile, number: index + 1 }));

  // 서는 칸: 좌석(데스크·공용 모두)과 입구를 피한다.
  const blockedTiles = new Set(
    layout.seats.map((seat) =>
      key({
        col: Math.floor(seat.x / CHANNEL_TILE_SIZE),
        row: Math.floor(seat.y / CHANNEL_TILE_SIZE),
      }),
    ),
  );
  const spawn = effectiveMapSpawn(data, channel.mapConfig);
  if (spawn) blockedTiles.add(key({ col: spawn.col, row: spawn.row }));

  const cols = layout.bounds.width / CHANNEL_TILE_SIZE;
  const rows = layout.bounds.height / CHANNEL_TILE_SIZE;
  const standable = (col: number, row: number) =>
    layout.isWalkable(col, row) &&
    !blockedTiles.has(key({ col, row })) &&
    layout.canStandAt({ x: (col + 0.5) * CHANNEL_TILE_SIZE, y: (row + 0.5) * CHANNEL_TILE_SIZE });
  // 8이웃이 모두 열린 바닥만 — 1칸 폭 통로를 막고 서지 않는다.
  const open = (col: number, row: number) => {
    for (let dy = -1; dy <= 1; dy += 1)
      for (let dx = -1; dx <= 1; dx += 1) if (!layout.isWalkable(col + dx, row + dy)) return false;
    return true;
  };

  const strict: Tile[] = [];
  const relaxed: Tile[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!standable(col, row)) continue;
      relaxed.push({ col, row });
      if (open(col, row)) strict.push({ col, row });
    }
  }
  return {
    seats,
    standing: strict.length > 0 ? strict : relaxed,
    reserved: layout.executiveSeatTiles.map((tile) => ({ ...tile })),
  };
}

export function seatNumberAt(
  seats: readonly DeskSeat[],
  col: number | null,
  row: number | null,
): number | null {
  if (col === null || row === null) return null;
  return seats.find((seat) => seat.col === col && seat.row === row)?.number ?? null;
}

/** FNV-1a — 같은 직원은 늘 같은 칸에서 찾기 시작한다. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 자리 없는 직원을 id 순으로, 번호가 낮은 빈 데스크 좌석부터 채운다. 좌석이 다하면
 * 서는 칸에 세운다. `occupied` 는 채널의 **모든** NPC 자리다 — 잠든 직원도 자리를 기억한다.
 */
export function planPlacements(
  unplaced: readonly { id: string }[],
  map: SeatingMap,
  occupied: readonly { positionX: number | null; positionY: number | null }[],
): Placement[] {
  const taken = new Set(
    occupied
      .filter((n) => Number.isInteger(n.positionX) && Number.isInteger(n.positionY))
      .map((n) => `${n.positionX},${n.positionY}`),
  );
  const plan: Placement[] = [];
  for (const npc of [...unplaced].sort((a, b) => a.id.localeCompare(b.id))) {
    const seat = map.seats.find((candidate) => !taken.has(key(candidate)));
    if (seat) {
      taken.add(key(seat));
      plan.push({ npcId: npc.id, col: seat.col, row: seat.row, seated: true });
      continue;
    }
    const count = map.standing.length;
    const start = count > 0 ? hash(npc.id) % count : 0;
    for (let i = 0; i < count; i += 1) {
      const tile = map.standing[(start + i) % count];
      if (taken.has(key(tile))) continue;
      taken.add(key(tile));
      plan.push({ npcId: npc.id, col: tile.col, row: tile.row, seated: false });
      break;
    }
  }
  return plan;
}
