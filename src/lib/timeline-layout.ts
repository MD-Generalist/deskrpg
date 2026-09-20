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
 * Hermes 의 `outcome` 어휘(`completed|blocked|crashed|timed_out|spawn_failed|gave_up|reclaimed`)를
 * 화면이 구분해야 하는 만큼으로 접는다. **실패를 한 덩어리로 뭉개지 않는다** — `gave_up` 과
 * `crashed` 는 사람이 할 일이 다르다.
 */
export type RunTone = "running" | "done" | "failed" | "gaveUp" | "interrupted" | "other";

export function toneOf(run: Pick<KanbanTimelineRun, "outcome" | "ended_at">): RunTone {
  if (!run.outcome) return run.ended_at === undefined ? "running" : "other";
  switch (run.outcome) {
    case "completed":
      return "done";
    case "crashed":
    case "timed_out":
    case "spawn_failed":
      return "failed";
    case "gave_up":
      return "gaveUp";
    case "reclaimed":
    case "blocked":
      return "interrupted";
    default:
      return "other";
  }
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

export function presetWindow(preset: WindowPreset, nowMs: number): TimelineWindow {
  if (preset === "today") {
    const start = new Date(nowMs);
    start.setHours(0, 0, 0, 0);
    return { fromMs: start.getTime(), toMs: nowMs };
  }
  return { fromMs: nowMs - 7 * 24 * 3600_000, toMs: nowMs };
}

/**
 * 시간축 눈금. 창 길이에 따라 간격을 고르고, 창 안에 드는 경계만 돌려준다.
 *
 * 눈금 수를 고정하지 않는 이유는 "오늘" 이 자정 직후면 한 시간도 안 되기 때문이다 —
 * 억지로 여섯 개를 만들면 초 단위 눈금이 생긴다.
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
    24 * 3600_000,
  ];
  // 눈금은 경계이므로 개수는 `span/step + 1` 이다. 간격을 고를 때 그 +1 을 빼먹으면
  // 딱 하나가 넘친다(4시간 창에서 30분 간격 → 9개).
  const step = steps.find((s) => Math.floor(span / s) + 1 <= maxTicks) ?? steps[steps.length - 1];
  const ticks: number[] = [];
  for (let t = Math.ceil(win.fromMs / step) * step; t <= win.toMs; t += step) ticks.push(t);
  return ticks;
}

/** 막대 한 건의 소요(ms). 아직 안 끝났으면 창 안에서 보이는 만큼이다. */
export function barDurationMs(bar: PositionedBar): number {
  return bar.endMs - bar.startMs;
}
