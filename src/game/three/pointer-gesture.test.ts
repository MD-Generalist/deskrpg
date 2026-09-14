import test from "node:test";
import assert from "node:assert/strict";
import { PointerGesture } from "./pointer-gesture";
const e = (x = 0, button = 0, id = 1) => ({
  pointerId: id,
  isPrimary: true,
  button,
  clientX: x,
  clientY: 0,
});
test("clicks accept primary left/right but reject middle, drags and cancellation", () => {
  const gesture = new PointerGesture();
  for (const button of [0, 2]) {
    gesture.start(e(0, button));
    assert.equal(gesture.finish(e(1, button)), true);
  }
  gesture.start(e(0, 1));
  assert.equal(gesture.finish(e(0, 1)), false);
  gesture.start(e());
  gesture.move(e(10));
  assert.equal(gesture.finish(e()), false);
  gesture.start(e());
  gesture.cancel();
  assert.equal(gesture.finish(e()), false);
  gesture.start(e());
  assert.equal(gesture.finish(e(0, 0, 2)), false);
});
