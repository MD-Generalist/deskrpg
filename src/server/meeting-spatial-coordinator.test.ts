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

test("맵 reset은 준비와 참가자를 폐기하고 이전 도착 세대를 재사용하지 않는다", async () => {
  const { coordinator: c, occupied } = harness();
  await c.joinPlayer("a", "u1", "socket1");
  const old = await c.start("a", "u1", ["n1"]);
  const ready = c.ready("a", old!);
  c.reset("a");
  assert.equal(await ready, false);
  assert.equal(c.snapshot("a"), null);
  occupied.clear();
  assert.equal(await c.joinPlayer("a", "u1", "socket1"), true);
  assert.equal(occupied.size, 1);
  const fresh = await c.start("a", "u1", ["n1"]);
  assert.ok(fresh! > old!);
  assert.equal(c.arrived("a", "n1", old!), false);
});

test("맵 reset은 지연된 참가 예약과 대기중 start가 세션을 되살리지 못하게 한다", async () => {
  let release!: () => void;
  const pending = new Promise<void>((r) => {
    release = r;
  });
  const c = createMeetingSpatialCoordinator({
    layout: async () => {
      await pending;
      return { spaceId: "old", targets: [{ x: 80, y: 80, seatId: null }] };
    },
    capture: async () => ({ x: 16, y: 16, seatId: null }),
    reserve: async () => true,
    move: async () => true,
    release: async () => {},
    returnTarget: async (_c, _a, p) => p,
    publish: () => {},
  });
  const join = c.joinPlayer("a", "u1", "socket1");
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const start = c.start("a", "u1", ["n1"]);
  c.reset("a");
  release();
  assert.equal(await join, false);
  assert.equal(await start, null);
  assert.equal(c.snapshot("a"), null);
});

test("준비 완료 회의도 reset 뒤 이전 ready와 복귀 위치를 폐기한다", async () => {
  const { coordinator: c, occupied, moves } = harness();
  const generation = await c.start("a", "u1", ["n1"]);
  c.arrived("a", "n1", generation!);
  assert.equal(await c.ready("a", generation!), true);
  c.reset("a");
  assert.equal(await c.ready("a", generation!), false);
  await c.cancel("a");
  assert.equal(moves.length, 1);
  occupied.clear();
  assert.ok((await c.start("a", "u1", ["n1"]))! > generation!);
});

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

// 카드 "회의가 끝나도 NPC 가 회의석에 남는다" Acceptance (c).
//
// 원래 좌석이 점유돼 있으면 `returnTarget` 이 가장 가까운 설 자리를 내준다. 그 강등이 실제로
// **회의석을 떠나는 이동**으로 이어지는지, 그리고 세션이 idle 로 닫히는지를 고정한다.
// 여기서 막히면(`return_space_full`) NPC 는 회의석에 그대로 남는다.
test("원래 좌석이 점유돼 있으면 설 자리로 강등해 회의석을 떠난다", async () => {
  const moves: Array<{ actorId: string; x: number; y: number; seatId: string | null }> = [];
  const occupied = new Set<string>();
  const published: string[] = [];
  const standing = { seatId: null, x: 144, y: 16 };
  const coordinator = createMeetingSpatialCoordinator({
    layout: async () => ({
      spaceId: "meeting",
      targets: [{ seatId: "80:80", x: 80, y: 80 }],
    }),
    capture: async () => ({ x: 16, y: 16, seatId: "16:16" }),
    reserve: async (_channel, _actorId, target) => {
      const key = `${target.x}:${target.y}`;
      if (occupied.has(key)) return false;
      occupied.add(key);
      return true;
    },
    move: async (_channel, actorId, _generation, target) => {
      moves.push({ actorId, x: target.x, y: target.y, seatId: target.seatId });
      return true;
    },
    release: async (_channel, actorId) => {
      // 회의석 예약을 놓아준다 — 실제 좌석 정본과 같은 동작.
      occupied.delete("80:80");
      void actorId;
    },
    // 원래 좌석(16:16)은 그사이 누가 차지했다 → 가장 가까운 설 자리로 강등된다.
    returnTarget: async () => standing,
    publish: (state) => published.push(state.phase),
  });
  const generation = await coordinator.start("a", "u1", ["n1"]);
  assert.ok(generation);
  coordinator.arrived("a", "n1", generation);
  assert.equal(coordinator.snapshot("a")?.phase, "ready");

  await coordinator.cancel("a");
  const returnMove = moves.at(-1)!;
  assert.deepEqual(
    [returnMove.x, returnMove.y],
    [standing.x, standing.y],
    "강등된 설 자리로 이동하지 않으면 회의석에 남는다",
  );
  assert.equal(returnMove.seatId, null, "좌석이 아니라 서 있기다");

  const participant = coordinator.snapshot("a")?.participants.find((p) => p.actorId === "n1");
  assert.equal(participant?.state, "returning");
  assert.equal(coordinator.snapshot("a")?.failure, null, "강등은 실패가 아니다");
  coordinator.arrived("a", "n1", coordinator.snapshot("a")!.generation);
  assert.equal(coordinator.snapshot("a")?.phase, "idle", "복귀가 끝나면 회의가 닫힌다");
  assert.ok(published.includes("returning"));
});

