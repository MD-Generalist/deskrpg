import { computeOccupiedTiles, OBJECT_TYPES, type MapObject } from "./object-types";

/** Structural subset shared by persisted Tiled JSON, server navigation and UI previews. */
export type TiledGeometryMap = {
  width: number;
  height: number;
  layers: Array<{
    id: number;
    name: string;
    type: "tilelayer" | "objectgroup";
    data?: number[];
    objects?: Array<{
      id: number;
      type: string;
      x: number;
      y: number;
      width?: number;
      height?: number;
      properties?: Array<{ name: string; value: unknown }>;
    }>;
  }>;
};
export type TiledGeometrySnapshot = {
  cols: number;
  rows: number;
  floor: number[][];
  walls: number[][];
  objects: MapObject[];
  blocked: string[];
  tiled: true;
};

/** Project editor and game both keep server coordinates at 32 pixels per logical tile. */
export function projectTiledGeometry(map: TiledGeometryMap): TiledGeometrySnapshot {
  const tileLayers = map.layers.filter((layer) => layer.type === "tilelayer");
  const floorLayer = tileLayers.find((l) => l.name.toLowerCase() === "floor") || tileLayers[0];
  const wallsLayer = tileLayers.find((l) => l.name.toLowerCase() === "walls");
  const rows = (data?: number[]) =>
    Array.from({ length: map.height }, (_, row) =>
      Array.from({ length: map.width }, (_, col) => data?.[row * map.width + col] || 0),
    );
  const objects = map.layers
    .filter((l) => l.type === "objectgroup" && l.name.toLowerCase() !== "collision")
    .flatMap((layer) =>
      (layer.objects || [])
        .filter((o) => OBJECT_TYPES[o.type])
        .map((o) => ({
          id: `${layer.id}:${o.id}`,
          type: o.type,
          col: Math.floor(o.x / 32),
          row: Math.floor(o.y / 32),
          ...tiledDirection(o.properties),
          ...tiledVariant(o.properties),
          ...tiledDestinationTags(o.properties),
        })),
    );
  const blocked = computeOccupiedTiles(objects);
  for (const layer of map.layers.filter((l) => l.name.toLowerCase() === "collision")) {
    if (layer.type === "tilelayer")
      layer.data?.forEach((gid, i) => {
        if (gid) blocked.add(`${i % map.width},${Math.floor(i / map.width)}`);
      });
    else
      for (const object of layer.objects || []) {
        for (
          let y = Math.floor(object.y / 32);
          y < Math.ceil((object.y + (object.height || 32)) / 32);
          y++
        )
          for (
            let x = Math.floor(object.x / 32);
            x < Math.ceil((object.x + (object.width || 32)) / 32);
            x++
          )
            blocked.add(`${x},${y}`);
      }
  }
  return {
    cols: map.width,
    rows: map.height,
    floor: rows(floorLayer?.data),
    walls: rows(wallsLayer?.data),
    objects,
    blocked: [...blocked],
    tiled: true,
  };
}

export function tiledDirection(properties?: Array<{ name: string; value: unknown }>): {
  direction?: MapObject["direction"];
} {
  const value = properties?.find((p) => p.name === "direction")?.value;
  return value === "up" || value === "down" || value === "left" || value === "right"
    ? { direction: value }
    : {};
}

export function tiledVariant(properties?: Array<{ name: string; value: unknown }>): {
  variant?: string;
} {
  const value = properties?.find((p) => p.name === "variant")?.value;
  return typeof value === "string" ? { variant: value } : {};
}

export function tiledDestinationTags(properties?: Array<{ name: string; value: unknown }>): {
  destinationTags?: readonly string[];
} {
  const value = properties?.find((property) => property.name === "destinationTags")?.value;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) && parsed.every((tag) => typeof tag === "string")
      ? { destinationTags: parsed }
      : {};
  } catch {
    return {};
  }
}
