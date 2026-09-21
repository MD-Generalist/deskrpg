import assert from "node:assert/strict";
import test from "node:test";

import type { KanbanTimelineRun } from "@/lib/hermes/deskrpg-plugin-types";
import {
  axisLabelKind,
  axisTicks,
  barDurationMs,
  dependencyEdges,
  layoutTimeline,
  outcomeLegend,
  presetWindow,
  targetMarker,
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

test("결과를 뜻으로 묶는다 — 실패와 '할 일이 있다' 를 가른다", () => {
  assert.equal(toneOf({ outcome: "completed", ended_at: 1 }), "done");
  for (const bad of ["crashed", "timed_out", "spawn_failed", "gave_up", "stale"]) {
    assert.equal(toneOf({ outcome: bad, ended_at: 1 }), "failed", bad);
  }
  // 한도·차단·변경요청은 사용자가 할 일이 있는 상태다. 실패색으로 칠하면 "고장" 으로 읽혀
  // 그 할 일을 놓친다.
  for (const todo of ["rate_limited", "blocked", "changes_requested"]) {
    assert.equal(toneOf({ outcome: todo, ended_at: 1 }), "actionable", todo);
  }
  for (const mid of ["reclaimed", "scheduled", "review_requested"]) {
    assert.equal(toneOf({ outcome: mid, ended_at: 1 }), "neutral", mid);
  }
});

test("결과가 없고 끝나지도 않았으면 실행 중이다", () => {
  assert.equal(toneOf({ ended_at: undefined }), "running");
  // 끝났는데 결과가 없는 것은 판단하지 않는다 — 없는 뜻을 지어내지 않는다.
  assert.equal(toneOf({ ended_at: 1 }), "unknown");
});

test("모르는 결과는 unknown 이고, 범례가 그 문자열을 잃지 않는다", () => {
  // `outcome` 은 Hermes 코어가 소유한 열린 어휘다. 값이 늘어도 이름은 화면에 남아야 한다 —
  // 실측에서 `rate_limited` 177건이 색 매핑에 없어 회색으로 뭉개진 것이 이 결함이었다.
  assert.equal(toneOf({ outcome: "some_future_outcome", ended_at: 1 }), "unknown");
  const win = { fromMs: 0, toMs: 10_000 };
  const layout = layoutTimeline(
    [
      run({
        id: "a",
        profile: "sophie",
        started_at: 1,
        ended_at: 2,
        outcome: "some_future_outcome",
      }),
      run({
        id: "b",
        profile: "sophie",
        started_at: 3,
        ended_at: 4,
        outcome: "some_future_outcome",
      }),
      run({ id: "c", profile: "sophie", started_at: 5, ended_at: 6, outcome: "rate_limited" }),
    ],
    win,
    10_000,
  );
  const legend = outcomeLegend(layout.rows);
  assert.deepEqual(
    legend.map((e) => [e.outcome, e.tone, e.count]),
    [
      ["some_future_outcome", "unknown", 2],
      ["rate_limited", "actionable", 1],
    ],
    "범례가 값 이름을 잃거나 '기타' 로 뭉갰습니다",
  );
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

test("오늘 창은 자정부터 오늘 끝까지다 — now 에서 끊으면 목표일 선이 영영 안 보인다", () => {
  const now = Date.parse("2026-09-21T14:30:00.000Z");
  const win = presetWindow("today", now);
  const start = new Date(win.fromMs);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
  assert.ok(win.fromMs <= now);
  const end = new Date(win.toMs);
  assert.equal(end.getHours(), 23);
  assert.equal(end.getMinutes(), 59);
  // 목표일은 그날 끝이라 `now` 로 끊으면 언제나 창 밖이 된다.
  assert.ok(win.toMs > now);
});

test("지난 7일 창은 7일째 되는 날의 로컬 자정에서 열리고 오늘 끝에서 닫힌다", () => {
  const now = Date.parse("2026-09-21T14:30:00.000Z");
  const win = presetWindow("week", now);
  const start = new Date(win.fromMs);
  // 달력 주가 아니라 롤링 7일이다. 시작을 로컬 자정에 맞추지 않으면 일 단위 눈금이 날짜
  // 경계에서 어긋난다(라벨이 자정이 아닌 시각을 가리킨다).
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
  assert.equal(new Date(win.toMs).getHours(), 23);
  const days = Math.round(localNoonDayIndex(win.toMs) - localNoonDayIndex(win.fromMs));
  assert.equal(days, 6, "오늘을 포함해 7일이어야 합니다");
});

/** 로컬 날짜를 정수로 — DST 가 있는 지역에서 ms 나누기로 날 수를 세면 틀린다. */
function localNoonDayIndex(ms: number): number {
  const d = new Date(ms);
  return Math.round(
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime() / 86_400_000,
  );
}

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

test("일 단위 눈금은 로컬 자정에 놓인다 — epoch 경계에 맞추면 KST 에서 09:00 에 찍힌다", () => {
  // **창을 자정에 맞추지 않은 상태로 `axisTicks` 를 직접 부른다.** `presetWindow` 가 이제 창
  // 시작을 로컬 자정으로 맞추기 때문에, 프리셋 창으로 이 단정을 쓰면 눈금 정렬이 틀려도 통과한다
  // (변이로 확인했다 — 정렬을 epoch 으로 되돌렸는데 테스트가 초록이었다). 원래 결함이 드러난
  // 모양이 바로 이것이다: 옛 주 프리셋은 7일 전의 23:59:59 에서 열렸다.
  //
  // 단정을 "라벨 문자열" 이 아니라 "눈금 시각의 로컬 시·분이 0:00" 으로 쓴다 — 그래야 TZ=UTC 와
  // TZ=Asia/Seoul 에서 같은 단정이 옳게 통과한다(UTC 에서는 두 자정이 같아 결함이 안 보인다).
  const dayEnd = new Date(Date.parse("2026-09-14T00:00:00.000Z"));
  dayEnd.setHours(23, 59, 59, 999);
  const win = { fromMs: dayEnd.getTime(), toMs: dayEnd.getTime() + 7 * 24 * 3600_000 };
  const ticks = axisTicks(win);
  assert.ok(ticks.length >= 2, `주 단위 창에 눈금이 ${ticks.length}개입니다`);
  for (const tick of ticks) {
    const d = new Date(tick);
    assert.equal(d.getHours(), 0, `눈금 ${d.toString()} 이 로컬 자정이 아닙니다`);
    assert.equal(d.getMinutes(), 0);
  }
});

test("프리셋 창의 눈금도 로컬 자정이다", () => {
  const now = Date.parse("2026-09-21T14:30:00.000Z");
  for (const tick of axisTicks(presetWindow("week", now))) {
    const d = new Date(tick);
    assert.equal(d.getHours(), 0, `눈금 ${d.toString()} 이 로컬 자정이 아닙니다`);
  }
});

test("하루를 넘는 창의 눈금은 서로 다른 날이다 — 라벨이 전부 같아지지 않는다", () => {
  const now = Date.parse("2026-09-21T14:30:00.000Z");
  const win = presetWindow("week", now);
  const ticks = axisTicks(win);
  // 실측 결함의 모양은 "라벨 일곱 개가 모두 오전 09:00" 이었다. 라벨 포맷은 로케일 소관이므로
  // 여기서는 그 근거가 되는 성질만 본다 — 눈금이 서로 다른 **날짜**여야 한다.
  const days = ticks.map((t) => new Date(t).toDateString());
  assert.equal(new Set(days).size, days.length, `눈금이 같은 날에 겹쳤습니다: ${days.join(", ")}`);
  assert.equal(axisLabelKind(win), "date", "하루를 넘는 창은 날짜 라벨을 써야 합니다");
});

test("하루 이하 창은 시각 라벨을 쓴다", () => {
  const now = Date.parse("2026-09-21T14:30:00.000Z");
  assert.equal(axisLabelKind(presetWindow("today", now)), "time");
  assert.equal(axisLabelKind({ fromMs: 0, toMs: 4 * 3600_000 }), "time");
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

// ---------------------------------------------------------------------------
// 목표일
// ---------------------------------------------------------------------------

test("목표일이 없으면 표시가 없다", () => {
  assert.deepEqual(targetMarker(null, WIN, NOW), { kind: "none" });
  assert.deepEqual(targetMarker(undefined, WIN, NOW), { kind: "none" });
  assert.deepEqual(targetMarker("날짜아님", WIN, NOW), { kind: "none" });
});

test("목표일은 그날 끝까지다 — 자정으로 잡으면 하루를 잃는다", () => {
  const dayStart = Date.parse("2026-09-30T00:00:00");
  const win = { fromMs: dayStart - 3600_000, toMs: dayStart + 48 * 3600_000 };
  const marker = targetMarker("2026-09-30", win, dayStart);
  assert.equal(marker.kind, "inWindow");
  if (marker.kind !== "inWindow") return;
  assert.ok(marker.atMs > dayStart + 23 * 3600_000, "30일 밤이어야 한다");
  assert.ok(marker.atMs < dayStart + 24 * 3600_000);
});

test("창 밖 목표일은 선을 경계에 붙이지 않고 방향과 남은 일수를 말한다", () => {
  const now = Date.parse("2026-09-21T00:00:00");
  const win = { fromMs: now - 3600_000, toMs: now };
  const marker = targetMarker("2026-09-30", win, now);
  assert.equal(marker.kind, "outside");
  if (marker.kind !== "outside") return;
  assert.equal(marker.side, "after");
  assert.equal(marker.daysFromNow, 10, "9월 30일 밤까지면 10일 뒤로 올림된다");
});

test("지난 목표일은 음수 일수로 나온다 — 화면이 지났다고 말할 수 있어야 한다", () => {
  const now = Date.parse("2026-09-21T12:00:00");
  const win = { fromMs: now - 3600_000, toMs: now };
  const marker = targetMarker("2026-09-10", win, now);
  assert.equal(marker.kind, "outside");
  if (marker.kind !== "outside") return;
  assert.equal(marker.side, "before");
  assert.ok(marker.daysFromNow < 0);
});

// ---------------------------------------------------------------------------
// 의존 화살표
// ---------------------------------------------------------------------------

test("양쪽 카드가 다 보일 때만 화살표를 만든다", () => {
  const layout = layoutTimeline(
    [
      run({ task_id: "parent", started_at: 1_100, ended_at: 1_200, profile: "a" }),
      run({ task_id: "child", started_at: 1_300, ended_at: 1_400, profile: "b" }),
    ],
    WIN,
    NOW,
  );
  const edges = dependencyEdges(layout.rows, [
    { parent_id: "parent", child_id: "child" },
    // 자식이 창에 없다 — 허공으로 들어가는 화살표를 만들지 않는다.
    { parent_id: "parent", child_id: "ghost" },
  ]);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].childTaskId, "child");
  assert.equal(edges[0].outOfOrder, false);
});

test("자식이 부모보다 먼저 시작했으면 숨기지 않고 드러낸다", () => {
  const layout = layoutTimeline(
    [
      run({ task_id: "parent", started_at: 1_300, ended_at: 1_900, profile: "a" }),
      run({ task_id: "child", started_at: 1_100, ended_at: 1_200, profile: "b" }),
    ],
    WIN,
    NOW,
  );
  const edges = dependencyEdges(layout.rows, [{ parent_id: "parent", child_id: "child" }]);
  assert.equal(edges[0].outOfOrder, true);
});

test("한 카드가 여러 번 돌았으면 처음 시작과 마지막 끝으로 잇는다", () => {
  const layout = layoutTimeline(
    [
      run({ task_id: "parent", started_at: 1_100, ended_at: 1_200, profile: "a" }),
      run({ task_id: "parent", started_at: 1_300, ended_at: 1_500, profile: "a" }),
      run({ task_id: "child", started_at: 1_700, ended_at: 1_800, profile: "b" }),
    ],
    WIN,
    NOW,
  );
  const edges = dependencyEdges(layout.rows, [{ parent_id: "parent", child_id: "child" }]);
  assert.equal(edges.length, 1);
  // 부모의 끝은 두 번째 실행의 끝이다.
  assert.ok(edges[0].from.x > 0.2);
  assert.equal(edges[0].outOfOrder, false);
});

test("오늘이 목표일이면 오늘 창 안에 든다 — 이게 이 기능의 핵심 경우다", () => {
  const now = Date.parse("2026-09-21T09:00:00");
  const win = presetWindow("today", now);
  const marker = targetMarker("2026-09-21", win, now);
  assert.equal(marker.kind, "inWindow", "오늘 마감인데 선이 안 그려지면 기능이 없는 것과 같다");
});

test("내일 목표일은 창 밖이라 글로 말한다", () => {
  const now = Date.parse("2026-09-21T09:00:00");
  const win = presetWindow("today", now);
  const marker = targetMarker("2026-09-22", win, now);
  assert.equal(marker.kind, "outside");
});
