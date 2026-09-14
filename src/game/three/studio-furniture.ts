import * as T from "three";
import { round } from "./primitives";
import { sceneAsset, studioFurnitureAsset } from "./scene-asset-definitions";
export { studioFurnitureAsset } from "./scene-asset-definitions";

/** Small scene-owned silhouette fallbacks; asset selection stays in the shared catalog. */
export function buildStudioFurnitureFallback(type: string, variant?: string): T.Group | null {
  const selected = studioFurnitureAsset({ type, variant });
  if (!selected) return null;
  const definition = sceneAsset(selected.id),
    group = new T.Group();
  group.name = selected.id;
  const id = selected.id;
  const cloth = new T.MeshStandardMaterial({
    color: definition.variants?.[selected.variant ?? "off-white"]?.upholstery ?? "#e7dfd1",
    roughness: 0.9,
  });
  const wood = new T.MeshStandardMaterial({ color: "#cfb68d", roughness: 0.58 });
  const metal = new T.MeshStandardMaterial({ color: "#354441", metalness: 0.6, roughness: 0.38 });
  const cream = new T.MeshStandardMaterial({ color: "#e3dfd2", roughness: 0.85 });
  const box = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    m: T.Material = wood,
    owner: T.Group = group,
  ) => round(owner, w, h, d, m, x, y, z, Math.min(0.025, w * 0.2, h * 0.2, d * 0.2));
  const rod = (r: number, h: number, x: number, y: number, z: number, m: T.Material = wood) => {
    const mesh = new T.Mesh(new T.CylinderGeometry(r, r, h, 32), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const w = definition.bounds.max[0] * 2,
    d = definition.bounds.max[2] * 2;
  if (["shared-workstation", "shared-production-table", "shared-conference-table"].includes(id)) {
    box(w - 0.03, 0.09, d - 0.03, 0, 0.81, 0);
    for (const x of [-w / 2 + 0.16, w / 2 - 0.16])
      for (const z of [-d / 2 + 0.16, d / 2 - 0.16]) box(0.065, 0.76, 0.065, x, 0.38, z, metal);
    box(w - 0.25, 0.075, 0.05, 0, 0.71, -d / 2 + 0.16);
  } else if (id === "shared-round-table" || id === "shared-coffee-table") {
    const coffee = id === "shared-coffee-table";
    rod(w / 2 - 0.015, coffee ? 0.075 : 0.1, 0, coffee ? 0.45 : 0.81, 0);
    rod(coffee ? 0.28 : 0.3, coffee ? 0.41 : 0.75, 0, coffee ? 0.205 : 0.375, 0);
  } else if (id === "shared-side-chair" || id === "shared-office-chair") {
    box(0.61, 0.1, 0.58, 0, 0.41, 0, cloth);
    box(0.58, 0.47, 0.09, 0, 0.715, -0.24, cloth);
    for (const x of [-0.225, 0.225])
      for (const z of [-0.205, 0.205])
        box(0.04, 0.36, 0.04, x, 0.18, z, id === "shared-side-chair" ? wood : metal);
    if (id === "shared-office-chair")
      for (const x of [-0.32, 0.32]) {
        box(0.025, 0.23, 0.025, x, 0.53, 0, metal);
        box(0.05, 0.04, 0.36, x, 0.665, 0, cloth);
      }
  } else if (["shared-curved-sofa", "shared-sofa", "shared-armchair"].includes(id)) {
    const single = id === "shared-armchair";
    for (const x of single ? [0] : [-0.94, 0, 0.94]) {
      const part = new T.Group();
      part.position.x = x;
      if (id === "shared-curved-sofa") {
        part.rotation.y = x < 0 ? -0.22 : x > 0 ? 0.22 : 0;
        part.position.z = x === 0 ? -0.1 : 0.01;
      }
      group.add(part);
      box(single ? 0.84 : 0.95, 0.23, 0.75, 0, 0.245, 0, cloth, part);
      box(single ? 0.65 : 0.86, 0.16, 0.66, 0, 0.45, 0.04, cloth, part);
      box(single ? 0.68 : 0.89, 0.5, 0.14, 0, 0.705, -0.295, cloth, part);
      for (const xx of [-0.31, 0.31])
        for (const zz of [-0.24, 0.24]) box(0.04, 0.13, 0.04, xx, 0.065, zz, metal, part);
    }
    if (single) for (const x of [-0.385, 0.385]) box(0.09, 0.44, 0.74, x, 0.44, 0, cloth);
  } else if (id === "shared-stool") {
    rod(0.3, 0.08, 0, 0.68, 0);
    for (const x of [-0.2, 0.2]) for (const z of [-0.2, 0.2]) box(0.035, 0.64, 0.035, x, 0.32, z);
    const ring = new T.Mesh(new T.TorusGeometry(0.23, 0.012, 6, 24), metal);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.245;
    group.add(ring);
  } else if (id === "shared-mobile-board") {
    box(1.87, 1.22, 0.07, 0, 1.27, 0);
    box(1.77, 1.12, 0.015, 0, 1.27, 0.044, cream);
    for (const x of [-0.78, 0.78]) {
      box(0.04, 1.78, 0.05, x, 0.94, 0, metal);
      box(0.09, 0.05, 0.79, x, 0.04, 0, metal);
    }
  } else if (id === "shared-credenza" || id === "shared-low-shelf") {
    box(1.91, 0.92, 0.035, 0, 0.55, -0.36);
    for (const x of [-0.93, 0.93]) box(0.05, 0.98, 0.77, x, 0.55, 0);
    for (const y of [0.1, 0.55, 1.03]) box(1.91, 0.05, 0.77, 0, y, 0);
    if (id === "shared-credenza")
      for (const x of [-0.46, 0.46]) {
        box(0.9, 0.86, 0.03, x, 0.565, 0.39, cream);
        box(0.025, 0.1, 0.04, x * 0.2, 0.64, 0.423, metal);
      }
    else for (const x of [-0.32, 0.32]) box(0.035, 0.9, 0.74, x, 0.56, 0);
  } else if (id === "shared-counter") {
    box(3.9, 0.81, 0.85, 0, 0.48, 0, cream);
    box(3.98, 0.08, 0.95, 0, 0.91, 0);
    box(3.75, 0.12, 0.72, 0, 0.06, 0, metal);
    for (const x of [-1.45, -0.48, 0.48, 1.45]) box(0.18, 0.018, 0.035, x, 0.77, 0.46, metal);
  } else if (id === "shared-round-rug") rod(1.88, 0.022, 0, 0.011, 0, cloth);
  else if (id === "shared-woven-rug") box(5.9, 0.022, 3.9, 0, 0.011, 0, cloth);
  // Materials created for another branch never enter the tree and must not leak.
  const retained = new Set<T.Material>();
  group.traverse((o) => {
    if (o instanceof T.Mesh)
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) retained.add(m);
  });
  for (const material of [cloth, wood, metal, cream])
    if (!retained.has(material)) material.dispose();
  group.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.castShadow = definition.shadows.cast;
      o.receiveShadow = definition.shadows.receive;
    }
  });
  return group;
}
