import { test } from "node:test";
import assert from "node:assert/strict";
import { findPath, clearSegment, turnToward } from "./navigation";
const floor = (x: number, y: number) => x >= 0 && y >= 0 && x < 12 && y < 12;
test("open floor uses arbitrary-angle direct route and preserves exact endpoints", () => {
  assert.deepEqual(findPath(1, 1, 9, 5, floor), [
    { x: 1, y: 1 },
    { x: 9, y: 5 },
  ]);
  assert.deepEqual(findPath(1, 1, 1, 1, floor), [{ x: 1, y: 1 }]);
  assert.equal(findPath(1, 1, 20, 20, floor), null);
});
test("cannot cut a blocked diagonal or pass through a sealed wall", () => {
  const corner = (x: number, y: number) =>
    floor(x, y) && !(x === 1 && y === 0) && !(x === 0 && y === 1);
  assert.equal(findPath(0, 0, 1, 1, corner), null);
  assert.equal(
    findPath(1, 1, 9, 1, (x, y) => floor(x, y) && x !== 5),
    null,
  );
});
test("simplified detour retains body clearance around obstacles and through a one-tile door", () => {
  const walkable = (x: number, y: number) => floor(x, y) && !(x === 5 && y !== 6);
  const path = findPath(2, 2, 9, 2, walkable)!;
  assert.ok(path.length > 2);
  assert.deepEqual(path.at(-1), { x: 9, y: 2 });
  for (let i = 1; i < path.length; i++) assert.ok(clearSegment(path[i - 1], path[i], walkable));
});
test("swept checks catch intermediate occupancy and off-center corner clipping", () => {
  const walkable = (x: number, y: number) => floor(x, y) && !(x === 3 && y === 2);
  assert.equal(clearSegment({ x: 1, y: 2 }, { x: 5, y: 2 }, walkable), false);
  assert.equal(clearSegment({ x: 2.1, y: 1.4 }, { x: 3.2, y: 1.4 }, walkable), false);
  assert.equal(clearSegment({ x: 2, y: 1 }, { x: 4, y: 1 }, walkable), true);
});
test("rotation crosses angle wrap by shortest route and is frame-rate independent", () => {
  const start = Math.PI - 0.1,
    target = -Math.PI + 0.1;
  const one = turnToward(start, target, 0.1);
  assert.ok(one > start && one < Math.PI + 0.1);
  const two = turnToward(turnToward(start, target, 0.05), target, 0.05);
  assert.ok(Math.abs(one - two) < 1e-8);
  assert.equal(turnToward(start, target, 0), start);
});
