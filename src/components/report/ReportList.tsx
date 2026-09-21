"use client";

import type { ReportItem } from "@/game/report-queue";
import { useLocale, useT } from "@/lib/i18n";

/**
 * 보고 배지를 누르면 열리는 **남은 보고 목록**. 예전에는 배지가 맨 앞 보고의 칸반으로
 * 바로 가서, 어떤 보고가 남았는지(특히 접혀서 아무도 오지 않는 보고) 알 수 없었다.
 *
 * "열기" 는 그 보고 한 건만 확인한다. 접힌 보고에는 "다시 부르기" 를 둔다.
 */
export default function ReportList({
  items,
  dismissedIds,
  onOpen,
  onRecall,
}: {
  items: readonly ReportItem[];
  dismissedIds: ReadonlySet<string>;
  onOpen: (item: ReportItem) => void;
  onRecall: (item: ReportItem) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div
      role="dialog"
      aria-label={t("report.list.title")}
      data-testid="report-list"
      /* 가장 위 레이어만 Esc 를 먹는다 — 이 표시가 없으면 목록을 닫는 Esc 가 뒤의 직원
         대화창까지 닫아 보고가 접힌다(2026-09-21 스테이징 실측). */
      data-modal-overlay=""
      className="absolute right-0 top-full z-50 mt-1 w-80 rounded-md border border-border bg-surface p-2 shadow-lg"
    >
      <p className="px-1 pb-1 text-caption font-semibold text-text-secondary">
        {t("report.list.title")}
      </p>
      {items.length === 0 ? (
        <p data-testid="report-list-empty" className="px-1 py-2 text-caption text-text-muted">
          {t("report.list.empty")}
        </p>
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {items.map((item) => {
            const dismissed = dismissedIds.has(item.messageId);
            return (
              <li
                key={item.messageId}
                data-testid="report-list-item"
                data-report-id={item.messageId}
                className="rounded px-1 py-1.5 text-caption hover:bg-surface-raised"
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold text-text">{item.npcName}</span>
                  <span className="text-text-muted">
                    {new Date(item.createdAt).toLocaleTimeString(locale, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {dismissed && (
                    <span className="text-text-muted">· {t("report.list.dismissed")}</span>
                  )}
                </div>
                <p className="truncate text-text-secondary" title={item.cardTitle}>
                  {item.cardTitle}
                </p>
                <div className="mt-1 flex gap-3">
                  <button
                    type="button"
                    data-testid="report-list-open"
                    onClick={() => onOpen(item)}
                    className="font-medium text-npc hover:underline"
                  >
                    {t("report.list.open")}
                  </button>
                  {dismissed && (
                    <button
                      type="button"
                      data-testid="report-list-recall"
                      onClick={() => onRecall(item)}
                      className="font-medium text-text-secondary hover:underline"
                    >
                      {t("report.list.recall")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
