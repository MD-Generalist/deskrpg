import { projectTiledGeometry, type TiledGeometryMap } from "./tiled-geometry";
import { parseDbJson } from "./db-json";
import {
  computeOccupiedTiles,
  detectAndConvertMapData,
  TILE_ID_TO_OBJECT,
  type MapObject,
} from "./object-types";
import {
  ACTOR_RADIUS,
  clearSegment,
  type NavigationPoint,
  type Walkable,
} from "../game/navigation";
import { isCreativeStudioMap, effectiveMapSpawn } from "./effective-map-spawn";
import { furnitureSeats } from "../game/three/seating";

export const CHANNEL_TILE_SIZE = 32;
export type ChannelMotionLayout = {
  /** v3 homes are runtime allocations; roster changes may require relocation. */
  sanitizedHomes?: boolean;
  npcs: Array<NavigationPoint & { id: string }>;
  seats: Array<NavigationPoint & { id: string }>;
  bounds: { width: number; height: number };
  /** Logical tile indices, matching GameScene navigation. */
  isWalkable: Walkable;
  /** Pixel coordinates, including actor body clearance at wall corners. */
  canStandAt: (point: NavigationPoint) => boolean;
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const dimension = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 4096;
const grid = (value: unknown): value is number[][] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((row) => Array.isArray(row) && row.every(Number.isFinite));
const finitePoint = (point: NavigationPoint) =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

/** Read the persisted snapshot, never regenerate a themed map over user edits. */
export function deriveChannelMotionLayout(
  channel: { mapData: unknown; mapConfig?: unknown },
  npcRows: ReadonlyArray<{ id: string; positionX: number; positionY: number }>,
): ChannelMotionLayout | null {
  const data = parseDbJson(channel.mapData);
  if (!data) return null;
  let cols: number, rows: number, objects: MapObject[], blocked: Set<string>;
  try {
    if (record(data) && "tiledversion" in data) {
      if (!dimension(data.width) || !dimension(data.height) || !Array.isArray(data.layers))
        return null;
      const snapshot = projectTiledGeometry(data as unknown as TiledGeometryMap);
      cols = snapshot.cols;
      rows = snapshot.rows;
      objects = snapshot.objects;
      blocked = new Set(snapshot.blocked);
      // GameScene retains legacy WALL=2 handling only without a Collision tile layer.
      const collisionLayer = (data as unknown as TiledGeometryMap).layers.find(
        (layer) => layer.type === "tilelayer" && layer.name.toLowerCase() === "collision",
      );
      if (!collisionLayer?.data)
        snapshot.walls.forEach((row, y) =>
          row.forEach((tile, x) => {
            if (tile === 2) blocked.add(`${x},${y}`);
          }),
        );
    } else {
      // The legacy scene uses a fixed 40x30 tilemap; mapConfig only supplies spawn.
      const recognizable =
        grid(data) ||
        (record(data) &&
          ((record(data.layers) &&
            grid(data.layers.floor) &&
            grid(data.layers.walls) &&
            Array.isArray(data.objects)) ||
            (grid(data.floor) && grid(data.walls) && grid(data.furniture))));
      if (!recognizable) return null;
      const legacy = detectAndConvertMapData(data, 40, 30);
      cols = 40;
      rows = 30;
      objects = legacy.objects;
      blocked = computeOccupiedTiles(objects);
      legacy.layers.walls.forEach((row, y) =>
        row.forEach((tile, x) => {
          if (tile === 2) blocked.add(`${x},${y}`);
        }),
      );
      // Renderer also derives visible legacy furniture from tile layers.
      objects = [
        ...objects,
        ...[legacy.layers.floor, legacy.layers.walls].flatMap((layer, index) =>
          layer.flatMap((row, y) =>
            row.flatMap((tile, x) =>
              TILE_ID_TO_OBJECT[tile]
                ? [{ id: `tile-${index}-${x}-${y}`, type: TILE_ID_TO_OBJECT[tile], col: x, row: y }]
                : [],
            ),
          ),
        ),
      ];
    }
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
    const studio = isCreativeStudioMap(data);
    const spawn = effectiveMapSpawn(data, channel.mapConfig);
    const npcs = npcRows
      .filter(
        (npc) => studio || (Number.isInteger(npc.positionX) && Number.isInteger(npc.positionY)),
      )
      .map((npc) => ({
        id: npc.id,
        x: Number.isInteger(npc.positionX) ? (npc.positionX + 0.5) * 32 : NaN,
        y: Number.isInteger(npc.positionY) ? (npc.positionY + 0.5) * 32 : NaN,
      }));
    const seats = new Map<string, NavigationPoint & { id: string }>();
    for (const seat of furnitureSeats(objects)) {
      const x = (seat.anchorX ?? seat.x) * 32,
        y = (seat.anchorZ ?? seat.z) * 32;
      if (canStandAt({ x, y })) seats.set(`${x}:${y}`, { id: `${x}:${y}`, x, y });
    }
    // Historical profile assignments stay in the DB. Only v3 runtime homes are repaired.
    if (studio) {
      const occupied: NavigationPoint[] = [];
      // Reserve valid homes first, before assigning invalid actors to nearby seats.
      const ordered = [...npcs].sort(
        (a, b) => Number(canStandAt(b)) - Number(canStandAt(a)) || a.id.localeCompare(b.id),
      );
      for (const npc of ordered) {
        const malformed = !finitePoint(npc);
        if (malformed) {
          npc.x = ((spawn?.col ?? 1) + 0.5) * 32;
          npc.y = ((spawn?.row ?? 1) + 0.5) * 32;
        }
        const available = (point: NavigationPoint) =>
          canStandAt(point) &&
          occupied.every(
            (other) => Math.hypot(point.x - other.x, point.y - other.y) >= ACTOR_RADIUS * 2 * 32,
          );
        if (malformed || !available(npc)) {
          const candidates = [...seats.values()]
            .filter(available)
            .sort(
              (a, b) =>
                Math.hypot(a.x - npc.x, a.y - npc.y) - Math.hypot(b.x - npc.x, b.y - npc.y) ||
                a.y - b.y ||
                a.x - b.x,
            );
          const replacement =
            candidates[0] ??
            closestValidUnoccupiedSpawn(
              {
                npcs: [],
                seats: [],
                bounds: { width: cols * 32, height: rows * 32 },
                isWalkable,
                canStandAt,
              },
              npc,
              occupied,
            );
          if (!replacement) return null;
          npc.x = replacement.x;
          npc.y = replacement.y;
        }
        occupied.push(npc);
      }
    }
    return {
      ...(studio ? { sanitizedHomes: true } : {}),
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
