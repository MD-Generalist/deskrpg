"use client";

import { useEffect, useRef, useState } from "react";

import type { ReportItem } from "@/game/report-queue";
import { useT } from "@/lib/i18n";

import ReportList from "./ReportList";

/**
 * 헤더의 보고 배지. 누르면 남은 보고 목록이 열린다(단테 결정 2026-09-21 "목록 + 자동 재후보").
 * 목록을 연 채 마지막 보고를 확인해도 빈 목록 상태로 남아 사용자가 결과를 본다.
 */
export default function ReportBadge({
  queue,
  current,
  dismissedIds,
  onOpen,
  onRecall,
}: {
  queue: readonly ReportItem[];
  /** 지금 전하러 오는 보고. 없으면 맨 앞 보고가 제목이 된다. */
  current: ReportItem | null;
  dismissedIds: ReadonlySet<string>;
  onOpen: (item: ReportItem) => void;
  onRecall: (item: ReportItem) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 가장 위 레이어인 이 목록이 Esc 를 **소비**한다. 실제 브라우저에서는 목록이 DOM 에서
      // 사라진 뒤에 대화창 리스너가 돌아, 레이어 표시만으로는 대화창이 함께 닫혔다(실측).
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (queue.length === 0 && !open) return null;
  const title = (current ?? queue[0])?.cardTitle;
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid="report-badge"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 rounded-md border border-border bg-danger-bg px-2.5 py-1 text-caption font-semibold text-danger hover:bg-surface-raised"
        title={title}
      >
        <span className="h-2 w-2 rounded-full bg-danger" />
        <span className="header-full-label">
          {t("notice.pendingReports", { count: queue.length })}
        </span>
        <span className="header-mobile-label" aria-hidden="true">
          {queue.length}
        </span>
      </button>
      {open && (
        <ReportList items={queue} dismissedIds={dismissedIds} onOpen={onOpen} onRecall={onRecall} />
      )}
    </div>
  );
}
