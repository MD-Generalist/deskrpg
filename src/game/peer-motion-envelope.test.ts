import test from "node:test";
import assert from "node:assert/strict";
import {
  TrafficCoordinator,
  clearActors,
  clearTraffic,
  ACTOR_SEPARATION,
  segmentDistance,
} from "./traffic";
import { peerMovementUncertainty } from "./peer-motion-envelope";

// Each client has only received coordinates and local receipt time. No sender
// clock, future position or other coordinator's intent is exposed to it.
function simulate(
  interval: number,
  latency: number,
  envelope: boolean,
  changeMotion = false,
  doorway = false,
  stepMs = 10,
) {
  let a = { id: "a", x: 5, y: 5 },
    b = { id: "b", x: 5, y: 9.02 };
  let pa = { ...a, moving: true },
    pb = { ...b, moving: true },
    receivedAt = 0;
  const queues: { due: number; a: typeof pa; b: typeof pb }[] = [];
  const ca = new TrafficCoordinator(),
    cb = new TrafficCoordinator();
  let minimum = Infinity,
    lastSent = -interval,
    movingA = true,
    movingB = true;
  const floor = (x: number, y: number) =>
    x >= 0 && x < 15 && y >= 0 && y < 15 && (!doorway || y !== 7 || x === 5 || x === 6);
  for (let now = 0; now < 30000; now += stepMs) {
    if (now - lastSent >= interval) {
      queues.push({
        due: now + latency,
        a: { ...a, moving: movingA },
        b: { ...b, moving: movingB },
      });
      lastSent = now;
    }
    while (queues.length && queues[0].due <= now) {
      const message = queues.shift()!;
      pa = message.a;
      pb = message.b;
      receivedAt = now;
    }
    const peer = (sample: typeof pa) => ({
      ...sample,
      player: true,
      movementUncertainty: envelope
        ? peerMovementUncertainty({ receivedAt, moving: sample.moving }, now, stepMs)
        : 0,
    });
    const nextA = ca.step(a.id, a, { x: 5, y: 11 }, (3.75 * stepMs) / 1000, now, floor, [
      a,
      peer(pb),
    ]);
    // Abrupt stop, perpendicular turn, then reversal happen between reports.
    const stopped = changeMotion && now >= 350 && now < 600;
    const goalB =
      changeMotion && now >= 600 && now < 900
        ? { x: 9, y: b.y }
        : changeMotion && now >= 900 && now < 1200
          ? { x: 2, y: b.y }
          : { x: 5, y: 3 };
    const nextB = stopped
      ? b
      : cb.step(b.id, b, goalB, (3.75 * stepMs) / 1000, now, floor, [b, peer(pa)]);
    movingA = Math.hypot(nextA.x - a.x, nextA.y - a.y) > 0;
    movingB = Math.hypot(nextB.x - b.x, nextB.y - b.y) > 0;
    minimum = Math.min(
      minimum,
      segmentDistance(
        { x: a.x - b.x, y: a.y - b.y },
        { x: nextA.x - nextB.x, y: nextA.y - nextB.y },
        { x: 0, y: 0 },
      ),
    );
    a = { ...a, ...nextA };
    b = { ...b, ...nextB };
    minimum = Math.min(minimum, Math.hypot(a.x - b.x, a.y - b.y));
  }
  return { minimum, a, b };
}

test("independent simultaneous steps reproduce stale-peer and fresh-frame counterflow overlap", () => {
  assert.ok(simulate(10, 0, false).minimum < ACTOR_SEPARATION);
  assert.ok(simulate(66, 0, false).minimum < ACTOR_SEPARATION);
});
for (const [interval, latency] of [
  [10, 0],
  [66, 0],
  [66, 30],
  [66, 66],
]) {
  for (const changeMotion of [false, true]) {
    test(`receive-time envelope: ${interval}ms updates/${latency}ms transit, abrupt changes=${changeMotion}`, () => {
      const result = simulate(interval, latency, true, changeMotion);
      assert.ok(result.minimum >= ACTOR_SEPARATION, `minimum ${result.minimum}`);
      assert.ok(Math.hypot(result.a.x - 5, result.a.y - 11) < 0.02, JSON.stringify(result));
      assert.ok(Math.hypot(result.b.x - 5, result.b.y - 3) < 0.02, JSON.stringify(result));
    });
  }
}
test("peer movement allowance preserves physical seat occupancy, walls and monotone escape", () => {
  const peer = { x: 1, y: 1, movementUncertainty: 0.6 };
  assert.equal(clearActors({ x: 1.5, y: 1 }, { x: 1.5, y: 1 }, [peer]), true);
  assert.equal(clearActors({ x: 1.3, y: 1 }, { x: 1.3, y: 1 }, [peer]), false);
  assert.equal(clearActors({ x: 1.5, y: 1 }, { x: 1.6, y: 1 }, [peer]), true);
  assert.equal(clearActors({ x: 1.5, y: 1 }, { x: 1.4, y: 1 }, [peer]), false);
  assert.equal(
    clearTraffic({ x: 1.5, y: 1 }, { x: 2, y: 1 }, (x) => x < 2, [peer]),
    false,
  );
  assert.equal(
    clearActors({ x: 1.5, y: 1 }, { x: 1.6, y: 1 }, [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]),
    false,
  );
  assert.ok(Number.isFinite(peerMovementUncertainty({ receivedAt: 0, moving: true }, 1e9, 1e9)));
});

for (const latency of [0, 30, 66]) {
  test(`two independently driven peers pass a two-tile doorway with ${latency}ms transit`, () => {
    const result = simulate(66, latency, true, false, true);
    assert.ok(result.minimum >= ACTOR_SEPARATION, JSON.stringify(result));
    assert.ok(Math.hypot(result.a.x - 5, result.a.y - 11) < 0.02, JSON.stringify(result));
    assert.ok(Math.hypot(result.b.x - 5, result.b.y - 3) < 0.02, JSON.stringify(result));
  });
}

for (const stepMs of [16, 33, 100]) {
  test(`relative swept clearance also holds for ${stepMs}ms simultaneous physics steps`, () => {
    const result = simulate(66, 66, true, true, false, stepMs);
    assert.ok(result.minimum >= ACTOR_SEPARATION, JSON.stringify(result));
    assert.ok(Math.hypot(result.a.x - 5, result.a.y - 11) < 0.02, JSON.stringify(result));
    assert.ok(Math.hypot(result.b.x - 5, result.b.y - 3) < 0.02, JSON.stringify(result));
  });
}

test("a stopped remote caller remains reachable at the normal 60Hz arrival threshold", () => {
  const traffic = new TrafficCoordinator();
  let npc = { id: "npc", x: 5, y: 2 };
  const caller = { id: "caller", x: 5, y: 5, player: true };
  for (let now = 0; now < 5000; now += 1000 / 60) {
    if (Math.hypot(npc.x - caller.x, npc.y - caller.y) < 36 / 32) break;
    npc = {
      ...npc,
      ...traffic.step(npc.id, npc, caller, 0.05, now, () => true, [
        npc,
        {
          ...caller,
          movementUncertainty: peerMovementUncertainty(
            { receivedAt: 0, moving: false },
            now,
            1000 / 60,
          ),
        },
      ]),
    };
  }
  assert.ok(Math.hypot(npc.x - caller.x, npc.y - caller.y) < 36 / 32);
  assert.ok(Math.hypot(npc.x - caller.x, npc.y - caller.y) >= ACTOR_SEPARATION);
});
