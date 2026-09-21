import test from "node:test";
import assert from "node:assert/strict";
import { EventBus, pendingChannelData, setPendingChannelData } from "../EventBus";
import { OfficeSimulation, isTypingTarget } from "./office-simulation";
import type { TickLoop } from "./tick-loop";

type Runtime = OfficeSimulation & Record<string, unknown>;

const legacyMap = {
  layers: {
    floor: Array.from({ length: 5 }, () => Array(6).fill(1)),
    walls: Array.from({ length: 5 }, (_, row) =>
      Array.from({ length: 6 }, () => (row === 0 ? 2 : 0)),
    ),
  },
  objects: [{ id: "desk", type: "desk", col: 4, row: 3 }],
};

function withFetch<T>(body: unknown, run: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify(body)))) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("부팅은 scene-ready → three:bridge-ready 순서로 알리고 채널 데이터를 소비한다", async () => {
  const order: string[] = [];
  const sceneReady = () => order.push("scene-ready");
  const bridgeReady = (bridge: unknown) => {
    order.push("three:bridge-ready");
    assert.equal(bridge, sim.officeBridge);
  };
  EventBus.on("scene-ready", sceneReady);
  EventBus.on("three:bridge-ready", bridgeReady);
  setPendingChannelData({ channelId: "ch", mapData: legacyMap });
  const sim = new OfficeSimulation() as Runtime;
  try {
    await withFetch({ npcs: [] }, async () => {
      sim["boot"](pendingChannelData!);
      await settle();
    });
    assert.deepEqual(order, ["scene-ready", "three:bridge-ready"]);
    assert.equal(pendingChannelData, null, "pending channel data is consumed once");
    assert.equal(sim["channelId"], "ch");
  } finally {
    EventBus.off("scene-ready", sceneReady);
    EventBus.off("three:bridge-ready", bridgeReady);
    sim.dispose();
  }
});

test("브리지는 타일 편집 진입점 없이 배치·시작 위치·소유자·Tiled 여부만 낸다", async () => {
  setPendingChannelData({ channelId: "ch", mapData: legacyMap });
  const sim = new OfficeSimulation() as Runtime;
  try {
    await withFetch({ npcs: [] }, async () => {
      sim["boot"](pendingChannelData!);
      await settle();
    });
    assert.deepEqual(sim.officeBridge.editor(), {
      placement: false,
      spawn: false,
      owner: false,
      tiled: false,
      seatLabels: [],
    });
    assert.equal("edit" in sim.officeBridge, false);
    assert.equal("save" in sim.officeBridge, false);
    EventBus.emit("placement-mode-start", { id: "npc" });
    EventBus.emit("owner-status", { isOwner: true });
    const { seatLabels, ...placing } = sim.officeBridge.editor();
    assert.deepEqual(placing, {
      placement: true,
      spawn: false,
      owner: true,
      tiled: false,
    });
    assert.ok(Array.isArray(seatLabels));
    EventBus.emit("placement-mode-end");
    const map = sim.officeBridge.map();
    assert.equal("artwork" in map, false, "the simulation never produces map artwork");
    // 회의 공간 정규화가 맵을 넓힌다 — 원본 격자는 왼쪽 위에 그대로 남는다.
    assert.ok(map.cols >= 6 && map.rows >= 5);
    assert.equal(map.tiled, false);
    assert.ok(map.meetingSpace, "normalization attaches the meeting space");
    assert.equal(map.walls[0][0], 2);
    assert.ok(map.blocked.includes("0,0"), "legacy wall tiles are blocked");
    assert.ok(map.blocked.includes("4,3"), "furniture occupies its tile");
    assert.ok(!map.blocked.includes("1,1"));
  } finally {
    sim.dispose();
  }
});

test("플레이어는 NPC 위치를 받은 뒤 빈 자리에 스폰하고 액터 스냅샷에 텍스처가 없다", async () => {
  const spawned: string[] = [];
  const onSpawn = () => spawned.push("player-spawned");
  EventBus.on("player-spawned", onSpawn);
  setPendingChannelData({
    channelId: "ch",
    mapData: legacyMap,
    mapConfig: { spawnCol: 1, spawnRow: 1 },
  });
  const sim = new OfficeSimulation() as Runtime;
  try {
    await withFetch(
      { npcs: [{ id: "n1", name: "Mina", positionX: 1, positionY: 1, direction: "down" }] },
      async () => {
        sim["boot"](pendingChannelData!);
        assert.equal(sim["playerReady"], false, "spawn waits for the NPC prefetch");
        await settle();
      },
    );
    assert.deepEqual(spawned, ["player-spawned"]);
    const actors = sim.officeBridge.actors();
    const player = actors.find((actor) => actor.kind === "player")!;
    const npc = actors.find((actor) => actor.kind === "npc")!;
    assert.ok(player);
    assert.notDeepEqual([player.x, player.y], [48, 48], "the configured tile is taken by the NPC");
    assert.deepEqual([npc.x, npc.y, npc.name], [48, 48, "Mina"]);
    for (const actor of actors) assert.equal("texture" in actor, false);
  } finally {
    EventBus.off("player-spawned", onSpawn);
    sim.dispose();
  }
});

