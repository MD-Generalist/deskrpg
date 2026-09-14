import test from "node:test";
import assert from "node:assert/strict";
import { clearMovementSegment, clearSegment, findPath } from "./navigation";
import { clearTraffic, TrafficCoordinator } from "./traffic";
import { buildOfficeEnvironment } from "./three/office-environments";
import { tiledSnapshot } from "./three/tiled-preview";

test("live table/partition edge positions escape shallow penetration and reach their clicked goals", () => {
  const blocked = new Set(tiledSnapshot(buildOfficeEnvironment("publishing")).blocked);
  const floor = (x: number, y: number) => x >= 1 && x < 29 && y >= 1 && y < 21 && !blocked.has(`${x},${y}`);
  for (const [origin, goal] of [
    [{ x: 16.354, y: 6.209 }, { x: 12, y: 10 }],
    [{ x: 16.772, y: 7.790 }, { x: 16, y: 1 }],
  ]) {
    let position = { x: origin.x - .5, y: origin.y - .5 };
    assert.equal(clearSegment(position, position, floor), false);
    const path = findPath(Math.floor(origin.x), Math.floor(origin.y), goal.x, goal.y, floor)!;
    const traffic = new TrafficCoordinator();
    let index = 1;
    for (let frame = 0; frame < 1500 && index < path.length; frame++) {
      const next = traffic.step("local", position, path[index], .05, frame * 16, floor, [{ id: "local", ...position }]);
      assert.ok(clearMovementSegment(position, next, floor));
      position = next;
      if (Math.hypot(position.x - path[index].x, position.y - path[index].y) < .02) index++;
    }
    assert.equal(index, path.length);
    assert.equal(clearSegment(position, position, floor), true);
  }
});

test("shallow wall recovery rejects deep, inward, tangent, new-wall and actor intersections", () => {
  const floor = (x: number, y: number) => !(x === 0 && y === 0);
  const start = { x: .71, y: 0 };
  assert.equal(clearMovementSegment(start, { x: .715, y: 0 }, floor), true);
  assert.equal(clearMovementSegment(start, { x: .75, y: 0 }, floor), true);
  assert.equal(clearMovementSegment(start, start, floor), false);
  assert.equal(clearMovementSegment(start, { x: .70, y: 0 }, floor), false);
  assert.equal(clearMovementSegment(start, { x: .71, y: .1 }, floor), false);
  assert.equal(clearMovementSegment({ x: .6, y: 0 }, { x: .8, y: 0 }, floor), false);
  assert.equal(clearMovementSegment(start, { x: 2, y: 0 }, (x, y) => floor(x, y) && !(x === 2 && y === 0)), false);
  assert.equal(clearTraffic(start, { x: .8, y: 0 }, floor, [{ x: 1.2, y: 0 }]), false);
  assert.equal(clearMovementSegment({ x: .75, y: 0 }, start, floor), false);
});

test("a corner overlap must improve both nearest wall faces, not merely one", () => {
  const floor = (x: number, y: number) => !(x === 0 && y === 1) && !(x === 1 && y === 0);
  const start = { x: .71, y: .71 };
  assert.equal(clearMovementSegment(start, { x: .75, y: .75 }, floor), true);
  assert.equal(clearMovementSegment(start, { x: .75, y: .71 }, floor), false);
  assert.equal(clearMovementSegment(start, { x: .71, y: .75 }, floor), false);
  assert.equal(clearMovementSegment(start, { x: .75, y: .70 }, floor), false);
  assert.equal(clearTraffic(start, { x: .8, y: .8 }, floor, [{ x: 1.05, y: 1.05 }]), false);
});
