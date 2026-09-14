import assert from "node:assert/strict";
import test from "node:test";
import { createCommuteMotion, getWalkPhase } from "./commute-motion";

test("frame rates agree and pauses exclude wall time", () => {
  const runs = [30, 60, 120].map((hz) => {
    const m = createCommuteMotion();
    for (let i = 0; i < hz * 40; i++) m.step(1 / hz);
    return m;
  });
  for (const m of runs.slice(1)) assert.deepEqual(m.vehicles, runs[0].vehicles);
  const m = createCommuteMotion();
  m.update(100);
  m.update(101);
  const before = structuredClone(m.vehicles);
  m.update(500, false);
  assert.deepEqual(m.vehicles, before);
  m.update(501);
  assert.equal(m.elapsed, 2);
});

test("ten minute loop preserves fleet, direction, bumper gaps and wheel odometry", () => {
  const m = createCommuteMotion();
  const previous = new Map<string, number>();
  for (let i = 0; i < 600 * 30; i++) {
    m.step(1 / 30);
    assert.equal(m.vehicles.length, 6);
    for (const v of m.vehicles) {
      assert.ok(v.cumulativeDistance >= (previous.get(v.id) ?? 0));
      previous.set(v.id, v.cumulativeDistance);
      assert.equal(v.wheelRotation, (v.direction * v.cumulativeDistance) / v.wheelRadius);
      assert.ok(v.opacity >= 0 && v.opacity <= 1);
    }
    for (const d of [-1, 1]) {
      const lane = m.vehicles
        .filter((v) => v.active && v.direction === d)
        .sort((a, b) => d * (a.x - b.x));
      for (let j = 1; j < lane.length; j++)
        assert.ok(
          d * (lane[j].x - lane[j - 1].x) - (lane[j].length + lane[j - 1].length) / 2 >= 0.8 - 1e-8,
        );
    }
  }
  assert.ok(m.vehicles.every((v) => v.cumulativeDistance > 100));
});

test("red stops an approaching bus but lets an already crossed vehicle clear, then resumes", () => {
  const fleet = [
    {
      id: "bus",
      kind: "bus" as const,
      direction: 1 as const,
      laneZ: 4.4,
      length: 6,
      wheelRadius: 0.35,
      x: -8,
    },
    {
      id: "clear",
      kind: "sedan" as const,
      direction: -1 as const,
      laneZ: 7.2,
      length: 3,
      wheelRadius: 0.3,
      x: 2,
    },
  ];
  const m = createCommuteMotion({ fleet, driveSeconds: 0.1, stopSeconds: 10 });
  m.step(8);
  assert.ok(m.vehicles[0].x + 3 <= 1.05 - 0.35 + 1e-8);
  assert.ok(m.vehicles[0].speed < 0.01);
  assert.ok(m.vehicles[1].cumulativeDistance > 5);
  const x = m.vehicles[0].x;
  m.step(3);
  assert.ok(m.vehicles[0].x > x);
});

test("blocked reentry waits invisibly until a full body fits", () => {
  const m = createCommuteMotion({
    driveSeconds: 0.01,
    stopSeconds: 100,
    roadMin: -5,
    roadMax: 5,
    fleet: [
      { id: "exit", kind: "sedan", direction: 1, laneZ: 4.4, length: 3, wheelRadius: 0.3, x: 6.49 },
      { id: "queue", kind: "bus", direction: 1, laneZ: 4.4, length: 6, wheelRadius: 0.35, x: -4 },
    ],
  });
  m.step(8);
  const v = m.vehicles[0];
  assert.equal(v.active, false);
  assert.equal(v.opacity, 0);
  const distance = v.cumulativeDistance;
  m.step(5);
  assert.equal(v.cumulativeDistance, distance);
});

test("walk phase derives cycles from distance", () => {
  assert.equal(getWalkPhase(1.5, 2), Math.PI * 1.5);
  assert.equal(getWalkPhase(3.5, 2), Math.PI * 1.5);
  assert.throws(() => getWalkPhase(1, 0));
});

test("large frame deltas match fine steps without tunneling and both lanes stop", () => {
  const coarse = createCommuteMotion();
  const fine = createCommuteMotion();
  coarse.step(50);
  for (let i = 0; i < 6000; i++) fine.step(1 / 120);
  assert.deepEqual(coarse.vehicles, fine.vehicles);
  for (const direction of [1, -1] as const) {
    const m = createCommuteMotion({
      driveSeconds: 0.01,
      stopSeconds: 20,
      fleet: [
        {
          id: "front",
          kind: "sedan",
          direction,
          laneZ: direction === 1 ? 4.4 : 7.2,
          length: 3,
          wheelRadius: 0.3,
          x: direction === 1 ? -7 : 12,
        },
      ],
    });
    let lastSpeed = 0;
    let lastX = m.vehicles[0].x;
    for (let i = 0; i < 1200; i++) {
      m.step(1 / 120);
      const v = m.vehicles[0];
      assert.ok(direction * (v.x - lastX) >= 0);
      assert.ok(v.speed - lastSpeed <= 1.4 / 120 + 1e-8);
      assert.ok(lastSpeed - v.speed <= 2.5 / 120 + 1e-8);
      assert.ok(direction * v.x + v.length / 2 <= direction * 2.4 - 2.7 / 2 - 0.35 + 1e-8);
      lastSpeed = v.speed;
      lastX = v.x;
    }
    assert.ok(m.vehicles[0].speed < 0.01);
    assert.equal(m.pedestriansMayCross, true);
  }
});

test("default fleet brakes smoothly throughout ten minutes including red transitions", () => {
  const m = createCommuteMotion();
  for (let i = 0; i < 600 * 120; i++) {
    const before = m.vehicles.map((v) => ({ speed: v.speed, active: v.active }));
    m.step(1 / 120);
    m.vehicles.forEach((v, j) => {
      if (!before[j].active || !v.active) return; // Invisible recycling is not driving.
      assert.ok(
        before[j].speed - v.speed <= 2.5 / 120 + 1e-8,
        `${v.id} brakes abruptly at ${m.elapsed}: ${before[j].speed} -> ${v.speed}`,
      );
      assert.ok(v.speed - before[j].speed <= 1.4 / 120 + 1e-8);
    });
  }
});

test("reject nonfinite geometry and impossible initial fleets", () => {
  for (const config of [
    { crossingX: NaN },
    { crossingWidth: NaN },
    { roadMax: Infinity },
    { roadMin: -Infinity },
    { crossingWidth: -1 },
    { stopMargin: NaN },
  ])
    assert.throws(() => createCommuteMotion(config), RangeError);
  const base = {
    id: "one",
    kind: "sedan" as const,
    direction: 1 as const,
    laneZ: 4.4,
    length: 3,
    wheelRadius: 0.3,
    x: 0,
  };
  for (const config of [{ length: Infinity }, { wheelRadius: Infinity }, { laneZ: NaN }])
    assert.throws(() => createCommuteMotion({ fleet: [{ ...base, ...config }] }), RangeError);
  assert.throws(() => createCommuteMotion({ fleet: [base, { ...base, id: "two" }] }), RangeError);
});