test("채널 데이터 없이 시작하면 channel-data-ready 를 기다렸다가 부팅한다", async () => {
  setPendingChannelData(null);
  const sim = new OfficeSimulation() as Runtime;
  const booted: unknown[] = [];
  sim["boot"] = (data: unknown) => booted.push(data);
  try {
    // start() 의 대기 분기는 브라우저 API 를 쓰지 않는다.
    sim.start();
    assert.equal(booted.length, 0);
    setPendingChannelData({ channelId: "late", mapData: legacyMap });
    // boot 을 가짜로 바꿨으므로 start() 의 나머지(rAF·키보드)는 가짜 창에 붙는다.
    sim["loop"] = { start() {}, stop() {} } as unknown as TickLoop;
    const originalWindow = (globalThis as { window?: unknown }).window;
    const listeners: string[] = [];
    (globalThis as { window?: unknown }).window = {
      addEventListener(name: string) {
        listeners.push(`+${name}`);
      },
      removeEventListener(name: string) {
        listeners.push(`-${name}`);
      },
    };
    try {
      EventBus.emit("channel-data-ready");
      assert.equal(booted.length, 1);
      assert.equal((booted[0] as { channelId: string }).channelId, "late");
      sim.dispose();
      assert.deepEqual(listeners, ["+keydown", "+keyup", "+blur", "-keydown", "-keyup", "-blur"]);
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  } finally {
    setPendingChannelData(null);
    sim.dispose();
  }
});

test("입력 상자에 포커스가 있으면 게임 키를 가로채지 않는다", () => {
  assert.equal(isTypingTarget(null), false);
  assert.equal(
    isTypingTarget({ tagName: "DIV", isContentEditable: false } as unknown as EventTarget),
    false,
  );
  assert.equal(isTypingTarget({ tagName: "INPUT" } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: "TEXTAREA" } as unknown as EventTarget), true);
  assert.equal(
    isTypingTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget),
    true,
  );
});

test("dispose 는 이 시뮬레이션의 EventBus 리스너만 떼고 페이지 리스너는 남긴다", async () => {
  let pageCount = 0;
  const page = () => pageCount++;
  EventBus.on("dialog:open", page);
  setPendingChannelData({ channelId: "ch", mapData: legacyMap });
  const sim = new OfficeSimulation() as Runtime;
  await withFetch({ npcs: [] }, async () => {
    sim["boot"](pendingChannelData!);
    await settle();
  });
  EventBus.emit("dialog:open");
  assert.equal(sim["dialogOpen"], true);
  sim.dispose();
  sim["dialogOpen"] = false;
  EventBus.emit("dialog:open");
  assert.equal(sim["dialogOpen"], false, "disposed simulation ignores page events");
  assert.equal(pageCount, 2);
  EventBus.off("dialog:open", page);
});

// 카드 "npc:call 거절이 사용자에게 도달하지 않는다".
//
// 소유권은 걸음이 끊기지 않게 낙관적으로 먼저 잡는다. 예전에는 ack 조차 받지 않아
// 서버가 거절해도 **클라이언트만 자기가 주인이라고 믿었고**, 사용자에게는 아무 표시도
// 없었다. 거절되면 소유권을 되돌리고 이유를 보여 줘야 한다.
test("호출이 거절되면 낙관적 소유권을 되돌리고 이유를 보여 준다", async () => {
  const sim = new OfficeSimulation() as Runtime;
  const toasts: string[] = [];
  const onToast = (data: { messageKey?: string }) => toasts.push(data.messageKey ?? "");
  EventBus.on("toast:show", onToast);
  try {
    let ack: ((result: unknown) => void) | undefined;
    sim["socket"] = {
      connected: true,
      id: "me",
      emit: (_event: string, _payload: unknown, callback?: (result: unknown) => void) => {
        ack = callback;
      },
    } as never;
    sim["motionSnapshot"] = { current: {} } as never;

    assert.equal(sim["ensureLocalNpcOwnership"]({ id: "n1" } as never), true);
    assert.equal(sim["npcOwnership"].owner("n1"), "me", "걸음을 위해 먼저 잡는다");
    assert.ok(ack, "ack 콜백 없이 emit 하고 있다 — 거절이 도달할 길이 없다");

    ack({ ok: false, error: "meeting_reserved" });
    assert.equal(sim["npcOwnership"].owner("n1"), undefined, "거절됐는데 소유권이 남아 있다");
    assert.deepEqual(toasts, ["game.npcCall.meetingReserved"]);
  } finally {
    EventBus.off("toast:show", onToast);
    sim.dispose();
  }
});

