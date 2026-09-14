import type { TiledMap, TilesetImageInfo } from "../../components/map-editor/hooks/useMapEditor";
import { projectTiledGeometry } from "../../lib/tiled-geometry";
import type { MapSnapshot } from "./bridge";
import { resolveOfficeEnvironment } from "./office-environment-theme";

/** UI-only metadata stays outside the shared server geometry dependency graph. */
export function tiledSnapshot(map: TiledMap): MapSnapshot {
  return { ...projectTiledGeometry(map), environment: resolveOfficeEnvironment(map) };
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
