import assert from "node:assert/strict";
import test from "node:test";

import type { KanbanTimelineRun } from "@/lib/hermes/deskrpg-plugin-types";
import {
  axisTicks,
  barDurationMs,
  layoutTimeline,
  presetWindow,
  toneOf,
  type TimelineWindow,
} from "./timeline-layout";

const S = 1000;
const WIN: TimelineWindow = { fromMs: 1_000 * S, toMs: 2_000 * S };
const NOW = 1_900 * S;

let seq = 0;
function run(over: Partial<KanbanTimelineRun> = {}): KanbanTimelineRun {
  seq += 1;
  return {
    id: String(seq),
    status: "done",
    task_id: "t1",
    board: "default",
    started_at: 1_100,
    ended_at: 1_200,
    ...over,
  } as KanbanTimelineRun;
}

// ---------------------------------------------------------------------------
// 결과 색
// ---------------------------------------------------------------------------

test("실패를 한 덩어리로 뭉개지 않는다", () => {
  assert.equal(toneOf({ outcome: "completed", ended_at: 1 }), "done");
  assert.equal(toneOf({ outcome: "crashed", ended_at: 1 }), "failed");
  assert.equal(toneOf({ outcome: "timed_out", ended_at: 1 }), "failed");
  assert.equal(toneOf({ outcome: "spawn_failed", ended_at: 1 }), "failed");
  // 포기는 사람이 원인을 봐야 하는 부류라 실패와 따로 둔다.
  assert.equal(toneOf({ outcome: "gave_up", ended_at: 1 }), "gaveUp");
  assert.equal(toneOf({ outcome: "reclaimed", ended_at: 1 }), "interrupted");
  assert.equal(toneOf({ outcome: "blocked", ended_at: 1 }), "interrupted");
});

test("결과가 없고 끝나지도 않았으면 실행 중이다", () => {
  assert.equal(toneOf({ ended_at: undefined }), "running");
  // 끝났는데 결과가 없는 것은 판단하지 않는다 — 없는 뜻을 지어내지 않는다.
  assert.equal(toneOf({ ended_at: 1 }), "other");
});

// ---------------------------------------------------------------------------
// 창과 겹침
// ---------------------------------------------------------------------------

test("창에 걸치기만 해도 그린다 — 시작만 보고 자르면 긴 작업이 사라진다", () => {
  const layout = layoutTimeline(
    [
      run({ started_at: 900, ended_at: 1_500, profile: "a" }), // 창 전 시작
      run({ started_at: 1_900, ended_at: 2_500, profile: "a" }), // 창 후 종료
      run({ started_at: 800, ended_at: 2_900, profile: "a" }), // 창을 통째로 덮음
    ],
    WIN,
    NOW,
  );
  assert.equal(layout.rows[0].bars.length, 3);
  assert.equal(layout.omitted, 0);
});

test("창 밖으로 뻗은 막대는 창 경계에 붙는다", () => {
  const layout = layoutTimeline(
    [run({ started_at: 500, ended_at: 2_500, profile: "a" })],
    WIN,
    NOW,
  );
  const bar = layout.rows[0].bars[0];
  assert.equal(bar.startMs, WIN.fromMs);
  assert.equal(bar.endMs, WIN.toMs);
  assert.equal(bar.x, 0);
  assert.equal(bar.width, 1);
});

test("창에 겹치지 않는 실행은 버리고 몇 건인지 말한다", () => {
  const layout = layoutTimeline(
    [
      run({ started_at: 10, ended_at: 20, profile: "a" }),
      run({ started_at: 5_000, ended_at: 5_100, profile: "a" }),
      run({ started_at: 1_100, ended_at: 1_200, profile: "a" }),
    ],
    WIN,
    NOW,
  );
  assert.equal(layout.rows.length, 1);
  assert.equal(layout.rows[0].bars.length, 1);
  assert.equal(layout.omitted, 2, "조용히 버리면 화면이 사실을 숨긴다");
});

test("시각을 못 읽는 실행도 버린 건수로 드러난다", () => {
  const layout = layoutTimeline([run({ started_at: undefined, profile: "a" })], WIN, NOW);
  assert.deepEqual(layout.rows, []);
  assert.equal(layout.omitted, 1);
});

// ---------------------------------------------------------------------------
// 진행 중
// ---------------------------------------------------------------------------

test("끝나지 않은 실행은 지금까지만 그리고 open 으로 표시한다", () => {
  const layout = layoutTimeline(
    [run({ started_at: 1_500, ended_at: undefined, profile: "a" })],
    WIN,
    NOW,
  );
  const bar = layout.rows[0].bars[0];
  assert.equal(bar.open, true, "여기까지 확실하다는 표시가 필요하다");
  assert.equal(bar.endMs, NOW);
});

