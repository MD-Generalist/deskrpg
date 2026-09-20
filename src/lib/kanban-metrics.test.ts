import assert from "node:assert/strict";
import test from "node:test";

import type { KanbanTimelineRun } from "@/lib/hermes/deskrpg-plugin-types";
import { countNeedsAttention } from "@/lib/needs-attention";
import { computeOperationalMetrics, hasEnoughSamples, MIN_RATE_SAMPLES } from "./kanban-metrics";

const WIN = { fromMs: 1_000_000, toMs: 2_000_000 };
const NO_APPROVALS: ReadonlySet<string> = new Set();

let seq = 0;
function run(over: Partial<KanbanTimelineRun> = {}): KanbanTimelineRun {
  seq += 1;
  return {
    id: `r${seq}`,
    status: "done",
    task_id: `t${seq}`,
    board: "default",
    started_at: 1_100,
    ended_at: 1_200,
    outcome: "completed",
    ...over,
  } as KanbanTimelineRun;
}

function metrics(
  runs: KanbanTimelineRun[],
  cards: { id: string; status: string }[] = [],
  pending: ReadonlySet<string> = NO_APPROVALS,
) {
  return computeOperationalMetrics(runs, cards, pending, WIN);
}

// ---------------------------------------------------------------------------
// 성공률 — outcome 어휘로 센다
// ---------------------------------------------------------------------------

test("성공은 completed 하나뿐이고 나머지는 합치지 않는다", () => {
  const m = metrics([
    run({ outcome: "completed" }),
    run({ outcome: "crashed" }),
    run({ outcome: "gave_up" }),
    run({ outcome: "timed_out" }),
  ]);
  assert.equal(m.terminalRuns, 4);
  assert.equal(m.successRate, 0.25);
  assert.deepEqual(
    m.outcomes.map((o) => o.outcome).sort(),
    ["completed", "crashed", "gave_up", "timed_out"],
    "실패를 한 덩어리로 뭉개면 무엇을 고쳐야 하는지가 사라진다",
  );
});

test("끝난 실행이 없으면 성공률은 null — 0% 로 쓰면 거짓이다", () => {
  const m = metrics([run({ ended_at: undefined, outcome: undefined })]);
  assert.equal(m.successRate, null);
  assert.equal(m.terminalRuns, 0);
  assert.equal(m.openRuns, 1);
});

test("결과가 없는 채 끝난 실행은 미기록으로 센다 — 지어내지 않는다", () => {
  const m = metrics([run({ outcome: undefined })]);
  assert.deepEqual(m.outcomes, [{ outcome: "unrecorded", count: 1 }]);
  assert.equal(m.successRate, 0);
});

test("결과 분포는 많은 것부터, 같으면 이름순", () => {
  const m = metrics([
    run({ outcome: "crashed" }),
    run({ outcome: "crashed" }),
    run({ outcome: "completed" }),
    run({ outcome: "blocked" }),
  ]);
  assert.deepEqual(
    m.outcomes.map((o) => `${o.outcome}:${o.count}`),
    ["crashed:2", "blocked:1", "completed:1"],
  );
});

// ---------------------------------------------------------------------------
// 창
// ---------------------------------------------------------------------------

test("창 밖에서 끝난 실행은 이 창의 성과가 아니다", () => {
  // 겹치기만 하는 것을 세면 같은 실행이 두 창에 중복으로 잡힌다.
  const m = metrics([
    run({ started_at: 900, ended_at: 999 }), // 창 전 종료
    run({ started_at: 900, ended_at: 1_500 }), // 창 안 종료 — 센다
    run({ started_at: 1_900, ended_at: 2_500 }), // 창 후 종료
  ]);
  assert.equal(m.terminalRuns, 1);
});

test("아직 안 끝난 실행은 성공률 분모에서 빠지고 따로 센다", () => {
  const m = metrics([
    run({ outcome: "completed" }),
    run({ ended_at: undefined, outcome: undefined }),
  ]);
  assert.equal(m.terminalRuns, 1);
  assert.equal(m.openRuns, 1);
  assert.equal(m.successRate, 1);
});

// ---------------------------------------------------------------------------
// 처리량
// ---------------------------------------------------------------------------

test("처리량은 카드 수다 — 같은 카드가 여러 번 성공해도 한 번 센다", () => {
  const m = metrics([
    run({ task_id: "same", outcome: "completed" }),
    run({ task_id: "same", outcome: "completed" }),
    run({ task_id: "other", outcome: "completed" }),
  ]);
  assert.equal(m.throughput, 2);
});