test("호출이 받아들여지면 소유권과 화면은 그대로 둔다", async () => {
  const sim = new OfficeSimulation() as Runtime;
  const toasts: string[] = [];
  const onToast = (data: { messageKey?: string }) => toasts.push(data.messageKey ?? "");
  EventBus.on("toast:show", onToast);
  try {
    let ack: ((result: unknown) => void) | undefined;
    sim["socket"] = {
      connected: true,
      id: "me",
      emit: (_event: string, _payload: unknown, callback?: (result: unknown) => void) => {
        ack = callback;
      },
    } as never;
    sim["motionSnapshot"] = { current: {} } as never;
    sim["ensureLocalNpcOwnership"]({ id: "n1" } as never);
    ack!({ ok: true, revision: 7 });
    assert.equal(sim["npcOwnership"].owner("n1"), "me");
    assert.deepEqual(toasts, []);
  } finally {
    EventBus.off("toast:show", onToast);
    sim.dispose();
  }
});

// ---------------------------------------------------------------------------
// 일하는 직원 (설계 2026-09-21 npc-working-state, 결정 B-1·C-1)
// ---------------------------------------------------------------------------

test("카드가 돌기 시작하면 그 직원을 지정석으로 보낸다", () => {
  const sim = new OfficeSimulation() as Runtime;
  try {
    const sent: string[] = [];
    sim["npcs"] = [
      {
        id: "n1",
        pixelX: 500,
        pixelY: 500,
        homeCol: 2,
        homeRow: 3,
        moveState: "idle",
        calledForRoom: null,
      },
    ] as never;
    sim["mayDriveNpc"] = () => true;
    sim["sendNpcHome"] = (npc: { id: string }) => sent.push(npc.id);

    sim["seatNpcForWork"]("n1");
    assert.deepEqual(sent, ["n1"], "일을 시작했는데 자리로 가지 않았습니다");
  } finally {
    sim.dispose();
  }
});

test("임자가 아니면 움직이지 않는다 — 모두가 같은 직원을 걷게 하면 안 된다", () => {
  const sim = new OfficeSimulation() as Runtime;
  try {
    const sent: string[] = [];
    sim["npcs"] = [
      {
        id: "n1",
        pixelX: 500,
        pixelY: 500,
        homeCol: 2,
        homeRow: 3,
        moveState: "idle",
        calledForRoom: null,
      },
    ] as never;
    sim["mayDriveNpc"] = () => false;
    sim["sendNpcHome"] = (npc: { id: string }) => sent.push(npc.id);

    sim["seatNpcForWork"]("n1");
    assert.deepEqual(sent, [], "임자가 아닌데 걷게 했습니다");
  } finally {
    sim.dispose();
  }
});

test("부름을 받아 와 있는 직원은 자리로 돌려보내지 않는다 — 사용자가 부른 것이 우선이다", () => {
  const sim = new OfficeSimulation() as Runtime;
  try {
    const sent: string[] = [];
    sim["npcs"] = [
      {
        id: "n1",
        pixelX: 500,
        pixelY: 500,
        homeCol: 2,
        homeRow: 3,
        moveState: "idle",
        calledForRoom: "room-1",
      },
    ] as never;
    sim["mayDriveNpc"] = () => true;
    sim["sendNpcHome"] = (npc: { id: string }) => sent.push(npc.id);

    sim["seatNpcForWork"]("n1");
    assert.deepEqual(sent, [], "부른 직원을 자리로 되돌려 보냈습니다");
  } finally {
    sim.dispose();
  }
});

