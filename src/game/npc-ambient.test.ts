import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AmbientDepartures,
  restAtAmbientSeat,
  ambientLeader,
  ambientAllowed,
  ambientDestinations,
  ambientHome,
  createAmbientSchedule,
  advanceAmbientSchedule,
} from "./npc-ambient";
test("only one connected client drives ambient movement", () => {
  assert.equal(ambientLeader("a", ["b", "c"]), true);
  assert.equal(ambientLeader("b", ["a", "c"]), false);
  assert.equal(ambientLeader(undefined, []), false);
  assert.equal(ambientLeader("b", ["c"]), true);
});
test("work, conversation, and calls suspend roaming", () => {
  assert.equal(ambientAllowed(false, false, false), true);
  for (const flags of [
    [true, false, false],
    [false, true, false],
    [false, false, true],
  ])
    assert.equal(ambientAllowed(...(flags as [boolean, boolean, boolean])), false);
});
test("random destinations include distant tiles and exclude blocked/current tiles", () => {
  const points = ambientDestinations(
    30,
    20,
    { x: 1, y: 1 },
    (x, y) => x !== 10 && y !== 10,
    () => 0.5,
  );
  assert.ok(points.some((p) => p.x === 29 && p.y === 19));
  assert.ok(points.every((p) => p.x !== 10 && p.y !== 10 && (p.x !== 1 || p.y !== 1)));
  assert.equal(new Set(points.map((p) => `${p.x},${p.y}`)).size, points.length);
});
test("cycle rests, roams, prioritizes home and starts rest only after arrival", () => {
  const state = createAmbientSchedule(() => 0);
  for (let i = 0; i < 600; i++) advanceAmbientSchedule(state, 100, true, () => 0);
  assert.equal(state.phase, "roam");
  for (let i = 0; i < 200; i++) advanceAmbientSchedule(state, 100, false, () => 0);
  assert.equal(state.phase, "home");
  for (let i = 0; i < 1000; i++) advanceAmbientSchedule(state, 100, false, () => 0);
  assert.equal(state.phase, "home");
  advanceAmbientSchedule(state, 100, true, () => 0);
  assert.equal(state.phase, "rest");
  assert.equal(state.elapsed, 0);
});
test("chairs are stable, unique and fall back to configured home", () => {
  const home = { x: 5, y: 5 },
    seats = [
      { x: 6, y: 5 },
      { x: 9, y: 9 },
    ];
  assert.deepEqual(ambientHome(home, seats, []), seats[0]);
  assert.deepEqual(ambientHome(home, seats, [seats[0]]), seats[1]);
  assert.deepEqual(ambientHome(home, seats, seats), home);
});

test("departure spacing and two slots include returning workers", () => {
  const gate = new AmbientDepartures();
  assert.equal(gate.canDepart(0, 0), true);
  gate.departed(0, () => 0);
  assert.equal(gate.canDepart(14999, 1), false);
  assert.equal(gate.canDepart(15000, 1), true);
  assert.equal(gate.canDepart(99999, 2), false);
  const waiting = createAmbientSchedule(() => 0);
  waiting.elapsed = waiting.duration;
  advanceAmbientSchedule(waiting, 100, true, () => 0, false);
  assert.equal(waiting.phase, "rest");
  advanceAmbientSchedule(waiting, 100, true, () => 0, true);
  assert.equal(waiting.phase, "roam");
});
test("ten workers over ten minutes keep two reservations and stagger every departure", () => {
  const gate = new AmbientDepartures();
  const workers = Array.from({ length: 10 }, () => createAmbientSchedule(() => 0));
  const departures: number[] = [];
  for (let now = 0; now < 600000; now += 100) {
    for (const worker of [...workers].sort(
      (a, b) => b.elapsed - b.duration - (a.elapsed - a.duration),
    )) {
      const before = worker.phase;
      const atHome = before === "rest" || (before === "home" && worker.elapsed >= 20000);
      const active = workers.filter((other) => other !== worker && other.phase !== "rest").length;
      advanceAmbientSchedule(worker, 100, atHome, () => 0, gate.canDepart(now, active));
      if (before === "rest" && worker.phase === "roam") {
        gate.departed(now, () => 0);
        departures.push(now);
      }
    }
    assert.ok(workers.filter((worker) => worker.phase !== "rest").length <= 2);
  }
  assert.ok(departures.length > 10);
  assert.ok(departures.every((time, i) => i === 0 || time - departures[i - 1] >= 15000));
});

test("public-seat break starts after arrival, lasts 8 seconds and preserves walking budget", () => {
  const state = createAmbientSchedule(() => 0);
  Object.assign(state, {
    phase: "roam",
    elapsed: 12000,
    duration: 20000,
    seatTarget: { x: 4, y: 6 },
    visitedSeat: true,
  });
  assert.equal(
    restAtAmbientSeat(state, { x: 3, y: 6 }, true, 100, () => 0),
    false,
  );
  assert.equal(state.seatRest, undefined);
  for (let i = 0; i < 80; i++) {
    assert.equal(
      restAtAmbientSeat(state, { x: 4, y: 6 }, false, 100, () => 0),
      true,
    );
  }
  assert.equal(state.elapsed, 12000);
  assert.equal(restAtAmbientSeat(state, { x: 4, y: 6 }, false, 100), false);
  advanceAmbientSchedule(state, 100, false);
  assert.equal(state.phase, "roam");
  assert.equal(state.elapsed, 12100);
  state.phase = "home";
  advanceAmbientSchedule(state, 100, true);
  assert.equal(state.visitedSeat, undefined);
});
test("blocked or aborted paths do not start a seat break and returning cancels it", () => {
  const state = createAmbientSchedule();
  state.phase = "roam";
  state.seatTarget = { x: 4, y: 6 };
  assert.equal(restAtAmbientSeat(state, { x: 3, y: 6 }, false, 100), false);
  assert.equal(state.seatTarget, undefined);
  state.seatTarget = { x: 4, y: 6 };
  restAtAmbientSeat(state, { x: 4, y: 6 }, false, 100, () => 1);
  assert.equal(state.seatRest, 15900);
  state.phase = "home";
  assert.equal(restAtAmbientSeat(state, { x: 4, y: 6 }, false, 100), false);
  assert.equal(state.seatRest, undefined);
});
