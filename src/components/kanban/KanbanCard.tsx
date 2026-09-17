"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, GitBranch, GripVertical, MessageSquare, Play } from "lucide-react";

import { useT } from "@/lib/i18n";
import type { KanbanTask, KanbanTaskStatus } from "@/lib/hermes/deskrpg-plugin-types";

import {
  assigneeLabel,
  elapsedSeconds,
  formatElapsed,
  isRunning,
  progressLabel,
  warningBadge,
  type BoardNpc,
} from "./kanban-view-model";
import {
  clearMoveTargets,
  autoScrollKanbanBoard,
  columnStatus,
  markMoveTarget,
  visibleKanbanColumns,
  type KanbanMoveCancelReason,
  type KanbanMoveInteractionHandler,
} from "./kanban-card-move";

interface KanbanCardProps {
  task: KanbanTask;
  npcs: readonly BoardNpc[];
  /** 경과 시간 계산 기준(ms). 보드가 1초마다 올려 준다. */
  now: number;
  selected: boolean;
  onOpen: (taskId: string) => void;
  moveDisabled?: boolean;
  onMoveInteraction?: KanbanMoveInteractionHandler;
}

const SEVERITY_CLASS: Record<"critical" | "error" | "warning", string> = {
  critical: "bg-danger-bg text-danger",
  error: "bg-danger-bg text-danger",
  warning: "bg-amber-500/15 text-amber-700",
};

