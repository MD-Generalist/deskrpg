import assert from "node:assert/strict";
import test from "node:test";

import { createGaitTracker } from "./gait";

/** 일정한 속도(칸/초)로 `seconds` 동안 60fps 로 걷는다. */
function walk(
  tracker: ReturnType<typeof createGaitTracker>,
  tilesPerSecond: number,
  seconds: number,
) {
  const dt = 1 / 60;
  let gait = tracker.update(0, 0, dt, true);
  for (let i = 0; i < seconds * 60; i++) gait = tracker.update(tilesPerSecond * dt, 0, dt, true);
  return gait;
}

test("호출 기본 속도(300px/s)는 뛰고, 평소 걸음(150px/s)은 걷는다", () => {
  assert.equal(walk(createGaitTracker(), 300 / 32, 1).running, true);
  assert.equal(walk(createGaitTracker(), 150 / 32, 1).running, false);
  assert.equal(walk(createGaitTracker(), 55 / 32, 1).running, false, "산책은 걷는다");
});

test("뛸 때 걸음 주기는 속도에 비례한다 — 2배로 뛰면 약 2배로 돈다(발이 미끄러지지 않게)", () => {
  const gait = walk(createGaitTracker(), 300 / 32, 1);
  assert.ok(Math.abs(gait.cadence - 2) < 0.05, `주기 ${gait.cadence}`);
});

test("문턱 근처에서 떨려도 깜빡이지 않는다 — 들어가는 문턱보다 낮은 곳에서 나온다", () => {
  const tracker = createGaitTracker();
  walk(tracker, 300 / 32, 1);
  // 문턱(225px/s) 바로 아래로 떨어져도 여전히 뛴다.
  assert.equal(walk(tracker, 210 / 32, 1).running, true);
  // 충분히 느려지면 걷는다.
  assert.equal(walk(tracker, 150 / 32, 1).running, false);
});

test("멈추면 뛰지 않는다, 순간이동은 속도로 치지 않는다", () => {
  const tracker = createGaitTracker();
  walk(tracker, 300 / 32, 1);
  assert.equal(tracker.update(0, 0, 1 / 60, false).running, false);
  const fresh = createGaitTracker();
  // 한 프레임에 10칸 — 재배치다. 뛰는 것으로 치면 안 된다.
  assert.equal(fresh.update(10, 0, 1 / 60, true).running, false);
  assert.ok(fresh.speed < 1, `순간이동이 속도에 섞였습니다: ${fresh.speed}`);
});

test("프레임률에 상관없이 같은 판정이다", () => {
  const at = (fps: number) => {
    const tracker = createGaitTracker();
    let gait = tracker.update(0, 0, 1 / fps, true);
    for (let i = 0; i < fps; i++) gait = tracker.update(((300 / 32) * 1) / fps, 0, 1 / fps, true);
    return gait;
  };
  assert.equal(at(30).running, at(120).running);
  assert.ok(Math.abs(at(30).cadence - at(120).cadence) < 0.05);
});
