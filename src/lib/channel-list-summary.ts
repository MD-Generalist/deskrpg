/**
 * 채널 선택 카드에 싣는 요약 — 맵 환경(썸네일용)과 참여자.
 *
 * 채널은 환경 ID 를 따로 저장하지 않는다. 생성 때 `buildOfficeEnvironment(id)` 의 사본을 `map_data` 에
 * 넣을 뿐이다(`POST /api/channels`). 그래서 저장된 맵을 다섯 공식 환경의 현재 맵과 견준다. 오브젝트는
 * 자리 배치 등으로 달라질 수 있으니 **크기와 바닥 레이어**만 본다 — 환경마다 바닥 모양이 다르다.
 * 업그레이드 전 옛 공식 맵은 기존 판정(`upgradeOfficialEnvironmentMap`)을 먼저 거친다.
 */
import {
  buildOfficeEnvironment,
  OFFICE_ENVIRONMENTS,
  type OfficeEnvironmentId,
} from "../game/three/office-environments";
import { parseDbJson } from "./db-json";
import { upgradeOfficialEnvironmentMap } from "./official-environment-upgrade";
import { sameJsonSnapshot } from "./same-json-snapshot";

type MapShape = { width?: unknown; height?: unknown; layers?: unknown };

function floorLayer(map: MapShape): unknown {
  if (!Array.isArray(map.layers)) return undefined;
  const floor = map.layers.find(
    (layer) =>
      !!layer && typeof layer === "object" && (layer as { name?: unknown }).name === "Floor",
  ) as { data?: unknown } | undefined;
  return floor?.data;
}

let signatures: Array<{ id: OfficeEnvironmentId; map: MapShape; floor: unknown }> | null = null;

function environmentSignatures() {
  signatures ??= OFFICE_ENVIRONMENTS.map((environment) => {
    const map = buildOfficeEnvironment(environment.id) as unknown as MapShape;
    return { id: environment.id, map, floor: floorLayer(map) };
  });
  return signatures;
}

export function detectOfficeEnvironmentId(mapData: unknown): OfficeEnvironmentId | null {
  const parsed = parseDbJson<MapShape>(mapData);
  if (!parsed || typeof parsed !== "object") return null;
  const map = upgradeOfficialEnvironmentMap(parsed).map as MapShape;
  const floor = floorLayer(map);
  if (floor === undefined) return null;
  for (const signature of environmentSignatures()) {
    if (
      map.width === signature.map.width &&
      map.height === signature.map.height &&
      sameJsonSnapshot(floor, signature.floor)
    ) {
      return signature.id;
    }
  }
  return null;
}

export type ParticipantRow = {
  userId: string;
  nickname: string | null;
  appearance: unknown;
  joinedAt: Date | string | null;
};

export type ParticipantPreview = { nickname: string | null; appearance: unknown };

export const PARTICIPANT_PREVIEW_LIMIT = 5;

/** 소유자 먼저, 나머지는 들어온 순서. 사용자당 한 명. */
export function summarizeParticipants(
  rows: ParticipantRow[],
  ownerId: string,
  limit = PARTICIPANT_PREVIEW_LIMIT,
): { count: number; preview: ParticipantPreview[] } {
  const byUser = new Map<string, ParticipantRow>();
  for (const row of rows) if (!byUser.has(row.userId)) byUser.set(row.userId, row);
  const time = (row: ParticipantRow) =>
    row.joinedAt ? new Date(row.joinedAt).getTime() : Infinity;
  const ordered = [...byUser.values()].sort((a, b) => {
    if (a.userId === ownerId) return -1;
    if (b.userId === ownerId) return 1;
    return time(a) - time(b);
  });
  return {
    count: ordered.length,
    preview: ordered
      .slice(0, limit)
      .map((row) => ({ nickname: row.nickname, appearance: row.appearance })),
  };
}
