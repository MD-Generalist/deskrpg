/** Frontend-only presentation boundary. World positions remain server pixel coordinates. */
import type { MapObject } from "../../lib/object-types";
import type { MeetingSpace } from "../meeting-space";
export const PIXELS_PER_TILE = 32;
export type ActorSnapshot = {
  id: string;
  userId?: string;
  name: string;
  kind: "player" | "npc" | "remote";
  x: number;
  y: number;
  direction: string;
  walking: boolean;
  /** 룩 정의(`officeLookId`)의 출처. 렌더러는 이것으로만 색을 정한다. */
  appearance?: unknown;
  bubble?: string;
  active?: boolean;
  /** Optional explicit response state; attention bubbles are not streamed responses. */
  phase?: "idle" | "queued" | "thinking" | "streaming" | "done" | "attention";
  /** 칸반 카드 실행·크론 실행이 진행 중(R27). 대화 응답 표시가 없을 때만 그린다. */
  working?: boolean;
  /** 진행 중인 건수(카드 + 크론). 2 이상일 때만 배지에 숫자가 붙는다. */
  workingCount?: number;
};
export type MapSnapshot = {
  meetingSpace?: MeetingSpace;
  cols: number;
  rows: number;
  floor: number[][];
  walls: number[][];
  blocked: string[];
  objects: MapObject[];
  tiled: boolean;
  /** Validated office-template metadata, independent of actor appearance. */
  environment?: string;
  /** Optional persisted template version used for backwards-compatible presentation. */
  environmentVersion?: number;
};
/** 게임 화면의 모드. 타일 편집 진입점은 없다 — NPC 배치·시작 위치 지정만 있다. */
export type EditorSnapshot = {
  placement: boolean;
  spawn: boolean;
  owner: boolean;
  tiled: boolean;
  /** 자리 변경 모드에서만 채워진다 — 데스크 좌석 번호와 점유 여부. */
  seatLabels: Array<{ number: number; col: number; row: number; taken: boolean }>;
};
export interface OfficeBridge {
  actors(): ActorSnapshot[];
  mapKey(): string;
  map(): MapSnapshot;
  editor(): EditorSnapshot;
  pointer(
    kind: "move" | "down",
    x: number,
    y: number,
    button: number,
    screenX: number,
    screenY: number,
    actorId?: string,
  ): void;
  walkable(col: number, row: number): boolean;
  /** Includes authoritative reservations that may not have reached the chair yet. */
  seatAvailable?(x: number, z: number): boolean;
  /** Server-pixel reservation ID for the player's current or approaching seat. */
  seatIntent?(): string | null;
  /** 렌더러가 붙고 떨어질 때 알린다. 화면 없는 시뮬레이션은 그릴 것이 없어 무시해도 된다. */
  setPresentation(active: boolean): void;
}
export function pixelToWorld(x: number, y: number) {
  return { x: x / PIXELS_PER_TILE, z: y / PIXELS_PER_TILE };
}
export function worldToPixel(x: number, z: number) {
  return { x: x * PIXELS_PER_TILE, y: z * PIXELS_PER_TILE };
}
/** Exact model/name-label targets take precedence over the legacy proximity fallback. */
export function matchesNpcTarget(
  npc: { id: string; x: number; y: number },
  click: { x: number; y: number; actorId?: string },
) {
  return click.actorId !== undefined
    ? npc.id === click.actorId
    : Math.hypot(npc.x - click.x, npc.y - click.y) < 48;
}

export function overviewDistance(cols: number, rows: number, aspect: number, fovDegrees = 38) {
  const halfVertical = (fovDegrees * Math.PI) / 360;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * Math.max(0.1, aspect));
  return (Math.hypot(cols, rows) / 2 / Math.sin(Math.min(halfVertical, halfHorizontal))) * 1.1;
}

/** Preserve server/UI response state without guessing streaming from a report bubble. */
export function actorPresentationPhase(actor: Pick<ActorSnapshot, "phase" | "active" | "bubble">) {
  return actor.phase ?? (actor.active ? "thinking" : actor.bubble ? "attention" : "idle");
}

export type ActorIndicator = "queued" | "thinking" | "streaming" | "working" | null;

/**
 * 이름표 옆 표시 하나(R27). 대화 응답(queued/thinking/streaming)이 우선하고, 없을 때만
 * "작업 중" — 둘을 같은 자리에 그리므로 겹치지 않는다.
 */
export function actorIndicator(
  actor: Pick<ActorSnapshot, "phase" | "active" | "bubble" | "working">,
): ActorIndicator {
  const phase = actorPresentationPhase(actor);
  if (phase === "queued" || phase === "thinking" || phase === "streaming") return phase;
  return actor.working ? "working" : null;
}

/**
 * 표시 옆에 붙는 숫자. **2 이상일 때만** 붙는다 — 1건은 배지 자체가 이미 말하고 있어서
 * 숫자를 붙이면 잡음만 는다. 한 직원이 여러 장을 돌릴 수 있는데(프로필별 상한은 기본 무제한)
 * 지금까지 화면이 그것을 한 장처럼 보여 줬다.
 */
export function indicatorCountLabel(
  indicator: ActorIndicator,
  actor: Pick<ActorSnapshot, "workingCount">,
): string {
  if (indicator !== "working") return "";
  const count = actor.workingCount ?? 0;
  return count >= 2 ? String(count) : "";
}

/** Chat messages use user IDs; scene player IDs use socket IDs. Never match names. */
export function speechActorId(actors: Pick<ActorSnapshot, "id" | "userId">[], senderId: string) {
  return (
    actors.find((actor) => actor.id === senderId)?.id ??
    actors.find((actor) => actor.userId === senderId)?.id ??
    senderId
  );
}
