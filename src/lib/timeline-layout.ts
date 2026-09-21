/**
 * 실적 타임라인의 배치 계산 — SVG·React·DOM 을 모른다.
 *
 * "누가 언제 **실제로** 일했는가" 를 그린다. 계획이 아니라 실적이다. 행은 카드가 아니라
 * 작업자이고, 막대 하나가 실행 기록 한 건이다.
 *
 * 배치를 순수 함수로 빼 두면 SVG 없이 테스트할 수 있다 — 겹침·레인·창 경계 같은 것은
 * 그림을 보지 않고도 틀렸는지 알 수 있어야 한다.
 */

import type { KanbanTimelineRun } from "@/lib/hermes/deskrpg-plugin-types";
import { taskTimeMs } from "@/lib/plugin-time";

/**
 * 막대 색을 고르는 결과 종류.
 *
 * `outcome` 은 **Hermes 코어가 소유한 열린 어휘**다. 닫힌 목록으로 믿으면 코어가 값을 하나
 * 늘릴 때마다 조용히 회색으로 빠진다 — 실제로 그렇게 됐다(스테이징 실측: 실행 178건 중
 * 177건이 `rate_limited` 였고 색 매핑에 없어 "기타" 로 그려졌다). 그래서 여기서 하는 일은
 * "아는 값을 나열" 이 아니라 **뜻으로 묶기**이고, 모르는 값은 `unknown` 으로 두되 화면이
 * 그 문자열을 그대로 보여 준다(`outcomeLegend`).
 *
 * `actionable` 은 실패와 다르다 — 한도·차단·변경요청은 **사용자가 할 일이 있는** 상태다.
 * 실패색으로 칠하면 "고장" 으로 읽혀 할 일을 놓친다.
 */
export type RunTone = "running" | "done" | "failed" | "actionable" | "neutral" | "unknown";

/** 뜻이 같은 결과끼리. 값은 `~/.hermes` 코어의 `kanban_db.py` 에서 확인한 것이다. */
const TONE_BY_OUTCOME: Readonly<Record<string, RunTone>> = {
  completed: "done",
  crashed: "failed",
  gave_up: "failed",
  timed_out: "failed",
  spawn_failed: "failed",
  stale: "failed",
  rate_limited: "actionable",
  blocked: "actionable",
  changes_requested: "actionable",
  reclaimed: "neutral",
  scheduled: "neutral",
  review_requested: "neutral",
};

export function toneOf(run: Pick<KanbanTimelineRun, "outcome" | "ended_at">): RunTone {
  if (!run.outcome) return run.ended_at === undefined ? "running" : "unknown";
  return TONE_BY_OUTCOME[run.outcome] ?? "unknown";
}

export type TimelineWindow = { fromMs: number; toMs: number };

export type PositionedBar = {
  run: KanbanTimelineRun;
  tone: RunTone;
  /** 창 안으로 자른 시작·끝(ms). 창 밖으로 뻗은 쪽은 창 경계에 붙는다. */
  startMs: number;
  endMs: number;
  /** 아직 끝나지 않았는가. 화면은 이쪽 끝을 흐리게 그려 "여기까지 확실하다" 를 말한다. */
  open: boolean;
  /** 창 기준 0~1 비율. 픽셀 환산은 화면이 한다 — 여기서 폭을 모른다. */
  x: number;
  width: number;
  /** 같은 작업자 안에서 동시에 돈 실행을 쌓는 줄 번호(0부터). */
  lane: number;
};

export type ActorRow = {
  /** 작업자 이름(`runs[].profile`). 없으면 `null` — 누가 했는지 모르는 실행도 버리지 않는다. */
  profile: string | null;
  /** 이 행이 몇 줄을 차지하는가(동시 실행 수). 최소 1. */
  lanes: number;
  bars: PositionedBar[];
};

export type TimelineLayout = {
  window: TimelineWindow;
  rows: ActorRow[];
  /** 창에 겹치지 않아 그려지지 않은 실행 수. 0이 아니면 화면이 밝혀야 한다. */
  omitted: number;
};

/** 창에 겹치는가. 시작만 보고 자르면 긴 작업이 타임라인에서 사라진다. */
function overlaps(startMs: number, endMs: number | null, win: TimelineWindow): boolean {
  if (startMs > win.toMs) return false;
  if (endMs !== null && endMs < win.fromMs) return false;
  return true;
}

/**
 * 실행 기록을 작업자 행으로 배치한다.
 *
 * - 행 순서는 **가장 최근에 일한 작업자가 위**다. 이름순으로 두면 방금 일어난 일을 찾으려고
 *   눈이 훑어야 한다.
 * - 같은 작업자가 동시에 여러 실행을 돌렸으면 아래 줄로 쌓는다(겹쳐 그리면 하나만 보인다).
 * - 시각을 못 읽는 실행은 버린다. 다만 몇 건을 버렸는지 `omitted` 로 말한다.
 */
