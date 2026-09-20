import assert from "node:assert/strict";
import test from "node:test";

import { buildAttentionInbox } from "./attention-inbox";

const card = (id: string, status: string, title = id, at: string | null = null) => ({
  id,
  status,
  title,
  at,
});
const T = (n: number) => `2026-09-21T00:00:0${n}.000Z`;

const base = {
  cards: [] as { id: string; status: string; title: string }[],
  approvals: [] as {
    id: string;
    title: string;
    requestedBy: string;
    createdAt: string;
    taskIds: string[];
  }[],
  cronFailures: [] as { messageId: string; jobId: string; jobName: string; createdAt: string }[],
};

test("빈 보드는 빈 목록이다", () => {
  assert.deepEqual(buildAttentionInbox(base), []);
});

test("대기 중인 승인이 한 줄이 된다 — 카드 수를 함께 싣는다", () => {
  const rows = buildAttentionInbox({
    ...base,
    cards: [card("t1", "blocked"), card("t2", "blocked")],
    approvals: [
      {
        id: "a1",
        title: "2건 수행할까요?",
        requestedBy: "sophie",
        createdAt: T(1),
        taskIds: ["t1", "t2"],
      },
    ],
  });
  assert.equal(rows.length, 1, "승인 대기 카드는 각각이 아니라 승인 한 줄로 모인다");
  assert.deepEqual(rows[0], {
    kind: "approval",
    id: "a1",
    title: "2건 수행할까요?",
    at: T(1),
    requestedBy: "sophie",
    count: 2,
  });
});

test("승인에 묶이지 않은 blocked 카드는 '막힘' 으로 따로 선다", () => {
  const rows = buildAttentionInbox({
    ...base,
    cards: [card("t1", "blocked", "오류로 막힘")],
  });
  assert.deepEqual(rows, [
    { kind: "blocked", id: "t1", title: "오류로 막힘", at: null, requestedBy: null, count: 1 },
  ]);
});

test("승인 대기 카드가 '막힘' 으로 두 번 나오지 않는다", () => {
  const rows = buildAttentionInbox({
    ...base,
    cards: [card("t1", "blocked"), card("t2", "blocked")],
    approvals: [
      { id: "a1", title: "묶음", requestedBy: "sophie", createdAt: T(1), taskIds: ["t1"] },
    ],
  });
  assert.deepEqual(
    rows.map((r) => [r.kind, r.id]),
    [
      ["approval", "a1"],
      ["blocked", "t2"],
    ],
  );
});

test("검토 대기 카드가 한 줄씩 선다", () => {
  const rows = buildAttentionInbox({ ...base, cards: [card("t9", "review", "결과 검토")] });
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["review"],
  );
});

test("사람이 할 일이 없는 상태는 목록에 없다", () => {
  const rows = buildAttentionInbox({
    ...base,
    cards: ["triage", "todo", "scheduled", "ready", "running", "done", "archived"].map((s, i) =>
      card(`t${i}`, s),
    ),
  });
  assert.deepEqual(rows, [], "무엇이 이것을 전진시키는가에 답할 수 없는 줄은 넣지 않는다");
});

test("실패한 크론이 한 줄이 된다", () => {
  const rows = buildAttentionInbox({
    ...base,
    cronFailures: [{ messageId: "m1", jobId: "j1", jobName: "야간 집계", createdAt: T(2) }],
  });
  assert.deepEqual(rows, [
    { kind: "cron_failed", id: "j1", title: "야간 집계", at: T(2), requestedBy: null, count: 1 },
  ]);
});

test("오래된 것이 위로 온다 — 방치된 것을 드러낸다", () => {
  const rows = buildAttentionInbox({
    ...base,
    approvals: [
      { id: "new", title: "새것", requestedBy: "s", createdAt: T(9), taskIds: [] },
      { id: "old", title: "오래된 것", requestedBy: "s", createdAt: T(1), taskIds: [] },
    ],
    cronFailures: [{ messageId: "m", jobId: "j", jobName: "중간", createdAt: T(5) }],
  });
  assert.deepEqual(
    rows.map((r) => r.id),
    ["old", "j", "new"],
  );
});

test("시각이 없는 줄은 시각이 있는 줄 뒤에 온다 — 순서가 흔들리지 않게 id 로 가른다", () => {
  const rows = buildAttentionInbox({
    ...base,
    cards: [card("b2", "blocked"), card("b1", "blocked")],
    cronFailures: [{ messageId: "m", jobId: "j", jobName: "크론", createdAt: T(1) }],
  });
  assert.deepEqual(
    rows.map((r) => r.id),
    ["j", "b1", "b2"],
  );
});

test("카드에도 시각이 있으면 함께 줄 세운다 — 보드 응답의 created_at 을 쓴다", () => {
  // `KanbanTask.created_at` 은 epoch 초로 온다. 호출자가 `taskTimeMs` 로 읽어 ISO 로 넘긴다.
  const rows = buildAttentionInbox({
    ...base,
    cards: [card("late", "review", "늦은 검토", T(9)), card("early", "blocked", "이른 막힘", T(1))],
    cronFailures: [{ messageId: "m", jobId: "j", jobName: "중간", createdAt: T(5) }],
  });
  assert.deepEqual(
    rows.map((r) => r.id),
    ["early", "j", "late"],
    "시각이 있으면 종류와 무관하게 오래된 순이다",
  );
});

test("시각을 못 읽은 카드만 뒤로 간다", () => {
  const rows = buildAttentionInbox({
    ...base,
    cards: [card("unknown", "review", "시각 없음"), card("known", "review", "시각 있음", T(3))],
  });
  assert.deepEqual(
    rows.map((r) => r.id),
    ["known", "unknown"],
  );
});
