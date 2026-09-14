import * as T from "three";
import { round } from "./primitives";

const TYPES = new Set([
  "conference_table",
  "office_sofa",
  "office_armchair",
  "low_cabinet",
  "kitchen_counter",
  "refrigerator",
  "microwave_cabinet",
  "cup_shelf",
  "recycling_bins",
  "office_printer",
  "coat_rack",
  "meeting_display",
  "floor_lamp",
  "office_locker",
]);

/** Centered on the footprint, floor at y=0, front facing +Z. No scene-global resources. */
export function buildRoomFurniture(type: string, executive = false): T.Group | null {
  if (
    !TYPES.has(type) &&
    !(
      executive &&
      ["executive_desk", "reception_desk", "meeting_table", "bookshelf", "chair"].includes(type)
    )
  )
    return null;
  const g = new T.Group();
  g.name = type;
  const materials = new Map<string, T.MeshStandardMaterial>();
  const material = (color: string, surface = "paint") => {
    const key = `${color}:${surface}`;
    let m = materials.get(key);
    if (!m) {
      m = new T.MeshStandardMaterial({
        color,
        roughness: surface === "metal" ? 0.32 : surface === "fabric" ? 0.96 : 0.7,
        metalness: surface === "metal" ? 0.65 : 0,
      });
      if (surface !== "paint") m.userData.surface = surface;
      materials.set(key, m);
    }
    return m;
  };
  const wood = material(executive ? "#63452f" : "#b89b70", "wood");
  const metal = material("#39494c", "metal");
  const steel = material("#bbc5c2", "metal");
  const cream = material("#e9e6da");
  const dark = material("#293a3d");
  const cloth = material(
    executive ? (type === "office_armchair" ? "#9b613d" : "#ddd0b7") : "#6f857a",
    executive && type === "office_armchair" ? "leather" : "fabric",
  );
  const box = (w: number, h: number, d: number, m: T.Material, x: number, y: number, z: number) =>
    round(g, w, h, d, m, x, y, z, Math.min(w, h, d, 0.12) * 0.25);
  const rod = (
    radius: number,
    height: number,
    m: T.Material,
    x: number,
    y: number,
    z: number,
    top = radius,
  ) => {
    const mesh = new T.Mesh(new T.CylinderGeometry(top, radius, height, 16), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const feet = (w: number, d: number, height = 0.12) => {
    for (const x of [-w / 2 + 0.1, w / 2 - 0.1])
      for (const z of [-d / 2 + 0.1, d / 2 - 0.1]) box(0.07, height, 0.07, metal, x, height / 2, z);
  };
  const handle = (x: number, y: number, z: number, width = 0.15) =>
    box(width, 0.025, 0.035, metal, x, y, z);
  const cup = (x: number, y: number, z: number) => {
    rod(0.05, 0.11, cream, x, y + 0.055, z);
    rod(0.041, 0.004, dark, x, y + 0.111, z);
    const grip = new T.Mesh(new T.TorusGeometry(0.033, 0.009, 5, 12), cream);
    grip.position.set(x + 0.047, y + 0.058, z);
    grip.castShadow = true;
    g.add(grip);
  };
  const cabinet = (w: number, height: number) => {
    feet(w, 0.7);
    box(w, height - 0.14, 0.7, wood, 0, (height + 0.1) / 2, 0);
    box(w + 0.04, 0.065, 0.75, wood, 0, height, 0);
    for (const side of [-1, 1]) {
      box(w / 2 - 0.025, height - 0.22, 0.025, cream, (side * w) / 4, height / 2 + 0.03, 0.362);
      handle(side * 0.085, height * 0.7, 0.39, 0.055);
    }
  };

  if (executive && type === "chair") {
    const leather = material("#c7baa1", "leather");
    feet(0.65, 0.65, 0.46);
    box(0.69, 0.13, 0.68, leather, 0, 0.48, 0);
    box(0.69, 0.64, 0.14, leather, 0, 0.81, -0.27);
    for (const x of [-0.33, 0.33]) box(0.065, 0.22, 0.49, leather, x, 0.62, 0);
    return g;
  }
  if (executive && type === "bookshelf") {
    box(0.98, 3.35, 0.12, wood, 0, 1.68, -0.4);
    for (const x of [-0.47, 0.47]) box(0.055, 3.35, 0.8, wood, x, 1.68, 0);
    for (const y of [0.12, 0.8, 1.55, 2.3, 3.32]) box(0.98, 0.065, 0.8, wood, 0, y, 0);
    box(0.88, 0.65, 0.06, wood, 0, 0.45, 0.37);
    for (const y of [0.84, 1.59, 2.34])
      for (let i = 0; i < 5; i++) {
        const book = box(
          0.09,
          0.42 + (i % 2) * 0.1,
          0.29,
          material(["#c5b695", "#655f4b", "#3e4036"][i % 3]),
          -0.31 + i * 0.14,
          y + 0.25,
          0.1,
        );
        book.rotation.z = i === 4 ? -0.12 : 0;
      }
    return g;
  }
  if (executive && (type === "reception_desk" || type === "executive_desk")) {
    box(1.95, 0.12, 0.95, wood, 0, 0.84, 0);
    for (const x of [-0.78, 0.78]) box(0.35, 0.75, 0.8, wood, x, 0.4, 0);
    box(1.5, 0.6, 0.09, wood, 0, 0.44, 0.32);
    box(0.85, 0.01, 0.48, dark, 0, 0.91, 0);
    const brass = material("#b99a5f", "metal");
    rod(0.09, 0.025, brass, 0.7, 0.92, 0);
    rod(0.018, 0.34, brass, 0.7, 1.1, 0);
    box(0.24, 0.045, 0.15, brass, 0.63, 1.28, 0);
    return g;
  }
  if (executive && (type === "conference_table" || type === "meeting_table")) {
    const meeting = type === "conference_table";
    const top = rod(
      0.92,
      0.1,
      meeting ? wood : material("#a99f90", "metal"),
      0,
      meeting ? 0.81 : 0.43,
      0,
    );
    top.scale.x = meeting ? 2 : 1;
    rod(meeting ? 0.55 : 0.45, meeting ? 0.75 : 0.38, wood, 0, meeting ? 0.375 : 0.19, 0);
    rod(0.18, 0.12, material("#b69754", "metal"), 0, meeting ? 0.92 : 0.54, 0);
    for (let i = 0; i < 7; i++)
      rod(
        0.06,
        0.16 + (i % 3) * 0.05,
        material("#617044"),
        Math.sin(i) * 0.1,
        meeting ? 1.04 : 0.67,
        Math.cos(i) * 0.1,
      );
    return g;
  }
  switch (type) {
    case "conference_table": {
      // One uninterrupted surface; supports leave the long edges clear for six chairs.
      box(3.8, 0.1, 1.8, wood, 0, 0.77, 0);
      box(3.72, 0.025, 1.72, wood, 0, 0.833, 0);
      box(2.8, 0.1, 0.12, metal, 0, 0.68, 0);
      for (const x of [-1.25, 1.25]) {
        box(0.085, 0.7, 1.2, metal, x, 0.35, 0);
        box(0.18, 0.045, 1.3, metal, x, 0.0225, 0);
      }
      const mat = material("#637b70", "leather");
      for (const x of [-0.67, 0.67]) {
        for (const z of [-0.59, 0.59]) {
          box(0.66, 0.012, 0.38, mat, x, 0.853, z);
          box(0.23, 0.008, 0.27, cream, x - 0.08, 0.863, z);
          box(0.013, 0.013, 0.21, metal, x + 0.1, 0.865, z);
        }
      }
      box(0.4, 0.045, 0.3, dark, 0, 0.868, 0);
      box(0.3, 0.006, 0.2, metal, 0, 0.894, 0);
      rod(0.023, 0.008, material("#89aa99"), 0, 0.901, 0);
      for (const x of [-1.55, 1.55]) cup(x, 0.846, -0.4);
      break;
    }
    case "office_armchair":
      feet(0.9, 0.85, 0.16);
      box(0.9, 0.23, 0.82, cloth, 0, 0.28, 0);
      box(0.9, 0.65, 0.16, cloth, 0, 0.68, -0.33);
      for (const x of [-0.4, 0.4]) box(0.13, 0.48, 0.82, cloth, x, 0.51, 0);
      box(0.64, 0.16, 0.62, cloth, 0, 0.465, 0.065);
      box(0.63, 0.42, 0.12, cloth, 0, 0.73, -0.21);
      break;
    case "office_sofa":
      feet(1.8, 0.85, 0.16);
      box(1.8, 0.23, 0.82, cloth, 0, 0.28, 0);
      box(1.78, 0.65, 0.16, cloth, 0, 0.68, -0.33);
      for (const x of [-0.82, 0.82]) box(0.18, 0.48, 0.82, cloth, x, 0.51, 0);
      for (const x of [-0.38, 0.38]) {
        box(0.72, 0.16, 0.62, cloth, x, 0.465, 0.065);
        box(0.71, 0.42, 0.12, cloth, x, 0.73, -0.21);
      }
      box(0.28, 0.28, 0.12, material("#d2b88b", "fabric"), -0.57, 0.67, -0.09).rotation.z = 0.18;
      break;
    case "low_cabinet":
      cabinet(1.8, 0.8);
      for (let i = 0; i < 3; i++)
        box(0.32, 0.025, 0.23, i === 1 ? cream : cloth, -0.52 + i * 0.018, 0.847 + i * 0.025, 0);
      box(0.24, 0.3, 0.045, metal, 0.53, 0.985, -0.1);
      box(0.19, 0.24, 0.008, cream, 0.53, 0.985, -0.073);
      break;
    case "kitchen_counter":
      cabinet(1.8, 0.87);
      // Recessed basin: countertop split around the opening, rim and inset bowl.
      box(0.78, 0.07, 0.77, cream, 0.52, 0.92, 0);
      box(0.16, 0.07, 0.77, cream, -0.84, 0.92, 0);
      for (const z of [-0.315, 0.315]) box(0.7, 0.07, 0.14, cream, -0.41, 0.92, z);
      box(0.57, 0.012, 0.46, steel, -0.41, 0.905, 0);
      for (const x of [-0.705, -0.115]) box(0.02, 0.05, 0.48, steel, x, 0.93, 0);
      for (const z of [-0.24, 0.24]) box(0.61, 0.05, 0.02, steel, -0.41, 0.93, z);
      rod(0.025, 0.3, steel, -0.4, 1.09, -0.3);
      box(0.035, 0.035, 0.2, steel, -0.4, 1.22, -0.21);
      rod(0.018, 0.065, steel, -0.4, 1.19, -0.12);
      box(0.22, 0.34, 0.29, dark, 0.57, 1.12, -0.13);
      box(0.17, 0.035, 0.16, steel, 0.57, 0.982, 0.08);
      cup(0.57, 1, 0.08);
      break;
    case "refrigerator":
      feet(0.76, 0.78, 0.06);
      box(0.76, 1.63, 0.76, steel, 0, 0.865, 0);
      box(0.72, 0.48, 0.035, cream, 0, 1.42, 0.398);
      box(0.72, 1.04, 0.035, cream, 0, 0.637, 0.398);
      for (const y of [0.96, 1.31]) box(0.035, 0.23, 0.055, metal, -0.25, y, 0.434);
      box(0.13, 0.16, 0.012, material("#d2b88b"), 0.14, 1.42, 0.423);
      break;
    case "microwave_cabinet":
      cabinet(0.78, 0.77);
      box(0.67, 0.35, 0.49, cream, 0, 0.98, 0);
      box(0.45, 0.24, 0.015, dark, -0.055, 0.98, 0.253);
      box(0.37, 0.16, 0.008, material("#536669"), -0.055, 0.98, 0.266);
      for (const y of [0.96, 1.055]) box(0.045, 0.045, 0.015, metal, 0.26, y, 0.265);
      break;
    case "cup_shelf":
      for (const x of [-0.4, 0.4]) box(0.055, 1.45, 0.52, wood, x, 0.725, 0);
      box(0.84, 1.45, 0.04, cream, 0, 0.725, -0.24);
      for (const y of [0.06, 0.48, 0.92, 1.42]) box(0.84, 0.045, 0.52, wood, 0, y, 0);
      for (const y of [0.503, 0.943]) for (const x of [-0.25, 0, 0.23]) cup(x, y, 0.05);
      box(0.56, 0.22, 0.33, cloth, 0, 0.195, 0);
      break;
    case "recycling_bins":
      for (const [i, color] of ["#638677", "#7a8f9c", "#b4986e"].entries()) {
        const x = (i - 1) * 0.29;
        box(0.26, 0.54, 0.5, material(color), x, 0.27, 0);
        box(0.28, 0.055, 0.53, metal, x, 0.557, 0);
        box(0.16, 0.008, 0.18, dark, x, 0.587, 0);
        box(0.12, 0.1, 0.012, cream, x, 0.37, 0.257);
      }
      break;
    case "office_printer":
      cabinet(0.78, 0.56);
      box(0.7, 0.41, 0.65, cream, 0, 0.795, 0);
      box(0.72, 0.07, 0.67, dark, 0, 1.035, 0);
      box(0.56, 0.045, 0.42, cream, 0, 1.09, -0.045);
      box(0.48, 0.06, 0.018, dark, 0, 0.89, 0.333);
      box(0.3, 0.012, 0.16, cream, 0, 0.865, 0.34);
      box(0.18, 0.018, 0.09, material("#7ba7ab"), 0.2, 1.08, 0.23);
      break;
    case "coat_rack":
      rod(0.29, 0.07, metal, 0, 0.035, 0);
      rod(0.035, 1.68, wood, 0, 0.9, 0);
      for (const y of [1.3, 1.62]) {
        box(0.66, 0.035, 0.035, wood, 0, y, 0);
        for (const x of [-0.3, 0.3]) rod(0.025, 0.11, wood, x, y + 0.045, 0);
      }
      box(0.24, 0.58, 0.1, cloth, -0.26, 1.29, 0.04);
      break;
    case "meeting_display":
      for (const x of [-0.59, 0.59]) {
        box(0.07, 1.05, 0.07, metal, x, 0.55, 0);
        box(0.12, 0.08, 0.68, metal, x, 0.04, 0);
      }
      box(1.8, 1.02, 0.1, dark, 0, 1.45, 0);
      box(1.69, 0.91, 0.009, material("#809b9c"), 0, 1.45, 0.055);
      box(0.04, 0.04, 0.02, metal, 0, 2, 0);
      for (let i = 0; i < 3; i++)
        box(0.18, 0.15 + i * 0.13, 0.009, cream, -0.43 + i * 0.33, 1.23 + i * 0.065, 0.064);
      box(0.6, 0.06, 0.08, metal, 0, 0.89, 0.025);
      break;
    case "floor_lamp":
      rod(0.27, 0.055, metal, 0, 0.0275, 0);
      rod(0.025, 1.5, metal, 0, 0.805, 0);
      rod(0.32, 0.38, cream, 0, 1.67, 0, 0.21);
      rod(0.28, 0.008, material("#e6c888"), 0, 1.475, 0);
      break;
    case "office_locker":
      feet(0.83, 0.68, 0.07);
      box(0.83, 1.67, 0.68, metal, 0, 0.905, 0);
      for (const x of [-0.208, 0.208]) {
        box(0.393, 1.61, 0.025, cream, x, 0.905, 0.354);
        box(0.027, 0.16, 0.035, metal, x + 0.11, 0.99, 0.38);
        box(0.13, 0.05, 0.012, wood, x, 1.53, 0.375);
        for (let i = 0; i < 3; i++) box(0.2, 0.012, 0.009, dark, x, 0.3 + i * 0.045, 0.373);
      }
      break;
  }
  return g;
}