// ---------------------------------------------------------------------------
// 이미 좌석에 앉아 있는 사람은 움직이지 않아도 도착한 것이다.
//
// 사람의 도착 통지는 플레이어 **이동** 핸들러에서만 온다. 그래서 좌석을 새로 예약하는 순간
// 이미 그 자리에 앉아 있고 움직이지 않으면 통지가 영영 오지 않아, 집결이 `이동 중` 에서
// 멈췄다가 시간 초과로 깨졌다(스테이징 실측). 재접속(새 소켓)과 재시도가 모두 좌석을
// 다시 예약하므로 같은 길로 빠진다.
// ---------------------------------------------------------------------------

/** 좌석 위에 정지해 있는 소켓을 흉내낸다. 이 하네스에서는 `playerArrived` 를 부르지 않는다. */
function seatedHarness(seatedSockets: Set<string>) {
  const occupied = new Map<string, string>();
  const coordinator = createMeetingSpatialCoordinator({
    layout: async () => ({
      spaceId: "meeting",
      targets: [
        { seatId: "80:80", x: 80, y: 80 },
        { seatId: "112:80", x: 112, y: 80 },
      ],
    }),
    capture: async () => ({ x: 16, y: 16, seatId: null }),
    reserve: async (_channel, actorId, target) => {
      const key = `${target.x}:${target.y}`;
      const holder = occupied.get(key);
      if (holder && holder !== actorId) return false;
      occupied.set(key, actorId);
      return true;
    },
    move: async () => true,
    release: async (_channel, actorId) => {
      for (const [key, holder] of occupied) if (holder === actorId) occupied.delete(key);
    },
    returnTarget: async (_channel, _actorId, origin) => origin,
    atReservation: async (_channel, socketId) => seatedSockets.has(socketId),
    publish: () => {},
  });
  return coordinator;
}

function playerState(c: ReturnType<typeof seatedHarness>, userId: string) {
  return c.snapshot("a")?.participants.find((p) => p.actorId === userId)?.state;
}

test("이미 좌석에 앉아 있는 주재자는 움직이지 않아도 착석으로 잡히고 집결이 준비된다", async () => {
  const c = seatedHarness(new Set(["socket1"]));
  await c.joinPlayer("a", "u1", "socket1");
  assert.equal(playerState(c, "u1"), "seated", "예약 순간 이미 그 자리인데 이동 중으로 남는다");

  const generation = await c.start("a", "u1", ["n1"]);
  const ready = c.ready("a", generation!);
  assert.equal(c.arrived("a", "n1", generation!), true);
  assert.equal(await ready, true, "주재자가 착석인데 집결이 준비되지 않는다");
  assert.equal(c.snapshot("a")?.phase, "ready");
});

test("같은 사용자가 새 소켓으로 다시 들어와 좌석에 가만히 있어도 집결이 준비된다", async () => {
  // 처음 소켓은 걸어 들어와 착석했다.
  const seated = new Set<string>();
  const c = seatedHarness(seated);
  await c.joinPlayer("a", "u1", "socket1");
  seated.add("socket1");
  c.playerArrived("a", "u1", "socket1");
  assert.equal(playerState(c, "u1"), "seated");

  // 연결이 끊겼다가 새 소켓으로 돌아왔다 — 화면상 여전히 좌석에 앉아 있고 움직이지 않는다.
  seated.delete("socket1");
  seated.add("socket2");
  await c.joinPlayer("a", "u1", "socket2");
  assert.equal(playerState(c, "u1"), "seated", "재접속이 착석을 이동 중으로 되돌린다");

  const generation = await c.start("a", "u1", ["n1"]);
  const ready = c.ready("a", generation!);
  c.arrived("a", "n1", generation!);
  assert.equal(await ready, true);
});

test("좌석에 없는 사람은 여전히 걸어 와야 한다 — 즉시 도착 처리가 거짓 착석을 만들지 않는다", async () => {
  const c = seatedHarness(new Set());
  await c.joinPlayer("a", "u1", "socket1");
  assert.equal(playerState(c, "u1"), "walking");

  const generation = await c.start("a", "u1", ["n1"]);
  c.arrived("a", "n1", generation!);
  assert.equal(c.snapshot("a")?.phase, "assembling", "주재자가 오지 않았는데 준비됐다");
});

test("집결은 여는 사람의 소켓을 capture 에 넘긴다 — 그 사람이 부른 직원만 데려갈 수 있게", async () => {
  const seen: Array<string | undefined> = [];
  const c = createMeetingSpatialCoordinator({
    layout: async () => ({ spaceId: "meeting", targets: [{ seatId: "80:80", x: 80, y: 80 }] }),
    capture: async (_channel, _actorId, takeFrom) => {
      seen.push(takeFrom);
      return { x: 16, y: 16, seatId: null };
    },
    reserve: async () => true,
    move: async () => true,
    release: async () => {},
    returnTarget: async (_c, _a, origin) => origin,
    publish: () => {},
  });
  await c.joinPlayer("a", "host", "host-socket");
  await c.joinPlayer("a", "guest", "guest-socket");
  await c.start("a", "host", ["n1"]);
  assert.deepEqual(seen, ["host-socket"], "여는 사람이 아닌 소켓을 넘긴다");
});
