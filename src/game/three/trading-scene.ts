import * as T from "three";
import type { MapSnapshot } from "./bridge";
import type { MapObject } from "../../lib/object-types";
import { floorContours, insetContour } from "./office-footprint";
import { addOfficeFrameRuns, type FrameRun } from "./office-perimeter";
import { TRADING_ENTRANCE } from "./trading-layout";
import { round } from "./primitives";
import { concreteTexture } from "./tech-startup-scene";

export function isTradingMap(map: Pick<MapSnapshot, "environment" | "environmentVersion">) {
  return map.environment === "trading" && (map.environmentVersion ?? 0) >= 3;
}
export function tradingFrameRuns(map: Pick<MapSnapshot, "floor">): FrameRun[] {
  const runs: FrameRun[] = [];
  for (const contour of floorContours(map.floor)) {
    const p = insetContour(contour, 0.5);
    for (let i = 0; i < p.length; i++) {
      const a = p[i],
        b = p[(i + 1) % p.length];
      const height = a.z === 0.5 && b.z === 0.5 ? 2.85 : 1.25;
      if (
        a.z === TRADING_ENTRANCE.row + 0.5 &&
        b.z === a.z &&
        Math.min(a.x, b.x) < TRADING_ENTRANCE.fromCol &&
        Math.max(a.x, b.x) > TRADING_ENTRANCE.toCol
      ) {
        runs.push(
          { x1: Math.min(a.x, b.x), z1: a.z, x2: TRADING_ENTRANCE.fromCol, z2: b.z, height },
          { x1: TRADING_ENTRANCE.toCol + 1, z1: a.z, x2: Math.max(a.x, b.x), z2: b.z, height },
        );
      } else runs.push({ x1: a.x, z1: a.z, x2: b.x, z2: b.z, height });
    }
  }
  return runs;
}
/** Tile-neighbour joins: no half-cell holes or overlapping rails at corners. */
export function joinedPartitionSpan(object: MapObject, objects: readonly MapObject[]) {
  const vertical = object.direction === "right";
  let x = object.col + 0.5,
    z = object.row + 0.5,
    length = 1;
  for (const side of [-1, 1]) {
    const col = object.col + (vertical ? 0 : side),
      row = object.row + (vertical ? side : 0);
    const perpendicular = objects.some(
      (o) =>
        (o.type === "glass_partition" ||
          o.variant === "trading-perimeter" ||
          o.type === "cubicle_wall") &&
        o.col === col &&
        o.row === row &&
        (o.variant === "trading-perimeter" ||
          o.type === "cubicle_wall" ||
          (o.direction === "right") !== vertical),
    );
    if (perpendicular) {
      length += 0.5;
      if (vertical) z += side * 0.25;
      else x += side * 0.25;
    }
  }
  return { vertical, x, z, length };
}
export function addTradingArchitecture(root: T.Group, map: MapSnapshot) {
  const group = new T.Group();
  group.name = "trading-architecture";
  root.add(group);
  const grain = concreteTexture();
  grain.repeat.set(1, 1);
  const stone = new T.MeshStandardMaterial({
    color: "#c4bfb3",
    map: grain,
    bumpMap: grain,
    bumpScale: 0.018,
    roughness: 0.68,
  });
  // Geometric slabs follow the exact mask; the central notch is genuinely empty.
  for (const points of floorContours(map.floor)) {
    const shape = new T.Shape(points.map((p) => new T.Vector2(p.x, -p.z)));
    const geom = new T.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false });
    geom.rotateX(-Math.PI / 2);
    geom.translate(0, -0.36, 0);
    const slab = new T.Mesh(
      geom,
      new T.MeshStandardMaterial({ color: "#ceb48a", roughness: 0.76 }),
    );
    slab.receiveShadow = true;
    group.add(slab);
  }
  const cells = map.floor.flat().filter(Boolean).length;
  const tiles = new T.InstancedMesh(new T.BoxGeometry(0.986, 0.04, 0.986), stone, cells);
  const matrix = new T.Matrix4(),
    color = new T.Color();
  let i = 0;
  for (let z = 0; z < map.rows; z++)
    for (let x = 0; x < map.cols; x++) {
      if (!map.floor[z]?.[x]) continue;
      matrix.makeTranslation(x + 0.5, -0.025, z + 0.5);
      tiles.setMatrixAt(i, matrix);
      const shade = 1 + Math.sin(x * 31.7 + z * 13.1) * 0.018;
      tiles.setColorAt(i++, color.setRGB(shade, shade, shade));
    }
  tiles.name = "trading-stone-tiles";
  tiles.receiveShadow = true;
  group.add(tiles);
  const meetingWalls = addOfficeFrameRuns(group, tradingFrameRuns(map), "#e6e0d2", "#c3aa82");
  group.userData.meetingWalls = meetingWalls;
  for (const wall of meetingWalls) wall.userData.meetingWall = true;
  // Back-wall mural is scene-owned, with readiness observed before capture/batching.
  const mural = new T.Group();
  mural.name = "trading-world-mural";
  mural.position.set(map.cols / 2, 0, 0.61);
  group.add(mural);
  round(mural, 9.8, 2.9, 0.14, "#ede7da", 0, 1.55, 0, 0.012);
  mural.userData.assetStatus = "loading";
  mural.userData.sceneAssetUrl = "/assets/shared/trading/world-mural.webp";
  mural.userData.assetReady = new Promise<boolean>((resolve) => {
    new T.TextureLoader().load(
      mural.userData.sceneAssetUrl,
      (texture) => {
        if (!group.parent) {
          texture.dispose();
          resolve(false);
          return;
        }
        texture.colorSpace = T.SRGBColorSpace;
        const panel = new T.Mesh(
          new T.PlaneGeometry(9.5, 2.7),
          new T.MeshStandardMaterial({ map: texture, roughness: 0.94 }),
        );
        panel.position.set(0, 1.55, 0.08);
        mural.add(panel);
        mural.userData.assetStatus = "ready";
        resolve(true);
      },
      undefined,
      () => {
        mural.userData.assetStatus = "failed";
        resolve(false);
      },
    );
  });
  return group;
}
