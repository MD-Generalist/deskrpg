import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OFFICE_LOOKS } from "./office-looks";
import { createCommuteWalker, createDistanceWalkPhase, COMMUTE_WALK_STRIDES } from "./commute-walk";

test("distance phase survives stride changes, pause, and wraps", () => {
  const phase = createDistanceWalkPhase();
  assert.equal(phase(0, 2), 0);
  assert.ok(Math.abs(phase(0.5, 2) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(phase(0.5, 1) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(phase(0.75, 1) - Math.PI) < 1e-9);
  const walker = createCommuteWalker(0.58);
  walker.update(10);
  walker.update(11);
  walker.update(100, false);
  assert.equal(walker.update(100).cumulativeDistance, 0.58);
  assert.equal(walker.update(101).cumulativeDistance, 1.16);
});

// Parse all geometry and animation from the real GLBs, bypassing only browser
// image decoding: textures do not affect joint coordinates or model dimensions.
test("six homepage assets match measured planted-foot cycle travel within 10%", async () => {
  const errors: string[] = [];
  for (const index of [0, 2, 5, 8, 11, 3]) {
    const id = OFFICE_LOOKS[index].id;
    const bytes = readFileSync(`public/assets/characters/office/${id}.glb`);
    const loader = new GLTFLoader();
    loader.register(() => ({
      name: "node-texture-bypass",
      loadTexture: () => Promise.resolve(new T.Texture()),
    }));
    const asset = await loader.parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    );
    const clip = asset.animations.find((clip) => clip.name === "walk")!;
    assert.ok(clip);
    const height = new T.Box3().setFromObject(asset.scene).getSize(new T.Vector3()).y;
    const feet = ["LeftToeBase", "RightToeBase", "FootL", "FootR"]
      .map((name) => asset.scene.getObjectByName(name))
      .filter((node) => node !== undefined);
    assert.equal(feet.length, 2);
    const mixer = new T.AnimationMixer(asset.scene);
    mixer.clipAction(clip).play();
    const samples = feet.map(() => [] as T.Vector3[]);
    const count = 240;
    for (let k = 0; k <= count; k++) {
      mixer.setTime((k / count) * clip.duration);
      asset.scene.updateMatrixWorld(true);
      feet.forEach((foot, f) => samples[f].push(foot.getWorldPosition(new T.Vector3())));
    }
    const cycleTravels = samples.map((points) => {
      const floor = Math.min(...points.map((point) => point.y));
      const velocities: number[] = [];
      for (let k = 1; k < count; k++) {
        const a = points[k - 1],
          b = points[k];
        // Only low, backward-moving contact samples; exclude forward swing.
        if (Math.max(a.y, b.y) < floor + 0.025 && b.z < a.z) velocities.push((a.z - b.z) * count);
      }
      assert.ok(velocities.length >= 10);
      velocities.sort((a, b) => a - b);
      return velocities[Math.floor(velocities.length / 2)];
    });
    console.log(
      JSON.stringify({ id, duration: clip.duration, height, contactCycleTravel: cycleTravels }),
    );
    for (const scale of [0.8, 1.15, 1.6]) {
      const stride = COMMUTE_WALK_STRIDES[id] * scale;
      for (const measured of cycleTravels)
        if (!(Math.abs(stride - measured * scale) / (measured * scale) <= 0.1))
          errors.push(`${id}: ${stride} vs ${measured * scale}`);
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(asset.scene);
  }
  assert.deepEqual(errors, []);
});
