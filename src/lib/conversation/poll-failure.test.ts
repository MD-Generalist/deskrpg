import test from "node:test";
import assert from "node:assert/strict";

import { MeetingFloorController } from "./floor-controller";
import type { NpcRuntime } from "./npc-runtime";
import type { Participant } from "./turn-policy";

// 폴에 **닿지 못한** 참가자를 침묵과 구분한다.
//
// 실패한 참가자는 raises 에도 passes 에도 들어가지 않고 사라졌다. 그래서 결정은
// `all-passed` 가 되고 화면에는 "전원 PASS" 로 보였다 — 아무도 패스하지 않았는데도.
// 과거 '전원 PASS' 사고가 정확히 이 모양이었다. Hermes 는 동시 실행 상한을 넘기면
// 429 로 또박또박 거절하는데(api_server.py:7154), 그 거절이 여기서 증발했다.

function participant(npcId: string): Participant {
  return { npcId, displayName: npcId, seated: true, turnCount: 0, lastSpokeAt: 0 } as Participant;
}

function controllerWith(
  poll: (npcId: string) => Promise<{ wantsToSpeak: boolean; reason: string }>,
) {
  const fc = new MeetingFloorController({
    inbox: { take: () => null } as never,
    mode: "meeting",
    maxConcurrentPolls: 4,
    onPollStart: () => {},
  });
  const runtimeFor = (npcId: string) =>
    ({ poll: () => poll(npcId), isBurnedOut: () => false }) as unknown as NpcRuntime;
  return (candidates: Participant[]) =>
    fc.next({
      participants: candidates,
      runtimeFor,
      remainingTurns: () => 5,
      lastSpeakerId: null,
      pollingAllowed: true,
      onSkippedGrant: () => {},
    });
}

test("닿지 못한 참가자는 PASS 가 아니라 failures 로 기록된다", async () => {
  const next = controllerWith(async (npcId) => {
    if (npcId === "b") throw new Error("Too many concurrent runs (max 2)");
    return { wantsToSpeak: false, reason: "" };
  });
  const decision = await next([participant("a"), participant("b")]);

  assert.equal(decision.kind, "all-passed");
  const report = "pollResult" in decision ? decision.pollResult : null;
  assert.ok(report);
  assert.deepEqual(report.passes, ["a"], "a 만 진짜 PASS 다");
  assert.deepEqual(
    report.failures?.map((f) => f.npcId),
    ["b"],
    "b 는 닿지 못한 것이지 패스한 게 아니다",
  );
});

test("전원이 닿지 못하면 passes 는 비고 failures 만 찬다", async () => {
  const next = controllerWith(async () => {
    throw new Error("Too many concurrent runs (max 2)");
  });
  const decision = await next([participant("a"), participant("b")]);

  const report = "pollResult" in decision ? decision.pollResult : null;
  assert.ok(report);
  assert.deepEqual(report.passes, [], "아무도 패스하지 않았다");
  assert.equal(report.failures?.length, 2);
});

test("아무도 실패하지 않으면 failures 는 빈 배열이다", async () => {
  const next = controllerWith(async () => ({ wantsToSpeak: false, reason: "" }));
  const decision = await next([participant("a")]);
  const report = "pollResult" in decision ? decision.pollResult : null;
  assert.deepEqual(report?.failures, []);
});
