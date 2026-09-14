"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import TaskCard from "./TaskCard";
import type { Task } from "./TaskCard";
import TaskCreateForm from "./TaskCreateForm";
import NpcAssignModal from "./NpcAssignModal";
import DroppableColumn from "./DroppableColumn";
import DraggableTaskCard from "./DraggableTaskCard";
import { useT } from "@/lib/i18n";
import {
  ClipboardList,
  X,
  Clock,
  Loader,
  CheckCircle,
  PauseCircle,
  Inbox,
  FileText,
} from "lucide-react";
import type { Socket } from "socket.io-client";

interface NpcInfo {
  id: string;
  name: string;
  active: boolean;
}

interface TaskBoardProps {
  channelId: string;
  isOpen: boolean;
  onClose: () => void;
  onDeleteTask?: (taskId: string) => void;
  onRequestReportTask?: (taskId: string) => void;
  onResumeTask?: (taskId: string) => void;
  onCompleteTask?: (taskId: string) => void;
  tasks: Task[];
  socket: Socket | null;
  npcs?: NpcInfo[];
}

const COLUMNS = [
  {
    status: "backlog",
    labelKey: "task.backlog",
    colorClass: "text-text-muted",
    bgClass: "bg-text-muted/20",
    Icon: Inbox,
  },
  {
    status: "pending",
    labelKey: "task.pending",
    colorClass: "text-npc",
    bgClass: "bg-npc/20",
    Icon: Clock,
  },
  {
    status: "in_progress",
    labelKey: "task.inProgress",
    colorClass: "text-danger",
    bgClass: "bg-danger/20",
    Icon: Loader,
  },
  {
    status: "stalled",
    labelKey: "task.stalled",
    colorClass: "text-warning",
    bgClass: "bg-warning/20",
    Icon: PauseCircle,
  },
  {
    status: "done",
    labelKey: "task.done",
    colorClass: "text-success",
    bgClass: "bg-success/20",
    Icon: CheckCircle,
  },
] as const;

