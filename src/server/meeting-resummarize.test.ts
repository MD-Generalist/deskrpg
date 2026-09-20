import assert from "node:assert/strict";
import test from "node:test";

import type { NpcAdapter } from "../lib/adapters/types";
import type { ParsedMeetingOutcome } from "../lib/meeting-outcome";
import { createResummarizer } from "./meeting-resummarize";

const ok: ParsedMeetingOutcome = {
  status: "ok",
  keyTopics: ["a"],
  conclusions: "b",
  outcome: { decisions: [], followUps: [], project: null },
};
const input = {
  minutesId: "m1",
  channelId: "c1",
  userId: "u1",
  topic: "주제",
  transcript: "전문",
  participants: [
    { npcId: "npc-gone", name: "떠난 직원" },
    { npcId: "npc-1", name: "소피" },
    { npcId: "npc-2", name: "노아" },
  ],
};
const adapter = { type: "fake" } as unknown as NpcAdapter;

test("채널에 남아 있고 어댑터가 풀리는 첫 참석 직원에게 요약을 맡긴다", async () => {
  const tried: string[] = [];
  let sessionKey = "";
  const resummarize = createResummarizer({
    getNpcConfigsForChannel: async () => [
      { id: "npc-1", name: "소피" },
      { id: "npc-2", name: "노아" },
    ],
    resolveAdapter: async (npc) => {
      tried.push(npc.id);
      return npc.id === "npc-1" ? { excluded: true } : { adapter, sessionKey: `key-${npc.id}` };
    },
    generateMeetingSummary: async (_adapter, key, _topic, _transcript, participants) => {
      sessionKey = key;
      assert.equal(participants?.length, 3);
      return ok;
    },
  });
  assert.deepEqual(await resummarize(input), ok);
  // 떠난 직원은 시도하지 않고, 풀리지 않은 소피 다음에 노아로 넘어간다.
  assert.deepEqual(tried, ["npc-1", "npc-2"]);
  assert.equal(sessionKey, "key-npc-2");
});

test("맡길 직원이 없으면 실패가 아니라 skipped 다", async () => {
  const resummarize = createResummarizer({
    getNpcConfigsForChannel: async () => [],
    resolveAdapter: async () => ({ excluded: true }),
    generateMeetingSummary: async () => assert.fail("부르면 안 된다"),
  });
  assert.deepEqual(await resummarize(input), {
    status: "skipped",
    keyTopics: [],
    conclusions: null,
    outcome: null,
  });
});
