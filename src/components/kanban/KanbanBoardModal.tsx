"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Archive, KanbanSquare, Plus, RefreshCw, Settings, X } from "lucide-react";

import { useT } from "@/lib/i18n";
import type { KanbanTask } from "@/lib/hermes/deskrpg-plugin-types";

import BoardSettingsPanel from "./BoardSettingsPanel";
import KanbanColumn from "./KanbanColumn";
import TaskDrawer from "./TaskDrawer";
import TaskEditorDialog from "./TaskEditorDialog";
import {
  createKanbanApi,
  toFailure,
  type AutomationStatus,
  type BoardResponse,
} from "./kanban-api";
import {
  classifyBoardFailure,
  EMPTY_TASK_FORM,
  failureLine,
  flattenTasks,
  isRunning,
  npcIdForAssignee,
  orderColumns,
  type BoardBlocker,
  type TaskFormValues,
} from "./kanban-view-model";

interface KanbanBoardModalProps {
  channelId: string;
  onClose: () => void;
  /** `kanban:event` 가 올 때마다 1 씩 오른다(GamePageClient 가 소켓을 든다). 디바운스해 재조회. */
  refreshTick?: number;
  /** 사건 → 재조회 디바운스(ms). 기본 `KANBAN_EVENT_DEBOUNCE_MS`. */
  debounceMs?: number;
  /** 열자마자 이 카드의 상세를 편다 — 방 알림의 "카드 열기"(R29). 마운트 시에만 읽는다. */
  initialTaskId?: string | null;
}

/** `kanban:event` 연타를 한 번의 재조회로 접는 간격. */
export const KANBAN_EVENT_DEBOUNCE_MS = 400;

type Editor = { mode: "create" } | { mode: "edit"; task: KanbanTask };

function formFromTask(task: KanbanTask & Record<string, unknown>, npcs: BoardResponse["npcs"]) {
  const str = (key: string) => (typeof task[key] === "string" ? (task[key] as string) : "");
  const num = (key: string) => (typeof task[key] === "number" ? String(task[key]) : "");
  const kind = str("workspace_kind");
  return {
    ...EMPTY_TASK_FORM,
    title: task.title,
    body: task.body ?? "",
    assigneeNpcId: npcIdForAssignee(task.assignee, npcs) ?? "",
    priority: task.priority ?? "",
    workspaceKind: (kind === "scratch" || kind === "worktree" || kind === "dir"
      ? kind
      : "") as TaskFormValues["workspaceKind"],
    workspacePath: str("workspace_path"),
    skills: Array.isArray(task.skills) ? (task.skills as string[]).join(", ") : "",
    modelOverride: str("model_override"),
    providerOverride: str("provider_override"),
    reasoningEffort: str("reasoning_effort"),
    maxRuntimeSeconds: num("max_runtime_seconds"),
    goalMode: task.goal_mode === true,
    goalMaxTurns: num("goal_max_turns"),
  } satisfies TaskFormValues;
}

/**
 * 칸반 보드 모달. 상태(`automation/status`)와 보드를 읽고 고정 순서의 열로 그린다(R6).
 * 조작은 전부 드로어·편집 폼이 서버에 보내고, 성공하면 여기의 `reload` 로 다시 읽는다(R26).
 * 보드를 못 열면(428·409·503) 열 대신 안내를 그린다(R31/R32/E6).
 */
