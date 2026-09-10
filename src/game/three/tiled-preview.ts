import type { TiledMap, TilesetImageInfo } from "../../components/map-editor/hooks/useMapEditor";
import { computeOccupiedTiles, OBJECT_TYPES } from "../../lib/object-types";
import type { MapSnapshot } from "./bridge";

/** Project editor and game both keep server coordinates at 32 pixels per logical tile. */
export function tiledSnapshot(map: TiledMap): MapSnapshot {
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

export function drawTiledArtwork(
  map: TiledMap,
  images: Record<number, TilesetImageInfo>,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = map.width * 32;
  canvas.height = map.height * 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const tilesets = Object.values(images).sort((a, b) => b.firstgid - a.firstgid);
  const depth = (layer: TiledMap["layers"][number]) =>
    Number(layer.properties?.find((p) => p.name === "depth")?.value) || 0;
  for (const layer of [...map.layers].sort((a, b) => depth(a) - depth(b))) {
    if (layer.type !== "tilelayer" || !layer.visible || layer.name.toLowerCase() === "collision")
      continue;
    ctx.globalAlpha = layer.opacity;
    layer.data?.forEach((raw, i) => {
      const gid = raw & 0x1fffffff;
      if (!gid) return;
      const ts = tilesets.find((t) => gid >= t.firstgid && gid < t.firstgid + t.tilecount);
      if (!ts) return;
      const local = gid - ts.firstgid;
      ctx.save();
      ctx.translate((i % map.width) * 32 + 16, Math.floor(i / map.width) * 32 + 16);
      // Tiled: diagonal flip precedes horizontal and vertical flips.
      ctx.scale(raw & 0x80000000 ? -1 : 1, raw & 0x40000000 ? -1 : 1);
      if (raw & 0x20000000) ctx.transform(0, 1, 1, 0, 0, 0);
      ctx.drawImage(
        ts.img,
        (local % ts.columns) * ts.tilewidth,
        Math.floor(local / ts.columns) * ts.tileheight,
        ts.tilewidth,
        ts.tileheight,
        -16,
        -16,
        32,
        32,
      );
      ctx.restore();
    });
  }
  return canvas;
}
