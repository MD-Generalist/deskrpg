import test from "node:test";
import assert from "node:assert/strict";
import { adaptRenderScale } from "./render-scale";

test("persistent slow tails reduce scale even when median-like FPS is near sixty", () => {
  const first = adaptRenderScale(1.75, 0, 60, 33.4);
  assert.deepEqual(first, { scale: 1.75, slowSamples: 1 });
  assert.deepEqual(adaptRenderScale(first.scale, first.slowSamples, 60, 33.4), {
    scale: 1.5,
    slowSamples: 0,
  });
});
test("one transient slow window does not sacrifice resolution", () => {
  const first = adaptRenderScale(1.5, 0, 40, 40);
  assert.deepEqual(adaptRenderScale(first.scale, first.slowSamples, 60, 18), {
    scale: 1.5,
    slowSamples: 0,
  });
});
test("quality floor is preserved under sustained load", () => {
  assert.deepEqual(adaptRenderScale(0.75, 1, 30, 40), { scale: 0.75, slowSamples: 0 });
});
test("target boundaries are accepted", () => {
  assert.deepEqual(adaptRenderScale(1.75, 1, 55, 25), { scale: 1.75, slowSamples: 0 });
});

test("sustained low average FPS also reduces scale without a slow tail", () => {
  assert.deepEqual(adaptRenderScale(1.5, 1, 50, 24), { scale: 1.25, slowSamples: 0 });
});
