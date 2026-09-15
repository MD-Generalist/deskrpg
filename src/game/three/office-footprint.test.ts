import test from "node:test";
import assert from "node:assert/strict";
import { floorContours, insetContour } from "./office-footprint";
import { tradingFrameRuns, joinedPartitionSpan } from "./trading-scene";
import { buildOfficeEnvironment } from "./office-environments";
import { tiledSnapshot } from "./tiled-preview";

test("U floor outline retains exact occupied area and concave corners", () => {
  const map = tiledSnapshot(buildOfficeEnvironment("trading"));
  const contours = floorContours(map.floor);
  assert.equal(contours.length, 1);
  const points = contours[0];
  assert.equal(points.length, 8);
  const area =
    points.reduce((sum, p, i) => {
      const b = points[(i + 1) % points.length];
      return sum + p.x * b.z - b.x * p.z;
    }, 0) / 2;
  assert.equal(area, 44 * 30 - 8 * 11);
  const inset = insetContour(points, 0.5);
  assert.ok(inset.some((p) => p.x === 17.5 && p.z === 18.5));
  assert.ok(inset.some((p) => p.x === 26.5 && p.z === 18.5));
  const runs = tradingFrameRuns(map);
  assert.ok(
    runs.some(
      (r) => Math.min(r.x1, r.x2) === 17.5 && Math.max(r.x1, r.x2) === 26.5 && r.z1 === 18.5,
    ),
  );
  assert.ok(
    !runs.some(
      (r) =>
        r.z1 === 29.5 && r.z2 === 29.5 && Math.min(r.x1, r.x2) < 37 && Math.max(r.x1, r.x2) > 37,
    ),
  );
});
test("room horizontal frames reach exterior posts, without closing doorways", () => {
  const map = tiledSnapshot(buildOfficeEnvironment("trading"));
  const o = map.objects.find((o) => o.type === "glass_partition" && o.col === 1 && o.row === 10)!;
  const span = joinedPartitionSpan(o, map.objects);
  assert.equal(span.x - span.length / 2, 0.5);
  const east = map.objects.find(
    (o) => o.type === "glass_partition" && o.col === 42 && o.direction !== "right",
  )!;
  const right = joinedPartitionSpan(east, map.objects);
  assert.equal(right.x + right.length / 2, 43.5);
});
test("unsupported diagonal and closed-courtyard masks fail explicitly", () => {
  assert.throws(
    () =>
      floorContours([
        [1, 0],
        [0, 1],
      ]),
    /Diagonal/,
  );
  assert.throws(
    () =>
      floorContours([
        [1, 1, 1],
        [1, 0, 1],
        [1, 1, 1],
      ]),
    /courtyard/,
  );
  assert.deepEqual(
    floorContours([
      [1, 1],
      [1, 1],
    ])[0],
    [
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { x: 2, z: 2 },
      { x: 0, z: 2 },
    ],
  );
});
