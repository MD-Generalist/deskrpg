import * as T from "three";
import { getObjectDimensions, type MapObject } from "../../lib/object-types";
import { furnitureOffset } from "./executive-lounge-layout";
import { attachFurnitureSeats } from "./seat-picking";
import { buildTechStartupAsset } from "./tech-startup-assets";
export const PUBLISHING_ASSETS = {
  "pub-library": { type: "studio_shelf", footprint: [2, 1], height: 2.9 },
  "pub-library-ladder": { type: "studio_shelf", footprint: [2, 1], height: 2.9 },
  "pub-proof-desk": { type: "studio_counter", footprint: [4, 1], height: 1.22 },
  "pub-newbook-display": { type: "studio_shelf", footprint: [2, 1], height: 1.25 },
  "pub-print-bench": { type: "studio_shelf", footprint: [2, 1], height: 1.42 },
  "pub-workstation": { type: "reception_desk", footprint: [2, 1], height: 1.45 },
} as const;
/** 바닥 원점·미터 단위·+Z 전면을 사용하는 재사용 출판 집기. */
export function buildPublishingAsset(id: keyof typeof PUBLISHING_ASSETS) {
  const root = id === "pub-workstation" ? buildTechStartupAsset("tech-workstation") : new T.Group();
  root.name = id;
  const mat = (color: string, roughness = 0.65, metalness = 0) =>
    new T.MeshStandardMaterial({ color, roughness, metalness });
  const oak = mat("#a98150"),
    sage = mat("#738d83"),
    dark = mat("#262d33", 0.4, 0.5),
    paper = mat("#f2ead8"),
    ink = mat("#787269"),
    brass = mat("#a28b58", 0.35, 0.65);
  const covers = ["#5f7063", "#806146", "#384e5b", "#ae745b", "#bba783", "#ddd4bd"].map((c) =>
    mat(c),
  );
  const box = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    m: T.Material = oak,
  ) => {
    const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };
  const cylinder = (
    rt: number,
    rb: number,
    h: number,
    x: number,
    y: number,
    z: number,
    m: T.Material,
  ) => {
    const mesh = new T.Mesh(new T.CylinderGeometry(rt, rb, h, 20), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };
  const book = (x: number, y: number, z: number, w: number, h: number, c: T.Material) => {
    box(w, h, 0.19, x, y + h / 2, z, c);
    box(w * 0.64, h * 0.12, 0.006, x, y + h * 0.77, z + 0.099, paper);
    box(w * 0.74, 0.012, 0.007, x, y + h * 0.72, z + 0.105, brass);
  };
  const openBook = (x: number, y: number, z: number) => {
    box(0.35, 0.018, 0.27, x, y, z, covers[2]);
    for (const s of [-1, 1]) {
      const page = box(0.165, 0.016, 0.255, x + s * 0.085, y + 0.017, z, paper);
      page.rotation.z = s * 0.05;
      for (let j = 0; j < 5; j++)
        box(0.12, 0.001, 0.004, x + s * 0.085, y + 0.03, z - 0.075 + j * 0.032, ink);
    }
  };
  if (id === "pub-library" || id === "pub-library-ladder") {
    box(1.98, 2.9, 0.045, 0, 1.45, -0.445);
    for (const x of [-0.965, 0, 0.965]) box(0.05, 2.9, 0.73, x, 1.45, -0.06);
    for (const y of [0.04, 0.63, 1.17, 1.71, 2.25, 2.87]) box(1.98, 0.055, 0.73, 0, y, -0.06);
    for (const x of [-0.48, 0.48]) {
      box(0.9, 0.53, 0.035, x, 0.325, 0.313);
      cylinder(0.016, 0.016, 0.035, x + 0.3, 0.37, 0.35, brass).rotation.x = Math.PI / 2;
    }
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 18; col++) {
        const x = -0.865 + col * 0.101,
          y = 0.665 + row * 0.54;
        if (col === 8 || col === 9) continue;
        const h = 0.29 + ((col * 7 + row * 3) % 5) * 0.031;
        book(x, y, -0.012, 0.066 + (col % 3) * 0.009, h, covers[(col + row * 2) % covers.length]);
        box(0.045, 0.008, 0.009, x, y + h * 0.8, 0.096, brass);
      }
    if (id === "pub-library-ladder") {
      for (const x of [0.26, 0.68]) {
        const rail = box(0.045, 2.52, 0.055, x, 1.26, 0.365, dark);
        rail.rotation.x = -0.06;
      }
      for (let i = 0; i < 9; i++)
        box(0.44, 0.035, 0.085, 0.47, 0.17 + i * 0.267, 0.44 - i * 0.016, oak);
    }
  } else if (id === "pub-proof-desk") {
    box(3.96, 0.085, 0.95, 0, 0.85, 0);
    for (const x of [-1.8, 1.8])
      for (const z of [-0.36, 0.36]) box(0.075, 0.81, 0.075, x, 0.405, z);
    box(3.65, 0.05, 0.055, 0, 0.21, 0);
    for (let i = 0; i < 7; i++) openBook(-1.5 + i * 0.5, 0.91, i % 2 ? 0.13 : -0.11);
    for (let i = 0; i < 4; i++) box(0.29, 0.04, 0.25, -1.63, 0.94 + i * 0.045, -0.3, covers[i]);
    cylinder(0.07, 0.06, 0.14, 1.66, 0.965, -0.27, sage);
    for (let i = 0; i < 6; i++) {
      const pen = cylinder(
        0.009,
        0.009,
        0.26,
        1.62 + (i % 3) * 0.025,
        1.08,
        -0.29 + Math.floor(i / 3) * 0.04,
        covers[3],
      );
      pen.rotation.z = (i - 2) * 0.06;
    }
  } else if (id === "pub-newbook-display") {
    for (const x of [-0.97, 0, 0.97]) box(0.045, 0.82, 0.64, x, 0.41, 0);
    for (const y of [0.04, 0.41, 0.81]) box(1.98, 0.04, 0.68, 0, y, 0);
    box(1.95, 0.78, 0.035, 0, 0.4, -0.32);
    for (let row = 0; row < 2; row++)
      for (let i = 0; i < 7; i++)
        book(-0.82 + i * 0.27, 0.065 + row * 0.38, 0.02, 0.21, 0.28, covers[(i + row) % 6]);
    for (let i = 0; i < 6; i++)
      book(-0.82 + i * 0.32, 0.83, -0.025, 0.24, 0.31 + (i % 2) * 0.05, covers[i]);
  } else if (id === "pub-print-bench") {
    box(1.97, 0.08, 0.95, 0, 0.85, 0);
    box(1.88, 0.79, 0.84, 0, 0.395, 0);
    for (let i = 0; i < 4; i++) {
      box(0.44, 0.69, 0.028, -0.72 + i * 0.48, 0.43, 0.437);
      box(0.17, 0.018, 0.025, -0.72 + i * 0.48, 0.66, 0.463, brass);
    }
    box(0.72, 0.39, 0.63, -0.52, 1.085, -0.04, paper);
    box(0.64, 0.045, 0.51, -0.52, 1.3, -0.04, dark);
    box(0.44, 0.03, 0.23, -0.52, 1.1, 0.31, dark);
    box(0.32, 0.015, 0.28, -0.52, 1.12, 0.34, paper);
    box(0.75, 0.013, 0.59, 0.54, 0.901, 0.03, sage);
    for (let i = 0; i < 10; i++) box(0.002, 0.002, 0.55, 0.22 + i * 0.065, 0.91, 0.03, paper);
    for (let i = 0; i < 7; i++) box(0.71, 0.002, 0.002, 0.54, 0.912, -0.23 + i * 0.08, paper);
    for (let i = 0; i < 4; i++) box(0.32, 0.035, 0.26, 0.6, 0.935 + i * 0.035, -0.2, paper);
  } else {
    root.traverse((o) => {
      if (o instanceof T.Mesh) {
        const m = o.material as T.MeshStandardMaterial;
        if (m.color?.getHexString() === "262d33") m.color.set("#738d83");
        if (m.color?.getHexString() === "cdb58c") m.color.set("#a98150");
      }
    });
    cylinder(0.105, 0.115, 0.025, -0.63, 0.902, 0.22, sage);
    cylinder(0.012, 0.012, 0.41, -0.63, 1.115, 0.22, dark);
    const shade = cylinder(0.06, 0.145, 0.13, -0.63, 1.335, 0.22, sage);
    shade.rotation.z = 0.15;
    openBook(0.6, 0.904, 0.13);
  }
  return root;
}
export function renderPublishingObject(
  host: T.Group,
  object: MapObject,
  objects: MapObject[] = [object],
): boolean {
  const id = object.variant as keyof typeof PUBLISHING_ASSETS,
    definition = PUBLISHING_ASSETS[id];
  if (!definition || definition.type !== object.type) return false;
  const size = getObjectDimensions(object.type, object.direction),
    offset = furnitureOffset(object);
  host.name = `publishing-object:${object.id}`;
  host.userData.mapObjectId = object.id;
  host.userData.objectType = object.type;
  host.userData.assetId = id;
  host.position.set(
    object.col + size.width / 2 + offset.x,
    0,
    object.row + size.height / 2 + offset.z,
  );
  host.rotation.y = { down: 0, right: Math.PI / 2, up: Math.PI, left: -Math.PI / 2 }[
    object.direction ?? "down"
  ];
  attachFurnitureSeats(host, object, objects);
  host.add(buildPublishingAsset(id));
  return true;
}
