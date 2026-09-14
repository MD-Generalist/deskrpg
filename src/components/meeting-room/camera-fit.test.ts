import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { meetingCameraDistance } from "./camera-fit";

test("meeting camera keeps floor and figures inside portrait and desktop scenes", () => {
  for (const tableWidth of [5.6, 7.5, 15, 36]) {
    for (const aspect of [0.5, 1.27, 2.9]) {
      const distance = meetingCameraDistance(tableWidth, aspect);
      const camera = new PerspectiveCamera(34, aspect, 0.1, 1000);
      camera.position.set(0, distance * 0.68, distance * 0.8);
      camera.lookAt(0, 0.4, 0);
      camera.updateMatrixWorld();
      for (const x of [-1, 1]) for (const y of [0, 2.5]) for (const z of [-1, 1]) {
        const p = new Vector3(x * (tableWidth + 5) / 2, y, z * 4.5).project(camera);
        assert.ok(Math.abs(p.x) <= 0.9 && Math.abs(p.y) <= 0.9 && Math.abs(p.z) < 1,
          `clipped width=${tableWidth} aspect=${aspect}`);
      }
    }
  }
});