export function layoutTimeline(
  runs: readonly KanbanTimelineRun[],
  win: TimelineWindow,
  nowMs: number,
): TimelineLayout {
  const span = Math.max(1, win.toMs - win.fromMs);
  const byActor = new Map<string, { profile: string | null; bars: PositionedBar[] }>();
  let omitted = 0;

  for (const run of runs) {
    const startedMs = taskTimeMs(run.started_at);
    if (startedMs === null) {
      omitted += 1;
      continue;
    }
    const endedMs = taskTimeMs(run.ended_at);
    const open = endedMs === null;
    // 끝나지 않은 실행은 "지금까지" 로 본다. 창 끝을 넘지는 않는다.
    const effectiveEnd = open ? Math.min(nowMs, win.toMs) : endedMs;
    if (!overlaps(startedMs, open ? null : endedMs, win)) {
      omitted += 1;
      continue;
    }
    const startMs = Math.max(startedMs, win.fromMs);
    const endMs = Math.max(startMs, Math.min(effectiveEnd, win.toMs));
    const key = run.profile ?? "\u0000unknown";
    const row = byActor.get(key) ?? { profile: run.profile ?? null, bars: [] };
    row.bars.push({
      run,
      tone: toneOf(run),
      startMs,
      endMs,
      open,
      x: (startMs - win.fromMs) / span,
      width: (endMs - startMs) / span,
      lane: 0,
    });
    byActor.set(key, row);
  }

  const rows: ActorRow[] = [];
  for (const row of byActor.values()) {
    row.bars.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    const lanes = assignLanes(row.bars);
    rows.push({ profile: row.profile, lanes, bars: row.bars });
  }
  // 최근에 일한 작업자가 위. 이름 없는 행은 마지막.
  rows.sort((a, b) => {
    if ((a.profile === null) !== (b.profile === null)) return a.profile === null ? 1 : -1;
    return lastEnd(b) - lastEnd(a);
  });
  return { window: win, rows, omitted };
}

function lastEnd(row: ActorRow): number {
  return row.bars.reduce((max, bar) => Math.max(max, bar.endMs), 0);
}

/**
 * 겹치는 막대를 아래 줄로 내린다. 각 줄이 비는 가장 이른 줄에 넣는 탐욕 배치다 —
 * 최소 줄 수를 보장하고(구간 그래프의 색칠 수는 최대 동시 수와 같다) 순서가 안정적이다.
 */
function assignLanes(bars: PositionedBar[]): number {
  const laneEnds: number[] = [];
  for (const bar of bars) {
    let lane = laneEnds.findIndex((end) => end <= bar.startMs);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(bar.endMs);
    } else {
      laneEnds[lane] = bar.endMs;
    }
    bar.lane = lane;
  }
  return Math.max(1, laneEnds.length);
}

/** 창의 기본 범위 — "오늘" 과 "이번 주". 줌은 없다(요구가 생기면 그때 붙인다). */
export type WindowPreset = "today" | "week";

/**
 * 창은 **오늘 끝까지**다. `now` 에서 끊지 않는다.
 *
 * 처음에는 `now` 에서 끊었는데, 그러면 목표일 세로선이 사실상 절대 그려지지 않는다 — 목표일은
 * 그날 끝(23:59)이라 언제나 `now` 보다 뒤이기 때문이다. 오늘 마감인 일을 보려고 여는 화면에서
 * 그 선이 없으면 기능이 없는 것과 같다(모달 배선 테스트가 이걸 잡았다).
 *
 * 남은 오늘은 막대 없는 빈 구간으로 남는데, 그것이 곧 "얼마 남았나" 를 보여 준다. 진행 중인
 * 막대는 `now` 까지만 그려지므로(`layoutTimeline`) 없는 일을 그리지도 않는다.
 */
export function presetWindow(preset: WindowPreset, nowMs: number): TimelineWindow {
  const end = new Date(nowMs);
  end.setHours(23, 59, 59, 999);
  const toMs = end.getTime();
  if (preset === "today") return { fromMs: localDayStart(nowMs), toMs };
  // 달력 주가 아니라 **롤링 7일**이다. 월요일 아침에 빈 화면이 되는 달력 주보다, "최근에
  // 무슨 일이 있었나" 를 보는 이 화면에는 롤링이 맞다(2026-09-21 결정). 창 시작을 그 날의
  // 로컬 자정에 맞춰 눈금이 날짜 경계와 어긋나지 않게 한다 — 라벨은 "지난 7일" 이다.
  return { fromMs: localDayStart(toMs - 6 * DAY_MS), toMs };
}

/** 그 시각이 속한 날의 **로컬** 자정. 눈금 기준점과 날짜 비교의 단일 출처다. */
function localDayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const DAY_MS = 24 * 3600_000;

