import {
  ACTOR_RADIUS,
  clearSegment,
  findPath,
  type NavigationPoint,
  type Walkable,
} from "./navigation";
/** Map-owned tile rectangles. No environment names or room coordinates in the scheduler. */
export type AmbientZone = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  roaming: boolean;
  access?: "ambient" | "purpose-only";
  destinationTags?: readonly string[];
  /** Traversable rectangles that idle movement may not choose as a stopping point. */
  destinationExclusions?: readonly AmbientArea[];
};
export type AmbientArea = { x: number; y: number; width: number; height: number };

function validArea(value: unknown): value is AmbientArea {
  if (!value || typeof value !== "object") return false;
  const area = value as Record<string, unknown>;
  return (
    ["x", "y", "width", "height"].every((key) => Number.isInteger(area[key])) &&
    Number(area.width) > 0 &&
    Number(area.height) > 0
  );
}

function validZone(value: unknown): value is AmbientZone {
  if (!value || typeof value !== "object") return false;
  const zone = value as Record<string, unknown>;
  if (
    typeof zone.id !== "string" ||
    !["x", "y", "width", "height"].every((key) => Number.isInteger(zone[key])) ||
    Number(zone.width) <= 0 ||
    Number(zone.height) <= 0 ||
    typeof zone.roaming !== "boolean"
  )
    return false;
  const access = zone.access;
  if (access !== undefined && access !== "ambient" && access !== "purpose-only") return false;
  if (access !== undefined && zone.roaming !== (access === "ambient")) return false;
  if (
    zone.destinationTags !== undefined &&
    (!Array.isArray(zone.destinationTags) ||
      zone.destinationTags.length === 0 ||
      !zone.destinationTags.every((tag) => typeof tag === "string" && tag.length > 0))
  )
    return false;
  if (access !== undefined && zone.destinationTags === undefined) return false;
  if (zone.destinationExclusions === undefined) return true;
  if (!Array.isArray(zone.destinationExclusions)) return false;
  return zone.destinationExclusions.every(
    (candidate) =>
      validArea(candidate) &&
      candidate.x >= Number(zone.x) &&
      candidate.y >= Number(zone.y) &&
      candidate.x + candidate.width <= Number(zone.x) + Number(zone.width) &&
      candidate.y + candidate.height <= Number(zone.y) + Number(zone.height),
  );
}
export function readAmbientZones(map: Record<string, unknown>): AmbientZone[] {
  const layers = map.layers;
  if (!Array.isArray(layers)) return [];
  const layer = layers.find(
    (l) => l?.type === "objectgroup" && String(l.name).toLowerCase() === "objects",
  );
  const raw = layer?.properties?.find((p: { name: string }) => p.name === "ambientZones")?.value;
  if (typeof raw !== "string") return [];
  try {
    const zones: unknown = JSON.parse(raw);
    if (!Array.isArray(zones)) return [];
    return zones.filter(validZone);
  } catch {
    return [];
  }
}
function contains(zone: AmbientZone, x: number, y: number) {
  return x >= zone.x && y >= zone.y && x < zone.x + zone.width && y < zone.y + zone.height;
}
function containsArea(area: AmbientArea, x: number, y: number) {
  return x >= area.x && y >= area.y && x < area.x + area.width && y < area.y + area.height;
}
export function ambientTileAllowed(zones: AmbientZone[], x: number, y: number) {
  const containing = zones.filter((zone) => contains(zone, x, y));
  if (
    containing.some(
      (zone) =>
        !zone.roaming || zone.destinationExclusions?.some((area) => containsArea(area, x, y)),
    )
  )
    return false;
  if (containing.some((zone) => zone.roaming && zone.access !== "purpose-only")) return true;
  // Modern studio metadata makes unzoned circulation traversable but not an idle destination.
  return !zones.some((zone) => zone.access !== undefined);
}

/** Explicit actions may target tagged purpose-only zones; omitted tags keep random-stop policy. */
export function destinationTileAllowed(
  zones: AmbientZone[],
  x: number,
  y: number,
  destinationTag?: string,
) {
  if (!destinationTag) return ambientTileAllowed(zones, x, y);
  const containing = zones.filter((zone) => contains(zone, x, y));
  if (!containing.length) return !zones.some((zone) => zone.access !== undefined);
  return containing.some(
    (zone) =>
      zone.destinationTags?.includes(destinationTag) &&
      !zone.destinationExclusions?.some((area) => containsArea(area, x, y)),
  );
}

/** Resolve an explicit tagged action through circulation into its matching purpose zone. */
export function findTaggedDestinationPath(
  zones: AmbientZone[],
  destinationTag: string,
  start: NavigationPoint,
  destination: NavigationPoint,
  walkable: Walkable,
  segmentAllowed: (from: NavigationPoint, to: NavigationPoint) => boolean = () => true,
  accessOrigin: NavigationPoint = start,
) {
  if (!destinationTileAllowed(zones, destination.x, destination.y, destinationTag)) return null;
  const permitted: Walkable = (x, y) =>
    walkable(x, y) && taggedPathTileAllowed(zones, destinationTag, accessOrigin, x, y);
  return findPath(
    start.x,
    start.y,
    destination.x,
    destination.y,
    permitted,
    (from, to) => clearSegment(from, to, permitted) && segmentAllowed(from, to),
  );
}

/** Purpose actions may exit their origin zone and enter only zones matching their tag. */
export function taggedPathTileAllowed(
  zones: AmbientZone[],
  destinationTag: string,
  origin: NavigationPoint,
  x: number,
  y: number,
) {
  return !zones.some(
    (zone) =>
      !zone.roaming &&
      contains(zone, x, y) &&
      !contains(zone, origin.x, origin.y) &&
      !zone.destinationTags?.includes(destinationTag),
  );
}
/** A worker starting in an excluded room may leave it; never choose a destination inside it. */
export function ambientPathAllowed(
  zones: AmbientZone[],
  x: number,
  y: number,
  start: { x: number; y: number },
) {
  return !zones.some((z) => !z.roaming && contains(z, x, y) && !contains(z, start.x, start.y));
}

/** One excursion's exit-only permits. Coordinates use navigation's tile-center convention. */
export class AmbientExitPolicy {
  private exiting: Set<AmbientZone>;
  constructor(
    private zones: AmbientZone[],
    origin: { x: number; y: number },
  ) {
    this.exiting = new Set(
      zones.filter(
        (zone) =>
          !zone.roaming && contains(zone, Math.floor(origin.x + 0.5), Math.floor(origin.y + 0.5)),
      ),
    );
  }
  /** Call once for the actual body position, never with A* candidate positions. */
  at(position: { x: number; y: number }, radius = ACTOR_RADIUS) {
    for (const zone of this.exiting) {
      // Match clearSegment's expanded tile AABBs. Keep the permit until the whole body clears.
      const outside =
        position.x < zone.x - 0.5 - radius ||
        position.y < zone.y - 0.5 - radius ||
        position.x > zone.x + zone.width - 0.5 + radius ||
        position.y > zone.y + zone.height - 0.5 + radius;
      if (outside) this.exiting.delete(zone);
    }
    return (x: number, y: number) =>
      !this.zones.some((zone) => !zone.roaming && contains(zone, x, y) && !this.exiting.has(zone));
  }
}