test("이미 지정석에 있으면 다시 보내지 않는다", () => {
  const sim = new OfficeSimulation() as Runtime;
  try {
    const sent: string[] = [];
    // TILE_SIZE 가 무엇이든 0,0 은 home 0,0 과 같은 칸이다.
    sim["npcs"] = [
      {
        id: "n1",
        pixelX: 0,
        pixelY: 0,
        homeCol: 0,
        homeRow: 0,
        moveState: "idle",
        calledForRoom: null,
      },
    ] as never;
    sim["mayDriveNpc"] = () => true;
    sim["sendNpcHome"] = (npc: { id: string }) => sent.push(npc.id);

    sim["seatNpcForWork"]("n1");
    assert.deepEqual(sent, [], "제자리에 있는데 다시 걷게 했습니다");
  } finally {
    sim.dispose();
  }
});

test("새로 일을 시작한 직원만 자리로 보낸다 — 이미 일하던 직원은 다시 보내지 않는다", async () => {
  setPendingChannelData({ channelId: "ch", mapData: legacyMap });
  const sim = new OfficeSimulation() as Runtime;
  try {
    await withFetch({ npcs: [] }, async () => {
      sim["boot"](pendingChannelData!);
      await settle();
    });
    const seated: string[] = [];
    sim["seatNpcForWork"] = (npcId: string) => seated.push(npcId);
    sim["workingNpcs"] = new Set(["n1"]);

    EventBus.emit("npc:working-state", { npcIds: ["n1", "n2"], counts: { n1: 1, n2: 2 } });
    assert.deepEqual(seated, ["n2"], "이미 일하던 직원을 다시 자리로 보냈습니다");
    assert.deepEqual(sim["workingCounts"], { n1: 1, n2: 2 });
  } finally {
    sim.dispose();
  }
});

test("업무 중인 직원을 부르면 막지 않고 그 사실을 알린다", () => {
  const sim = new OfficeSimulation() as Runtime;
  const toasts: { key: string; params?: Record<string, string> }[] = [];
  const onToast = (d: { messageKey?: string; params?: Record<string, string> }) =>
    toasts.push({ key: d.messageKey ?? "", params: d.params });
  EventBus.on("toast:show", onToast);
  try {
    sim["player"] = { x: 0, y: 0 } as never;
    sim["motionSnapshot"] = { current: {} } as never;
    sim["npcs"] = [
      {
        id: "n1",
        name: "소피",
        pixelX: 0,
        pixelY: 0,
        moveState: "idle",
        calledForRoom: null,
        distanceTo: () => 9999,
        moveTo: () => true,
      },
    ] as never;
    sim["workingCounts"] = { n1: 2 };
    sim["ensureLocalNpcOwnership"] = () => true;
    sim["npcTilePositions"] = new Set() as never;

    sim["handleNpcCallToPlayer"]({ npcId: "n1", npcName: "소피" } as never);

    const busy = toasts.find((t) => t.key === "game.calledWhileWorking");
    assert.ok(busy, `작업 중을 알리지 않았습니다: ${toasts.map((t) => t.key).join(",")}`);
    assert.equal(busy.params?.count, "2", "몇 건인지 말해야 합니다");
  } finally {
    EventBus.off("toast:show", onToast);
    sim.dispose();
  }
});

test("놀고 있는 직원을 부르면 작업 중 안내를 띄우지 않는다", () => {
  const sim = new OfficeSimulation() as Runtime;
  const toasts: string[] = [];
  const onToast = (d: { messageKey?: string }) => toasts.push(d.messageKey ?? "");
  EventBus.on("toast:show", onToast);
  try {
    sim["player"] = { x: 0, y: 0 } as never;
    sim["motionSnapshot"] = { current: {} } as never;
    sim["npcs"] = [
      {
        id: "n1",
        name: "소피",
        pixelX: 0,
        pixelY: 0,
        moveState: "idle",
        calledForRoom: null,
        distanceTo: () => 9999,
        moveTo: () => true,
      },
    ] as never;
    sim["workingCounts"] = {};
    sim["ensureLocalNpcOwnership"] = () => true;
    sim["npcTilePositions"] = new Set() as never;

    sim["handleNpcCallToPlayer"]({ npcId: "n1", npcName: "소피" } as never);
    assert.ok(
      !toasts.includes("game.calledWhileWorking"),
      "일하지 않는 직원에게 작업 중 안내가 떴습니다",
    );
  } finally {
    EventBus.off("toast:show", onToast);
    sim.dispose();
  }
});

