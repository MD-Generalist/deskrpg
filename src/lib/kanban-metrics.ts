/**
 * 운영 지표 — 카드·실행 기록에서 **계산되는** 것. 저장하지 않는다.
 *
 * 저장하지 않는 이유는 틀렸을 때 계산만 고치면 되고, 낡은 값이 DB 에 남지 않기 때문이다.
 *
 * 제품 방향(`docs/product-direction.md`)이 못을 박아 뒀다 — 에이전트 수·메시지 수·회의 시간·
 * 화면 체류시간만으로 생산성을 주장하지 않는다. 그래서 "카드 30개 생성" 같은 수는 지표가
 * 아니다. 여기 있는 것은 **끝났는가 · 왜 실패했는가 · 지금 손이 필요한가** 세 가지다.
 */

import type { KanbanTimelineRun } from "@/lib/hermes/deskrpg-plugin-types";
import { countNeedsAttention, type AttentionCounts } from "@/lib/needs-attention";
import { taskTimeMs } from "@/lib/plugin-time";

/**
 * 끝난 실행의 결과 어휘(Hermes `task_runs.outcome`).
 *
 * `completed` 하나만 성공이다. 나머지를 "실패" 한 덩어리로 합치지 않는다 — `gave_up` 과
 * `crashed` 는 사람이 할 일이 다르고, 합치면 무엇을 고쳐야 하는지가 사라진다.
 */
export const RUN_SUCCESS_OUTCOME = "completed";

export type OutcomeCount = { outcome: string; count: number };

export type DurationStats = {
  /** 중앙값(ms). 평균은 크래시 한 건에 끌려간다. 표본이 없으면 null. */
  medianMs: number | null;
  /** **표본 수를 반드시 함께 낸다.** 3건의 중앙값을 추세처럼 보여 주면 없는 경향을 읽게 된다. */
  samples: number;
};

export type OperationalMetrics = {
  window: { fromMs: number; toMs: number };
  /** 이 창에서 완료 실행이 하나라도 있었던 **카드 수**. 같은 카드가 여러 번 돌아도 한 번 센다. */
  throughput: number;
  /** 끝난 실행 가운데 성공 비율(0~1). 끝난 실행이 없으면 null — 0% 로 쓰면 거짓이다. */
  successRate: number | null;
  /** 끝난 실행 수. `successRate` 의 분모이고, 표본 크기이기도 하다. */
  terminalRuns: number;
  /** 아직 안 끝난 실행 수. 성공률 계산에서 빠진다. */
  openRuns: number;
  /** 결과별 건수, 많은 것부터. 같으면 이름순 — 재조회마다 순서가 흔들리지 않게. */
  outcomes: OutcomeCount[];
  /** 완료 실행의 소요. 실패한 실행은 소요의 의미가 달라 섞지 않는다. */
  duration: DurationStats;
  /** 손이 필요한 카드. 판단 모음과 **같은 함수**로 센다. */
  attention: AttentionCounts;
};

/** 실행이 끝났는가. `ended_at` 이 없으면 아직 돌고 있다. */
function isTerminal(run: KanbanTimelineRun): boolean {
  return taskTimeMs(run.ended_at) !== null;
}

/**
 * 창 안에서 **끝난** 실행만 센다.
 *
 * 타임라인은 창에 겹치기만 하면 그리지만(보이는 것이 목적이므로), 지표는 다르다 — 창 밖에서
 * 끝난 일을 이 창의 성과로 세면 같은 실행이 두 창에 중복으로 잡힌다.
 */
function endedInWindow(run: KanbanTimelineRun, fromMs: number, toMs: number): boolean {
  const ended = taskTimeMs(run.ended_at);
  return ended !== null && ended >= fromMs && ended <= toMs;
}

export function computeOperationalMetrics(
  runs: readonly KanbanTimelineRun[],
  cards: readonly { id: string; status: string }[],
  pendingApprovalTaskIds: ReadonlySet<string>,
  window: { fromMs: number; toMs: number },
): OperationalMetrics {
  const completedTasks = new Set<string>();
  const outcomes = new Map<string, number>();
  const durations: number[] = [];
  let terminalRuns = 0;
  let openRuns = 0;
  let successes = 0;

  for (const run of runs) {
    if (!isTerminal(run)) {
      openRuns += 1;
      continue;
    }
    if (!endedInWindow(run, window.fromMs, window.toMs)) continue;
    terminalRuns += 1;

    // 결과가 없는 채 끝난 실행도 센다. 지어내지 않고 "미기록" 으로 둔다.
    const outcome = run.outcome ?? "unrecorded";
    outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);

    if (outcome === RUN_SUCCESS_OUTCOME) {
      successes += 1;
      completedTasks.add(run.task_id);
      const started = taskTimeMs(run.started_at);
      const ended = taskTimeMs(run.ended_at);
      if (started !== null && ended !== null && ended >= started) durations.push(ended - started);
    }
  }

  return {
    window,
    throughput: completedTasks.size,
    successRate: terminalRuns > 0 ? successes / terminalRuns : null,
    terminalRuns,
    openRuns,
    outcomes: [...outcomes.entries()]
      .map(([outcome, count]) => ({ outcome, count }))
      .sort((a, b) => b.count - a.count || a.outcome.localeCompare(b.outcome)),
    duration: median(durations),
    attention: countNeedsAttention(cards, pendingApprovalTaskIds),
  };
}

function median(values: number[]): DurationStats {
  if (values.length === 0) return { medianMs: null, samples: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianMs =
    sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return { medianMs, samples: sorted.length };
}

/**
 * 표본이 이만큼은 돼야 비율을 수치로 보여 준다.
 *
 * 2건 중 1건 성공을 "50%" 로 쓰면 없는 경향을 읽게 된다. 그 아래에서는 화면이 비율 대신
 * 건수를 그대로 보인다.
 */
export const MIN_RATE_SAMPLES = 5;

export function hasEnoughSamples(terminalRuns: number): boolean {
  return terminalRuns >= MIN_RATE_SAMPLES;
}
