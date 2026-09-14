import { ACTOR_RADIUS } from "./navigation";
/** Map-owned tile rectangles. No environment names or room coordinates in the scheduler. */
export type AmbientZone = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  roaming: boolean;
};
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
    return zones.filter(
      (z): z is AmbientZone =>
        !!z &&
        typeof z.id === "string" &&
        ["x", "y", "width", "height"].every((k) => Number.isInteger(z[k])) &&
        z.width > 0 &&
        z.height > 0 &&
        typeof z.roaming === "boolean",
    );
  } catch {
    return [];
  }
}
function contains(zone: AmbientZone, x: number, y: number) {
  return x >= zone.x && y >= zone.y && x < zone.x + zone.width && y < zone.y + zone.height;
}
export function ambientTileAllowed(zones: AmbientZone[], x: number, y: number) {
  return !zones.some((z) => !z.roaming && contains(z, x, y));
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
