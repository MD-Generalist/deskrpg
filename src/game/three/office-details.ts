import { officeFinish } from "./office-finishes";
import type { OfficeEnvironmentId } from "./office-environments";
import * as T from "three";
import { round, cylinder, sphere } from "./primitives";

/** Details stay inside existing furniture footprints; navigation remains authoritative. */
export function addOfficeDetails(
  g: T.Group,
  type: string,
  wood: string,
  wall: string,
  rear: boolean,
  environment?: OfficeEnvironmentId,
) {
  const finish = officeFinish(environment);
  const metal = "#35434b",
    fabric = finish.upholstery,
    paper = "#f6f3e9";
  const box = (
    w: number,
    h: number,
    d: number,
    color: string | T.Material,
    x: number,
    y: number,
    z: number,
  ) => round(g, w, h, d, color, x, y, z, Math.min(w, h, d, 0.08) / 3);
  if (type === "cubicle_wall") {
    // Low partitions keep the working floor readable; the rear becomes a glazed facade.
    const height = rear ? 2.7 : 1.15;
    box(1, 0.24, 0.18, wall, 0, 0.12, 0);
    const glass = new T.MeshPhysicalMaterial({
      color: "#b5d3dd",
      transparent: true,
      opacity: rear ? 0.3 : 0.18,
      roughness: 0.12,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      envMapIntensity: 0.7,
      depthWrite: false,
    });
    const panel = box(0.94, height - 0.3, 0.035, glass, 0, (height + 0.24) / 2, 0);
    panel.castShadow = false;
    box(1, 0.055, 0.12, metal, 0, height, 0);
    box(0.045, height, 0.12, metal, -0.48, height / 2, 0);
    if (rear) {
      box(1, 0.045, 0.09, metal, 0, 1.45, 0);
      box(1, 0.065, 0.28, wood, 0, 0.3, 0);
      for (let i = 0; i < 3; i++) box(0.94, 0.04, 0.13, paper, 0, height - 0.15 - i * 0.1, 0);
    }
    return true;
  }
  if (type.includes("desk") || type === "meeting_table") {
    const meeting = type === "meeting_table";
    const w = meeting || type === "reception_desk" ? 1.8 : 0.9,
      d = meeting ? 1.8 : 0.8;
    box(w, 0.1, d, wood, 0, 0.77, 0);
    box(w - 0.08, 0.025, d - 0.06, wood, 0, 0.833, 0);
    const deskMat = new T.MeshStandardMaterial({ color: finish.mat, roughness: 0.7 });
    deskMat.userData.surface = "leather";
    box(meeting ? 1.05 : 0.58, 0.012, meeting ? 0.5 : 0.36, deskMat, 0, 0.853, meeting ? 0 : 0.09);
    for (const x of [-1, 1]) {
      box(0.055, 0.7, d * 0.75, metal, x * w * 0.4, 0.35, 0);
      box(0.12, 0.035, d * 0.8, metal, x * w * 0.4, 0.035, 0);
    }
    if (!meeting) {
      // Small role-specific objects stay on the desktop and never affect navigation.
      if (finish.prop === "swatches") {
        for (let i = 0; i < 3; i++)
          box(
            0.09,
            0.009,
            0.13,
            [finish.accent, "#e4c17d", "#789c90"][i],
            -0.26 + i * 0.085,
            0.866,
            -0.21,
          );
      } else if (finish.prop === "device") {
        box(0.15, 0.016, 0.23, metal, -0.29, 0.87, -0.17);
        box(0.125, 0.004, 0.18, finish.accent, -0.29, 0.881, -0.17);
      } else if (finish.prop === "folio" || finish.prop === "binder") {
        box(0.22, 0.035, 0.25, finish.mat, -0.25, 0.87, -0.17);
        box(0.014, 0.004, 0.25, finish.accent, -0.32, 0.891, -0.17);
      } else {
        for (let i = 0; i < 3; i++)
          box(0.23, 0.008, 0.25, paper, -0.25 + i * 0.007, 0.86 + i * 0.01, -0.17);
        box(0.1, 0.004, 0.013, finish.accent, -0.25, 0.888, -0.19);
      }
    }
    if (!meeting) {
      box(0.28, 0.45, 0.42, "#d8ddd8", w * 0.24, 0.4, 0.08);
      for (let i = 0; i < 2; i++) box(0.12, 0.018, 0.015, metal, w * 0.24, 0.35 + i * 0.2, 0.298);
      box(0.28, 0.018, 0.22, "#667e88", -0.2, 0.86, 0.13);
      box(0.24, 0.009, 0.19, paper, -0.2, 0.875, 0.13);
      cylinder(g, 0.052, 0.045, 0.12, "#c48e67", 0.3, 0.9, -0.2);
    } else {
      box(0.45, 0.015, 0.3, "#697f88", 0, 0.86, 0);
      for (const x of [-0.6, 0.6]) {
        box(0.25, 0.01, 0.3, paper, x, 0.86, 0.2);
        cylinder(g, 0.055, 0.05, 0.14, "#b3d3da", x, 0.91, -0.25);
      }
    }
    return true;
  }
  if (type === "chair") {
    box(0.58, 0.13, 0.57, fabric, 0, 0.48, 0);
    box(0.55, 0.56, 0.095, fabric, 0, 0.82, -0.24);
    // Cushion piping and lumbar seam remain within the original chair footprint.
    for (const x of [-0.245, 0.245]) box(0.012, 0.44, 0.012, "#80908e", x, 0.82, -0.186);
    box(0.47, 0.012, 0.012, "#80908e", 0, 0.67, -0.186);
    for (const x of [-0.3, 0.3]) {
      box(0.04, 0.2, 0.04, metal, x, 0.55, 0);
      box(0.075, 0.045, 0.35, metal, x, 0.67, 0);
    }
    cylinder(g, 0.045, 0.07, 0.37, metal, 0, 0.25, 0);
    for (let i = 0; i < 5; i++) {
      const angle = (i * Math.PI * 2) / 5;
      const leg = box(
        0.035,
        0.035,
        0.3,
        metal,
        Math.sin(angle) * 0.13,
        0.09,
        Math.cos(angle) * 0.13,
      );
      leg.rotation.y = angle;
      sphere(g, 0.055, metal, Math.sin(angle) * 0.27, 0.055, Math.cos(angle) * 0.27, 1, 1, 0.7);
    }
    return true;
  }
  if (type === "bookshelf") {
    // Open shelving gives books contact shadows instead of a solid slab behind them.
    box(0.88, 1.5, 0.035, wood, 0, 0.75, -0.16);
    for (const x of [-0.42, 0.42]) box(0.065, 1.5, 0.38, wood, x, 0.75, 0);
    for (let row = 0; row < 4; row++) box(0.84, 0.055, 0.38, wood, 0, 0.04 + row * 0.47, 0);
    const variation = Math.abs(Math.round(g.position.x * 3 + g.position.z * 7));
    const covers = ["#6a8178", "#c19169", "#8999a2", "#ddd0b3", "#956c59"];
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 5; col++) {
        const index = (variation + col + row * 2) % covers.length;
        const material = new T.MeshStandardMaterial({ color: covers[index], roughness: 1 });
        material.userData.surface = "book";
        const h = 0.28 + ((index + row) % 3) * 0.035;
        const book = box(
          0.105,
          h,
          0.23,
          material,
          (col - 2) * 0.145,
          0.08 + row * 0.47 + h / 2,
          0.04,
        );
        if (col === 4) book.rotation.z = -0.07;
      }
    return true;
  }
  if (type === "computer") {
    box(0.73, 0.44, 0.065, metal, 0, 1.12, -0.17);
    box(0.66, 0.36, 0.012, "#203e54", 0, 1.12, -0.13);
    box(0.16, 0.29, 0.014, "#4c7586", -0.23, 1.12, -0.119);
    for (let i = 0; i < 4; i++)
      box(
        0.28 - i * 0.035,
        0.016,
        0.016,
        i % 2 ? "#91cbbb" : "#f2dfb0",
        0.05,
        1.24 - i * 0.065,
        -0.118,
      );
    box(0.045, 0.17, 0.05, metal, 0, 0.85, -0.17);
    box(0.24, 0.025, 0.15, metal, 0, 0.825, -0.13);
    box(0.42, 0.028, 0.14, "#77838a", -0.03, 0.84, 0.18);
    for (let i = 0; i < 3; i++) box(0.36, 0.006, 0.012, paper, -0.03, 0.858, 0.135 + i * 0.04);
    sphere(g, 0.06, metal, 0.29, 0.85, 0.18, 0.7, 0.4, 1);
    return true;
  }
  if (type === "whiteboard") {
    box(0.99, 0.9, 0.09, metal, 0, 1.02, 0);
    box(0.92, 0.83, 0.02, paper, 0, 1.02, 0.055);
    for (let i = 0; i < 3; i++) {
      box(0.19, 0.025, 0.015, "#698c8b", (i - 1) * 0.29, 1.29, 0.073);
      for (let j = 0; j < 2; j++)
        box(
          0.13,
          0.12,
          0.014,
          ["#ead296", "#aac9c2", "#d9aaa0"][i],
          (i - 1) * 0.29,
          1.15 - j * 0.21,
          0.073,
        );
    }
    for (const x of [-0.35, 0.35]) box(0.04, 0.55, 0.08, metal, x, 0.28, 0);
    box(0.98, 0.035, 0.16, metal, 0, 0.56, 0.08);
    return true;
  }
  if (type === "coffee") {
    box(0.8, 0.72, 0.6, wood, 0, 0.36, 0);
    box(0.84, 0.05, 0.64, paper, 0, 0.745, 0);
    box(0.38, 0.36, 0.3, metal, -0.12, 0.95, -0.06);
    box(0.27, 0.17, 0.025, "#172a31", -0.12, 0.9, 0.105);
    box(0.27, 0.02, 0.2, "#94a3a5", -0.12, 0.78, 0.17);
    for (const x of [-0.21, -0.04]) cylinder(g, 0.035, 0.03, 0.075, paper, x, 0.83, 0.16);
    cylinder(g, 0.065, 0.065, 0.18, "#b7c9bf", 0.27, 0.86, -0.05);
    box(0.15, 0.018, 0.018, metal, 0.22, 0.45, 0.31);
    return true;
  }
  if (type === "plant") {
    cylinder(g, 0.27, 0.2, 0.43, "#d4c4aa", 0, 0.22, 0);
    cylinder(g, 0.245, 0.245, 0.025, "#645949", 0, 0.44, 0);
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4,
        h = 0.72 + (i % 3) * 0.2;
      const stem = cylinder(
        g,
        0.012,
        0.015,
        h - 0.3,
        "#657157",
        Math.sin(a) * 0.08,
        (h + 0.3) / 2,
        Math.cos(a) * 0.08,
      );
      stem.rotation.z = Math.sin(a) * 0.15;
      const leaf = sphere(
        g,
        0.2,
        i % 2 ? "#547764" : "#779269",
        Math.sin(a) * 0.19,
        h,
        Math.cos(a) * 0.19,
        0.6,
        1.4,
        0.3,
      );
      leaf.rotation.set(0.3, a, Math.sin(a) * 0.5);
    }
    return true;
  }
  return false;
}