test("일하는 직원은 앰비언트 일정이 차도 산책을 나가지 않는다", async () => {
  setPendingChannelData({ channelId: "ch", mapData: legacyMap });
  const sim = new OfficeSimulation() as Runtime;
  try {
    await withFetch(
      { npcs: [{ id: "n1", name: "Mina", positionX: 1, positionY: 1, direction: "down" }] },
      async () => {
        sim["boot"](pendingChannelData!);
        await settle();
      },
    );
    const npc = (sim["npcs"] as { id: string; moveState: string; ambientTimer: number }[])[0];
    assert.ok(npc, "사전 조건: NPC 가 하나 있다");
    const seated: string[] = [];
    sim["seatNpcForWork"] = (id: string) => seated.push(id);
    sim["mayDriveNpc"] = () => true;
    // 테스트에는 소켓이 없어 앰비언트 리더가 아니다 — 그대로 두면 일하든 말든 산책이 막혀
    // 이 테스트가 아무것도 구별하지 못한다.
    (sim["npcOwnership"] as { mayRoam: (npcId: string, leader: boolean) => boolean }).mayRoam =
      () => true;

    sim["workingNpcs"] = new Set(["n1"]);
    npc.ambientTimer = 99_999; // 일정이 넘치게 찼다
    sim["updateNpcs"]();

    assert.equal(npc.moveState, "idle", "일하는 중인데 자리에서 일어났습니다");
    assert.equal(npc.ambientTimer, 0, "앰비언트 타이머가 리셋되지 않았습니다");
    assert.deepEqual(seated, ["n1"], "일하는 직원을 자리로 다시 보내지 않았습니다");
  } finally {
    sim.dispose();
  }
});

test("산책 중에 일이 시작되면 멈추고 자리로 간다", async () => {
  setPendingChannelData({ channelId: "ch", mapData: legacyMap });
  const sim = new OfficeSimulation() as Runtime;
  try {
    await withFetch(
      { npcs: [{ id: "n1", name: "Mina", positionX: 1, positionY: 1, direction: "down" }] },
      async () => {
        sim["boot"](pendingChannelData!);
        await settle();
      },
    );
    const npc = (sim["npcs"] as { id: string; moveState: string; stopStroll: () => void }[])[0];
    let stopped = 0;
    npc.stopStroll = () => {
      stopped += 1;
      npc.moveState = "idle";
    };
    npc.moveState = "strolling";
    const seated: string[] = [];
    sim["seatNpcForWork"] = (id: string) => seated.push(id);
    sim["mayDriveNpc"] = () => true;
    // 테스트에는 소켓이 없어 앰비언트 리더가 아니다 — 그대로 두면 일하든 말든 산책이 막혀
    // 이 테스트가 아무것도 구별하지 못한다.
    (sim["npcOwnership"] as { mayRoam: (npcId: string, leader: boolean) => boolean }).mayRoam =
      () => true;

    sim["workingNpcs"] = new Set(["n1"]);
    sim["updateNpcs"]();

    assert.equal(stopped, 1, "걷던 직원이 일을 시작했는데 멈추지 않았습니다");
    assert.deepEqual(seated, ["n1"], "멈춘 자리에 배지만 단 채 서 있습니다");
  } finally {
    sim.dispose();
  }
});

test("일하지 않는 직원의 산책은 그대로 둔다", async () => {
  setPendingChannelData({ channelId: "ch", mapData: legacyMap });
  const sim = new OfficeSimulation() as Runtime;
  try {
    await withFetch(
      { npcs: [{ id: "n1", name: "Mina", positionX: 1, positionY: 1, direction: "down" }] },
      async () => {
        sim["boot"](pendingChannelData!);
        await settle();
      },
    );
    const seated: string[] = [];
    sim["seatNpcForWork"] = (id: string) => seated.push(id);
    (sim["npcOwnership"] as { mayRoam: (npcId: string, leader: boolean) => boolean }).mayRoam =
      () => true;
    sim["workingNpcs"] = new Set();
    sim["updateNpcs"]();
    assert.deepEqual(seated, [], "일하지 않는 직원을 자리로 보냈습니다");
  } finally {
    sim.dispose();
  }
});

// ---------------------------------------------------------------------------
// 걸음 속도 — 채널 설정이 호출·회의 호출·일반 이동·산책에 각각 닿는다