export default function KanbanBoardModal({
  channelId,
  onClose,
  refreshTick = 0,
  debounceMs = KANBAN_EVENT_DEBOUNCE_MS,
  initialTaskId = null,
}: KanbanBoardModalProps) {
  const t = useT();
  const api = useMemo(() => createKanbanApi(channelId), [channelId]);
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [blocker, setBlocker] = useState<BoardBlocker | null>(null);
  const [loading, setLoading] = useState(true);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [boardWarning, setBoardWarning] = useState<string | null>(null);
  const [creationWarnings, setCreationWarnings] = useState<Record<string, string>>({});
  const [detailTick, setDetailTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    let nextStatus: AutomationStatus | null = null;
    try {
      nextStatus = await api.status();
      setStatus(nextStatus);
    } catch (err) {
      const failure = toFailure(err);
      if (failure.code === "gateway_not_bound") {
        setBlocker({ kind: "gateway_not_bound" });
        setBoard(null);
        setLoading(false);
        return;
      }
      // 상태 요약이 없어도 보드는 열 수 있다 — 경고 배지만 비운다.
      setStatus(null);
    }
    try {
      const data = await api.board(includeArchived);
      setBoard(data);
      setBlocker(null);
    } catch (err) {
      setBlocker(classifyBoardFailure(toFailure(err), nextStatus?.minVersion));
    } finally {
      setLoading(false);
    }
  }, [api, includeArchived]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  // `kanban:event` — 디바운스 후 보드·상세 재조회(R26).
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (refreshTick === 0) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      debounce.current = null;
      void reload();
      setDetailTick((n) => n + 1);
    }, debounceMs);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [refreshTick, debounceMs, reload]);

  const columns = useMemo(
    () => orderColumns(board?.columns, includeArchived),
    [board, includeArchived],
  );
  const allTasks = useMemo(() => flattenTasks(columns), [columns]);
  const npcs = useMemo(() => board?.npcs ?? [], [board]);
  const anyRunning = allTasks.some(isRunning);

  // 실행 중 카드가 있을 때만 1초 시계를 돌린다(경과 시간 표시).
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editor && !showSettings) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editor, showSettings]);

  const openEditor = (next: Editor) => {
    setEditorError(null);
    setEditor(next);
  };

  const handleEditorSubmit = async (body: Record<string, unknown>) => {
    if (!editor) return;
    setSubmitting(true);
    setEditorError(null);
    try {
      if (editor.mode === "create") {
        const res = await api.createTask(body);
        if (res.warning) {
          setBoardWarning(res.warning);
          setCreationWarnings((prev) => ({ ...prev, [res.task.id]: res.warning as string }));
        }
        setSelectedTaskId(res.task.id);
      } else {
        await api.updateTask(editor.task.id, body);
        setDetailTick((n) => n + 1);
      }
      setEditor(null);
      await reload();
    } catch (err) {
      // 서버 400 메시지 그대로(R8).
      setEditorError(failureLine(toFailure(err)));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDispatch = async () => {
    setDispatching(true);
    try {
      await api.dispatch();
      await reload();
    } catch (err) {
      setBoardWarning(failureLine(toFailure(err)));
    } finally {
      setDispatching(false);
    }
  };

  const banners: Array<{ key: string; text: string; tone: "warn" | "error" }> = [];
  if (status && status.dispatcherPresent === false) {
    banners.push({ key: "dispatcher", text: t("kanban.warning.noDispatcher"), tone: "warn" });
  }
  if (status?.lastError) {
    banners.push({
      key: "lastError",
      text: t("kanban.warning.lastError", { error: status.lastError }),
      tone: "error",
    });
  }
  if (boardWarning) banners.push({ key: "board", text: boardWarning, tone: "warn" });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="kanban-modal-title"
        className="bg-bg border border-border rounded-xl shadow-2xl w-[96vw] max-w-[1400px] h-[88dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-border flex-shrink-0">
          <h2 id="kanban-modal-title" className="text-sm font-bold flex items-center gap-1.5">
            <KanbanSquare className="w-4 h-4" />
            {t("kanban.title")}
            {status?.pluginVersion && (
              <span className="text-[10px] font-normal text-text-dim">v{status.pluginVersion}</span>
            )}
          </h2>
          <div className="flex items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => openEditor({ mode: "create" })}
              disabled={!board}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary hover:bg-primary-hover text-white font-semibold disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("kanban.newTask")}
            </button>
            <label className="flex items-center gap-1 px-2 py-1 rounded-md bg-surface-raised text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
              <Archive className="w-3.5 h-3.5" />
              {t("kanban.includeArchived")}
            </label>
            <button
              type="button"
              onClick={() => void handleDispatch()}
              disabled={!board || dispatching}
              className="px-2.5 py-1 rounded-md bg-surface-raised text-text-secondary hover:brightness-125 disabled:opacity-50"
            >
              {t("kanban.dispatch")}
            </button>
            <button
              type="button"
              onClick={() => void reload()}
              aria-label={t("kanban.refresh")}
              title={t("kanban.refresh")}
              className="p-1.5 rounded-md bg-surface-raised text-text-secondary hover:brightness-125"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              disabled={!board}
              aria-label={t("kanban.settings.title")}
              title={t("kanban.settings.title")}
              className="p-1.5 rounded-md bg-surface-raised text-text-secondary hover:brightness-125 disabled:opacity-50"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="ml-1 text-text-muted hover:text-text"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Banners (R9·E6) */}
        {banners.length > 0 && (
          <div className="flex flex-col gap-1 px-5 py-2 border-b border-border text-xs">
            {banners.map((banner) => (
              <div
                key={banner.key}
                data-banner={banner.key}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 ${
                  banner.tone === "error"
                    ? "bg-danger-bg text-danger"
                    : "bg-amber-500/10 text-amber-700"
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="break-words">{banner.text}</span>
                {banner.key === "board" && (
                  <button
                    type="button"
                    onClick={() => setBoardWarning(null)}
                    aria-label={t("common.close")}
                    className="ml-auto"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
            {loading && !board && !blocker ? (
              <div className="text-xs text-text-dim">{t("common.loading")}</div>
            ) : blocker ? (
              <Blocker blocker={blocker} onRetry={() => void reload()} />
            ) : (
              <div className="flex h-full gap-3">
                {columns.map((column) => (
                  <KanbanColumn
                    key={column.name}
                    name={column.name}
                    tasks={column.tasks}
                    npcs={npcs}
                    now={now}
                    selectedTaskId={selectedTaskId}
                    onOpen={setSelectedTaskId}
                  />
                ))}
              </div>
            )}
          </div>

          {selectedTaskId && board && !blocker && (
            <TaskDrawer
              key={selectedTaskId}
              api={api}
              taskId={selectedTaskId}
              npcs={npcs}
              boardTasks={allTasks}
              attachmentsSupported={status?.attachments !== false}
              creationWarning={creationWarnings[selectedTaskId] ?? null}
              refreshTick={detailTick}
              onChanged={() => void reload()}
              onEdit={(task) => openEditor({ mode: "edit", task })}
              onDeleted={() => setSelectedTaskId(null)}
              onClose={() => setSelectedTaskId(null)}
            />
          )}
        </div>
      </div>

      {editor && (
        <TaskEditorDialog
          mode={editor.mode}
          initial={
            editor.mode === "edit"
              ? formFromTask(editor.task as KanbanTask & Record<string, unknown>, npcs)
              : EMPTY_TASK_FORM
          }
          npcs={npcs}
          candidates={
            editor.mode === "edit"
              ? allTasks.filter((task) => task.id !== editor.task.id)
              : allTasks
          }
          serverError={editorError}
          submitting={submitting}
          onSubmit={(body) => void handleEditorSubmit(body)}
          onClose={() => setEditor(null)}
        />
      )}

      {showSettings && <BoardSettingsPanel api={api} onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function Blocker({ blocker, onRetry }: { blocker: BoardBlocker; onRetry: () => void }) {
  const t = useT();
  const title =
    blocker.kind === "upgrade_required"
      ? t("kanban.blocker.upgradeTitle")
      : blocker.kind === "gateway_not_bound"
        ? t("kanban.blocker.gatewayTitle")
        : blocker.kind === "board_unavailable"
          ? t("kanban.blocker.boardTitle")
          : t("kanban.blocker.errorTitle");
  return (
    <div
      data-blocker={blocker.kind}
      className="mx-auto mt-8 max-w-[560px] rounded-xl border border-border bg-surface p-5 text-xs"
    >
      <div className="text-sm font-bold text-text mb-2 flex items-center gap-1.5">
        <AlertTriangle className="w-4 h-4 text-amber-600" />
        {title}
      </div>
      {blocker.kind === "upgrade_required" && (
        <>
          <p className="text-text-secondary mb-2">
            {t("kanban.blocker.upgradeBody", { minVersion: blocker.minVersion })}
          </p>
          <pre className="rounded-md bg-bg-deep p-3 text-[11px] whitespace-pre-wrap break-all text-text">
            {blocker.command}
          </pre>
        </>
      )}
      {blocker.kind === "gateway_not_bound" && (
        <p className="text-text-secondary">{t("kanban.blocker.gatewayBody")}</p>
      )}
      {blocker.kind === "board_unavailable" && (
        <p className="text-text-secondary break-words">
          {failureLine({ code: blocker.code, message: blocker.reason })}
        </p>
      )}
      {blocker.kind === "other" && (
        <p className="text-text-secondary break-words">
          {blocker.status ? `${blocker.status} · ` : ""}
          {failureLine(blocker)}
        </p>
      )}
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 px-3 py-1.5 rounded-lg bg-surface-raised text-text-secondary hover:brightness-125"
      >
        {t("common.retry")}
      </button>
    </div>
  );
}
