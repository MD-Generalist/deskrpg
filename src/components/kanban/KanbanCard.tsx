"use client";
import { AlertTriangle, GitBranch, MessageSquare, Play } from "lucide-react";

import { useT } from "@/lib/i18n";
import type { KanbanTask } from "@/lib/hermes/deskrpg-plugin-types";

import {
  assigneeLabel,
  elapsedSeconds,
  formatElapsed,
  isRunning,
  progressLabel,
  warningBadge,
  type BoardNpc,
} from "./kanban-view-model";

interface KanbanCardProps {
  task: KanbanTask;
  npcs: readonly BoardNpc[];
  /** 경과 시간 계산 기준(ms). 보드가 1초마다 올려 준다. */
  now: number;
  selected: boolean;
  onOpen: (taskId: string) => void;
}

const SEVERITY_CLASS: Record<"critical" | "error" | "warning", string> = {
  critical: "bg-danger-bg text-danger",
  error: "bg-danger-bg text-danger",
  warning: "bg-amber-500/15 text-amber-700",
};

/** 카드 요약 한 장 — 제목·담당·우선순위·진행률·경고·실행 중·댓글·링크. 상세는 드로어가. */
export default function KanbanCard({ task, npcs, now, selected, onOpen }: KanbanCardProps) {
  const t = useT();
  const assignee = assigneeLabel(task.assignee, npcs);
  const progress = progressLabel(task);
  const warning = warningBadge(task);
  const running = isRunning(task);
  const elapsed = running ? elapsedSeconds(task, now) : null;
  const linkCount = (task.link_counts?.parents ?? 0) + (task.link_counts?.children ?? 0);
  const commentCount = task.comment_count ?? 0;

  return (
    <button
      type="button"
      data-task-id={task.id}
      onClick={() => onOpen(task.id)}
      className={`w-full text-left rounded-lg border p-2.5 text-xs transition-colors ${
        selected
          ? "border-info bg-info/10"
          : "border-border bg-surface hover:bg-surface-raised hover:border-border"
      }`}
    >
      <div className="font-semibold text-text leading-snug break-words">{task.title}</div>
      <div className="mt-1 text-[11px] text-text-muted truncate">
        {assignee ?? t("kanban.card.unassigned")}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
        {task.priority ? (
          <span className="rounded bg-surface-raised px-1.5 py-0.5 text-text-secondary">
            {t("kanban.card.priority", { value: task.priority })}
          </span>
        ) : null}
        {progress ? (
          <span className="rounded bg-surface-raised px-1.5 py-0.5 text-text-secondary">
            {t("kanban.card.progress", { value: progress })}
          </span>
        ) : null}
        {warning ? (
          <span
            className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 ${SEVERITY_CLASS[warning.severity]}`}
            title={warning.severity}
          >
            <AlertTriangle className="w-3 h-3" />
            {t("kanban.card.warnings", { count: warning.count })}
          </span>
        ) : null}
        {running ? (
          <span className="inline-flex items-center gap-0.5 rounded bg-success/15 px-1.5 py-0.5 text-success">
            <Play className="w-3 h-3" />
            {t("kanban.card.running", { elapsed: formatElapsed(elapsed ?? 0) })}
          </span>
        ) : null}
        {commentCount > 0 ? (
          <span className="inline-flex items-center gap-0.5 text-text-dim">
            <MessageSquare className="w-3 h-3" />
            {commentCount}
          </span>
        ) : null}
        {linkCount > 0 ? (
          <span className="inline-flex items-center gap-0.5 text-text-dim">
            <GitBranch className="w-3 h-3" />
            {linkCount}
          </span>
        ) : null}
      </div>
    </button>
  );
}
