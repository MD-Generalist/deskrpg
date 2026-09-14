import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { commitPlayerStep } from "./player-motion";
import { clearSegment } from "./navigation";
const require = createRequire(import.meta.url);
interface BodyInstance {
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  reset(x: number, y: number): void;
  setVelocity(x: number, y: number): void;
  update(delta: number): void;
}
// Load the actual headless Arcade Body implementation, not a mocked integrator.
const Body = require("phaser/src/physics/arcade/Body.js") as new (world: object) => BodyInstance;
const makeBody = () => new Body({ defaults: {}, bounds: {}, updateMotion() {}, emit() {} });

test("Arcade's later fixed step can overshoot a render-delta checked endpoint", () => {
  const body = makeBody();
  const from = { x: 16.272, y: 7.20 }, checked = { x: 16.272, y: 7.26 };
  const floor = (_x: number, y: number) => y !== 8;
  assert.equal(clearSegment(from, checked, floor), true);
  body.reset((from.x + .5) * 32, (from.y + .5) * 32);
  body.setVelocity(0, (checked.y - from.y) * 32 / .008);
  body.update(1 / 60);
  const actual = { x: body.position.x / 32 - .5, y: body.position.y / 32 - .5 };
  assert.equal(clearSegment(actual, actual, floor), false);
});

test("committing the checked endpoint synchronizes Arcade and preserves walking independently", () => {
  for (const physicsDelta of [.008, 1 / 60, .033, .1]) {
    const body = makeBody();
    const from = { x: 536.704, y: 246.4 }, target = { x: 536.704, y: 248.32 };
    body.reset(from.x, from.y);
    body.setVelocity(0, 240);
    assert.equal(commitPlayerStep(body, from, target), true);
    assert.equal(body.velocity.x, 0);
    assert.equal(body.velocity.y, 0);
    body.update(physicsDelta);
    assert.equal(body.position.x, target.x);
    assert.equal(body.position.y, target.y);
    assert.equal(clearSegment({ x: 16.272, y: 7.26 }, {
      x: body.position.x / 32 - .5, y: body.position.y / 32 - .5,
    }, (_x, y) => y !== 8), true);
    assert.equal(commitPlayerStep(body, target, target), false);
  }
});
