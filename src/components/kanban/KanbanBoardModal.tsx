"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, KanbanSquare, Plus, RefreshCw, Settings, X } from "lucide-react";

import { useT } from "@/lib/i18n";
import { ProjectPicker, useSelectedBoard, type ProjectOption } from "./ProjectPicker";
import type {
  KanbanRunsPage,
  KanbanTask,
  KanbanTaskStatus,
} from "@/lib/hermes/deskrpg-plugin-types";
import GateChecklistModal from "@/components/gateway/GateChecklistModal";
import { classifyGateFailure, isSetupBlocker, type GateBlocker } from "@/lib/gate-failure";

import BoardSettingsPanel from "./BoardSettingsPanel";
import KanbanColumn from "./KanbanColumn";
import KanbanListView from "./KanbanListView";
import KanbanMetricsPanel from "./KanbanMetricsPanel";
import KanbanTimeline from "./KanbanTimeline";
import KanbanViewToolbar from "./KanbanViewToolbar";
import SwarmDialog, { type SwarmSubmit } from "./SwarmDialog";
import TaskDrawer, { type TaskDrawerArtifacts } from "./TaskDrawer";
import TaskEditorDialog from "./TaskEditorDialog";
import { restoreKanbanMoveResultFocus, type KanbanMoveEvent } from "./kanban-card-move";
import { applyFilter, filterRunsByVisibleTasks, hasActiveFilter } from "@/lib/kanban-view-state";
import { useProjectViewState, useTaskGroups } from "./use-project-view-state";
import { presetWindow, type WindowPreset } from "@/lib/timeline-layout";
import { computeOperationalMetrics } from "@/lib/kanban-metrics";
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
  /** 대화에서 가져온 초안. 확인 전에는 서버에 등록하지 않는다. */
  initialCreateDraft?: Pick<TaskFormValues, "title" | "body" | "assigneeNpcId">;
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

