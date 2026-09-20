import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedMeetingOutcome } from "./meeting-outcome";
import { resummarizeMinutes, type ResummarizeMinutesDeps } from "./meeting-summarize";

const row = {
  id: "m1",
  channelId: "c1",
  topic: "주제",
  transcript: "전문",
  initiatorId: "host",
  participants: [
    { id: "npc-1", name: "소피", type: "npc" },
    { id: "socket-9", name: "Dante", type: "player" },
  ],
  summaryStatus: "failed",
  outcome: null,
};
const ok: ParsedMeetingOutcome = {
  status: "ok",
  keyTopics: ["a"],
  conclusions: "b",
  outcome: { decisions: ["d"], followUps: [], project: null },
};

function deps(over: Partial<ResummarizeMinutesDeps> = {}): ResummarizeMinutesDeps & {
  saved: unknown[];
} {
  const saved: unknown[] = [];
  return {
    saved,
    loadMinutes: async () => row,
    loadChannelOwner: async () => "owner",
    resummarize: async () => ok,
    saveSummary: async (_id, summary) => {
      saved.push(summary);
    },
    ...over,
  };
}

test("주재자가 실패한 요약을 다시 시키면 결과를 저장하고 돌려준다", async () => {
  const d = deps({
    resummarize: async (input) => {
      // 담당 후보는 참석 **직원**만이다.
      assert.deepEqual(input.participants, [{ npcId: "npc-1", name: "소피" }]);
      return ok;
    },
  });
  const result = await resummarizeMinutes({ minutesId: "m1", userId: "host" }, d);
  assert.deepEqual(result, { ok: true, summary: ok });
  assert.deepEqual(d.saved, [ok]);
});

test("주재자도 소유자도 아니면 403 이고 아무것도 부르지 않는다", async () => {
  const d = deps({ resummarize: async () => assert.fail("부르면 안 된다") });
  const result = await resummarizeMinutes({ minutesId: "m1", userId: "member" }, d);
  assert.deepEqual(result, { ok: false, status: 403, errorCode: "forbidden" });
});

test("없는 회의록은 404", async () => {
  const result = await resummarizeMinutes(
    { minutesId: "x", userId: "host" },
    deps({ loadMinutes: async () => null }),
  );
  assert.deepEqual(result, { ok: false, status: 404, errorCode: "not_found" });
});

test("이미 등록된 회의는 요약을 덮어쓰지 않는다 — 카드와 초안이 어긋난다", async () => {
  const registered = {
    ...row,
    summaryStatus: "ok",
    outcome: {
      decisions: [],
      followUps: [],
      project: null,
      registered: { boardSlug: "b", tenant: null, taskIds: ["t1"], by: "host", at: "2026-09-21" },
    },
  };
  const result = await resummarizeMinutes(
    { minutesId: "m1", userId: "host" },
    deps({ loadMinutes: async () => registered }),
  );
  assert.deepEqual(result, { ok: false, status: 409, errorCode: "already_registered" });
});

test("소켓 서버 훅이 없으면 503 — 빈 요약으로 덮어쓰지 않는다", async () => {
  const d = deps({ resummarize: undefined });
  const result = await resummarizeMinutes({ minutesId: "m1", userId: "owner" }, d);
  assert.deepEqual(result, { ok: false, status: 503, errorCode: "summarizer_unavailable" });
  assert.deepEqual(d.saved, []);
});

test("다시 시도도 실패하면 저장은 하되(상태가 남는다) 실패를 그대로 돌려준다", async () => {
  const failed: ParsedMeetingOutcome = {
    status: "failed",
    keyTopics: [],
    conclusions: null,
    outcome: null,
  };
  const d = deps({ resummarize: async () => failed });
  const result = await resummarizeMinutes({ minutesId: "m1", userId: "owner" }, d);
  assert.deepEqual(result, { ok: true, summary: failed });
  assert.deepEqual(d.saved, [failed]);
});
