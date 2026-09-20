import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  getAutomationHooks,
  readWorkingSnapshot,
  registerAutomationHooks,
  requestPollNow,
  requestRefreshPollers,
  resetAutomationHooksForTests,
  requestEmitRoomMessage,
} from "./automation-registry";

afterEach(() => resetAutomationHooksForTests());

test("훅이 없으면 전부 조용한 no-op 다 — pollNow 는 null, 스냅샷은 빈 배열", async () => {
  assert.equal(getAutomationHooks(), undefined);
  assert.equal(await requestPollNow("ch-1"), null);
  await requestRefreshPollers();
  assert.deepEqual(readWorkingSnapshot("ch-1"), []);
});

test("등록한 훅으로 위임하고, 리셋하면 다시 no-op 로 돌아간다", async () => {
  const calls: string[] = [];
  registerAutomationHooks({
    pollNow: async (channelId) => {
      calls.push(`poll:${channelId}`);
      return { ok: true };
    },
    refreshPollers: async () => {
      calls.push("refresh");
    },
    getWorkingSnapshot: (channelId) => [
      { npcId: `npc-of-${channelId}`, working: true, sources: { runningCards: 1, cronRuns: 0 } },
    ],
    emitRoomMessage: (roomId) => {
      calls.push(`emit:${roomId}`);
    },
  });

  assert.deepEqual(await requestPollNow("ch-1"), { ok: true });
  await requestRefreshPollers();
  assert.equal(readWorkingSnapshot("ch-1")[0]?.npcId, "npc-of-ch-1");
  requestEmitRoomMessage("room-1", { id: "m1" });
  assert.deepEqual(calls, ["poll:ch-1", "refresh", "emit:room-1"]);

  resetAutomationHooksForTests();
  assert.equal(await requestPollNow("ch-1"), null);
  assert.deepEqual(readWorkingSnapshot("ch-1"), []);
  // 훅이 없어도 던지지 않는다 — 방송이 안 되는 것과 알림이 안 생기는 것은 무게가 다르다.
  requestEmitRoomMessage("room-1", { id: "m1" });
});

test("방송이 던져도 호출자는 계속 간다", () => {
  registerAutomationHooks({
    pollNow: async () => null,
    refreshPollers: async () => {},
    getWorkingSnapshot: () => [],
    emitRoomMessage: () => {
      throw new Error("socket down");
    },
  });
  // 던지면 승인 생성이 실패한다 — 그래서 삼킨다.
  requestEmitRoomMessage("room-1", { id: "m1" });
  resetAutomationHooksForTests();
});