test("진행 중 실행이 창 끝을 넘지 않는다", () => {
  const future = 9_000 * S;
  const layout = layoutTimeline(
    [run({ started_at: 1_500, ended_at: undefined, profile: "a" })],
    WIN,
    future,
  );
  assert.equal(layout.rows[0].bars[0].endMs, WIN.toMs);
});

// ---------------------------------------------------------------------------
// 레인
// ---------------------------------------------------------------------------

test("동시에 돈 실행은 아래 줄로 쌓인다 — 겹쳐 그리면 하나만 보인다", () => {
  const layout = layoutTimeline(
    [
      run({ started_at: 1_100, ended_at: 1_500, profile: "a" }),
      run({ started_at: 1_200, ended_at: 1_600, profile: "a" }),
      run({ started_at: 1_300, ended_at: 1_400, profile: "a" }),
    ],
    WIN,
    NOW,
  );
  assert.equal(layout.rows[0].lanes, 3);
  assert.deepEqual(
    layout.rows[0].bars.map((b) => b.lane),
    [0, 1, 2],
  );
});

test("겹치지 않으면 한 줄을 다시 쓴다", () => {
  const layout = layoutTimeline(
    [
      run({ started_at: 1_100, ended_at: 1_200, profile: "a" }),
      run({ started_at: 1_300, ended_at: 1_400, profile: "a" }),
    ],
    WIN,
    NOW,
  );
  assert.equal(layout.rows[0].lanes, 1);
  assert.deepEqual(
    layout.rows[0].bars.map((b) => b.lane),
    [0, 0],
  );
});

test("줄 수는 최대 동시 실행 수와 같다", () => {
  const layout = layoutTimeline(
    [
      run({ started_at: 1_100, ended_at: 1_900, profile: "a" }),
      run({ started_at: 1_200, ended_at: 1_300, profile: "a" }),
      run({ started_at: 1_400, ended_at: 1_500, profile: "a" }),
    ],
    WIN,
    NOW,
  );
  assert.equal(layout.rows[0].lanes, 2, "두 번째·세 번째는 서로 겹치지 않으니 한 줄을 나눠 쓴다");
});

// ---------------------------------------------------------------------------
// 행
// ---------------------------------------------------------------------------

test("행은 작업자별로 갈리고 최근에 일한 쪽이 위다", () => {
  const layout = layoutTimeline(
    [
      run({ started_at: 1_100, ended_at: 1_200, profile: "오래전" }),
      run({ started_at: 1_700, ended_at: 1_800, profile: "방금" }),
    ],
    WIN,
    NOW,
  );
  assert.deepEqual(
    layout.rows.map((r) => r.profile),
    ["방금", "오래전"],
  );
});

test("작업자를 모르는 실행도 버리지 않고 마지막 행에 둔다", () => {
  const layout = layoutTimeline(
    [
      run({ started_at: 1_100, ended_at: 1_200, profile: undefined }),
      run({ started_at: 1_100, ended_at: 1_200, profile: "소피" }),
    ],
    WIN,
    NOW,
  );
  assert.deepEqual(
    layout.rows.map((r) => r.profile),
    ["소피", null],
  );
});

// ---------------------------------------------------------------------------
// 창 프리셋·눈금
// ---------------------------------------------------------------------------

test("오늘 창은 자정부터 지금까지다", () => {
  const now = Date.parse("2026-09-21T14:30:00.000Z");
  const win = presetWindow("today", now);
  assert.equal(win.toMs, now);
  const start = new Date(win.fromMs);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
  assert.ok(win.fromMs <= now);
});

test("이번 주 창은 7일이다", () => {
  const now = Date.parse("2026-09-21T14:30:00.000Z");
  const win = presetWindow("week", now);
  assert.equal(win.toMs - win.fromMs, 7 * 24 * 3600_000);
});

test("눈금은 창 길이에 따라 간격을 고르고 창 안에만 놓인다", () => {
  const hour = 3600_000;
  const win = { fromMs: 0, toMs: 4 * hour };
  const ticks = axisTicks(win);
  assert.ok(ticks.length > 0 && ticks.length <= 8);
  assert.ok(ticks.every((t) => t >= win.fromMs && t <= win.toMs));
});

test("아주 짧은 창에서도 눈금이 창을 넘지 않는다", () => {
  const ticks = axisTicks({ fromMs: 0, toMs: 60_000 });
  assert.ok(ticks.every((t) => t <= 60_000));
});

test("길이가 0인 창은 눈금이 없다", () => {
  assert.deepEqual(axisTicks({ fromMs: 5, toMs: 5 }), []);
});

test("소요는 창 안에서 보이는 만큼이다", () => {
  const layout = layoutTimeline(
    [run({ started_at: 900, ended_at: 1_500, profile: "a" })],
    WIN,
    NOW,
  );
  assert.equal(barDurationMs(layout.rows[0].bars[0]), 500 * S);
});