test("실패한 실행은 처리량에 들지 않는다", () => {
  const m = metrics([run({ task_id: "a", outcome: "crashed" })]);
  assert.equal(m.throughput, 0);
});

// ---------------------------------------------------------------------------
// 소요
// ---------------------------------------------------------------------------

test("소요는 중앙값이고 표본 수를 함께 낸다", () => {
  const m = metrics([
    run({ started_at: 1_100, ended_at: 1_110 }),
    run({ started_at: 1_200, ended_at: 1_230 }),
    run({ started_at: 1_300, ended_at: 1_320 }),
  ]);
  assert.equal(m.duration.samples, 3);
  assert.equal(m.duration.medianMs, 20_000, "10·20·30초의 중앙값은 20초다");
});

test("표본이 짝수면 가운데 둘의 평균이다", () => {
  const m = metrics([
    run({ started_at: 1_100, ended_at: 1_110 }),
    run({ started_at: 1_200, ended_at: 1_230 }),
  ]);
  assert.equal(m.duration.medianMs, 20_000);
});

test("중앙값은 극단값에 끌려가지 않는다 — 평균이면 달라진다", () => {
  const m = metrics([
    run({ started_at: 1_100, ended_at: 1_110 }),
    run({ started_at: 1_200, ended_at: 1_210 }),
    run({ started_at: 1_300, ended_at: 1_900 }),
  ]);
  assert.equal(m.duration.medianMs, 10_000);
});

test("표본이 없으면 중앙값은 null 이고 표본 수는 0 이다", () => {
  const m = metrics([run({ outcome: "crashed" })]);
  assert.deepEqual(m.duration, { medianMs: null, samples: 0 });
});

test("실패한 실행의 소요는 섞지 않는다 — 소요의 의미가 다르다", () => {
  const m = metrics([
    run({ outcome: "completed", started_at: 1_100, ended_at: 1_110 }),
    run({ outcome: "timed_out", started_at: 1_200, ended_at: 1_900 }),
  ]);
  assert.equal(m.duration.samples, 1);
  assert.equal(m.duration.medianMs, 10_000);
});

test("시각을 못 읽는 실행은 소요 표본에서 빠지지만 결과 분포에는 남는다", () => {
  const m = metrics([run({ outcome: "completed", started_at: undefined, ended_at: 1_200 })]);
  assert.equal(m.duration.samples, 0);
  assert.equal(m.terminalRuns, 1);
});

// ---------------------------------------------------------------------------
// 손이 필요한 카드 — 판단 모음과 같은 수
// ---------------------------------------------------------------------------

test("손이 필요한 카드를 스스로 세지 않고 공유 함수를 쓴다", () => {
  const cards = [
    { id: "a", status: "review" },
    { id: "b", status: "blocked" },
    { id: "c", status: "blocked" },
    { id: "d", status: "running" },
  ];
  const pending = new Set(["b"]);
  const m = metrics([], cards, pending);
  // 두 곳이 각자 세면 다른 수가 나오고, 그때 어느 쪽이 맞는지 아무도 모른다.
  assert.deepEqual(m.attention, countNeedsAttention(cards, pending));
  assert.equal(m.attention.awaiting_approval, 1);
  assert.equal(m.attention.blocked, 1);
  assert.equal(m.attention.review, 1);
  assert.equal(m.attention.total, 3);
});

test("승인 대기 집합이 비면 blocked 는 오류 차단으로 읽는다", () => {
  // 승인이 풀렸는데 아직 blocked 로 보이는 순간에 "승인해 달라" 를 다시 보이면
  // 사용자가 같은 결정을 두 번 한다.
  const m = metrics([], [{ id: "b", status: "blocked" }], new Set());
  assert.equal(m.attention.awaiting_approval, 0);
  assert.equal(m.attention.blocked, 1);
});

// ---------------------------------------------------------------------------
// 표본 문턱
// ---------------------------------------------------------------------------

test("표본이 적으면 비율을 수치로 보이지 않는다", () => {
  assert.equal(hasEnoughSamples(MIN_RATE_SAMPLES - 1), false);
  assert.equal(hasEnoughSamples(MIN_RATE_SAMPLES), true);
  assert.equal(hasEnoughSamples(0), false);
});
