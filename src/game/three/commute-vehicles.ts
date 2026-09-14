import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CommuteMaterials, CommuteQuality } from "./commute-materials";
import { DEFAULT_COMMUTE_FLEET, type VehicleSpec, type VehicleState } from "./commute-motion";

export interface CommuteVehicle {
  readonly id: string;
  readonly kind: VehicleSpec["kind"];
  /** Local +X is front. Y=0 is the tire contact plane; no scale correction. */
  readonly root: T.Group;
  readonly wheels: readonly T.Group[];
  /** Vehicle-owned clones. Textures remain borrowed from the palette. */
  readonly materials: readonly T.MeshStandardMaterial[];
  update(state: VehicleState): void;
  dispose(): void;
}

/** Creates an unattached miniature. Body parts are merged by finish, wheels remain articulated. */
export function createCommuteVehicle(
  spec: VehicleSpec,
  palette: CommuteMaterials,
  quality: CommuteQuality = "desktop",
): CommuteVehicle {
  const root = new T.Group();
  root.name = `commute-vehicle:${spec.id}`;
  const { kind, length: l, wheelRadius: r } = spec;
  const bus = kind === "bus",
    van = kind === "van",
    suv = kind === "suv";
  const w = bus ? 1.65 : van ? 1.5 : suv ? 1.46 : 1.32;
  const base = r + (bus ? 0.31 : 0.19);
  const belt = bus ? 1.02 : van ? 0.91 : suv ? 0.88 : 0.71;
  const roof = bus ? 2.13 : van ? 1.86 : suv ? 1.62 : 1.35;
  const paint = {
    sedan: "#e7a68e",
    suv: "#9fb49a",
    taxi: "#f2cf65",
    van: "#efe8d8",
    bus: "#86b8b3",
  }[kind];
  // Deliberately clone directly: palette.clone() would register these with the palette.
  const clone = (source: T.MeshStandardMaterial, color?: string) => {
    const result = source.clone();
    if (color) result.color.set(color);
    return result;
  };
  const materials = [
    clone(palette.materials.vehiclePaint, spec.id === "sedan-west" ? "#b9bfd5" : paint),
    clone(palette.materials.glass, "#476669"),
    clone(palette.materials.rubber),
    clone(palette.materials.metal),
    clone(palette.materials.vehiclePaint, "#fff3ce"),
    clone(palette.materials.vehiclePaint, "#c87967"),
    clone(palette.materials.vehiclePaint, bus ? "#edcf85" : "#708c86"),
  ];
  materials[4].emissive.set("#fff0c0");
  materials[4].emissiveIntensity = 0.18;
  const parts: T.BufferGeometry[][] = materials.map(() => []);
  const geometries = new Set<T.BufferGeometry>();
  const box = (
    m: number,
    x: number,
    y: number,
    z: number,
    a: number,
    b: number,
    c: number,
    tilt = 0,
  ) => {
    const g = new RoundedBoxGeometry(
      a,
      b,
      c,
      quality === "desktop" ? 2 : 1,
      Math.min(0.065, a / 5, b / 5, c / 5),
    );
    g.rotateZ(tilt);
    g.translate(x, y, z);
    parts[m].push(g);
  };
  const mesh = (g: T.BufferGeometry, material: T.Material, parent: T.Object3D) => {
    geometries.add(g);
    const result = new T.Mesh(g, material);
    result.castShadow = true;
    result.receiveShadow = true;
    parent.add(result);
    return result;
  };
  // Bumpers define the exact physical length used by the traffic solver.
  box(0, 0, base, 0, l - 0.14, belt - base + 0.3, w);
  for (const side of [-1, 1]) {
    box(3, side * (l / 2 - 0.05), base - 0.12, 0, 0.1, 0.14, w * 0.9);
    box(2, 0, base - 0.18, (side * w) / 2, l * 0.72, 0.09, 0.06);
  }
  const cabStart = bus ? -l / 2 + 0.2 : van ? l * 0.13 : -l * 0.29;
  const cabEnd = bus ? l / 2 - 0.18 : l * (van ? 0.42 : suv ? 0.3 : 0.27);
  const cabLength = cabEnd - cabStart;
  if (van) {
    // Tall closed cargo box, separate low forward cab and parcel-service stripe.
    box(0, -l * 0.17, (belt + roof) / 2, 0, l * 0.59, roof - belt, w * 0.98);
    for (const side of [-1, 1]) {
      box(6, -l * 0.19, 1.17, side * w * 0.495, l * 0.41, 0.17, 0.025);
      box(3, -l / 2 + 0.085, 1.12, side * 0.14, 0.025, 0.32, 0.04);
    }
  }
  const cabRoof = van ? 1.52 : roof;
  // Warp the complete cabin (paint, glass and pillars) together: the roof is
  // narrower and shorter than the belt line, leaving proper sloping A/C pillars.
  const cabinBox = (...args: Parameters<typeof box>) => {
    box(...args);
    if (bus || van) return;
    const geometry = parts[args[0]][parts[args[0]].length - 1];
    const vertices = geometry.attributes.position;
    const center = (cabStart + cabEnd) / 2;
    for (let i = 0; i < vertices.count; i++) {
      const t = T.MathUtils.clamp((vertices.getY(i) - belt) / (cabRoof - belt), 0, 1);
      vertices.setX(i, center + (vertices.getX(i) - center) * (1 - t * (suv ? 0.31 : 0.38)));
      vertices.setZ(i, vertices.getZ(i) * (1 - t * 0.08));
    }
    geometry.computeVertexNormals();
  };
  cabinBox(
    0,
    (cabStart + cabEnd) / 2,
    (belt + cabRoof) / 2,
    0,
    cabLength,
    cabRoof - belt,
    w * 0.86,
  );
  cabinBox(0, (cabStart + cabEnd) / 2, cabRoof, 0, cabLength + 0.08, 0.1, w * 0.91);
  const windowHeight = cabRoof - belt - 0.17;
  const windows = bus ? 7 : van ? 1 : 2;
  for (const side of [-1, 1]) {
    for (let i = 0; i < windows; i++) {
      const spacing = cabLength / windows;
      cabinBox(
        1,
        cabStart + spacing * (i + 0.5),
        belt + windowHeight / 2 + 0.04,
        side * w * 0.435,
        spacing - 0.095,
        windowHeight,
        0.035,
      );
      if (i > 0)
        cabinBox(
          2,
          cabStart + spacing * i,
          belt + windowHeight / 2 + 0.04,
          side * w * 0.457,
          0.048,
          windowHeight + 0.025,
          0.02,
        );
      if (!bus)
        box(3, cabStart + spacing * (i + 0.3), belt - 0.055, side * w * 0.505, 0.13, 0.035, 0.035);
    }
    box(0, cabEnd - 0.06, belt + 0.08, side * (w / 2 + 0.07), 0.2, 0.12, 0.16);
    box(1, cabEnd - 0.165, belt + 0.08, side * (w / 2 + 0.075), 0.025, 0.085, 0.11);
    box(4, l / 2 - 0.081, base + 0.08, side * w * 0.33, 0.035, 0.15, w * 0.22);
    box(5, -l / 2 + 0.081, base + 0.1, side * w * 0.34, 0.035, 0.17, w * 0.17);
    if (bus) box(6, 0, belt - 0.12, side * w * 0.505, l * 0.92, 0.15, 0.025);
  }
  cabinBox(1, cabEnd + 0.015, belt + windowHeight / 2 + 0.04, 0, 0.04, windowHeight, w * 0.74);
  if (!van)
    cabinBox(1, cabStart - 0.015, belt + windowHeight / 2 + 0.04, 0, 0.04, windowHeight, w * 0.72);
  box(2, l / 2 - 0.079, base - 0.02, 0, 0.04, 0.12, w * 0.33);
  if (kind === "taxi") {
    box(4, -0.02, roof + 0.17, 0, 0.45, 0.23, 0.36);
    for (const side of [-1, 1])
      for (let i = 0; i < 4; i++)
        box(2, -0.165 + i * 0.11, roof + 0.16, side * 0.183, 0.045, 0.08, 0.014);
  }
  if (suv)
    for (const side of [-1, 1])
      box(3, -0.1, roof + 0.12, side * w * 0.34, cabLength * 0.65, 0.065, 0.055);
  if (bus) {
    box(0, -0.4, roof + 0.13, 0, 1.5, 0.18, 0.85);
    box(2, cabEnd + 0.02, roof - 0.13, 0, 0.035, 0.13, w * 0.65);
    box(4, cabEnd + 0.045, roof - 0.13, 0, 0.02, 0.065, w * 0.39);
  }
  for (const [i, list] of parts.entries()) {
    if (!list.length) continue;
    const merged = mergeGeometries(list, false)!;
    list.forEach((g) => g.dispose());
    mesh(merged, materials[i], root);
  }
  const wheels: T.Group[] = [];
  const tire = new T.CylinderGeometry(r, r, 0.18, quality === "desktop" ? 16 : 12);
  tire.rotateX(Math.PI / 2);
  const hub = new T.CylinderGeometry(r * 0.56, r * 0.56, 0.19, 10);
  hub.rotateX(Math.PI / 2);
  const spoke = new T.BoxGeometry(r * 1.16, r * 0.13, 0.2).toNonIndexed();
  const hubNonIndexed = hub.toNonIndexed();
  const wheelMetal = mergeGeometries([hubNonIndexed, spoke], false)!;
  hub.dispose();
  hubNonIndexed.dispose();
  spoke.dispose();
  for (const x of [-l * (bus ? 0.33 : 0.31), l * (bus ? 0.33 : 0.31)]) {
    for (const side of [-1, 1]) {
      const wheel = new T.Group();
      wheel.name = "wheel";
      wheel.position.set(x, r, side * w * 0.46);
      mesh(tire, materials[2], wheel);
      mesh(wheelMetal, materials[3], wheel);
      root.add(wheel);
      wheels.push(wheel);
    }
  }
  let disposed = false;
  return {
    id: spec.id,
    kind,
    root,
    wheels,
    materials,
    update(state) {
      if (disposed) return;
      root.position.set(state.x, 0, state.laneZ);
      root.rotation.y = state.direction === 1 ? 0 : Math.PI;
      root.visible = state.active && state.opacity > 0;
      const opacity = T.MathUtils.clamp(state.opacity, 0, 1);
      for (const material of materials) {
        const transparent = opacity < 1;
        if (material.transparent !== transparent) {
          material.transparent = transparent;
          material.needsUpdate = true;
        }
        material.opacity = opacity;
        material.depthWrite = !transparent;
      }
      // Local +X rolls about -Z. Root yaw supplies westbound world-axis reversal.
      for (const wheel of wheels) wheel.rotation.z = -state.cumulativeDistance / spec.wheelRadius;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      root.clear();
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}

export function createCommuteVehicles(
  palette: CommuteMaterials,
  {
    quality = "desktop",
    fleet = DEFAULT_COMMUTE_FLEET,
  }: { quality?: CommuteQuality; fleet?: readonly VehicleSpec[] } = {},
) {
  const root = new T.Group();
  root.name = "commute-vehicles";
  const vehicles = fleet.map((spec) => createCommuteVehicle(spec, palette, quality));
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  vehicles.forEach((v) => root.add(v.root));
  return {
    root,
    vehicles,
    update(states: readonly VehicleState[]) {
      states.forEach((state) => byId.get(state.id)?.update(state));
    },
    dispose() {
      vehicles.forEach((v) => v.dispose());
      root.removeFromParent();
    },
  };
}
