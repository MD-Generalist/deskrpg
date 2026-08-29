import { test } from "node:test";
import assert from "node:assert/strict";

import { NpcRuntime } from "./npc-runtime";
import { Transcript } from "./transcript";
import type { EngineParticipant } from "./types";
import type { NpcAdapter, AdapterExecuteOptions } from "@/lib/adapters/types";

// 회의·채널 멘션 경로가 시스템 지시를 싣는지 고정한다.
//
// 이 경로를 한 번 빠뜨린 적이 있다(2026-08-30). 1:1 경로만 배선하고 여기를 놓쳤는데,
// 회의야말로 <team-instructions> 가 가장 필요한 자리다. 폴과 발언 **둘 다** 봐야 한다 —
// 한쪽만 실으면 같은 NPC 가 손들 때와 말할 때 다른 규칙을 받는다.

function capturing(): { adapter: NpcAdapter; calls: AdapterExecuteOptions[] } {
  const calls: AdapterExecuteOptions[] = [];
  return {
    calls,
    adapter: {
      type: "mock",
      async execute(o: AdapterExecuteOptions) {
        calls.push(o);
        return { response: "SPEAK: 네", session: { sessionRef: o.sessionKey } };
      },
      async testConnection() {
        return { status: "ok" as const };
      },
    } as NpcAdapter,
  };
}

function participant(
  npcId: string,
  adapter: NpcAdapter,
  over: Partial<EngineParticipant> = {},
): EngineParticipant {
  return {
    npcId,
    displayName: npcId,
    seated: true,
    turnCount: 0,
    lastSpokeAt: 0,
    sessionKey: `sk-${npcId}`,
    adapter,
    role: "팀장",
    passPolicy: null,
    ...over,
  } as EngineParticipant;
}

function runtimeFor(p: EngineParticipant, transcript = new Transcript()) {
  return new NpcRuntime(p, {
    transcript,
    topic: "점심 메뉴",
    allParticipants: [p],
    maxTotalTurns: 10,
    historyLimit: 5,
    turnTimeout: { idleMs: 1000, maxMs: 2000 },
    now: () => 0,
  });
}

const INSTR = "<team-instructions>\n한 번에 한 명씩\n</team-instructions>";

test("발언 턴이 instructions 를 싣는다", async () => {
  const cap = capturing();
  const p = participant("a", cap.adapter, { instructions: INSTR });
  await runtimeFor(p).takeTurn(4, { onChunk: () => {} });
  const speak = cap.calls.find((c) => !c.sessionKey.endsWith("-poll"));
  assert.equal(speak?.instructions, INSTR);
});

test("폴(손들기)도 같은 instructions 를 싣는다", async () => {
  const cap = capturing();
  const p = participant("a", cap.adapter, { instructions: INSTR });
  await runtimeFor(p).poll(3);
  const poll = cap.calls.find((c) => c.sessionKey.endsWith("-poll"));
  assert.equal(poll?.instructions, INSTR);
});

test("지시가 없으면 필드를 만들지 않는다", async () => {
  const cap = capturing();
  const p = participant("a", cap.adapter);
  await runtimeFor(p).takeTurn(4, { onChunk: () => {} });
  await runtimeFor(p).poll(3);
  for (const c of cap.calls) assert.equal(c.instructions, undefined);
});
