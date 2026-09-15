import { parseDbObject } from "./db-json";

export function isCreativeStudioMap(mapData: unknown): boolean {
  const map = parseDbObject(mapData);
  const layers = Array.isArray(map?.layers)
    ? (map.layers as Array<{ properties?: Array<{ name: string; value: unknown }> }>)
    : [];
  return layers.some(
    (layer) =>
      layer.properties?.some((p) => p.name === "officeEnvironment" && p.value === "agency") &&
      layer.properties?.some(
        (p) => p.name === "officeEnvironmentVersion" && typeof p.value === "number" && p.value >= 3,
      ),
  );
}

type Point = { col: number; row: number };
/** Tiled is authoritative for creative-studio v3+; legacy maps retain configured spawn. */
export function effectiveMapSpawn(mapData: unknown, mapConfig?: unknown): Point | null {
  const map = parseDbObject(mapData),
    config = parseDbObject(mapConfig);
  const layers = Array.isArray(map?.layers)
    ? (map.layers as Array<{
        type?: string;
        objects?: Array<{ name?: string; type?: string; x: number; y: number }>;
        properties?: Array<{ name: string; value: unknown }>;
      }>)
    : [];
  const studio = isCreativeStudioMap(map);
  const valid = (point: Point) =>
    Number.isInteger(point.col) &&
    Number.isInteger(point.row) &&
    point.col >= 0 &&
    point.row >= 0 &&
    (!map || (point.col < Number(map.width) && point.row < Number(map.height)));
  const configured = { col: Number(config?.spawnCol), row: Number(config?.spawnRow) };
  if (!studio && config?.spawnCol != null && config?.spawnRow != null && valid(configured))
    return configured;
  const spawn = layers
    .filter((l) => l.type === "objectgroup")
    .flatMap((l) => l.objects ?? [])
    .find((o) => o.name === "spawn" || o.type === "spawn");
  if (!spawn) return null;
  const point = {
    col: Math.floor(spawn.x / Number(map?.tilewidth ?? 32)),
    row: Math.floor(spawn.y / Number(map?.tileheight ?? 32)),
  };
  return valid(point) ? point : null;
}