export default function TaskBoard({
  channelId,
  isOpen,
  onClose,
  tasks: incomingTasks,
  onDeleteTask,
  onRequestReportTask,
  onResumeTask,
  onCompleteTask,
  socket,
  npcs = [],
}: TaskBoardProps) {
  const t = useT();
  // Mutation events carry the assignment ID; profile roster names remain canonical.
  const tasks = useMemo(() => {
    const names = new Map(npcs.map((npc) => [npc.id, npc.name]));
    return incomingTasks.map((task) => ({
      ...task,
      npcName: task.npcId ? (names.get(task.npcId) ?? task.npcName) : undefined,
    }));
  }, [incomingTasks, npcs]);
  const [filterNpc, setFilterNpc] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [assignModal, setAssignModal] = useState<{
    taskId: string;
    taskTitle: string;
    toStatus: string;
  } | null>(null);
  const [reportModal, setReportModal] = useState<{
    task: Task;
    message: string | null;
    loading: boolean;
  } | null>(null);

  const cardElements = useRef(new Map<string, HTMLDivElement>());
  const pendingReveal = useRef<{ id: string; from: string; until: number } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      pendingReveal.current = null;
      return;
    }
    const pending = pendingReveal.current;
    if (!pending) return;
    const task = tasks.find((item) => item.id === pending.id);
    if (!task || Date.now() > pending.until) {
      pendingReveal.current = null;
      return;
    }
    // Reveal only after authoritative task props move, never on the outgoing request.
    if (task.status !== pending.from) {
      pendingReveal.current = null;
      cardElements.current.get(task.id)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }, [tasks, isOpen]);

  const npcList = useMemo(() => {
    const map = new Map<string, string>();
    tasks.forEach((task) => {
      if (task.npcId && task.npcName && !map.has(task.npcId)) {
        map.set(task.npcId, task.npcName);
      }
    });
    return Array.from(map.entries());
  }, [tasks]);

  const filtered = filterNpc ? tasks.filter((t) => t.npcId === filterNpc) : tasks;

  const groupedTasks = useMemo(
    () => ({
      backlog: filtered.filter((t) => t.status === "backlog"),
      pending: filtered.filter((t) => t.status === "pending"),
      in_progress: filtered.filter((t) => t.status === "in_progress"),
      stalled: filtered.filter((t) => t.status === "stalled"),
      done: filtered.filter((t) => t.status === "complete" || t.status === "cancelled"),
    }),
    [filtered],
  );

  const npcOptions = useMemo(() => {
    return npcs.map((npc) => ({
      id: npc.id,
      name: npc.name,
      inProgressCount: tasks.filter((t) => t.npcId === npc.id && t.status === "in_progress").length,
      pendingCount: tasks.filter((t) => t.npcId === npc.id && t.status === "pending").length,
      // Roster activity is authoritative; Hermes profiles have no legacy agentId.
      isActive: npc.active,
    }));
  }, [npcs, tasks]);

  const handleCreateTask = useCallback(
    (title: string, summary: string) => {
      if (!socket) return;
      socket.emit("task:create", { channelId, title, summary: summary || undefined });
      setShowCreateForm(false);
    },
    [socket, channelId],
  );

  const handleDrop = useCallback(
    (taskId: string, fromStatus: string, toStatus: string) => {
      if (!socket) return;

      const actualToStatus = toStatus === "done" ? "complete" : toStatus;
      const actualFromStatus = fromStatus === "done" ? "complete" : fromStatus;
      if (actualFromStatus === actualToStatus) return;

      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      const needsNpc =
        !task.npcId && actualToStatus !== "backlog" && actualToStatus !== "cancelled";
      if (needsNpc) {
        setAssignModal({ taskId, taskTitle: task.title, toStatus: actualToStatus });
        return;
      }

      pendingReveal.current = { id: taskId, from: task.status, until: Date.now() + 10000 };
      socket.emit("task:move", { taskId, toStatus: actualToStatus });
    },
    [socket, tasks],
  );

  const handleAssignFromModal = useCallback(
    (npcId: string) => {
      if (!socket || !assignModal) return;
      const task = tasks.find((item) => item.id === assignModal.taskId);
      if (task)
        pendingReveal.current = { id: task.id, from: task.status, until: Date.now() + 10000 };
      socket.emit("task:move", {
        taskId: assignModal.taskId,
        toStatus: assignModal.toStatus,
        npcId,
      });
      setAssignModal(null);
    },
    [socket, assignModal, tasks],
  );

  const handleAssignClick = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      setAssignModal({ taskId, taskTitle: task.title, toStatus: "in_progress" });
    },
    [tasks],
  );

  const handleTaskClick = useCallback(
    (taskId: string) => {
      if (!socket) return;
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      setReportModal({ task, message: null, loading: true });
      socket.emit("task:get-report", { taskId });
    },
    [socket, tasks],
  );

  useEffect(() => {
    if (!socket) return;
    const handler = ({ taskId, message }: { taskId: string; message: string | null }) => {
      setReportModal((prev) => {
        if (!prev || prev.task.id !== taskId) return prev;
        return { ...prev, message, loading: false };
      });
    };
    socket.on("task:report", handler);
    return () => {
      socket.off("task:report", handler);
    };
  }, [socket]);

  if (!isOpen) return null;

  return (
    <div
      className="theme-game fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised rounded-xl border border-border w-[95vw] max-w-[1100px] h-[80dvh] min-h-0 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex shrink-0 justify-between items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            <span className="text-title text-text flex items-center gap-1.5">
              <ClipboardList className="w-4 h-4" />
              {t("task.board")}
            </span>
            <div className="flex min-w-0 max-w-full gap-1 overflow-x-auto [&>button]:shrink-0">
              <button
                onClick={() => setFilterNpc(null)}
                className={`px-2 py-0.5 rounded text-[12px] ${
                  !filterNpc ? "bg-primary text-white" : "bg-surface text-text-muted"
                }`}
              >
                {t("common.all")}
              </button>
              {npcList.map(([id, name]) => (
                <button
                  key={id}
                  onClick={() => setFilterNpc(id)}
                  className={`px-2 py-0.5 rounded text-[12px] ${
                    filterNpc === id ? "bg-primary text-white" : "bg-surface text-text-muted"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="shrink-0 text-text-muted hover:text-text"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Kanban Columns */}
        <div className="flex-1 min-h-0 flex gap-2 p-3 overflow-x-auto">
          {COLUMNS.map((col) => {
            const colTasks = groupedTasks[col.status as keyof typeof groupedTasks] || [];
            return (
              <DroppableColumn
                key={col.status}
                status={col.status}
                className="min-w-[240px] !flex-none w-[80vw] sm:w-auto sm:!flex-1 sm:min-w-[190px]"
                onDrop={handleDrop}
                header={
                  <div
                    className={`text-[13px] ${col.colorClass} font-bold mb-2 flex justify-between`}
                  >
                    <span className="flex items-center gap-1">
                      <col.Icon className="w-3.5 h-3.5" />
                      {t(col.labelKey)}
                    </span>
                    <span className={`${col.bgClass} px-1.5 rounded`}>{colTasks.length}</span>
                  </div>
                }
              >
                {col.status === "backlog" &&
                  (showCreateForm ? (
                    <TaskCreateForm
                      onSubmit={handleCreateTask}
                      onCancel={() => setShowCreateForm(false)}
                    />
                  ) : (
                    <button
                      onClick={() => setShowCreateForm(true)}
                      className="w-full border border-dashed border-primary/50 rounded-lg py-2 text-[13px] text-primary hover:border-primary hover:bg-primary/5 transition mb-1"
                    >
                      + {t("task.createNew")}
                    </button>
                  ))}
                {colTasks.map((task) => (
                  <div
                    key={task.id}
                    ref={(element) => {
                      if (element) cardElements.current.set(task.id, element);
                      else cardElements.current.delete(task.id);
                    }}
                  >
                    <DraggableTaskCard taskId={task.id} status={col.status}>
                      <TaskCard
                        task={task}
                        showNpcName
                        compact
                        onDelete={onDeleteTask}
                        onRequestReport={onRequestReportTask}
                        onResume={onResumeTask}
                        onComplete={onCompleteTask}
                        onAssign={handleAssignClick}
                        onClick={handleTaskClick}
                      />
                    </DraggableTaskCard>
                    <select
                      aria-label={t("task.moveStatus", { title: task.title })}
                      value=""
                      disabled={!socket}
                      onChange={(event) => {
                        if (event.target.value)
                          handleDrop(task.id, task.status, event.target.value);
                      }}
                      className="mt-1 min-h-10 w-full rounded border border-border bg-surface px-2 text-[12px] text-text"
                    >
                      <option value="" disabled>
                        {t("task.changeStatus")}
                      </option>
                      {COLUMNS.filter((target) => target.status !== col.status).map((target) => (
                        <option key={target.status} value={target.status}>
                          {t(target.labelKey)}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </DroppableColumn>
            );
          })}
        </div>

        {/* Drag hint */}
        <div className="px-4 py-2 text-center text-[12px] text-text-dim border-t border-border">
          {t("task.dragHint")}
        </div>
      </div>

      {/* NPC Assign Modal */}
      {assignModal && (
        <NpcAssignModal
          taskTitle={assignModal.taskTitle}
          npcs={npcOptions}
          onAssign={handleAssignFromModal}
          onCancel={() => setAssignModal(null)}
        />
      )}

      {/* Task Report Modal */}
      {reportModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onClick={() => setReportModal(null)}
        >
          <div
            className="bg-surface-raised rounded-xl border border-border w-[90vw] max-w-[500px] max-h-[60vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-border flex shrink-0 justify-between items-start gap-2">
              <span className="text-text font-bold text-[13px] flex items-center gap-1.5">
                <FileText className="w-4 h-4" />
                {t("task.reportDetail")}
              </span>
              <button
                onClick={() => setReportModal(null)}
                className="text-text-muted hover:text-text"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-4 py-3 border-b border-border">
              <div className="text-text font-bold text-[13px] mb-1">{reportModal.task.title}</div>
              {reportModal.task.summary && (
                <div className="text-text-muted text-[12px]">{reportModal.task.summary}</div>
              )}
              {reportModal.task.npcName && (
                <div className="text-npc text-[11px] mt-1">NPC: {reportModal.task.npcName}</div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {reportModal.loading ? (
                <div className="text-text-muted text-[12px] text-center py-4">
                  {t("task.reportLoading")}
                </div>
              ) : reportModal.message ? (
                <div className="text-text text-[12px] whitespace-pre-wrap leading-relaxed">
                  {reportModal.message}
                </div>
              ) : (
                <div className="text-text-dim text-[12px] text-center py-4">
                  {t("task.noReport")}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
