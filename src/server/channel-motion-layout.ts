import { normalizeMeetingMap, projectMeetingMap } from "../game/meeting-map-normalization";
import type { MeetingSpace } from "../game/meeting-space";
import { parseDbJson } from "../lib/db-json";
import {
  ACTOR_RADIUS,
  clearSegment,
  type NavigationPoint,
  type Walkable,
} from "../game/navigation";
import { furnitureSeats } from "../game/three/seating";

export const CHANNEL_TILE_SIZE = 32;
export type ChannelMotionLayout = {
  meetingSpace: MeetingSpace;
  npcs: Array<NavigationPoint & { id: string }>;
  seats: Array<NavigationPoint & { id: string }>;
  bounds: { width: number; height: number };
  /** Logical tile indices, matching GameScene navigation. */
  isWalkable: Walkable;
  /** Pixel coordinates, including actor body clearance at wall corners. */
  canStandAt: (point: NavigationPoint) => boolean;
};
const finitePoint = (point: NavigationPoint) =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

/** Read the persisted snapshot, never regenerate a themed map over user edits. */
export function deriveChannelMotionLayout(
  channel: { mapData: unknown; mapConfig?: unknown },
  npcRows: ReadonlyArray<{ id: string; positionX: number; positionY: number }>,
): ChannelMotionLayout | null {
  const data = parseDbJson(channel.mapData);
  if (!data) return null;
  try {
    const normalized = normalizeMeetingMap(data, parseDbJson(channel.mapConfig));
    const { cols, rows, objects, blocked: blockedKeys } = projectMeetingMap(normalized.mapData);
    const blocked = new Set(blockedKeys);
    const isWalkable: Walkable = (x, y) =>
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < cols &&
      y < rows &&
      !blocked.has(`${x},${y}`);
    const canStandAt = (point: NavigationPoint) => {
      if (!finitePoint(point)) return false;
      const tile = { x: point.x / CHANNEL_TILE_SIZE - 0.5, y: point.y / CHANNEL_TILE_SIZE - 0.5 };
      return clearSegment(tile, tile, isWalkable);
    };
    const npcs = npcRows
      .filter((npc) => Number.isInteger(npc.positionX) && Number.isInteger(npc.positionY))
      .map((npc) => ({ id: npc.id, x: (npc.positionX + 0.5) * 32, y: (npc.positionY + 0.5) * 32 }));
    const seats = new Map<string, NavigationPoint & { id: string }>();
    for (const seat of furnitureSeats(objects)) {
      const x = (seat.anchorX ?? seat.x) * 32,
        y = (seat.anchorZ ?? seat.z) * 32;
      if (canStandAt({ x, y })) seats.set(`${x}:${y}`, { id: `${x}:${y}`, x, y });
    }
    return {
      meetingSpace: normalized.meetingSpace,
      npcs,
      seats: [...seats.values()],
      bounds: { width: cols * 32, height: rows * 32 },
      isWalkable,
      canStandAt,
    };
  } catch {
    return null;
  }
}

/** Preserve a valid saved position, otherwise choose the closest free tile center.
 * Equal distances use row then column ordering. Returns null when the map is full.
 */
export function closestValidUnoccupiedSpawn(
  layout: ChannelMotionLayout,
  preferred: NavigationPoint,
  occupied: ReadonlyArray<NavigationPoint> = [],
): NavigationPoint | null {
  if (!finitePoint(preferred)) return null;
  const actors = [...layout.npcs, ...occupied].filter(finitePoint);
  const available = (point: NavigationPoint) =>
    layout.canStandAt(point) &&
    actors.every(
      (actor) =>
        Math.hypot(actor.x - point.x, actor.y - point.y) >= ACTOR_RADIUS * 2 * CHANNEL_TILE_SIZE,
    );
  if (available(preferred)) return { ...preferred };
  let best: NavigationPoint | null = null,
    distance = Infinity;
  for (let y = 16; y < layout.bounds.height; y += 32) {
    for (let x = 16; x < layout.bounds.width; x += 32) {
      const nextDistance = Math.hypot(x - preferred.x, y - preferred.y);
      if (nextDistance < distance && available({ x, y })) {
        best = { x, y };
        distance = nextDistance;
      }
    }
  }
  return best;
}
