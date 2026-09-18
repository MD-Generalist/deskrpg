"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Archive, KanbanSquare, Plus, RefreshCw, Settings, X } from "lucide-react";

import { useT } from "@/lib/i18n";
import type { KanbanTask, KanbanTaskStatus } from "@/lib/hermes/deskrpg-plugin-types";

import BoardSettingsPanel from "./BoardSettingsPanel";
import KanbanColumn from "./KanbanColumn";
import SwarmDialog, { type SwarmSubmit } from "./SwarmDialog";
import TaskDrawer, { type TaskDrawerArtifacts } from "./TaskDrawer";
import TaskEditorDialog from "./TaskEditorDialog";
import { restoreKanbanMoveResultFocus, type KanbanMoveEvent } from "./kanban-card-move";
import {
  createKanbanApi,
  toFailure,
  type AutomationStatus,
  type BoardResponse,
} from "./kanban-api";
import {
  activeAssigneeOptions,
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
import { CopyCommand } from "../CopyCommand";

interface KanbanBoardModalProps {
  channelId: string;
  onConnectGateway?: () => void;
  onClose: () => void;
  /** `kanban:event` 가 올 때마다 1 씩 오른다(GamePageClient 가 소켓을 든다). 디바운스해 재조회. */
  refreshTick?: number;
  /** 사건 → 재조회 디바운스(ms). 기본 `KANBAN_EVENT_DEBOUNCE_MS`. */
  debounceMs?: number;
  /** 열자마자 이 카드의 상세를 편다 — 방 알림의 "카드 열기"(R29). 마운트 시에만 읽는다. */
  initialTaskId?: string | null;
  /** 카드 드로어의 결과물 섹션 — 그대로 `TaskDrawer` 에 넘긴다. 없으면 섹션이 없다. */
  artifacts?: TaskDrawerArtifacts | null;
  /** 채널 `artifact:event` 수 — 드로어의 결과물 섹션이 디바운스해 다시 읽는다. */
  artifactsRefreshTick?: number;
  /**
   * 이미 열린 보드에 "이 카드를 펴라" — 결과물의 "출처로 이동". `seq` 가 바뀔 때마다 선택을 옮긴다
   * (`initialTaskId` 는 마운트 때만 읽으므로 열린 보드에는 닿지 않는다).
   */
  focusRequest?: { taskId: string; seq: number } | null;
  /** 다른 모달(결과물)이 보드를 덮고 있다 — Escape 는 위 모달 몫이라 보드는 닫지 않는다. */
  covered?: boolean;
}

/** `kanban:event` 연타를 한 번의 재조회로 접는 간격. */
export const KANBAN_EVENT_DEBOUNCE_MS = 400;

type Editor = { mode: "create" } | { mode: "edit"; task: KanbanTask };
type MoveState =
  | { phase: "idle" }
  | { phase: "active"; taskId: string; source: KanbanTaskStatus; target?: KanbanTaskStatus }
  | { phase: "pending"; taskId: string; title: string; target: KanbanTaskStatus }
  | { phase: "success"; taskId: string; title: string; status?: KanbanTaskStatus }
  | { phase: "unconfirmed"; taskId: string; title: string; target: KanbanTaskStatus }
  | { phase: "error"; taskId: string; title: string; target: KanbanTaskStatus; message: string };
type ReloadResult =
  { kind: "applied"; board: BoardResponse } | { kind: "superseded" } | { kind: "failed" };

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
  onConnectGateway,
  refreshTick = 0,
  debounceMs = KANBAN_EVENT_DEBOUNCE_MS,
  initialTaskId = null,
  artifacts = null,
  artifactsRefreshTick = 0,
  focusRequest = null,
  covered = false,
}: KanbanBoardModalProps) {
  const t = useT();
  const api = useMemo(() => createKanbanApi(channelId), [channelId]);
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [boardChannelId, setBoardChannelId] = useState<string | null>(null);
  const [blocker, setBlocker] = useState<BoardBlocker | null>(null);
  const [loading, setLoading] = useState(true);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [showSwarm, setShowSwarm] = useState(false);
  const [swarmSubmitting, setSwarmSubmitting] = useState(false);
  const [swarmError, setSwarmError] = useState<string | null>(null);
  const [boardWarning, setBoardWarning] = useState<string | null>(null);
  const [creationWarnings, setCreationWarnings] = useState<Record<string, string>>({});
  const [detailTick, setDetailTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [move, setMove] = useState<MoveState>({ phase: "idle" });
  const mounted = useRef(true);
  const reloadSequence = useRef(0);
  const latestReloadRef = useRef<Promise<ReloadResult> | null>(null);
  const moveRequestPending = useRef(false);
  const currentApi = useRef(api);
  const selectedTaskIdRef = useRef(selectedTaskId);
  const boardRootRef = useRef<HTMLDivElement>(null);
  const activeMoveRef = useRef<{
    taskId: string;
    source: KanbanTaskStatus;
    target?: KanbanTaskStatus;
  } | null>(null);
  currentApi.current = api;
  selectedTaskIdRef.current = selectedTaskId;
  const getBoardRoot = useCallback(() => boardRootRef.current, []);

  // 출처로 이동 — 열린 보드에서도 요청된 카드로 드로어를 옮긴다(보드 상태는 그대로 둔다).
  const focusSeq = focusRequest?.seq ?? null;
  const focusTaskId = focusRequest?.taskId ?? null;
  useEffect(() => {
    if (focusSeq !== null && focusTaskId) setSelectedTaskId(focusTaskId);
  }, [focusSeq, focusTaskId]);

  useEffect(() => {
    mounted.current = true;
    setMove({ phase: "idle" });
    activeMoveRef.current = null;
    return () => {
      mounted.current = false;
      moveRequestPending.current = false;
      reloadSequence.current += 1;
    };
  }, [channelId]);

  const reload = useCallback((): Promise<ReloadResult> => {
    const sequence = ++reloadSequence.current;
    const current = () => mounted.current && sequence === reloadSequence.current;
    const operation = (async (): Promise<ReloadResult> => {
      let nextStatus: AutomationStatus | null = null;
      try {
        nextStatus = await api.status();
        if (current()) setStatus(nextStatus);
      } catch (err) {
        const failure = toFailure(err);
        if (failure.code === "gateway_not_bound") {
          if (!current()) return { kind: "superseded" };
          setBlocker({ kind: "gateway_not_bound" });
          setBoard(null);
          setBoardChannelId(null);
          setLoading(false);
          return { kind: "failed" };
        }
        // 상태 요약이 없어도 보드는 열 수 있다 — 경고 배지만 비운다.
        if (current()) setStatus(null);
      }
      try {
        const data = await api.board(includeArchived);
        if (!current()) return { kind: "superseded" };
        setBoard(data);
        setBoardChannelId(channelId);
        setBlocker(null);
        return { kind: "applied", board: data };
      } catch (err) {
        if (!current()) return { kind: "superseded" };
        setBlocker(classifyBoardFailure(toFailure(err), nextStatus?.minVersion));
        return { kind: "failed" };
      } finally {
        if (current()) setLoading(false);
      }
    })();
    latestReloadRef.current = operation;
    return operation;
  }, [api, channelId, includeArchived]);

  const reconcileReload = useCallback(
    async (result: ReloadResult): Promise<ReloadResult> => {
      if (result.kind !== "superseded") return result;
      const latest = latestReloadRef.current;
      const next = latest ? await latest : result;
      return next.kind === "superseded" ? reload() : next;
    },
    [reload],
  );

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

  const currentBoard = boardChannelId === channelId ? board : null;
  const columns = useMemo(
    () => orderColumns(currentBoard?.columns, includeArchived),
    [currentBoard, includeArchived],
  );
  const allTasks = useMemo(() => flattenTasks(columns), [columns]);
  const npcs = useMemo(() => currentBoard?.npcs ?? [], [currentBoard]);
  // 스웜 워커는 출근 중인 NPC 중에서만 고른다 — 서버가 잠든 NPC 를 400 으로 거절한다.
  const npcOptions = useMemo(() => activeAssigneeOptions(npcs), [npcs]);
  // 플러그인이 스웜을 못 하면 버튼을 아예 숨긴다 — 눌렀다가 428 을 보는 것보다 낫다.
  const swarmSupported = status?.capabilities?.includes("swarm") ?? false;
  const anyRunning = allTasks.some(isRunning);
  const movePending = move.phase === "pending";
  const moveBlocked =
    movePending ||
    loading ||
    Boolean(editor) ||
    showSettings ||
    showSwarm ||
    Boolean(blocker) ||
    !currentBoard;

  const handleMoveInteraction = useCallback(
    (event: KanbanMoveEvent) => {
      if (event.type === "start") {
        const task = allTasks.find((candidate) => candidate.id === event.taskId);
        if (moveBlocked || activeMoveRef.current || !task || task.status !== event.source) return;
        activeMoveRef.current = { taskId: event.taskId, source: event.source };
        setMove({ phase: "active", taskId: event.taskId, source: event.source });
        return;
      }
      if (event.type === "target") {
        const active = activeMoveRef.current;
        if (!active || active.taskId !== event.taskId || active.source !== event.source) return;
        active.target = event.target;
        setMove((current) =>
          current.phase === "active" && current.taskId === event.taskId
            ? { ...current, target: event.target }
            : current,
        );
        return;
      }
      if (event.type === "cancel") {
        const active = activeMoveRef.current;
        if (!active || active.taskId !== event.taskId || active.source !== event.source) return;
        activeMoveRef.current = null;
        setMove((current) =>
          current.phase === "active" && current.taskId === event.taskId
            ? { phase: "idle" }
            : current,
        );
        return;
      }
      if (moveBlocked || moveRequestPending.current) return;
      const active = activeMoveRef.current;
      if (
        !active ||
        active.taskId !== event.taskId ||
        active.source !== event.source ||
        active.target !== event.target
      )
        return;
      const task = allTasks.find((candidate) => candidate.id === event.taskId);
      const targetVisible = Array.from(
        boardRootRef.current?.querySelectorAll<HTMLElement>("[data-column]") ?? [],
      ).some(
        (column) =>
          column.dataset.column === event.target &&
          !column.closest("[hidden]") &&
          column.getAttribute("aria-hidden") !== "true",
      );
      if (
        !task ||
        task.status !== event.source ||
        event.source === event.target ||
        !targetVisible
      ) {
        setMove({ phase: "idle" });
        activeMoveRef.current = null;
        return;
      }

      const request = { taskId: task.id, title: task.title, target: event.target };
      activeMoveRef.current = null;
      moveRequestPending.current = true;
      setMove({ phase: "pending", ...request });
      void (async () => {
        try {
          await api.updateTask(task.id, { status: event.target });
        } catch (err) {
          moveRequestPending.current = false;
          if (!mounted.current || currentApi.current !== api) return;
          setMove({ phase: "error", ...request, message: failureLine(toFailure(err)) });
          await reload();
          return;
        }
        if (!mounted.current || currentApi.current !== api) return;
        const reloadResult = await reconcileReload(await reload());
        moveRequestPending.current = false;
        if (!mounted.current || currentApi.current !== api) return;
        if (selectedTaskIdRef.current === task.id) setDetailTick((value) => value + 1);
        if (reloadResult.kind !== "applied") {
          setMove({ phase: "unconfirmed", ...request });
          return;
        }
        const authoritativeBoard = reloadResult.board;
        const authoritativeTask = flattenTasks(
          orderColumns(authoritativeBoard.columns, includeArchived),
        ).find((candidate) => candidate.id === task.id);
        setMove({
          phase: "success",
          taskId: request.taskId,
          title: request.title,
          status: authoritativeTask?.status,
        });
        restoreKanbanMoveResultFocus(boardRootRef.current, task.id);
      })();
    },
    [allTasks, api, includeArchived, moveBlocked, reconcileReload, reload],
  );

  const retryMoveRead = useCallback(async () => {
    if (move.phase !== "unconfirmed") return;
    const request = move;
    const reloadResult = await reconcileReload(await reload());
    if (!mounted.current) return;
    if (reloadResult.kind === "applied") {
      const authoritativeBoard = reloadResult.board;
      if (selectedTaskIdRef.current === request.taskId) setDetailTick((value) => value + 1);
      const authoritativeTask = flattenTasks(
        orderColumns(authoritativeBoard.columns, includeArchived),
      ).find((candidate) => candidate.id === request.taskId);
      setMove({
        phase: "success",
        taskId: request.taskId,
        title: request.title,
        status: authoritativeTask?.status,
      });
      restoreKanbanMoveResultFocus(boardRootRef.current, request.taskId);
    }
  }, [includeArchived, move, reconcileReload, reload]);

  // 실행 중 카드가 있을 때만 1초 시계를 돌린다(경과 시간 표시).
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !covered && !editor && !showSettings && !showSwarm) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, covered, editor, showSettings, showSwarm]);

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

  const handleSwarm = async (values: SwarmSubmit) => {
    setSwarmSubmitting(true);
    setSwarmError(null); // 새 제출은 이전 오류를 지운다.
    try {
      const created = await api.createSwarm(values);
      setShowSwarm(false);
      await reload();
      setSelectedTaskId(created.root_id); // 루트 카드를 연다 — 블랙보드가 거기 있다.
    } catch (err) {
      const failure = toFailure(err);
      // `SwarmDialog` 는 `fixed inset-0` 로 보드 배너 위를 덮으므로, 오류는 다이얼로그
      // 안에서 보여야 사용자가 본다(boardWarning 만으로는 안 보인다).
      const line =
        failure.code === "plugin_upgrade_required"
          ? t("kanban.swarm.unsupported")
          : failureLine(failure);
      setSwarmError(line);
      setBoardWarning(line);
    } finally {
      setSwarmSubmitting(false);
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
              disabled={!currentBoard}
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
            {swarmSupported ? (
              <button
                type="button"
                onClick={() => {
                  setSwarmError(null);
                  setShowSwarm(true);
                }}
                disabled={!currentBoard || npcOptions.length === 0}
                className="px-2.5 py-1 rounded-md bg-surface-raised text-text-secondary hover:brightness-125 disabled:opacity-50"
              >
                {t("kanban.swarm")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void handleDispatch()}
              disabled={!currentBoard || dispatching}
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
              disabled={!currentBoard}
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
        {move.phase === "pending" ||
        move.phase === "success" ||
        move.phase === "unconfirmed" ||
        move.phase === "error" ? (
          <div
            data-move-status={move.phase}
            role={move.phase === "error" ? "alert" : "status"}
            aria-live={move.phase === "error" ? "assertive" : "polite"}
            className="border-b border-border px-5 py-2 text-xs text-text-secondary"
          >
            {move.phase === "pending"
              ? t("kanban.move.pending", {
                  title: move.title,
                  column: t(`kanban.column.${move.target}`),
                })
              : move.phase === "success" && move.status
                ? t("kanban.move.success", {
                    title: move.title,
                    column: t(`kanban.column.${move.status}`),
                  })
                : move.phase === "success"
                  ? t("kanban.move.reconciled", { title: move.title })
                  : move.phase === "unconfirmed"
                    ? t("kanban.move.unconfirmed", { title: move.title })
                    : t("kanban.move.failed", { title: move.title, error: move.message })}
            {move.phase === "unconfirmed" ? (
              <button type="button" className="ml-2 underline" onClick={() => void retryMoveRead()}>
                {t("kanban.move.retryRead")}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-1 overflow-hidden">
          <div
            ref={boardRootRef}
            data-kanban-board-root
            tabIndex={-1}
            className="flex-1 overflow-x-auto overflow-y-hidden p-4"
          >
            {loading && !currentBoard && !blocker ? (
              <div className="text-xs text-text-dim">{t("common.loading")}</div>
            ) : blocker ? (
              <Blocker
                blocker={blocker}
                onRetry={() => void reload()}
                onConnectGateway={onConnectGateway}
              />
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
                    moveDisabled={moveBlocked}
                    activeMoveTaskId={move.phase === "active" ? move.taskId : null}
                    getMoveRoot={getBoardRoot}
                    onMoveInteraction={handleMoveInteraction}
                  />
                ))}
              </div>
            )}
          </div>

          {selectedTaskId && currentBoard && !blocker && (
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
              artifacts={artifacts}
              artifactsRefreshTick={artifactsRefreshTick}
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

      {showSwarm ? (
        <SwarmDialog
          npcs={npcOptions}
          submitting={swarmSubmitting}
          error={swarmError}
          onSubmit={(values) => void handleSwarm(values)}
          onClose={() => setShowSwarm(false)}
        />
      ) : null}
    </div>
  );
}

function Blocker({
  blocker,
  onRetry,
  onConnectGateway,
}: {
  blocker: BoardBlocker;
  onRetry: () => void;
  onConnectGateway?: () => void;
}) {
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
          <CopyCommand command={blocker.command} />
        </>
      )}
      {blocker.kind === "gateway_not_bound" && (
        <p className="text-text-secondary">
          {t(onConnectGateway ? "kanban.blocker.gatewayBody" : "kanban.blocker.gatewayAskOwner")}
        </p>
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
      {(blocker.kind !== "gateway_not_bound" || onConnectGateway) && (
        <button
          type="button"
          onClick={blocker.kind === "gateway_not_bound" ? onConnectGateway : onRetry}
          className="mt-3 px-3 py-1.5 rounded-lg bg-surface-raised text-text-secondary hover:brightness-125"
        >
          {t(
            blocker.kind === "gateway_not_bound" ? "kanban.blocker.connectGateway" : "common.retry",
          )}
        </button>
      )}
    </div>
  );
}