type Editor =
  | { mode: "create"; draft?: Pick<TaskFormValues, "title" | "body" | "assigneeNpcId"> }
  | { mode: "edit"; task: KanbanTask };
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
    reviewMode:
      task.review &&
      !task.started_at &&
      !task.review.submission &&
      ["todo", "ready", "blocked", "triage"].includes(task.status)
        ? task.review.policy.mode
        : undefined,
    reviewerNpcId: npcIdForAssignee(task.review?.policy.reviewer_profile, npcs) ?? "",
    reviewRevision: task.review?.policy_revision,
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
  initialCreateDraft,
  artifacts = null,
  artifactsRefreshTick = 0,
  focusRequest = null,
  covered = false,
}: KanbanBoardModalProps) {
  const t = useT();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const { selected: selectedBoard, select: selectBoard } = useSelectedBoard(channelId, projects);
  // 보드가 바뀌면 api 가 새로 만들어지고, 아래 로딩 효과가 그 보드로 다시 읽는다.
  const api = useMemo(
    () => createKanbanApi(channelId, undefined, selectedBoard ?? undefined),
    [channelId, selectedBoard],
  );
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [boardChannelId, setBoardChannelId] = useState<string | null>(null);
  const [blocker, setBlocker] = useState<BoardBlocker | null>(null);
  const [checklist, setChecklist] = useState<GateBlocker | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId);
  const [editor, setEditor] = useState<Editor | null>(
    initialCreateDraft ? { mode: "create", draft: initialCreateDraft } : null,
  );
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
  const {
    state: viewState,
    update: updateView,
    setFilter: setViewFilter,
    toggleGroup: toggleViewGroup,
  } = useProjectViewState(channelId);
  const includeArchived = viewState.filter.includeArchived;
  /**
   * 묶음 조회가 되는가. capability 가 정본이다 — 버전으로 판단하면 "새 플러그인인데 404" 를
   * 진단할 수 없다(`plugin-capability.ts` 의 스웜 게이트와 같은 이유).
   */
  const viewsSupported = status?.capabilities?.includes("kanban_views") ?? false;
  const [expandedTasks, setExpandedTasks] = useState<ReadonlySet<string>>(() => new Set());
  const [loadingChildren, setLoadingChildren] = useState<ReadonlySet<string>>(() => new Set());
  /** 펼친 카드의 링크. id 만 담는다 — 카드 본문은 언제나 보드 응답이 정본이다. */
  const [links, setLinks] = useState<
    ReadonlyMap<string, { parents: string[]; children: string[] }>
  >(() => new Map());
  const [timelinePreset, setTimelinePreset] = useState<WindowPreset>("today");
  const [runsPage, setRunsPage] = useState<KanbanRunsPage | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [boardLinks, setBoardLinks] = useState<readonly { parent_id: string; child_id: string }[]>(
    [],
  );
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

  // 서버 정본이 화면에 반영된 뒤 새 카드 DOM으로 포커스를 옮긴다.
  useEffect(() => {
    if (move.phase === "success") {
      restoreKanbanMoveResultFocus(boardRootRef.current, move.taskId);
    }
  }, [move]);

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

  // 프로젝트 목록은 채널에만 달렸다 — `api` 에 매달면 보드를 고를 때마다 다시 읽고,
  // 그 결과가 다시 선택을 건드려 되돌이가 된다. 실패해도 조용히 넘긴다: 보드가 하나뿐인
  // 채널에서는 선택기가 어차피 그려지지 않고, 목록이 없다고 칸반을 막을 이유는 없다.
  useEffect(() => {
    let alive = true;
    const listApi = createKanbanApi(channelId);
    void listApi
      .projects()
      .then((data) => {
        // 모양이 예상과 다르면 빈 목록으로 본다 — 선택기 하나 때문에 칸반이 멈추면 안 된다.
        if (alive) setProjects(Array.isArray(data?.projects) ? data.projects : []);
      })
      .catch(() => {
        if (alive) setProjects([]);
      });
    return () => {
      alive = false;
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
  const listGroups = useTaskGroups(allTasks, viewState, {
    tenants: currentBoard?.tenants,
    assignees: currentBoard?.assignees,
  });

  /**
   * 보드 열에 **목록과 같은 필터**를 먹인다.
   *
   * 필터가 목록에만 걸리면 같은 보드의 두 표현이 서로 다른 카드 수를 보인다. 서브프로젝트를
   * 골랐는데 보드는 그대로인 것은 조용한 실패다 — 화면은 "필터 1개" 라고 말하면서 아무것도
   * 하지 않는다.
   *
   * 열 자체는 아홉 개 그대로 두고 카드만 뺀다. 빈 열을 없애면 상태 집합이 필터에 따라
   * 달라지는데, 열을 발명하지도 없애지도 않는 것이 이 화면의 규칙이다.
   */
  const visibleColumns = useMemo(
    () =>
      columns.map((column) => ({ ...column, tasks: applyFilter(column.tasks, viewState.filter) })),
    [columns, viewState.filter],
  );

  /**
   * 트리를 한 단 펼친다 — 펼친 카드만 상세를 부른다(설계 D1(a)).
   *
   * 보드 응답은 링크를 주지 않고 `link_counts` 만 준다. 전체 트리를 미리 받으려면 카드 수만큼
   * 호출해야 하므로, 사용자가 실제로 연 가지만 불러온다. 받은 링크는 id 로만 들고 있고 카드
   * 본문은 보드 응답에서 찾는다 — 사본을 두면 재조회 뒤 낡은 제목이 남는다.
   */
  const toggleExpand = useCallback(
    (taskId: string) => {
      setExpandedTasks((prev) => {
        const next = new Set(prev);
        if (next.has(taskId)) {
          next.delete(taskId);
          return next;
        }
        next.add(taskId);
        return next;
      });
      if (links.has(taskId)) return;
      setLoadingChildren((prev) => new Set(prev).add(taskId));
      void api
        .taskDetail(taskId)
        .then((detail) => {
          setLinks((prev) => new Map(prev).set(taskId, detail.links));
        })
        .catch(() => {
          // 링크를 못 받으면 가지가 비어 보인다. 카드 본문은 이미 목록에 있으므로 화면을
          // 막지 않고, 다음 펼침에서 다시 시도된다(캐시에 넣지 않았다).
        })
        .finally(() => {
          setLoadingChildren((prev) => {
            const next = new Set(prev);
            next.delete(taskId);
            return next;
          });
        });
    },
    [api, links],
  );

  /**
   * 타임라인 창. **매 렌더마다 `Date.now()` 를 다시 읽지 않는다** — 그러면 막대가 미세하게
   * 계속 흔들리고 `useMemo` 도 매번 깨진다. 뷰를 열거나 기간을 바꿀 때만 다시 잡는다.
   */
  const timelineWindow = useMemo(
    () => presetWindow(timelinePreset, Date.now()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 창을 고정하려면 열 때의 시각만 쓴다.
    [timelinePreset, viewState.viewMode],
  );

  useEffect(() => {
    if (viewState.viewMode !== "timeline" || !viewsSupported || blocker) return;
    let alive = true;
    setRunsLoading(true);
    setRunsError(null);
    void api
      .runs({
        from: Math.floor(timelineWindow.fromMs / 1000),
        to: Math.ceil(timelineWindow.toMs / 1000),
      })
      .then((page) => {
        if (alive) setRunsPage(page);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        // 실패를 빈 타임라인으로 덮지 않는다 — "일한 적 없음" 과 "물어볼 수 없음" 은 다르다.
        setRunsPage(null);
        setRunsError(toFailure(err).message);
      })
      .finally(() => {
        if (alive) setRunsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [api, blocker, timelineWindow, viewState.viewMode, viewsSupported, detailTick]);

  /**
   * 타임라인과 지표가 보는 실행 기록. 필터가 걸려 있으면 **보이는 카드의 것만** 남긴다 —
   * 필터가 보드·목록에만 먹고 타임라인에는 안 먹으면 조용한 실패가 된다(보드에서 한 번 겪었다).
   *
   * 필터가 없으면 거르지 않는다. 카드가 지워진 실행도 기록에 남는데(플러그인이 일부러 남긴다),
   * 교집합을 잡으면 그것들이 사라진다.
   */
  const visibleRuns = useMemo(() => {
    const runs = runsPage?.runs ?? [];
    if (!hasActiveFilter(viewState.filter)) return runs;
    const ids = new Set(applyFilter(allTasks, viewState.filter).map((task) => task.id));
    return filterRunsByVisibleTasks(runs, ids);
  }, [runsPage, allTasks, viewState.filter]);

  /**
   * 운영 지표. 타임라인과 **같은 실행 기록·같은 창**에서 계산한다 — 두 화면이 다른 수를
   * 말하면 둘 다 신뢰를 잃는다.
   *
   * 승인 대기 카드 집합은 아직 비어 있다. 승인 관문(dev2)이 붙으면 그 집합을 넘긴다. 그때까지
   * `blocked` 는 전부 오류 차단으로 읽히는데, 그게 안전한 쪽으로 틀리는 선택이다 — 승인을
   * 두 번 요구하는 것보다 낫다.
   */
  /**
   * 이 보드가 속한 프로젝트의 목표일. `boardSlug` 로 맞춘다 — 채널에 보드가 여러 개일 수 있고,
   * 프로젝트 하나가 보드 하나를 갖는다.
   *
   * 지금은 프로젝트를 만드는 화면이 없어 **값이 없는 것이 기본**이다. 그때 타임라인은 세로선을
   * 그리지 않고 "목표일 미정" 만 쓴다 — 없는 기한을 그려 넣지 않는다.
   */
  const targetDate = useMemo(() => {
    const slug = status?.boardSlug;
    if (!slug) return null;
    return projects.find((project) => project.boardSlug === slug)?.targetDate ?? null;
  }, [projects, status?.boardSlug]);

  const metrics = useMemo(
    () =>
      computeOperationalMetrics(
        visibleRuns,
        allTasks,
        PENDING_APPROVALS_UNAVAILABLE,
        timelineWindow,
      ),
    [visibleRuns, allTasks, timelineWindow],
  );

  useEffect(() => {
    if (viewState.viewMode !== "timeline" || !viewsSupported || blocker) return;
    let alive = true;
    void api
      .links()
      .then((page) => {
        if (alive) setBoardLinks(page.links);
      })
      .catch(() => {
        // 링크를 못 받으면 화살표만 없다. 막대는 그대로 그려지므로 화면을 막지 않는다.
        if (alive) setBoardLinks([]);
      });
    return () => {
      alive = false;
    };
  }, [api, blocker, viewState.viewMode, viewsSupported, detailTick]);

  const byId = useMemo(() => new Map(allTasks.map((task) => [task.id, task])), [allTasks]);
  const childrenOf = useMemo(() => resolveLinks(links, byId, "children"), [links, byId]);
  const parentsOf = useMemo(() => resolveLinks(links, byId, "parents"), [links, byId]);
  const npcs = useMemo(() => currentBoard?.npcs ?? [], [currentBoard]);
  // 스웜 워커는 출근 중인 NPC 중에서만 고른다 — 서버가 잠든 NPC 를 400 으로 거절한다.
  const npcOptions = useMemo(() => activeAssigneeOptions(npcs), [npcs]);
  // 플러그인이 스웜을 못 하면 버튼을 아예 숨긴다 — 눌렀다가 428 을 보는 것보다 낫다.
  const reviewSupported = status?.capabilities?.includes("kanban_review_policy_v1") ?? false;
  const swarmSupported = false; // 정책을 보장하는 native 스웜 생성 계약이 아직 없다.
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
            <ProjectPicker options={projects} selected={selectedBoard} onSelect={selectBoard} />
            <button
              type="button"
              onClick={() => openEditor({ mode: "create" })}
              disabled={!currentBoard || !reviewSupported}
              title={!reviewSupported ? t("kanban.review.unsupported") : undefined}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary hover:bg-primary-hover text-white font-semibold disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("kanban.newTask")}
            </button>
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
        {!blocker && (
          <KanbanViewToolbar
            state={viewState}
            tenants={currentBoard?.tenants ?? []}
            assignees={currentBoard?.assignees ?? []}
            onUpdate={updateView}
            onFilter={setViewFilter}
            timelineSupported={viewsSupported}
          />
        )}
        <div className="flex flex-1 overflow-hidden">
          <div
            ref={boardRootRef}
            data-kanban-board-root
            tabIndex={-1}
            className={
              viewState.viewMode === "list"
                ? "flex flex-1 flex-col overflow-hidden"
                : "flex-1 overflow-x-auto overflow-y-hidden p-4"
            }
          >
            {loading && !currentBoard && !blocker ? (
              <div className="text-xs text-text-dim">{t("common.loading")}</div>
            ) : blocker ? (
              <Blocker
                blocker={blocker}
                onRetry={() => void reload()}
                onConnectGateway={onConnectGateway}
                onOpenChecklist={() => setChecklist(gateBlockerFromBoard(blocker))}
              />
            ) : viewState.viewMode === "timeline" ? (
              <>
                <KanbanTimeline
                  runs={visibleRuns}
                  window={timelineWindow}
                  preset={timelinePreset}
                  onPresetChange={setTimelinePreset}
                  now={now}
                  truncated={runsPage?.truncated ?? false}
                  loading={runsLoading}
                  error={runsError}
                  onOpenTask={setSelectedTaskId}
                  header={<KanbanMetricsPanel metrics={metrics} />}
                  targetDate={targetDate}
                  links={boardLinks}
                />
              </>
            ) : viewState.viewMode === "list" ? (
              <KanbanListView
                groups={listGroups}
                groupBy={viewState.groupBy}
                npcs={npcs}
                now={now}
                selectedTaskId={selectedTaskId}
                collapsedGroups={viewState.collapsedGroups}
                onToggleGroup={toggleViewGroup}
                onOpen={setSelectedTaskId}
                childrenOf={childrenOf}
                parentsOf={parentsOf}
                expanded={expandedTasks}
                loadingChildren={loadingChildren}
                onToggleExpand={toggleExpand}
              />
            ) : (
              <div className="flex h-full gap-3">
                {visibleColumns.map((column) => (
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

      {currentBoard && !reviewSupported && (
        <p role="status" className="px-5 py-2 text-xs text-amber-700">
          {t("kanban.review.unsupported")}
        </p>
      )}
      {editor && currentBoard && !blocker && (
        <TaskEditorDialog
          mode={editor.mode}
          reviewSupported={reviewSupported}
          assigneeLocked={
            editor.mode === "edit" && !!editor.task.review && !!editor.task.started_at
          }
          confirmChatDraft={editor.mode === "create" && !!editor.draft}
          initial={
            editor.mode === "edit"
              ? formFromTask(editor.task as KanbanTask & Record<string, unknown>, npcs)
              : {
                  ...EMPTY_TASK_FORM,
                  ...editor.draft,
                  assigneeNpcId: npcs.some(
                    (npc) => npc.active && npc.npcId === editor.draft?.assigneeNpcId,
                  )
                    ? editor.draft!.assigneeNpcId
                    : "",
                }
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

      <GateChecklistModal blocker={checklist} onClose={() => setChecklist(null)} />
    </div>
  );
}

/** 보드 배너가 들고 있는 실패를 체크리스트가 아는 모양으로 옮긴다. 판정을 다시 하지 않는다 — */
/** `board_unavailable` 이 들고 있던 code·message 를 `classifyGateFailure` 로 되돌릴 뿐이다. */
/**
 * 링크 id 를 보드 응답의 카드로 바꾼다.
 *
 * 지금 보이지 않는 카드(보관함을 접었을 때의 부모·자식)는 결과에서 빠진다 — 없는 카드를
 * 그리려고 지어내지 않는다. 그렇게 부모를 잃은 자식은 목록에서 루트로 남는다.
 */
function resolveLinks(
  links: ReadonlyMap<string, { parents: string[]; children: string[] }>,
  byId: ReadonlyMap<string, KanbanTask>,
  side: "parents" | "children",
): Map<string, KanbanTask[]> {
  const out = new Map<string, KanbanTask[]>();
  for (const [taskId, link] of links) {
    const resolved = link[side]
      .map((id) => byId.get(id))
      .filter((task): task is KanbanTask => task !== undefined);
    if (resolved.length > 0) out.set(taskId, resolved);
  }
  return out;
}

/**
 * 승인 관문이 붙기 전의 빈 집합. dev2 의 `approval_targets` 조회가 자리 잡으면 그 결과로
 * 바꾼다. 비어 있는 동안 `blocked` 는 오류 차단으로 읽힌다 — 같은 결정을 두 번 묻지 않는 쪽이다.
 */
const PENDING_APPROVALS_UNAVAILABLE: ReadonlySet<string> = new Set();

function gateBlockerFromBoard(blocker: BoardBlocker): GateBlocker | null {
  if (blocker.kind === "gateway_not_bound") return { kind: "gateway_not_bound" };
  if (blocker.kind === "upgrade_required") {
    return {
      kind: "plugin_upgrade_required",
      minVersion: blocker.minVersion,
      command: blocker.command,
    };
  }
  if (blocker.kind === "board_unavailable") {
    return classifyGateFailure({ status: 503, code: blocker.code, message: blocker.reason });
  }
  return classifyGateFailure({
    status: blocker.status,
    code: blocker.code,
    message: blocker.message,
  });
}

function Blocker({
  blocker,
  onRetry,
  onConnectGateway,
  onOpenChecklist,
}: {
  blocker: BoardBlocker;
  onRetry: () => void;
  onConnectGateway?: () => void;
  onOpenChecklist: () => void;
}) {
  const t = useT();
  const gateBlocker = gateBlockerFromBoard(blocker);
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
        <AlertTriangle className="w-4 h-4 text-npc-dark" />
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
        <>
          <button
            type="button"
            onClick={blocker.kind === "gateway_not_bound" ? onConnectGateway : onRetry}
            className="mt-3 px-3 py-1.5 rounded-lg bg-surface-raised text-text-secondary hover:brightness-125"
          >
            {t(
              blocker.kind === "gateway_not_bound"
                ? "kanban.blocker.connectGateway"
                : "common.retry",
            )}
          </button>
          {gateBlocker && isSetupBlocker(gateBlocker) && (
            <button type="button" onClick={onOpenChecklist} className="ml-2 underline">
              {t("gateChecklist.whatIsNeeded")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
