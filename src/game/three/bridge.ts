/** Frontend-only presentation boundary. World positions remain server pixel coordinates. */
import type { MapObject } from "../../lib/object-types";
export const PIXELS_PER_TILE = 32;
export type ActorSnapshot = {
  id: string;
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