test("호출은 채널의 호출 속도로 뛰어온다", () => {
  const sim = new OfficeSimulation() as Runtime;
  try {
    const calls: { speed?: number }[] = [];
    sim["player"] = { x: 0, y: 0 } as never;
    sim["motionSnapshot"] = { current: {} } as never;
    sim["npcs"] = [
      {
        id: "n1",
        name: "소피",
        pixelX: 0,
        pixelY: 0,
        moveState: "idle",
        calledForRoom: null,
        distanceTo: () => 9999,
        moveTo: (_c: number, _r: number, _f: unknown, _v: unknown, o: { speed?: number }) => {
          calls.push(o);
          return true;
        },
      },
    ] as never;
    sim["workingCounts"] = {};
    sim["ensureLocalNpcOwnership"] = () => true;
    sim["npcTilePositions"] = new Set() as never;
    sim.setMotionConfig({ summon: 360 });

    sim["handleNpcCallToPlayer"]({ npcId: "n1", npcName: "소피" } as never);
    assert.equal(calls.at(-1)?.speed, 360, "호출이 채널 호출 속도를 쓰지 않았습니다");
  } finally {
    sim.dispose();
  }
});

test("회의 호출은 산책 속도가 아니라 채널의 회의 호출 속도로 모인다", () => {
  // 전에는 회의 집결이 산책 경로를 그대로 써서 55px/s 로 모였다.
  const sim = new OfficeSimulation() as Runtime;
  try {
    const strolls: (number | undefined)[] = [];
    sim["socket"] = { id: "me", emit() {} } as never;
    sim["npcPathfinder"] = () => () => [{ x: 3, y: 3 }];
    sim.setMotionConfig({ meetingSummon: 330, stroll: 40 });
    const npc = {
      id: "n1",
      pixelX: 32,
      pixelY: 32,
      cancelMovement() {},
      startStroll: (_path: unknown, speed?: number) => strolls.push(speed),
    };
    sim["applySpatialNpc"](
      npc as never,
      {
        npcId: "n1",
        ownerSocketId: "me",
        moving: true,
        spatialTarget: { x: 96, y: 96, generation: 1 },
      } as never,
    );
    assert.deepEqual(strolls, [330]);
  } finally {
    sim.dispose();
  }
});

test("채널 설정은 모든 NPC 의 일반 이동·산책 속도에 입혀진다 — 나중에 온 NPC 에도", () => {
  const sim = new OfficeSimulation() as Runtime;
  try {
    const first = { moveSpeed: 0, strollSpeed: 0 };
    sim["npcs"] = [first] as never;
    sim.setMotionConfig({ walk: 200, stroll: 70 });
    assert.deepEqual(first, { moveSpeed: 200, strollSpeed: 70 });
    // 비었거나 틀린 설정은 기본값이다 — 걸음이 멈추지 않는다.
    sim.setMotionConfig(null);
    assert.deepEqual(first, { moveSpeed: 150, strollSpeed: 55 });
  } finally {
    sim.dispose();
  }
});

test("빠르게 걸을수록 위치를 자주 보낸다 — 한 번에 30px 를 넘지 않게", () => {
  // 서버는 연속한 두 위치 보고 사이의 직선이 막히지 않았는지 검사한다. 200ms 고정이면 300px/s 에서
  // 한 번에 60px(2칸)라 모퉁이를 가로질러 거절되고, 회의 집결이 "이동 중" 에서 영영 멈췄다(실측).
  const sim = new OfficeSimulation() as Runtime;
  try {
    const interval = (speeds: { speed: number; state: string }[]) => {
      sim["npcs"] = speeds.map(({ speed, state }) => ({
        moveState: state,
        currentSpeed: () => speed,
      })) as never;
      return sim["npcPositionSyncInterval"]();
    };
    assert.equal(interval([]), 200, "움직이는 직원이 없으면 예전 간격");
    assert.equal(interval([{ speed: 150, state: "strolling" }]), 200, "옛 걸음은 예전 그대로");
    assert.equal(interval([{ speed: 300, state: "strolling" }]), 100);
    assert.equal(interval([{ speed: 480, state: "moving-to-player" }]), 62.5);
    assert.equal(
      interval([
        { speed: 55, state: "strolling" },
        { speed: 300, state: "strolling" },
      ]),
      100,
      "가장 빠른 직원에 맞춘다",
    );
    assert.equal(
      interval([{ speed: 900, state: "strolling" }]),
      50,
      "초당 20번보다 자주 보내지 않는다",
    );
    assert.equal(interval([{ speed: 300, state: "waiting" }]), 200, "멈춘 직원은 치지 않는다");
  } finally {
    sim.dispose();
  }
});