/**
 * 시간축 눈금. 창 길이에 따라 간격을 고르고, 창 안에 드는 경계만 돌려준다.
 *
 * 눈금 수를 고정하지 않는 이유는 "오늘" 이 자정 직후면 한 시간도 안 되기 때문이다 —
 * 억지로 여섯 개를 만들면 초 단위 눈금이 생긴다.
 *
 * **경계는 epoch 이 아니라 로컬 자정을 기준으로 센다.** epoch 배수에 맞추면 일 단위 눈금이
 * UTC 자정에 놓여 KST 에서는 09:00 에 찍힌다 — 주 단위 창의 눈금 일곱 개가 모두 "오전 09:00"
 * 으로 같아지는 실측 결함이 이것이었다. 30분 오프셋 시간대(예: 인도)에서는 시 단위 눈금도
 * 같은 문제를 겪으므로 간격에 상관없이 같은 기준을 쓴다.
 *
 * 일 단위는 24시간을 더하지 않고 **날짜를 하나 올린다** — DST 가 있는 지역에서 고정 24시간을
 * 더하면 하루씩 밀려 자정에서 벗어난다.
 */
export function axisTicks(win: TimelineWindow, maxTicks = 8): number[] {
  const span = win.toMs - win.fromMs;
  if (span <= 0) return [];
  const steps = [
    5 * 60_000,
    15 * 60_000,
    30 * 60_000,
    3600_000,
    3 * 3600_000,
    6 * 3600_000,
    12 * 3600_000,
    DAY_MS,
  ];
  // 눈금은 경계이므로 개수는 `span/step + 1` 이다. 간격을 고를 때 그 +1 을 빼먹으면
  // 딱 하나가 넘친다(4시간 창에서 30분 간격 → 9개).
  const step = steps.find((s) => Math.floor(span / s) + 1 <= maxTicks) ?? steps[steps.length - 1];
  const ticks: number[] = [];

  if (step === DAY_MS) {
    const cursor = new Date(localDayStart(win.fromMs));
    if (cursor.getTime() < win.fromMs) cursor.setDate(cursor.getDate() + 1);
    while (cursor.getTime() <= win.toMs) {
      ticks.push(cursor.getTime());
      cursor.setDate(cursor.getDate() + 1);
    }
    return ticks;
  }

  const origin = localDayStart(win.fromMs);
  const first = origin + Math.ceil((win.fromMs - origin) / step) * step;
  for (let t = first; t <= win.toMs; t += step) ticks.push(t);
  return ticks;
}

/**
 * 눈금 라벨을 시각으로 쓸지 날짜로 쓸지. 창이 하루를 넘으면 시:분만으로는 구분이 안 된다 —
 * 주 단위 창에서 라벨 일곱 개가 모두 같은 글자였던 실측 결함이 그것이다.
 */
export type AxisLabelKind = "time" | "date";

export function axisLabelKind(win: TimelineWindow): AxisLabelKind {
  return win.toMs - win.fromMs > DAY_MS ? "date" : "time";
}

/**
 * 범례 한 항목. `outcome` 이 `null` 이면 "결과 미기록" 이나 "아직 도는 중" 이라 화면이
 * 자기 말로 붙인다.
 */
export type OutcomeLegendEntry = { outcome: string | null; tone: RunTone; count: number };

/**
 * 보이는 막대에 **실제로 있는** 결과만 범례로 만든다.
 *
 * tone 고정 목록을 범례로 쓰면 모르는 값이 "기타" 한 칸에 뭉개져 이름을 잃는다. 여기서는
 * 값 자체가 항목이므로 코어가 어휘를 늘려도 그 문자열이 그대로 화면에 나온다 — 색을 못
 * 골라도 이름은 잃지 않는다는 것이 이 함수의 목적이다.
 *
 * 많은 것부터, 같으면 이름 순. 정렬을 고정해 두면 스냅샷이 흔들리지 않는다.
 */
export function outcomeLegend(rows: readonly ActorRow[]): OutcomeLegendEntry[] {
  const seen = new Map<string, OutcomeLegendEntry>();
  for (const row of rows) {
    for (const bar of row.bars) {
      const outcome = bar.run.outcome ?? null;
      const key = `${bar.tone}\u0000${outcome ?? ""}`;
      const found = seen.get(key);
      if (found) found.count += 1;
      else seen.set(key, { outcome, tone: bar.tone, count: 1 });
    }
  }
  return [...seen.values()].sort(
    (a, b) => b.count - a.count || (a.outcome ?? "").localeCompare(b.outcome ?? ""),
  );
}

/** 막대 한 건의 소요(ms). 아직 안 끝났으면 창 안에서 보이는 만큼이다. */
export function barDurationMs(bar: PositionedBar): number {
  return bar.endMs - bar.startMs;
}

