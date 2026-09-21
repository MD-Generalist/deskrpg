"use client";

import type { ReportItem } from "@/game/report-queue";
import { useT } from "@/lib/i18n";

/**
 * 직원이 보고하러 와서 열린 대화창 맨 위의 보고 요약. 대화창은 이전 대화만 보여 줘서
 * "무엇을 보고하러 왔는지" 가 화면에 없었다. 문구는 방 알림 카드와 같은 키를 쓴다.
 */
export default function DialogReportSummary({
  report,
  onOpenCard,
  onOpenCronJob,
}: {
  report: ReportItem;
  onOpenCard?: (cardId: string) => void;
  onOpenCronJob?: (jobId: string) => void;
}) {
  const t = useT();
  const headline =
    report.kind === "cron_failed"
      ? `${t("notice.cronResult", { jobName: report.cardTitle })} · ${t("notice.cronFailed")}`
      : t(
          report.kind === "card_done"
            ? "notice.cardDone"
            : report.kind === "card_blocked"
              ? "notice.cardBlocked"
              : "notice.cardReview",
          { title: report.cardTitle },
        );
  const summary = report.summary.trim();
  const open =
    report.jobId && onOpenCronJob
      ? { label: t("notice.openHistory"), run: () => onOpenCronJob(report.jobId!) }
      : report.cardId && onOpenCard
        ? { label: t("notice.openCard"), run: () => onOpenCard(report.cardId!) }
        : null;
  return (
    <div
      data-testid="dialog-report-summary"
      className="mx-3 mt-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-caption"
    >
      <p className="font-semibold text-text">{headline}</p>
      {summary && summary !== report.cardTitle && (
        <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-text-secondary">{summary}</p>
      )}
      {open && (
        <button
          type="button"
          data-testid="dialog-report-open"
          onClick={open.run}
          className="mt-1.5 text-npc font-medium hover:underline"
        >
          {open.label}
        </button>
      )}
    </div>
  );
}
