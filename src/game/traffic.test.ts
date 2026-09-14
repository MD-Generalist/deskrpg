import { test } from "node:test";
import assert from "node:assert/strict";
import { findPath, clearSegment } from "./navigation";
import {
  TrafficCoordinator,
  clearActors,
  clearTraffic,
  findTrafficPath,
  type TrafficActor,
} from "./traffic";

test("shared disc occupancy checks swept movement, including actors inside the current tile", () => {
  assert.equal(clearActors({ x: 1, y: 1 }, { x: 3, y: 1 }, [{ x: 2, y: 1 }]), false);
  assert.equal(clearActors({ x: 1, y: 1 }, { x: 1.1, y: 1 }, [{ x: 1.5, y: 1 }]), false);
  assert.equal(clearActors({ x: 1, y: 1 }, { x: 3, y: 1 }, [{ x: 2, y: 1.5 }]), true);
});

for (const [rotate, reverse, dt] of [
  [false, false, 25],
  [true, false, 16],
  [false, true, 50],
  [true, true, 100],
] as const) {
  test(`10 NPCs + 2 click players cross one-tile door: rotated=${rotate}, reverse=${reverse}, dt=${dt}`, (t) => {
    const floor = (x: number, y: number) => {
      if (rotate) [x, y] = [y, x];
      return x >= 0 && x < 15 && y >= 0 && y < 11 && !(x === 7 && y !== 5);
    };
    const traffic = new TrafficCoordinator();
    const actors: (TrafficActor & {
      path: { x: number; y: number }[];
      index: number;
      done?: number;
    })[] = [];
    for (let i = 0; i < 12; i++) {
      const left = i % 2 === 0;
      const start = { x: left ? 2 : 12, y: 1 + Math.floor(i / 2) * 1.5 };
      const goal = { x: left ? 12 : 2, y: Math.round(start.y) };
      start.y = Math.round(start.y);
      if (rotate) {
        [start.x, start.y] = [start.y, start.x];
        [goal.x, goal.y] = [goal.y, goal.x];
      }
      actors.push({
        id: `${i < 10 ? "npc" : "player"}-${i}`,
        player: i >= 10,
        ...start,
        path: findPath(start.x, start.y, goal.x, goal.y, floor)!,
        index: 1,
      });
    }
    if (reverse) actors.reverse();
    for (let frame = 0; frame < 4000 && actors.some((a) => !a.done); frame++) {
      const searchesBeforeFrame = traffic.searches;
      for (const a of actors) {
        if (a.done) continue;
        const target = a.path[a.index];
        if (Math.hypot(a.x - target.x, a.y - target.y) < 0.02) {
          if (++a.index === a.path.length) {
            a.done = frame;
            traffic.clear(a.id);
            continue;
          }
        }
        const next = traffic.step(
          a.id,
          a,
          a.path[a.index],
          (2 * dt) / 1000,
          frame * dt,
          floor,
          actors,
        );
        assert.ok(clearSegment(a, next, floor));
        assert.ok(
          clearActors(
            a,
            next,
            actors.filter((b) => a !== b),
          ),
        );
        Object.assign(a, next);
      }
      assert.ok(traffic.searches - searchesBeforeFrame <= 2, "shared frame search budget");
    }
    assert.ok(
      actors.every((a) => a.done),
      JSON.stringify(actors.map(({ id, x, y, index, done }) => ({ id, x, y, index, done }))),
    );
    assert.ok(
      Math.max(...actors.map((a) => a.done!)) * dt < 60000,
      "all queued actors complete within 60 seconds",
    );
    assert.ok(traffic.searches < 12000, `bounded searches: ${traffic.searches}`);
    t.diagnostic(
      `last arrival ${(Math.max(...actors.map((a) => a.done!)) * dt) / 1000}s, local searches ${traffic.searches}`,
    );
  });
}

test("a call approach and return keep their goal while the home seat is occupied", (t) => {
  const floor = (x: number, y: number) =>
    x >= 0 && x < 12 && y >= 0 && y < 9 && !(x === 6 && y !== 4);
  const traffic = new TrafficCoordinator();
  const npc: TrafficActor = { id: "caller", x: 2, y: 4 };
  const player: TrafficActor = { id: "player", x: 10, y: 4, player: true };
  const seated: TrafficActor = { id: "seat-owner", x: 2, y: 4 };
  let path = findPath(2, 4, 10, 4, floor)!;
  let index = 1,
    calledAt = 0,
    returnedAt = 0;
  let phase: "call" | "return" = "call";
  for (let frame = 1; frame < 6000; frame++) {
    const now = frame * 25;
    if (phase === "call" && Math.hypot(npc.x - player.x, npc.y - player.y) < 1.125) {
      calledAt = now;
      phase = "return";
      traffic.clear(npc.id);
      path = findPath(Math.round(npc.x), Math.round(npc.y), 2, 4, floor)!;
      index = 0;
    }
    const seatOccupied = phase === "return" && now < calledAt + 12000;
    const actors = [npc, player, ...(seatOccupied ? [seated] : [])];
    const target = path[index];
    if (Math.hypot(npc.x - target.x, npc.y - target.y) < 0.02) {
      if (++index === path.length) {
        assert.equal(seatOccupied, false, "return never declares arrival on an occupied seat");
        returnedAt = now;
        break;
      }
    }
    const next = traffic.step(npc.id, npc, path[index], 0.05, now, floor, actors);
    assert.ok(clearSegment(npc, next, floor));
    assert.ok(
      clearActors(
        npc,
        next,
        actors.filter((a) => a !== npc),
      ),
    );
    Object.assign(npc, next);
    assert.deepEqual(
      player,
      { id: "player", x: 10, y: 4, player: true },
      "NPC never commands a human",
    );
  }
  assert.ok(calledAt > 0 && returnedAt > calledAt + 12000);
  assert.ok(Math.hypot(npc.x - 2, npc.y - 4) < 0.02);
  t.diagnostic(
    `called at ${calledAt / 1000}s; occupied home released after 12s; returned at ${returnedAt / 1000}s`,
  );
});