// ---------------------------------------------------------------------------
// 목표일 (D3(c) — 계획 막대 대신 프로젝트 목표일 하나)
// ---------------------------------------------------------------------------

export type TargetMarker =
  | { kind: "none" }
  /** 창 안에 있어 세로선을 그릴 수 있다. `x` 는 0~1 비율. */
  | { kind: "inWindow"; atMs: number; x: number }
  /**
   * 목표일이 창 밖이다. **선을 창 경계에 붙이지 않는다** — 그러면 목표일이 그 시각인 것처럼
   * 보인다. 대신 방향과 남은 일수를 글로 말한다.
   */
  | { kind: "outside"; atMs: number; side: "before" | "after"; daysFromNow: number };

/**
 * 프로젝트 목표일을 창 기준으로 해석한다.
 *
 * `targetDate` 는 `YYYY-MM-DD` 날짜다(`project-registry.ts` 의 `toIsoDate`). 그날 **끝**까지를
 * 목표로 본다 — 9월 30일이 목표면 30일 23:59 까지가 기한이고, 00:00 으로 잡으면 하루를 잃는다.
 */
export function targetMarker(
  targetDate: string | null | undefined,
  win: TimelineWindow,
  nowMs: number,
): TargetMarker {
  if (!targetDate) return { kind: "none" };
  const dayStart = Date.parse(`${targetDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(dayStart)) return { kind: "none" };
  const atMs = dayStart + 24 * 3600_000 - 1;
  const span = Math.max(1, win.toMs - win.fromMs);
  if (atMs >= win.fromMs && atMs <= win.toMs) {
    return { kind: "inWindow", atMs, x: (atMs - win.fromMs) / span };
  }
  return {
    kind: "outside",
    atMs,
    side: atMs < win.fromMs ? "before" : "after",
    // 지난 목표일은 음수로 나온다 — 화면이 "지났다" 를 말할 수 있어야 한다.
    daysFromNow: Math.ceil((atMs - nowMs) / (24 * 3600_000)),
  };
}

// ---------------------------------------------------------------------------
// 의존 화살표 (부모 링크가 곧 실행 순서다)
// ---------------------------------------------------------------------------

export type DependencyEdge = {
  parentTaskId: string;
  childTaskId: string;
  /** 부모의 마지막 막대 끝과 자식의 첫 막대 시작. 둘 다 창 안에 보일 때만 만든다. */
  from: { x: number; row: number; lane: number };
  to: { x: number; row: number; lane: number };
  /**
   * 자식이 부모보다 먼저 시작했는가. Hermes 는 부모가 끝나야 자식을 집게 하므로 정상적으로는
   * 생기지 않는다. 생겼다면 볼 만한 사실이라 숨기지 않는다.
   */
  outOfOrder: boolean;
};

/**
 * 부모→자식 링크를 화살표로 바꾼다.
 *
 * **양쪽 카드가 모두 창 안에 그려져 있을 때만** 만든다. 한쪽이 없으면 화살표가 허공에서
 * 나오거나 허공으로 들어가는데, 그건 없는 관계를 암시한다.
 */
export function dependencyEdges(
  rows: readonly ActorRow[],
  links: readonly { parent_id: string; child_id: string }[],
): DependencyEdge[] {
  type Anchor = {
    row: number;
    lane: number;
    startX: number;
    endX: number;
    startMs: number;
    endMs: number;
  };
  const anchors = new Map<string, Anchor>();
  rows.forEach((row, rowIndex) => {
    for (const bar of row.bars) {
      const existing = anchors.get(bar.run.task_id);
      if (!existing) {
        anchors.set(bar.run.task_id, {
          row: rowIndex,
          lane: bar.lane,
          startX: bar.x,
          endX: bar.x + bar.width,
          startMs: bar.startMs,
          endMs: bar.endMs,
        });
        continue;
      }
      // 한 카드가 여러 번 돌았으면 처음 시작과 마지막 끝으로 잇는다.
      if (bar.startMs < existing.startMs) {
        existing.startMs = bar.startMs;
        existing.startX = bar.x;
        existing.row = rowIndex;
        existing.lane = bar.lane;
      }
      if (bar.endMs > existing.endMs) {
        existing.endMs = bar.endMs;
        existing.endX = bar.x + bar.width;
      }
    }
  });

  const edges: DependencyEdge[] = [];
  for (const link of links) {
    const parent = anchors.get(link.parent_id);
    const child = anchors.get(link.child_id);
    if (!parent || !child) continue;
    edges.push({
      parentTaskId: link.parent_id,
      childTaskId: link.child_id,
      from: { x: parent.endX, row: parent.row, lane: parent.lane },
      to: { x: child.startX, row: child.row, lane: child.lane },
      outOfOrder: child.startMs < parent.endMs,
    });
  }
  return edges;
}
