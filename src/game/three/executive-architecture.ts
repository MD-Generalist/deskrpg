import { attachFurnitureAsset } from "./furniture-asset";
import * as T from "three";
import { round, sphere } from "./primitives";
import { surfaceTexture } from "./surface-detail";
import { EXECUTIVE_ZONES } from "./executive-room-layout";

/** Fixed cutaway shell: no camera-dependent wall hiding or transparent depth flicker. */
export function addExecutiveArchitecture(root: T.Group, cols: number, rows: number) {
  const wood = new T.MeshStandardMaterial({
    color: "#62422d",
    roughness: 0.52,
    map: surfaceTexture("wood", "color"),
    bumpMap: surfaceTexture("wood"),
    bumpScale: 0.025,
  });
  const brass = new T.MeshStandardMaterial({ color: "#b49355", metalness: 0.75, roughness: 0.3 });
  const stone = new T.MeshStandardMaterial({ color: "#d9cbb5", roughness: 0.38 });
  const frame = new T.MeshStandardMaterial({ color: "#454039", metalness: 0.55, roughness: 0.4 });
  const light = new T.MeshStandardMaterial({
    color: "#fff0c8",
    emissive: "#ffce7b",
    emissiveIntensity: 1.5,
  });
  const box = (w: number, h: number, d: number, m: T.Material, x: number, y: number, z: number) =>
    round(root, w, h, d, m, x, y, z, 0.025);
  // Large honed limestone tiles with subtle, deterministic mineral veins.
  for (let z = 0; z < rows; z += 2)
    for (let x = 0; x < cols; x += 2) {
      box(1.992, 0.035, 1.992, stone, x + 1, 0.012, z + 1);
      const points = Array.from(
        { length: 9 },
        (_, i) => new T.Vector3(x + i / 4, 0.032, z + 0.65 + 0.14 * Math.sin(i * 1.7 + x + z)),
      );
      root.add(
        new T.Line(
          new T.BufferGeometry().setFromPoints(points),
          new T.LineBasicMaterial({ color: "#cbbda7", transparent: true, opacity: 0.22 }),
        ),
      );
    }
  for (const zone of EXECUTIVE_ZONES.filter((z) => z.id !== "meeting")) {
    const rug = new T.MeshStandardMaterial({
      color: zone.color,
      map: surfaceTexture("fabric", "color"),
      roughness: 1,
    });
    if (zone.id === "ceo") {
      const asset = new T.Group();
      asset.position.set(zone.x + zone.width / 2, 0.045, zone.z + zone.depth / 2);
      round(asset, zone.width - 1, 0.026, zone.depth - 1, rug, 0, 0.013, 0);
      root.add(asset);
      void attachFurnitureAsset(asset, "rug");
    } else {
      box(
        zone.width - 1,
        0.035,
        zone.depth - 1,
        rug,
        zone.x + zone.width / 2,
        0.055,
        zone.z + zone.depth / 2,
      );
    }
  }
  // Continuous walnut side walls, recessed flutes and a single dark top rail.
  for (const x of [0.5, cols - 0.5]) {
    box(0.32, 3.8, rows - 1, wood, x, 1.9, rows / 2);
    box(0.42, 0.13, rows - 0.8, frame, x, 3.84, rows / 2);
    box(0.4, 0.22, rows - 1, frame, x, 0.11, rows / 2);
    for (let z = 1; z < rows - 1; z += 0.38)
      box(0.025, 3.55, 0.035, brass, x + (x < 1 ? 0.17 : -0.17), 1.9, z);
    for (const z of [3, 9, rows - 3]) {
      const inside = x + (x < 1 ? 0.25 : -0.25);
      box(0.13, 1.25, 0.14, brass, inside, 2.2, z);
      box(0.15, 1.02, 0.07, light, inside + (x < 1 ? 0.08 : -0.08), 2.2, z);
    }
    // Framed abstract diptych: geometry instead of externally licensed artwork.
    const inside = x + (x < 1 ? 0.21 : -0.21);
    box(0.08, 1.85, 2.5, brass, inside, 2.1, 8);
    box(0.1, 1.7, 2.35, stone, inside + (x < 1 ? 0.04 : -0.04), 2.1, 8);
    for (let i = 0; i < 3; i++)
      box(0.12, 0.55 + i * 0.23, 0.42, frame, inside + (x < 1 ? 0.07 : -0.07), 2, 7.35 + i * 0.62);
  }
  box(cols - 1, 0.16, 0.4, frame, cols / 2, 3.84, 0.5);
  box(cols - 1, 0.35, 0.4, wood, cols / 2, 0.18, 0.5);
  const glass = new T.MeshStandardMaterial({
    color: "#c6d6dd",
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    roughness: 0.2,
  });
  for (let x = 1; x < cols - 1; x += 2) {
    box(0.08, 3.6, 0.15, frame, x, 2, 0.5);
    const pane = box(1.9, 3.4, 0.025, glass, x + 1, 2, 0.5);
    pane.castShadow = false;
  }
  // Low front glazing keeps entry and occupants legible at the default camera angle.
  for (const [start, end] of [
    [0.5, Math.floor(cols / 2) - 1],
    [Math.floor(cols / 2) + 2, cols - 0.5],
  ]) {
    box(end - start, 0.07, 0.1, brass, (start + end) / 2, 0.95, rows - 0.5);
    box(end - start, 0.85, 0.025, glass, (start + end) / 2, 0.48, rows - 0.5).castShadow = false;
    for (const x of [start, end]) box(0.14, 1.02, 0.16, brass, x, 0.51, rows - 0.5);
  }
  // Restrained skyline and tree canopy behind the rear windows.
  for (let i = 0; i < Math.floor(cols / 1.85); i++) {
    const height = 1.1 + ((i * 7) % 11) * 0.21;
    box(
      0.65,
      height,
      0.55,
      new T.MeshStandardMaterial({ color: i % 2 ? "#b9c4c8" : "#aab8bf", roughness: 1 }),
      1.5 + i * 1.85,
      height / 2,
      -1.4,
    );
    sphere(root, 0.7, "#8c9c7b", 1.3 + i * 1.9, 0.45, -0.5, 1, 0.8, 0.7);
  }
}
