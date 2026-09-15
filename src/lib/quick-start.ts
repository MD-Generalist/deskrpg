import { furnitureSeats } from "@/game/three/seating";
import { parseDbJson } from "@/lib/db-json";
import { projectTiledGeometry, type TiledGeometryMap } from "@/lib/tiled-geometry";
import type { CharacterAppearance } from "@/lib/lpc-registry";

/**
 * 빠른 시작의 **순수 로직**. DB 도 `fetch` 도 여기 들어오지 않는다 — 라우트가
 * 기존 도메인 함수(캐릭터/채널/배치 라우트)를 부르고, 이 파일은 "무엇을 만들지",
 * "어느 좌석이 비었는지" 같은 결정만 한다.
 *
 * 새 도메인 규칙을 만들지 않는 것이 이 기능의 핵심 제약이다. 좌석 후보도
 * `furnitureSeats`(렌더러·모션 레이아웃이 쓰는 그 함수)가 정하고, 여기서는
 * 그 결과를 타일 좌표로 접어 비교할 뿐이다.
 */

/** 채널 생성 화면의 기본 선택과 같은 오피스 환경. */
export const QUICK_START_ENVIRONMENT_ID = "trading";

/**
 * 기본 외형. `validateAppearance` 를 통과하는 최소 구성이고, 캐릭터 편집기의
 * 남성 기본값과 같은 조합이다(편집기는 `"use client"` 모듈이라 서버에서 import
 * 하지 않는다).
 */
export const QUICK_START_APPEARANCE: CharacterAppearance = {
  bodyType: "male",
  layers: {
    body: { itemKey: "body", variant: "light" },
    eye_color: { itemKey: "eye_color", variant: "blue" },
    hair: { itemKey: "hair_bangsshort", variant: "chestnut" },
    clothes: { itemKey: "torso_clothes_tshirt", variant: "blue" },
    legs: { itemKey: "legs_pants", variant: "charcoal" },
    shoes: { itemKey: "feet_boots_basic", variant: "brown" },
  },
};

const MAX_CHARACTER_NAME = 50;
const MAX_CHANNEL_NAME = 100;

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** 캐릭터 이름은 닉네임을 그대로 쓴다 — 없거나 너무 길면 접는다. */
export function quickStartCharacterName(nickname: string | null | undefined): string {
  const base = clean(nickname);
  return (base || "Player").slice(0, MAX_CHARACTER_NAME);
}

/** 채널 이름도 마찬가지. 사무실은 한 사람당 하나면 충분하다. */
export function quickStartChannelName(nickname: string | null | undefined): string {
  const base = clean(nickname);
  return (base ? `${base}'s Office` : "My Office").slice(0, MAX_CHANNEL_NAME);
}

export type SeatTile = { col: number; row: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * 채널 맵에서 좌석 앵커 타일을 뽑는다.
 *
 * 앵커는 타일 중심(`col + 0.5`)이므로 내림하면 타일 인덱스가 된다. 같은 타일이
 * 두 번 나오면 하나로 접는다 — `npcs_channel_position_unique` 가 한 타일에 둘을
 * 허용하지 않기 때문이다.
 */
export function quickStartSeatTiles(mapData: unknown): SeatTile[] {
  const data = parseDbJson(mapData);
  if (!isRecord(data) || !("tiledversion" in data)) return [];
  if (typeof data.width !== "number" || typeof data.height !== "number") return [];
  if (!Array.isArray(data.layers)) return [];

  let objects;
  try {
    objects = projectTiledGeometry(data as unknown as TiledGeometryMap).objects;
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const tiles: SeatTile[] = [];
  for (const seat of furnitureSeats(objects)) {
    const col = Math.floor(seat.anchorX ?? seat.x);
    const row = Math.floor(seat.anchorZ ?? seat.z);
    if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0) continue;
    const key = `${col},${row}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tiles.push({ col, row });
  }
  // 같은 맵이면 늘 같은 순서로 배정된다 — 재실행이 자리를 흔들지 않는다.
  return tiles.sort((a, b) => a.row - b.row || a.col - b.col);
}

/**
 * 이미 누가 앉아 있는 타일을 뺀 좌석 목록. `occupied` 는 채널의 모든 NPC 자리
 * (휴면 NPC 포함)다 — 잠든 NPC 도 자리를 기억하고 있으므로 그 위에 앉히면 안 된다.
 */
export function freeSeatTiles(
  seats: readonly SeatTile[],
  occupied: readonly { positionX: number | null; positionY: number | null }[],
): SeatTile[] {
  const taken = new Set(
    occupied
      .filter((n) => Number.isInteger(n.positionX) && Number.isInteger(n.positionY))
      .map((n) => `${n.positionX},${n.positionY}`),
  );
  return seats.filter((seat) => !taken.has(`${seat.col},${seat.row}`));
}

/**
 * 자리 없는 NPC 와 빈 좌석을 짝짓는다. 둘 중 짧은 쪽 길이만큼만 나온다.
 */
export function assignSeats<T extends { id: string }>(
  unplaced: readonly T[],
  free: readonly SeatTile[],
): Array<{ npcId: string; seat: SeatTile }> {
  return unplaced.slice(0, free.length).map((npc, index) => ({ npcId: npc.id, seat: free[index] }));
}

/** 빠른 시작이 끝나고 브라우저가 갈 곳. */
export function quickStartGamePath(input: { channelId: string; characterId: string }): string {
  const params = new URLSearchParams({
    channelId: input.channelId,
    characterId: input.characterId,
  });
  return `/game?${params.toString()}`;
}
