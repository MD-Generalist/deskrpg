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
