import * as T from "three";
import { round, cylinder } from "./primitives";
import { createActor } from "./characters";
import { OFFICE_LOOKS } from "./office-looks";
import { batchStaticFurniture } from "./static-batching";
import {
  createCommuteMaterials,
  type CommuteMaterialName,
  type CommuteQuality,
} from "./commute-materials";
import { createCommuteTree } from "./commute-trees";
import { createCommuteVehicles } from "./commute-vehicles";
import { createCommuteMotion } from "./commute-motion";
import { createCommuteWalker } from "./commute-walk";

/** A miniature morning district. Only commuters move; architecture is batched once. */
export function createCommuteCity(
  options: { quality?: CommuteQuality; actorFactory?: typeof createActor } = {},
) {
  let quality = options.quality ?? "desktop";
  const palette = createCommuteMaterials({ quality });
  const trees: ReturnType<typeof createCommuteTree>[] = [];
  const signTextures: T.Texture[] = [];
  let disposed = false,
    initialized = false;
  const root = new T.Group();
  const streets = new T.Group();
  root.add(streets);
  const stone = "#e9e1cc",
    ink = "#39584e",
    glass = "#83b4b1";
  const box = (
    w: number,
    h: number,
    d: number,
    color: string,
    x: number,
    y: number,
    z: number,
    finish?: CommuteMaterialName,
  ) => {
    const name =
      finish ??
      ([glass, "#74a4a2", "#709d98", "#85a6a0"].includes(color)
        ? "glass"
        : color === "#b9966e"
          ? "wood"
          : color === ink
            ? "metal"
            : "facade");
    // Static batching owns these clones; the palette retains texture ownership.
    const material = palette.materials[name].clone();
    material.color.set(color);
    const mesh = round(streets, w, h, d, material, x, y, z, Math.min(0.06, h / 4));
    // Project grain in world units on each box face before the meshes are baked.
    const uv = mesh.geometry.getAttribute("uv");
    const normal = mesh.geometry.getAttribute("normal");
    const position = mesh.geometry.getAttribute("position");
    const density = name === "asphalt" ? 2 : name === "paving" ? 0.5 : 1;
    for (let i = 0; i < uv.count; i++) {
      const nx = Math.abs(normal.getX(i)),
        ny = Math.abs(normal.getY(i));
      uv.setXY(
        i,
        (nx > 0.7 ? position.getZ(i) : position.getX(i)) * density,
        (ny > 0.7 ? position.getZ(i) : position.getY(i)) * density,
      );
    }
    return mesh;
  };

  // A broad avenue, raised pavement and a small planted headquarters plaza.
  box(38, 0.65, 21, "#cfc8b7", 0, -0.5, 0);
  box(38, 0.12, 6.2, "#879997", 0, -0.13, 5.8, "asphalt");
  box(38, 0.2, 11.5, stone, 0, -0.1, -3, "paving");
  box(38, 0.22, 2.5, "#e9e4d4", 0, -0.06, 10.1, "paving");
  for (let x = -18; x < 19; x += 2.5) box(1.15, 0.015, 0.065, "#f7edd0", x, -0.055, 5.8);
  for (const z of [2.76, 8.8]) box(38, 0.03, 0.12, "#faf1dc", 0, 0.025, z);
  for (let z = 3.15; z < 8.7; z += 0.7) box(2.7, 0.022, 0.36, "#f6f0de", 2.4, -0.043, z);
  for (let x = -18; x < 19; x += 1.6) box(0.018, 0.009, 2.55, "#d2ccbb", x, 0.014, 1.3);

  function sign(text: string, x: number, y: number, z: number, width: number, color = ink) {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 192;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff6de";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "600 66px sans-serif";
    ctx.fillText(text, 512, 100);
    const texture = new T.CanvasTexture(canvas);
    signTextures.push(texture);
    texture.colorSpace = T.SRGBColorSpace;
    const mesh = new T.Mesh(
      new T.PlaneGeometry(width, (width * 192) / 1024),
      new T.MeshBasicMaterial({ map: texture }),
    );
    mesh.position.set(x, y, z);
    streets.add(mesh);
  }

  function building(
    x: number,
    z: number,
    w: number,
    d: number,
    floors: number,
    color: string,
    headquarters = false,
  ) {
    const height = floors * 1.22 + 1.65;
    box(w, height, d, color, x, height / 2, z);
    box(w + 0.22, 0.2, d + 0.22, ink, x, height + 0.1, z);
    box(w - 0.42, 0.13, d - 0.42, "#bdc8ba", x, height + 0.25, z);
    const columns = Math.max(2, Math.floor(w / 0.95));
    for (let floor = 0; floor < floors; floor++) {
      const y = 2.35 + floor * 1.22;
      box(w + 0.035, 0.09, d + 0.035, "#f7eedb", x, y - 0.5, z);
      for (let col = 0; col < columns; col++) {
        const wx = x - w / 2 + ((col + 0.5) * w) / columns;
        box(
          w / columns - 0.22,
          0.82,
          0.055,
          (floor + col) % 6 === 0 ? "#e1dcb0" : glass,
          wx,
          y,
          z + d / 2 + 0.032,
        );
        box(0.035, 0.83, 0.08, "#c5d6c8", wx, y, z + d / 2 + 0.07);
      }
      for (let side = 0; side < Math.floor(d); side++) {
        box(0.045, 0.82, 0.66, "#74a4a2", x + w / 2 + 0.025, y, z - d / 2 + 0.5 + side);
      }
    }
    // Glazed lobby with an overhanging canopy and solid door mullions.
    box(w - 0.65, 1.25, 0.06, "#709d98", x, 0.7, z + d / 2 + 0.04);
    for (let dx = -w / 2 + 0.45; dx < w / 2; dx += 0.85)
      box(0.06, 1.28, 0.1, "#e9dfc8", x + dx, 0.7, z + d / 2 + 0.1);
    box(w + 0.3, 0.15, 1.05, headquarters ? ink : "#c3ad8a", x, 1.6, z + d / 2 + 0.35);
    if (headquarters) {
      sign("DeskRPG for Hermes", x, 1.28, z + d / 2 + 0.89, w - 0.3);
      box(1.8, 0.45, 1.15, "#97afa2", x + 0.5, height + 0.5, z);
      for (let i = 0; i < 4; i++)
        box(1.5, 0.03, 0.07, ink, x + 0.5, height + 0.74, z - 0.4 + i * 0.25);
    }
  }
  // Unequal rooflines and actual side facades reveal depth as the camera moves.
  building(-12.8, -3.3, 4.1, 4.8, 4, "#c5d2c4");
  building(-7.5, -4.4, 4.2, 5.2, 6, "#ece2cb");
  building(0, -4.9, 6.2, 6, 7, "#dedfca", true);
  building(7.6, -4.7, 5.1, 5.6, 5, "#b8ceca");
  building(13.8, -3.9, 4.5, 5, 8, "#e7d9bf");
  // A café tucked between the towers.
  box(3.2, 2.5, 2.3, "#efdfc2", -7.4, 1.25, -0.5);
  box(2.8, 1.6, 0.05, "#85a6a0", -7.4, 0.86, 0.68);
  box(3.5, 0.15, 1.25, "#ba8463", -7.4, 2.05, 1);
  sign("MORNING COFFEE", -7.4, 2.31, 0.69, 2.8, "#956c50");
  for (const x of [-8.4, -6.4]) {
    cylinder(streets, 0.4, 0.4, 0.09, "#c3a481", x, 0.65, 1.2);
    cylinder(streets, 0.05, 0.09, 0.6, ink, x, 0.32, 1.2);
  }

  function tree(x: number, z: number, size = 1) {
    box(1.25, 0.24, 1.15, "#c0bd9f", x, 0.12, z);
    box(1.1, 0.03, 1, "#91a87a", x, 0.255, z);
    const tree = createCommuteTree(palette, { seed: 47 + trees.length, size, quality });
    tree.group.name = "commute-tree";
    tree.group.position.set(x, 0.27, z);
    tree.group.userData.size = size;
    trees.push(tree);
    root.add(tree.group);
  }
  for (const x of [-16.8, -10.3, -4.2, 4.5, 10.5, 17.2]) tree(x, 1.15, x === -4.2 ? 0.85 : 1);
  for (const x of [-13, -4, 8, 16]) tree(x, 10.1, 0.85);
  for (const x of [-15, -2.9, 11.5]) {
    cylinder(streets, 0.045, 0.07, 3.5, ink, x, 1.75, 2.65);
    box(0.9, 0.07, 0.09, ink, x + 0.35, 3.5, 2.65);
    box(0.45, 0.12, 0.23, "#e9d9a6", x + 0.7, 3.44, 2.65);
  }
  for (const x of [-11, 6]) {
    box(1.65, 0.12, 0.46, "#b9966e", x, 0.5, 0.9);
    box(1.65, 0.45, 0.09, "#b9966e", x, 0.8, 0.7);
    for (const dx of [-0.6, 0.6]) box(0.08, 0.45, 0.42, ink, x + dx, 0.23, 0.9);
  }
  batchStaticFurniture(streets, true, { vertexColors: true });
  const motion = createCommuteMotion();
  let vehicles = createCommuteVehicles(palette, { quality });
  vehicles.root.name = "commute-vehicles";
  vehicles.root.position.y = -0.07;
  root.add(vehicles.root);
  vehicles.update(motion.vehicles);

  const commuters = [0, 2, 5, 8, 11, 3].map((lookIndex, index) => {
    const look = OFFICE_LOOKS[lookIndex];
    const actor = (options.actorFactory ?? createActor)(
      `commuter-${index}`,
      look.coat,
      index,
      undefined,
      look,
      { distanceWalk: true },
    );
    actor.ring.visible = false;
    actor.root.scale.setScalar(1.15);
    root.add(actor.root);
    const commuter = {
      actor,
      start: -15 + index * 5.3,
      direction: index % 3 === 0 ? -1 : 1,
      lane: index % 2 ? 9.3 : 2.1,
      walker: createCommuteWalker(1.7),
      frame: { cumulativeDistance: 0 },
    };
    return commuter;
  });
  return {
    root,
    ready: Promise.all(
      commuters.map(async (commuter) => {
        const { actor } = commuter;
        const ready = "ready" in actor ? await actor.ready : true;
        if (!disposed) actor.update(motion.elapsed, true, "walking", false, commuter.frame);
        return ready;
      }),
    ),
    setQuality(next: CommuteQuality) {
      if (disposed || next === quality) return;
      quality = next;
      // Preserve actors, gait phase, traffic state and camera across the breakpoint.
      for (let i = 0; i < trees.length; i++) {
        const previous = trees[i];
        const replacement = createCommuteTree(palette, {
          seed: 47 + i,
          size: previous.group.userData.size,
          quality,
        });
        replacement.group.name = "commute-tree";
        replacement.group.position.copy(previous.group.position);
        replacement.group.userData.size = previous.group.userData.size;
        previous.dispose();
        trees[i] = replacement;
        root.add(replacement.group);
      }
      vehicles.dispose();
      vehicles = createCommuteVehicles(palette, { quality });
      vehicles.root.name = "commute-vehicles";
      vehicles.root.position.y = -0.07;
      root.add(vehicles.root);
      vehicles.update(motion.vehicles);
    },
    update(time: number, moving: boolean) {
      if (disposed) return;
      motion.update(time, moving);
      vehicles.update(motion.vehicles);
      for (const commuter of commuters) {
        const { actor, start, direction, lane, walker } = commuter;
        const frame = walker.update(time, moving);
        commuter.frame = frame;
        if (!moving && initialized) continue;
        const x = ((((start + direction * frame.cumulativeDistance + 18) % 36) + 36) % 36) - 18;
        actor.root.position.set(x, 0.03, lane);
        actor.rig.rotation.y = (direction * Math.PI) / 2;
        actor.update(motion.elapsed, true, "walking", false, frame);
      }
      initialized = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { actor } of commuters) if ("dispose" in actor) actor.dispose();
      vehicles.dispose();
      for (const tree of trees) tree.dispose();
      const geometries = new Set<T.BufferGeometry>();
      const materials = new Set<T.Material>();
      streets.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          materials.add(material);
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      signTextures.forEach((t) => t.dispose());
      palette.dispose();
      root.clear();
    },
  };
}