test("a permanently blocked destination is retried at bounded frequency without clipping or teleporting", () => {
  const traffic = new TrafficCoordinator();
  const floor = (x: number, y: number) => x >= 0 && x < 6 && y === 0;
  const npc = { id: "npc", x: 1, y: 0 };
  const blocker = { id: "human", x: 2, y: 0, player: true };
  for (let frame = 0; frame < 1000; frame++) {
    const next = traffic.step(npc.id, npc, { x: 4, y: 0 }, 0.05, frame * 16, floor, [npc, blocker]);
    assert.ok(clearSegment(npc, next, floor));
    assert.ok(clearActors(npc, next, [blocker]));
    Object.assign(npc, next);
  }
  assert.ok(npc.x < 2);
  assert.ok(traffic.searches <= 44, `searches=${traffic.searches}`);
});

test("coarse dynamic planning and smoothed segments use the execution disc clearance", () => {
  const floor = (x: number, y: number) => x >= 0 && x < 10 && y >= 0 && y < 8;
  const actors = [
    { x: 4.25, y: 3.15 },
    { x: 5.1, y: 4 },
  ];
  const path = findPath(1, 3, 8, 3, floor, (a, b) => clearActors(a, b, actors))!;
  assert.ok(path.length > 2);
  for (let i = 1; i < path.length; i++) {
    assert.ok(clearSegment(path[i - 1], path[i], floor));
    assert.ok(clearActors(path[i - 1], path[i], actors));
  }
});

test("NPC return routes around a stationary human on its former coarse waypoint", () => {
  const floor = (x: number, y: number) => x >= 0 && x < 9 && y >= 0 && y < 7;
  const human = { id: "human", x: 4, y: 3, player: true };
  const npc = { id: "npc", x: 1, y: 3 };
  const path = findTrafficPath(1, 3, 7, 3, floor, [human])!;
  assert.ok(path.length > 2, "route must turn around the occupied direct route");
  const traffic = new TrafficCoordinator();
  let index = 0;
  for (let frame = 0; frame < 2000 && index < path.length; frame++) {
    if (Math.hypot(npc.x - path[index].x, npc.y - path[index].y) < 0.02) {
      index++;
      continue;
    }
    const next = traffic.step(npc.id, npc, path[index], 0.05, frame * 16, floor, [npc, human]);
    assert.ok(clearActors(npc, next, [human]));
    assert.ok(clearSegment(npc, next, floor));
    Object.assign(npc, next);
  }
  assert.equal(index, path.length);
  assert.ok(Math.hypot(npc.x - 7, npc.y - 3) < 0.02);
});

test("pre-existing overlap permits only separation without weakening swept collisions", () => {
  const a = { x: 13, y: 0.999 },
    other = { x: 12.601, y: 0.932 };
  assert.equal(clearActors(a, { x: 13.05, y: 0.999 }, [other]), true);
  assert.equal(clearActors(a, a, [other]), false);
  assert.equal(clearActors(a, { x: 12.95, y: 0.999 }, [other]), false);
  assert.equal(clearActors(a, { x: 12, y: 0.999 }, [other]), false);
  assert.equal(clearActors(a, { x: 13.1, y: 0.999 }, [other, { x: 13.5, y: 0.999 }]), false);
});

test("live close-spawn coordinates escape and reach the goal without entering a wall", () => {
  const traffic = new TrafficCoordinator();
  let a = { id: "a", x: 13, y: 0.999 };
  const b = { id: "b", x: 12.601, y: 0.932, player: true };
  const floor = (x: number, y: number) => x >= 0 && x < 20 && y >= 0 && y < 10;
  let previous = Math.hypot(a.x - b.x, a.y - b.y);
  for (let i = 0; i < 100; i++) {
    const next = traffic.step(a.id, a, { x: 16, y: 1 }, 0.05, i * 20, floor, [a, b]);
    assert.ok(clearSegment(a, next, floor));
    const separation = Math.hypot(next.x - b.x, next.y - b.y);
    assert.ok(separation >= previous - 1e-8);
    previous = separation;
    a = { ...a, ...next };
  }
  assert.ok(Math.hypot(a.x - 16, a.y - 1) < 0.02);
});

test("overlap escape handles tangent/coincident starts while preserving walls and other actors", () => {
  const a = { x: 1, y: 1 };
  assert.equal(clearActors(a, { x: 1.1, y: 1 }, [a]), true);
  assert.equal(clearActors(a, a, [a]), false);
  assert.equal(clearActors(a, { x: 1, y: 1.1 }, [{ x: 0.7, y: 1 }]), true);
  assert.equal(
    clearActors(a, { x: 1.1, y: 1 }, [
      { x: 0.7, y: 1 },
      { x: 1.3, y: 1 },
    ]),
    false,
  );
  assert.equal(
    clearTraffic(a, { x: 2, y: 1 }, (x) => x < 2, [{ x: 0.7, y: 1 }]),
    false,
  );
});
