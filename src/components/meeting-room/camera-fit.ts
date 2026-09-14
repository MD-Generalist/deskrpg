import { PerspectiveCamera, Vector3 } from "three";

/** Fit the miniature floor, seated figures and headroom at the fixed meeting angle. */
export function meetingCameraDistance(tableWidth: number, aspect: number): number {
  const camera = new PerspectiveCamera(34, Math.max(0.1, aspect), 0.1, 1000);
  const corners = [-1, 1].flatMap((x) =>
    [0, 2.5].flatMap((y) => [-1, 1].map((z) =>
      new Vector3(x * (tableWidth + 5) / 2, y, z * 4.5))));
  let distance = 12;
  for (let step = 0; step < 100; step++, distance *= 1.08) {
    camera.position.set(0, distance * 0.68, distance * 0.8);
    camera.lookAt(0, 0.4, 0);
    camera.updateMatrixWorld();
    if (corners.every((corner) => {
      const p = corner.clone().project(camera);
      return Math.abs(p.x) <= 0.9 && Math.abs(p.y) <= 0.9;
    })) return distance;
  }
  return distance;
}
