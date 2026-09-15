import * as T from "three";
import { round } from "./primitives";
export type FrameRun = { x1: number; z1: number; x2: number; z2: number; height: number };
/** Shared corner axes, with a three-tile opening at the existing entrance. */
export function officePerimeterRuns(cols: number, rows: number): FrameRun[] {
  const left = 0.5,
    right = cols - 0.5,
    back = 0.5,
    front = rows - 0.5;
  const doorStart = Math.floor(cols / 2) - 1,
    doorEnd = doorStart + 3;
  return [
    { x1: left, z1: back, x2: right, z2: back, height: 2.7 },
    { x1: left, z1: back, x2: left, z2: front, height: 1.15 },
    { x1: right, z1: back, x2: right, z2: front, height: 1.15 },
    { x1: left, z1: front, x2: doorStart, z2: front, height: 1.15 },
    { x1: doorEnd, z1: front, x2: right, z2: front, height: 1.15 },
  ];
}
export function addOfficePerimeter(
  root: T.Group,
  cols: number,
  rows: number,
  wall: string,
  wood: string,
) {
  return addOfficeFrameRuns(root, officePerimeterRuns(cols, rows), wall, wood);
}

/** Reusable glazed frame finish for arbitrary axis-aligned office contours. */
export function addOfficeFrameRuns(
  root: T.Group,
  runs: readonly FrameRun[],
  wall: string,
  wood: string,
) {
  const walls: T.Object3D[] = [];
  const metal = "#35434b";
  for (const run of runs) {
    const vertical = run.x1 === run.x2;
    const length = Math.hypot(run.x2 - run.x1, run.z2 - run.z1);
    const g = new T.Group();
    g.position.set((run.x1 + run.x2) / 2, 0, (run.z1 + run.z2) / 2);
    if (vertical) g.rotation.y = Math.PI / 2;
    root.add(g);
    walls.push(g);
    round(g, length, 0.24, 0.18, wall, 0, 0.12, 0, 0.015);
    round(g, length, 0.055, 0.12, metal, 0, run.height, 0, 0.008);
    const material = new T.MeshPhysicalMaterial({
      color: "#b5d3dd",
      transparent: true,
      opacity: run.height > 2 ? 0.3 : 0.18,
      roughness: 0.12,
      clearcoat: 1,
      depthWrite: false,
    });
    const count = Math.ceil(length);
    for (let i = 0; i < count; i++) {
      const width = length / count;
      const pane = round(
        g,
        width - 0.035,
        run.height - 0.3,
        0.035,
        material,
        -length / 2 + (i + 0.5) * width,
        (run.height + 0.24) / 2,
        0,
        0.005,
      );
      pane.userData.staticGlass = true;
      pane.castShadow = false;
    }
    // Both ends have full-height posts: no unsupported rail ends at doors or corners.
    for (let i = 0; i <= count; i++)
      round(
        g,
        0.065,
        run.height + 0.025,
        0.14,
        metal,
        -length / 2 + (i * length) / count,
        (run.height + 0.025) / 2,
        0,
        0.008,
      );
    if (run.height > 2) {
      round(g, length, 0.045, 0.09, metal, 0, 1.45, 0, 0.008);
      round(g, length, 0.065, 0.28, wood, 0, 0.3, 0, 0.01);
      for (let i = 0; i < 3; i++)
        round(g, length, 0.035, 0.13, "#f6f3e9", 0, run.height - 0.15 - i * 0.1, 0, 0.007);
    }
  }
  return walls;
}
