import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createMeetingSpatialCoordinator } from "./meeting-spatial-coordinator";

function harness() {
  const actors = new Map([
    ["n1", { x: 16, y: 16 }],
    ["n2", { x: 48, y: 16 }],
  ]);
  const occupied = new Set<string>();
  const moves: Array<{ actorId: string; generation: number; x: number; y: number }> = [];
  const coordinator = createMeetingSpatialCoordinator({
    layout: async () => ({
      spaceId: "meeting",
      targets: [
        { seatId: "80:80", x: 80, y: 80 },
        { seatId: null, x: 112, y: 80 },
      ],
    }),
    capture: async (_channel, actorId) =>
      actors.has(actorId) ? { ...actors.get(actorId)!, seatId: null } : null,
    reserve: async (_channel, actorId, target) => {
      const key = `${target.x}:${target.y}`;
      if (occupied.has(key)) return false;
      occupied.add(key);
      return true;
    },
    move: async (_channel, actorId, generation, target) => {
      moves.push({ actorId, generation, ...target });
      return true;
    },
    release: async () => {},
    returnTarget: async (_channel, _actorId, origin) => origin,
    publish: () => {},
  });
  return { coordinator, moves, occupied };
}

test("집결은 전원 서버 도착 뒤 한 번만 준비되고 오래된 도착은 무시한다", async () => {
  const { coordinator: c, moves } = harness();
  const generation = await c.start("a", "u1", ["n1", "n2"]);
  assert.equal(c.snapshot("a")?.phase, "assembling");
  assert.equal(moves.length, 2);
  assert.equal(await c.start("a", "u1", ["n1"]), null);
  assert.equal(c.arrived("a", "n1", generation! - 1), false);
  c.arrived("a", "n1", generation!);
  assert.equal(c.snapshot("a")?.phase, "assembling");
  c.arrived("a", "n2", generation!);
  assert.equal(await c.ready("a", generation!), true);
  assert.equal(c.snapshot("a")?.phase, "ready");
  assert.equal(c.arrived("a", "n2", generation!), false);
});

test("좌석 선점 실패는 standing으로 재배정하고 공간 부족은 대상과 함께 blocked", async () => {
  const { coordinator: c, occupied, moves } = harness();
  occupied.add("80:80");
  const generation = await c.start("a", "u1", ["n1", "n2"]);
  assert.equal(moves[0].x, 112);
  assert.deepEqual(c.snapshot("a")?.failure, { actorId: "n2", reasonCode: "space_full" });
  assert.equal(await c.ready("a", generation!), false);
});

test("취소는 원래 실제 위치로 도보 복귀하고 중복 취소는 중복 명령을 만들지 않는다", async () => {
  const { coordinator: c, moves } = harness();
  const generation = await c.start("a", "u1", ["n1"]);
  await c.cancel("a");
  await c.cancel("a");
  assert.equal(moves.length, 2);
  assert.deepEqual({ x: moves[1].x, y: moves[1].y }, { x: 16, y: 16 });
  assert.equal(c.arrived("a", "n1", generation!), false);
  c.arrived("a", "n1", moves[1].generation);
  assert.equal(c.snapshot("a")?.phase, "idle");
});

test("존재하지 않는 선택 NPC를 조용히 제외하지 않는다", async () => {
  const { coordinator: c } = harness();
  await c.start("a", "u1", ["missing"]);
  assert.deepEqual(c.snapshot("a")?.failure, {
    actorId: "missing",
    reasonCode: "actor_unavailable",
  });
});

test("예약 await 도중 취소는 옛 집결을 시작하지 않고 예약을 회수한 뒤 복귀한다", async () => {
  let finishReserve!: (value: boolean) => void;
  const reserved = new Promise<boolean>((resolve) => {
    finishReserve = resolve;
  });
  const actions: string[] = [];
  let calls = 0;
  const c = createMeetingSpatialCoordinator({
    layout: async () => ({ spaceId: "meeting", targets: [{ x: 80, y: 80, seatId: "80:80" }] }),
    capture: async () => ({ x: 16, y: 16, seatId: null }),
    reserve: async () => {
      actions.push("reserve");
      return ++calls === 1 ? reserved : true;
    },
    release: async () => {
      actions.push("release");
    },
    move: async (_c, _a, _g, _t, returning) => {
      actions.push(returning ? "return" : "assemble");
      return true;
    },
    returnTarget: async (_c, _a, p) => p,
    publish: () => {},
  });
  const start = c.start("a", "u1", ["n1"]);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.deepEqual(actions, ["reserve"]);
  const cancelled = c.cancel("a");
  finishReserve(true);
  await start;
  await cancelled;
  assert.deepEqual(actions, ["reserve", "release", "reserve", "return"]);
  assert.equal(c.snapshot("a")?.phase, "returning");
});

test("복귀 예약 await 도중 새 start는 복귀 세대를 덮지 않는다", async () => {
  let releaseReturn!: () => void;
  const waiting = new Promise<void>((r) => {
    releaseReturn = r;
  });
  const c = createMeetingSpatialCoordinator({
    layout: async () => ({ spaceId: "meeting", targets: [{ x: 80, y: 80, seatId: "80:80" }] }),
    capture: async () => ({ x: 16, y: 16, seatId: null }),
    reserve: async () => true,
    move: async () => true,
    release: async () => {
      await waiting;
    },
    returnTarget: async (_c, _a, p) => p,
    publish: () => {},
  });
  await c.start("a", "u1", ["n1"]);
  const cancel = c.cancel("a");
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const generation = c.snapshot("a")!.generation;
  const retry = c.start("a", "u1", ["n1"]);
  releaseReturn();
  await cancel;
  assert.equal(await retry, null);
  assert.equal(c.snapshot("a")!.generation, generation);
});

test("복귀 중 정체는 timeout blocked가 되어 재시도할 수 있고 옛 실패는 무시한다", async () => {
  const c = createMeetingSpatialCoordinator({
    timeoutMs: 5,
    layout: async () => ({ spaceId: "meeting", targets: [{ x: 80, y: 80, seatId: "80:80" }] }),
    capture: async () => ({ x: 16, y: 16, seatId: null }),
    reserve: async () => true,
    move: async () => true,
    release: async () => {},
    returnTarget: async (_c, _a, p) => p,
    publish: () => {},
  });
  await c.start("a", "u1", ["n1"]);
  await c.cancel("a");
  const oldGeneration = c.snapshot("a")!.generation;
  await delay(20);
  assert.deepEqual(c.snapshot("a")?.failure, { actorId: "n1", reasonCode: "return_timeout" });
  const retry = await c.start("a", "u1", ["n1"]);
  assert.ok(retry! > oldGeneration);
  c.block("a", "n1", "path_unavailable", oldGeneration);
  assert.equal(c.snapshot("a")?.phase, "assembling");
  c.arrived("a", "n1", retry!);
});
