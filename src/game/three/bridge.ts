/** Frontend-only presentation boundary. World positions remain server pixel coordinates. */
import type { MapObject } from "../../lib/object-types";
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
  texture?: CanvasImageSource;
  appearance?: unknown;
  bubble?: string;
  active?: boolean;
  /** Optional explicit response state; attention bubbles are not streamed responses. */
  phase?: "idle" | "queued" | "thinking" | "streaming" | "done" | "attention";
  /** 칸반 카드 실행·크론 실행이 진행 중(R27). 대화 응답 표시가 없을 때만 그린다. */
  working?: boolean;
};
export type MapSnapshot = {
  cols: number;
  rows: number;
  floor: number[][];
  walls: number[][];
  blocked: string[];
  objects: MapObject[];
  tiled: boolean;
  /** Validated office-template metadata, independent of actor appearance. */
  environment?: string;
  /** Actual channel artwork; retained for custom tiles without semantic 3D equivalents. */
  artwork?: HTMLCanvasElement;
};
export type EditorSnapshot = {
  enabled: boolean;
  objects: boolean;
  tile: number;
  layer: number;
  objectType: string;
  placement: boolean;
  spawn: boolean;
  owner: boolean;
  tiled: boolean;
};
export interface OfficeBridge {
  actors(): ActorSnapshot[];
  mapKey(): string;
  map(): MapSnapshot;
  save(): Promise<boolean>;
  editor(): EditorSnapshot;
  edit(
    options: Partial<Pick<EditorSnapshot, "enabled" | "objects" | "tile" | "layer" | "objectType">>,
  ): void;
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
  setPresentation(active: boolean): void;
}
export function pixelToWorld(x: number, y: number) {
  return { x: x / PIXELS_PER_TILE, z: y / PIXELS_PER_TILE };
}
export function worldToPixel(x: number, z: number) {
  return { x: x * PIXELS_PER_TILE, y: z * PIXELS_PER_TILE };
}
/** Inverse of Phaser Camera.getWorldPoint for an unrotated, zoomed game camera. */
export function worldToCamera(
  x: number,
  y: number,
  camera: {
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
    zoom: number;
    x: number;
    y: number;
  },
) {
  return {
    x: camera.x + (x - camera.scrollX - camera.width / 2) * camera.zoom + camera.width / 2,
    y: camera.y + (y - camera.scrollY - camera.height / 2) * camera.zoom + camera.height / 2,
  };
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

/** Chat messages use user IDs; scene player IDs use socket IDs. Never match names. */
export function speechActorId(actors: Pick<ActorSnapshot, "id" | "userId">[], senderId: string) {
  return (
    actors.find((actor) => actor.id === senderId)?.id ??
    actors.find((actor) => actor.userId === senderId)?.id ??
    senderId
  );
}
