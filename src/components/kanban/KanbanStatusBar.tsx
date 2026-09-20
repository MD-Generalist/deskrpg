"use client";

import { useT } from "@/lib/i18n";
import type { KanbanTaskStatus } from "@/lib/hermes/deskrpg-plugin-types";
import { segmentWidths, type StatusSegment } from "@/lib/kanban-view-state";

/**
 * 묶음 진행률 — 상태 분포 세그먼트 바.
 *
 * 카드 진행률(자식 완료 수)과 **다른 수치**라서 모양도 다르다. 카드 쪽은 한 색 바이고
 * 이쪽은 상태별로 칸이 나뉜다. 셀 카드가 없으면(`counted === 0`) 아무것도 그리지 않는다 —
 * 빈 0% 바는 "아무도 일을 안 했다" 로 읽힌다.
 */
const SEGMENT_CLASS: Record<KanbanTaskStatus, string> = {
  triage: "bg-text-dim",
  todo: "bg-text-muted",
  scheduled: "bg-info",
  ready: "bg-primary-light",
  running: "bg-primary",
  blocked: "bg-danger",
  review: "bg-meeting",
  done: "bg-success",
  // 분모에서 빠지므로 그려질 일이 없지만, 색 표가 상태 집합을 통째로 덮게 둔다.
  archived: "bg-surface-raised",
};

export default function KanbanStatusBar({
  segments,
  counted,
}: {
  segments: readonly StatusSegment[];
  counted: number;
}) {
  const t = useT();
  const widths = segmentWidths(segments, counted);
  if (widths.length === 0) return null;

  const label = widths.map((s) => `${t(`kanban.column.${s.status}`)} ${s.count}`).join(", ");

  return (
    <div
      className="flex h-1.5 w-full max-w-[180px] overflow-hidden rounded-full bg-surface-raised"
      role="img"
      aria-label={label}
      title={label}
    >
      {widths.map((s) => (
        <div
          key={s.status}
          className={SEGMENT_CLASS[s.status]}
          style={{ width: `${s.percent}%` }}
        />
      ))}
    </div>
  );
}