/** 카드 요약 한 장 — 제목·담당·우선순위·진행률·경고·실행 중·댓글·링크. 상세는 드로어가. */
export default function KanbanCard({
  task,
  npcs,
  now,
  selected,
  onOpen,
  moveDisabled = false,
  onMoveInteraction,
}: KanbanCardProps) {
  const t = useT();
  const assignee = assigneeLabel(task.assignee, npcs);
  const progress = progressLabel(task);
  const warning = warningBadge(task);
  const running = isRunning(task);
  const elapsed = running ? elapsedSeconds(task, now) : null;
  const linkCount = (task.link_counts?.parents ?? 0) + (task.link_counts?.children ?? 0);
  const commentCount = task.comment_count ?? 0;
  const handleRef = useRef<HTMLButtonElement>(null);
  const movingRef = useRef(false);
  const targetRef = useRef<KanbanTaskStatus | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [isMoving, setIsMoving] = useState(false);
  const pointerRef = useRef<{ id: number; x: number; y: number } | null>(null);

  const announce = useCallback(
    (key: string, values?: Record<string, string>) => {
      setAnnouncement(t(key, values));
    },
    [t],
  );

  const finish = useCallback((restoreFocus = true) => {
    movingRef.current = false;
    setIsMoving(false);
    pointerRef.current = null;
    targetRef.current = null;
    clearMoveTargets();
    if (restoreFocus) requestAnimationFrame(() => handleRef.current?.focus());
  }, []);

  const cancel = useCallback(
    (reason: KanbanMoveCancelReason) => {
      if (!movingRef.current) return;
      onMoveInteraction?.({ type: "cancel", taskId: task.id, source: task.status, reason });
      announce("kanban.move.cancelled");
      finish(reason !== "focus-loss");
    },
    [announce, finish, onMoveInteraction, task.id, task.status],
  );

  const start = useCallback(() => {
    if (moveDisabled || movingRef.current) return;
    movingRef.current = true;
    setIsMoving(true);
    targetRef.current = null;
    onMoveInteraction?.({ type: "start", taskId: task.id, source: task.status });
    announce("kanban.move.started", { title: task.title });
  }, [announce, moveDisabled, onMoveInteraction, task.id, task.status, task.title]);

  const selectTarget = useCallback(
    (column: HTMLElement) => {
      const target = columnStatus(column);
      if (!target || target === task.status) return;
      targetRef.current = target;
      markMoveTarget(column);
      onMoveInteraction?.({ type: "target", taskId: task.id, source: task.status, target });
      announce("kanban.move.target", { column: t(`kanban.column.${target}`) });
    },
    [announce, onMoveInteraction, t, task.id, task.status],
  );

  useEffect(
    () => () => {
      if (movingRef.current) {
        onMoveInteraction?.({
          type: "cancel",
          taskId: task.id,
          source: task.status,
          reason: "teardown",
        });
        clearMoveTargets();
      }
    },
    [onMoveInteraction, task.id, task.status],
  );

  useEffect(() => {
    if (!isMoving) return;
    const onBlur = () => cancel("focus-loss");
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [cancel, isMoving]);

  const columnAtPoint = (clientX: number, clientY: number) => {
    const hit = document.elementFromPoint(clientX, clientY);
    const column = hit?.closest<HTMLElement>("[data-column]") ?? null;
    return column && visibleKanbanColumns().includes(column) ? column : null;
  };

  const onMovePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (moveDisabled || event.button !== 0) return;
    pointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onMovePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    if (!movingRef.current && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < 6)
      return;
    if (!movingRef.current) start();
    event.preventDefault();
    autoScrollKanbanBoard(event.currentTarget, event.clientX);
    const column = columnAtPoint(event.clientX, event.clientY);
    if (column?.dataset.column === task.status) {
      targetRef.current = null;
      markMoveTarget(null);
    } else if (column) {
      selectTarget(column);
    } else {
      targetRef.current = null;
      markMoveTarget(null);
    }
  };

  const onMovePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    pointerRef.current = null;
    if (!movingRef.current) return;
    const column = columnAtPoint(event.clientX, event.clientY);
    const target = columnStatus(column ?? document.createElement("div"));
    if (!column || !target) return cancel("outside");
    if (target === task.status) return cancel("same-column");
    if (targetRef.current !== target) selectTarget(column);
    onMoveInteraction?.({ type: "submit", taskId: task.id, source: task.status, target });
    announce("kanban.move.requested", { column: t(`kanban.column.${target}`) });
    finish();
  };

  const onMovePointerCancel = () => {
    pointerRef.current = null;
    cancel("pointer-cancel");
  };

  const onMoveKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (moveDisabled) return;
    if (!movingRef.current) {
      if (event.key === " ") {
        event.preventDefault();
        start();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel("escape");
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const columns = visibleKanbanColumns();
      const currentStatus = targetRef.current ?? task.status;
      const index = columns.findIndex((column) => column.dataset.column === currentStatus);
      const next = columns[index + (event.key === "ArrowRight" ? 1 : -1)];
      if (next?.dataset.column === task.status) {
        targetRef.current = null;
        markMoveTarget(null);
        announce("kanban.move.target", { column: t(`kanban.column.${task.status}`) });
      } else if (next) {
        selectTarget(next);
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = targetRef.current;
      if (!target || !visibleKanbanColumns().some((column) => column.dataset.column === target)) {
        cancel("target-missing");
        return;
      }
      onMoveInteraction?.({ type: "submit", taskId: task.id, source: task.status, target });
      announce("kanban.move.requested", { column: t(`kanban.column.${target}`) });
      finish();
    }
  };

  return (
    <article
      data-task-id={task.id}
      className={`relative w-full rounded-lg border text-xs transition-colors ${
        selected
          ? "border-info bg-info/10"
          : "border-border bg-surface hover:bg-surface-raised hover:border-border"
      }`}
    >
      <button
        type="button"
        data-card-detail={task.id}
        onClick={() => onOpen(task.id)}
        className="w-full p-2.5 pr-9 text-left"
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
      <button
        ref={handleRef}
        type="button"
        data-card-move-handle={task.id}
        disabled={moveDisabled}
        aria-label={t("kanban.move.handle", { title: task.title })}
        aria-describedby={`kanban-move-help-${task.id}`}
        aria-pressed={isMoving}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onMoveKeyDown}
        onBlur={(event) => {
          if (movingRef.current && event.relatedTarget !== event.currentTarget)
            cancel("focus-loss");
        }}
        onPointerDown={onMovePointerDown}
        onPointerMove={onMovePointerMove}
        onPointerUp={onMovePointerUp}
        onPointerCancel={onMovePointerCancel}
        className="absolute right-1.5 top-1.5 rounded p-1 text-text-dim hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-info disabled:opacity-40 touch-none"
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      <span id={`kanban-move-help-${task.id}`} className="sr-only">
        {t("kanban.move.instructions")}
      </span>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </article>
  );
}
