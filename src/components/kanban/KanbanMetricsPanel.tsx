"use client";

import { useT } from "@/lib/i18n";
import { hasEnoughSamples, MIN_RATE_SAMPLES, type OperationalMetrics } from "@/lib/kanban-metrics";

import { formatElapsed } from "./kanban-view-model";

/**
 * 운영 지표 — 실적 타임라인 위에 얹는 요약 줄.
 *
 * 다섯 칸 가운데 **"손이 필요한 카드" 만 지금 행동을 부른다.** 나머지는 사후 통계라서
 * 시선 순서가 그 반대가 되지 않게 맨 앞에 둔다.
 *
 * 저장하지 않는 값이라 틀리면 계산만 고친다. 표본이 적을 때 비율을 수치로 쓰지 않는 것이
 * 이 화면의 규칙이다 — 2건 중 1건을 "50%" 로 쓰면 없는 경향을 읽게 된다.
 */
export default function KanbanMetricsPanel({ metrics }: { metrics: OperationalMetrics }) {
  const t = useT();
  const { attention, duration, outcomes, successRate, terminalRuns, throughput, openRuns } =
    metrics;

  return (
    <section
      aria-label={t("kanban.metrics.title")}
      className="mb-3 flex flex-wrap gap-2 text-[11px]"
    >
      <Cell
        label={t("kanban.metrics.attention")}
        value={String(attention.total)}
        emphasis={attention.total > 0}
        detail={
          attention.total > 0
            ? [
                attention.awaiting_approval > 0
                  ? t("kanban.metrics.attention.approval", {
                      count: attention.awaiting_approval,
                    })
                  : null,
                attention.review > 0
                  ? t("kanban.metrics.attention.review", { count: attention.review })
                  : null,
                attention.blocked > 0
                  ? t("kanban.metrics.attention.blocked", { count: attention.blocked })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : null
        }
      />

      <Cell label={t("kanban.metrics.throughput")} value={String(throughput)} />

      <Cell
        label={t("kanban.metrics.successRate")}
        // 표본이 적으면 비율 대신 건수를 그대로 보인다.
        value={
          successRate === null
            ? t("kanban.metrics.noData")
            : hasEnoughSamples(terminalRuns)
              ? `${Math.round(successRate * 100)}%`
              : t("kanban.metrics.fewSamples", {
                  count: Math.round(successRate * terminalRuns),
                  total: terminalRuns,
                })
        }
        detail={terminalRuns > 0 ? t("kanban.metrics.samples", { count: terminalRuns }) : null}
      />

      <Cell
        label={t("kanban.metrics.median")}
        value={
          duration.medianMs === null
            ? t("kanban.metrics.noData")
            : formatElapsed(Math.round(duration.medianMs / 1000))
        }
        // 표본 수 없이 중앙값만 보이면 추세처럼 읽힌다.
        detail={t("kanban.metrics.samples", { count: duration.samples })}
      />

      {openRuns > 0 && <Cell label={t("kanban.metrics.openRuns")} value={String(openRuns)} />}

      {outcomes.length > 0 && (
        <div className="flex min-w-[140px] flex-col rounded-md border border-border bg-surface px-2 py-1">
          <span className="text-text-muted">{t("kanban.metrics.outcomes")}</span>
          <ul className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
            {outcomes.map((entry) => (
              <li key={entry.outcome} className="text-text-secondary">
                {entry.outcome} <span className="text-text">{entry.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Cell({
  label,
  value,
  detail,
  emphasis = false,
}: {
  label: string;
  value: string;
  detail?: string | null;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`flex min-w-[96px] flex-col rounded-md border px-2 py-1 ${
        emphasis ? "border-danger bg-danger-bg" : "border-border bg-surface"
      }`}
    >
      <span className="text-text-muted">{label}</span>
      <span className={`text-sm font-semibold ${emphasis ? "text-danger" : "text-text"}`}>
        {value}
      </span>
      {detail && <span className="text-text-dim">{detail}</span>}
    </div>
  );
}

export { MIN_RATE_SAMPLES };
