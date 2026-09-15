import * as T from "three";
import { getObjectDimensions, type MapObject } from "../../lib/object-types";
import { furnitureOffset } from "./executive-lounge-layout";
import { attachFurnitureSeats } from "./seat-picking";
import { round } from "./primitives";

/** Procedural assets use meters, floor origins and +Z fronts; safe to reuse in any map. */
export const TECH_STARTUP_ASSETS = {
  "tech-workstation": {
    type: "reception_desk",
    footprint: [2, 1],
    height: 1.16,
    tags: ["work", "development"],
  },
  "tech-server-rack": {
    type: "office_locker",
    footprint: [1, 1],
    height: 2.1,
    tags: ["technology", "server"],
  },
  "tech-phone-booth": {
    type: "office_locker",
    footprint: [1, 1],
    height: 2.25,
    tags: ["focus", "acoustic"],
  },
  "tech-hardware-bench": {
    type: "desk",
    footprint: [1, 1],
    height: 1.72,
    tags: ["work", "electronics"],
  },
  "tech-beanbag": {
    type: "office_armchair",
    footprint: [1, 1],
    height: 0.86,
    tags: ["lounge", "seat"],
  },
} as const;

export function buildTechStartupAsset(variant: keyof typeof TECH_STARTUP_ASSETS) {
  const root = new T.Group();
  root.name = variant;
  const materials: T.Material[] = [];
  const mat = (color: string, roughness = 0.6, metalness = 0) => {
    const material = new T.MeshStandardMaterial({ color, roughness, metalness });
    materials.push(material);
    return material;
  };
  const charcoal = mat("#262d33", 0.37, 0.72),
    silver = mat("#9ca5aa", 0.3, 0.8);
  const wood = mat("#cdb58c", 0.57),
    dark = mat("#111b24", 0.65);
  const box = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    m: T.Material = charcoal,
    radius = 0.018,
  ) => {
    // Sub-centimeter trim gets a six-face solid: bevel tessellation is invisible here.
    if (Math.min(w, h, d) < 0.06) {
      const item = new T.Mesh(new T.BoxGeometry(w, h, d), m);
      item.position.set(x, y, z);
      item.castShadow = item.receiveShadow = true;
      root.add(item);
      return item;
    }
    return round(root, w, h, d, m, x, y, z, Math.min(radius, w / 3, h / 3, d / 3));
  };
  const mesh = (
    geometry: T.BufferGeometry,
    material: T.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const result = new T.Mesh(geometry, material);
    result.position.set(x, y, z);
    result.castShadow = result.receiveShadow = true;
    root.add(result);
    return result;
  };
  if (variant === "tech-workstation") {
    box(1.98, 0.085, 0.96, 0, 0.84, 0, wood);
    for (const x of [-0.85, 0.85]) {
      for (const z of [-0.36, 0.36]) box(0.045, 0.79, 0.045, x, 0.395, z);
      box(0.055, 0.045, 0.78, x, 0.14, 0);
    }
    box(1.73, 0.065, 0.05, 0, 0.7, -0.35);
    box(0.23, 0.5, 0.45, 0.68, 0.28, -0.03, dark);
    box(0.17, 0.018, 0.008, 0.68, 0.46, 0.2, silver);
    box(1.68, 0.28, 0.027, 0, 1.02, -0.45, mat("#426477", 0.95)).name = "workstation-rear-divider";
    box(1.1, 0.022, 0.08, 0, 0.785, -0.32, dark);
  } else if (variant === "tech-server-rack") {
    box(0.83, 2.05, 0.86, 0, 1.055, 0);
    box(0.72, 1.83, 0.035, 0, 1.06, 0.441, dark);
    const led = mat("#4db9ff", 0.3);
    led.emissive.set("#1575cb");
    led.emissiveIntensity = 1.35;
    for (let i = 0; i < 10; i++) {
      const y = 0.24 + i * 0.17;
      box(0.65, 0.142, 0.048, 0, y, 0.469, charcoal, 0.005);
      for (const x of [-0.29, 0.29]) box(0.017, 0.07, 0.025, x, y, 0.485, silver);
      box(0.13, 0.016, 0.009, 0.15, y + 0.025, 0.481, led);
      for (let j = 0; j < 5; j++) box(0.024, 0.007, 0.006, -0.2 + j * 0.045, y, 0.494, dark);
    }
    for (const x of [-0.37, 0.37]) box(0.035, 1.94, 0.055, x, 1.05, 0.465);
    for (const x of [-0.3, 0.3])
      for (const z of [-0.31, 0.31]) box(0.085, 0.055, 0.085, x, 0.0275, z, dark);
    for (let i = 0; i < 7; i++) box(0.53, 0.004, 0.025, 0, 2.083, -0.25 + i * 0.075, dark);
  } else if (variant === "tech-phone-booth") {
    const lining = mat("#738d83", 0.97),
      white = mat("#d2d5d2", 0.76);
    box(0.95, 0.095, 0.95, 0, 0.0475, 0);
    box(0.95, 0.1, 0.95, 0, 2.2, 0);
    box(0.95, 2.1, 0.085, 0, 1.125, -0.427);
    box(0.81, 1.98, 0.016, 0, 1.125, -0.375, lining);
    for (const x of [-0.427, 0.427]) {
      box(0.085, 2.1, 0.95, x, 1.125, 0);
      box(0.017, 1.95, 0.78, x > 0 ? 0.375 : -0.375, 1.125, 0, lining);
    }
    box(0.76, 0.025, 0.75, 0, 0.11, 0, lining);
    box(0.7, 0.055, 0.29, 0, 0.91, -0.17, wood);
    box(0.038, 0.78, 0.038, 0.28, 0.49, -0.17, silver);
    box(0.23, 0.014, 0.17, 0, 0.947, -0.13, dark);
    box(0.23, 0.17, 0.018, 0, 1.025, -0.218, dark);
    const glass = new T.MeshPhysicalMaterial({
      color: "#bad3cf",
      transparent: true,
      opacity: 0.19,
      roughness: 0.13,
      metalness: 0.05,
      depthWrite: false,
    });
    materials.push(glass);
    const pane = box(0.73, 1.96, 0.012, 0, 1.11, 0.435, glass);
    pane.castShadow = false;
    box(0.021, 0.28, 0.023, 0.25, 1.04, 0.461, silver);
    box(0.52, 0.018, 0.035, 0, 2.139, -0.06, white);
    for (let i = 0; i < 6; i++) box(0.008, 1.6, 0.006, -0.3 + i * 0.12, 1.21, -0.363, lining);
  } else if (variant === "tech-hardware-bench") {
    box(0.98, 0.072, 0.79, 0, 0.85, 0.04, wood);
    for (const x of [-0.41, 0.41]) for (const z of [-0.26, 0.34]) box(0.045, 0.8, 0.045, x, 0.4, z);
    const board = mat("#c3c0b3", 0.84),
      blue = mat("#315976", 0.5, 0.25),
      green = mat("#2c665b", 0.65);
    box(0.94, 0.74, 0.035, 0, 1.34, -0.35, board);
    for (let x = -0.4; x <= 0.4; x += 0.1)
      for (let y = 1.07; y < 1.65; y += 0.1) box(0.011, 0.011, 0.004, x, y, -0.329, dark, 0.001);
    for (let i = 0; i < 4; i++) {
      box(0.018, 0.14, 0.019, -0.3 + i * 0.11, 1.43, -0.302, silver);
      box(0.033, 0.063, 0.027, -0.3 + i * 0.11, 1.34, -0.3, i % 2 ? blue : dark);
    }
    box(0.23, 0.18, 0.18, 0.3, 0.98, -0.1, board);
    box(0.15, 0.09, 0.005, 0.3, 1, -0.005, dark);
    box(0.25, 0.013, 0.18, -0.2, 0.896, 0.13, green);
    for (let i = 0; i < 3; i++) box(0.035, 0.018, 0.044, -0.27 + i * 0.07, 0.911, 0.13, dark);
    box(0.32, 0.62, 0.58, 0.25, 0.35, 0.03, blue);
    for (let i = 0; i < 4; i++) {
      box(0.29, 0.132, 0.018, 0.25, 0.14 + i * 0.14, 0.329, blue);
      box(0.18, 0.012, 0.014, 0.25, 0.18 + i * 0.14, 0.347, silver);
    }
  } else {
    const cloth = mat("#719078", 0.98),
      seam = mat("#5e7d65", 0.97);
    // A full support cushion preserves the shared 0.45m seat pose. Lobes rise behind the sitter.
    const cushion = mesh(new T.SphereGeometry(1, 28, 16), cloth, 0, 0.235, 0.03);
    cushion.scale.set(0.46, 0.225, 0.44);
    const back = mesh(new T.SphereGeometry(1, 28, 18), cloth, 0, 0.46, -0.23);
    back.scale.set(0.4, 0.38, 0.23);
    for (const side of [-1, 1]) {
      const lobe = mesh(new T.SphereGeometry(1, 20, 14), cloth, side * 0.31, 0.31, -0.03);
      lobe.scale.set(0.16, 0.27, 0.34);
      lobe.rotation.z = side * 0.22;
    }
    for (const side of [-1, 1]) {
      const path = new T.CatmullRomCurve3([
        new T.Vector3(side * 0.21, 0.11, 0.397),
        new T.Vector3(side * 0.35, 0.36, 0.2),
        new T.Vector3(side * 0.3, 0.68, -0.12),
        new T.Vector3(side * 0.12, 0.81, -0.23),
      ]);
      mesh(new T.TubeGeometry(path, 22, 0.0035, 4, false), seam, 0, 0, 0);
    }
    box(0.025, 0.05, 0.005, 0.41, 0.22, 0.18, wood, 0.002);
  }
  const retained = new Set<T.Material>();
  root.traverse((o) => {
    if (o instanceof T.Mesh)
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) retained.add(m);
  });
  for (const material of materials) if (!retained.has(material)) material.dispose();
  return root;
}

export function renderTechStartupObject(
  host: T.Group,
  object: MapObject,
  objects: MapObject[] = [object],
): boolean {
  const variant = object.variant as keyof typeof TECH_STARTUP_ASSETS;
  const definition = TECH_STARTUP_ASSETS[variant];
  if (!definition || definition.type !== object.type) return false;
  const size = getObjectDimensions(object.type, object.direction),
    offset = furnitureOffset(object);
  host.name = `tech-object:${object.id}`;
  host.userData.mapObjectId = object.id;
  host.userData.objectType = object.type;
  host.userData.assetId = variant;
  host.position.set(
    object.col + size.width / 2 + offset.x,
    0,
    object.row + size.height / 2 + offset.z,
  );
  host.rotation.y = { down: 0, right: Math.PI / 2, up: Math.PI, left: -Math.PI / 2 }[
    object.direction ?? "down"
  ];
  attachFurnitureSeats(host, object, objects);
  host.add(buildTechStartupAsset(variant));
  return true;
}
