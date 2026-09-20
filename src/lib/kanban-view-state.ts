/**
 * 프로젝트 뷰의 순수 로직 — React·fetch·DOM 을 모른다.
 *
 * 보드와 목록은 **다른 화면이 아니라 같은 데이터의 다른 표현**이다. 무엇을 거르고, 어떻게 묶고,
 * 어떤 순서로 놓고, 진행률을 어떻게 세는지를 여기 한 곳에 고정한다. 컴포넌트는 결과만 그린다.
 *
 * 상태 집합(`KANBAN_TASK_STATUSES`)을 여기서 정의하지 않고, 카드 상태를 바꾸지도 않는다.
 * 전부 읽기 전용 파생이다.
 */

import {
  KANBAN_TASK_STATUSES,
  type KanbanTask,
  type KanbanTaskStatus,
  type PluginTime,
} from "@/lib/hermes/deskrpg-plugin-types";
import { taskTimeMs } from "@/lib/plugin-time";

// ---------------------------------------------------------------------------
// 뷰 상태
// ---------------------------------------------------------------------------

export type ViewMode = "board" | "list" | "timeline";
export type GroupBy = "none" | "status" | "tenant" | "assignee" | "priority";
export type SortField = "created" | "started" | "priority" | "title" | "status";
export type SortDir = "asc" | "desc";

export type ViewFilter = {
  tenants: string[];
  assignees: string[];
  statuses: KanbanTaskStatus[];
  warningsOnly: boolean;
  /**
   * 보관함 포함 여부. 기존 모달의 토글이 여기로 들어왔다 — 같은 뜻의 스위치가 두 곳에 있으면
   * 어느 쪽이 참인지 알 수 없다. 이 값은 서버 조회(`board(includeArchived)`)에도 쓰인다.
   */
  includeArchived: boolean;
};

export type ProjectViewState = {
  viewMode: ViewMode;
  groupBy: GroupBy;
  sortField: SortField;
  sortDir: SortDir;
  filter: ViewFilter;
  collapsedGroups: string[];
};

export const DEFAULT_VIEW_STATE: ProjectViewState = {
  viewMode: "board",
  groupBy: "status",
  sortField: "created",
  sortDir: "desc",
  filter: {
    tenants: [],
    assignees: [],
    statuses: [],
    warningsOnly: false,
    includeArchived: false,
  },
  collapsedGroups: [],
};

/**
 * `localStorage` 에서 읽은 값을 믿지 않고 접는다. 낡은 스키마·손으로 고친 값·다른 버전이
 * 남긴 값이 들어와도 화면이 깨지지 않아야 한다.
 */
export function normalizeViewState(value: unknown): ProjectViewState {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<ProjectViewState>;
  const rawFilter = (
    raw.filter && typeof raw.filter === "object" ? raw.filter : {}
  ) as Partial<ViewFilter>;
  return {
    viewMode: raw.viewMode === "list" || raw.viewMode === "timeline" ? raw.viewMode : "board",
    groupBy: isGroupBy(raw.groupBy) ? raw.groupBy : DEFAULT_VIEW_STATE.groupBy,
    sortField: isSortField(raw.sortField) ? raw.sortField : DEFAULT_VIEW_STATE.sortField,
    sortDir: raw.sortDir === "asc" ? "asc" : "desc",
    filter: {
      tenants: stringList(rawFilter.tenants),
      assignees: stringList(rawFilter.assignees),
      statuses: stringList(rawFilter.statuses).filter(isTaskStatus),
      warningsOnly: rawFilter.warningsOnly === true,
      includeArchived: rawFilter.includeArchived === true,
    },
    collapsedGroups: stringList(raw.collapsedGroups),
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function isGroupBy(value: unknown): value is GroupBy {
  return (
    value === "none" ||
    value === "status" ||
    value === "tenant" ||
    value === "assignee" ||
    value === "priority"
  );
}

function isSortField(value: unknown): value is SortField {
  return (
    value === "created" ||
    value === "started" ||
    value === "priority" ||
    value === "title" ||
    value === "status"
  );
}

function isTaskStatus(value: string): value is KanbanTaskStatus {
  return (KANBAN_TASK_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// 거르기
// ---------------------------------------------------------------------------

/**
 * 빈 배열은 "전부" 를 뜻한다 — 아무것도 고르지 않은 필터가 카드를 다 지우면 안 된다.
 *
 * `includeArchived` 는 여기서 보지 않는다. 그건 서버 조회 범위이고, 응답에 없는 카드를
 * 한 번 더 거르면 같은 규칙이 두 곳에 생긴다.
 */
export function applyFilter(tasks: readonly KanbanTask[], filter: ViewFilter): KanbanTask[] {
  const tenants = new Set(filter.tenants);
  const assignees = new Set(filter.assignees);
  const statuses = new Set<string>(filter.statuses);
  return tasks.filter((task) => {
    if (tenants.size > 0 && !tenants.has(task.tenant ?? "")) return false;
    if (assignees.size > 0 && !assignees.has(task.assignee ?? "")) return false;
    if (statuses.size > 0 && !statuses.has(task.status)) return false;
    if (filter.warningsOnly && !(task.warnings && task.warnings.count > 0)) return false;
    return true;
  });
}

/** 지금 걸린 필터가 있는가. 없으면 거를 것도 없다 — 빈 필터가 카드를 지우면 안 된다. */
export function hasActiveFilter(filter: ViewFilter): boolean {
  return (
    filter.tenants.length > 0 ||
    filter.assignees.length > 0 ||
    filter.statuses.length > 0 ||
    filter.warningsOnly
  );
}

/**
 * 실행 기록을 **보이는 카드**로 거른다. 필터가 없으면 그대로 돌려준다.
 *
 * 필터가 보드·목록에만 먹고 타임라인에는 안 먹으면, 서브프로젝트를 골라도 타임라인은 그대로다 —
 * 화면이 무언가 했다고 말하면서 아무것도 하지 않는 조용한 실패다(보드 뷰에서 같은 결함을
 * 한 번 겪었다).
 *
 * 필터가 없을 때 거르지 않는 것이 중요하다. 카드가 지워진 실행도 기록에 남는데(플러그인이
 * LEFT JOIN 으로 일부러 남긴다), 보이는 카드로 교집합을 잡으면 그것들이 조용히 사라진다.
 */
export function filterRunsByVisibleTasks<T extends { task_id: string }>(
  runs: readonly T[],
  visibleTaskIds: ReadonlySet<string> | null,
): readonly T[] {
  if (visibleTaskIds === null) return runs;
  return runs.filter((run) => visibleTaskIds.has(run.task_id));
}

// ---------------------------------------------------------------------------
// 정렬
// ---------------------------------------------------------------------------

/** 비어 있는 값은 항상 뒤로 간다 — 방향을 뒤집어도 "모르는 것" 이 맨 앞을 차지하지 않는다. */
function compareTasks(a: KanbanTask, b: KanbanTask, field: SortField): number {
  switch (field) {
    case "created":
      return compareMaybeTime(a.created_at, b.created_at);
    case "started":
      return compareMaybeTime(a.started_at, b.started_at);
    case "priority":
      return comparePriority(a.priority, b.priority);
    case "title":
      return a.title.localeCompare(b.title);
    case "status":
      return statusIndex(a.status) - statusIndex(b.status);
  }
}

function compareMaybeTime(a: PluginTime | undefined, b: PluginTime | undefined): number {
  // 둘 다 값이 있을 때만 불린다 — 없는 값의 자리는 `sortTasks` 가 따로 정한다.
  return (taskTimeMs(a) ?? 0) - (taskTimeMs(b) ?? 0);
}

/**
 * Hermes 의 `priority` 는 숫자인데 플러그인 계약에서는 문자열로 온다. 숫자로 읽히면 숫자로,
 * 아니면 문자열 비교로 떨어뜨린다 — "P1" 같은 값도 순서를 잃지 않는다.
 */
function comparePriority(a: string | undefined, b: string | undefined): number {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return (a ?? "").localeCompare(b ?? "");
}

function statusIndex(status: string): number {
  const i = (KANBAN_TASK_STATUSES as readonly string[]).indexOf(status);
  // 모르는 상태는 맨 뒤로. 버리지는 않는다.
  return i === -1 ? KANBAN_TASK_STATUSES.length : i;
}

/** 이 카드가 정렬 기준 값을 갖고 있는가. 없으면 방향과 무관하게 뒤로 간다. */
function hasSortKey(task: KanbanTask, field: SortField): boolean {
  switch (field) {
    case "created":
      return taskTimeMs(task.created_at) !== null;
    case "started":
      return taskTimeMs(task.started_at) !== null;
    case "priority":
      return task.priority !== undefined && task.priority !== "";
    case "title":
    case "status":
      return true;
  }
}

/**
 * 안정 정렬. 같은 키를 가진 카드의 상대 순서가 재조회마다 바뀌면 행이 이유 없이 튄다.
 *
 * **값이 없는 카드는 방향을 뒤집어도 뒤에 남는다.** 비교 결과 전체에 부호를 곱하면 "없는 것은
 * 뒤로" 규칙까지 같이 뒤집혀, 내림차순에서 날짜 없는 카드가 맨 앞을 차지한다(실측으로 잡힌 결함).
 * 그래서 값이 있는 것과 없는 것을 먼저 가르고, 부호는 값끼리의 비교에만 준다.
 */
export function sortTasks(
  tasks: readonly KanbanTask[],
  field: SortField,
  dir: SortDir,
): KanbanTask[] {
  const sign = dir === "asc" ? 1 : -1;
  const withKey: KanbanTask[] = [];
  const withoutKey: KanbanTask[] = [];
  for (const task of tasks) (hasSortKey(task, field) ? withKey : withoutKey).push(task);
  withKey.sort((a, b) => sign * compareTasks(a, b, field));
  return [...withKey, ...withoutKey];
}

// ---------------------------------------------------------------------------
// 묶기
// ---------------------------------------------------------------------------

export type TaskGroup = {
  /** 안정적인 식별자 — 접힘 상태를 기억하는 키. 표시 이름과 다를 수 있다. */
  key: string;
  /** 서브프로젝트 슬러그 등 원래 값. 표시 이름은 화면이 메타에서 찾아 붙인다. */
  value: string | null;
  tasks: KanbanTask[];
};

/** 값이 없는 카드가 모이는 그룹. 항상 마지막에 온다. */
export const UNSET_GROUP_KEY = "__unset__";

/** 알 수 없는 상태값이 모이는 그룹. 카드를 버리지 않기 위한 자리다. */
export const OTHER_STATUS_GROUP_KEY = "__other_status__";

/**
 * `groupBy` 기준으로 묶는다.
 *
 * - `status` 는 `KANBAN_TASK_STATUSES` 순서를 따르고, 모르는 상태는 "기타" 그룹으로 간다.
 *   **카드를 버리지 않는다** — 화면에서 사라진 카드는 사용자가 찾을 방법이 없다.
 * - `tenant`·`assignee` 는 보드 응답이 준 목록(`known`) 순서를 먼저 쓰고, 그 목록에 없는
 *   값도 그룹으로 만든다. 메타가 없는 테넌트를 숨기면 그 카드들이 통째로 사라진다.
 * - 값이 빈 카드는 `UNSET_GROUP_KEY` 그룹으로 모이고 **항상 마지막**이다.
 * - 빈 그룹은 만들지 않는다(`status` 도 마찬가지 — 빈 열은 보드 뷰의 일이다).
 */
export function groupTasks(
  tasks: readonly KanbanTask[],
  by: GroupBy,
  known: { tenants?: readonly string[]; assignees?: readonly string[] } = {},
): TaskGroup[] {
  if (by === "none") {
    return tasks.length > 0 ? [{ key: "all", value: null, tasks: [...tasks] }] : [];
  }

  const buckets = new Map<string, TaskGroup>();
  const push = (key: string, value: string | null, task: KanbanTask) => {
    const existing = buckets.get(key);
    if (existing) existing.tasks.push(task);
    else buckets.set(key, { key, value, tasks: [task] });
  };

  for (const task of tasks) {
    if (by === "status") {
      const isKnown = isTaskStatus(task.status);
      push(isKnown ? task.status : OTHER_STATUS_GROUP_KEY, isKnown ? task.status : null, task);
      continue;
    }
    const raw = by === "tenant" ? task.tenant : by === "assignee" ? task.assignee : task.priority;
    const value = (raw ?? "").trim();
    push(value === "" ? UNSET_GROUP_KEY : value, value === "" ? null : value, task);
  }

  return orderGroups([...buckets.values()], by, known);
}

function orderGroups(
  groups: TaskGroup[],
  by: GroupBy,
  known: { tenants?: readonly string[]; assignees?: readonly string[] },
): TaskGroup[] {
  const rank = new Map<string, number>();
  if (by === "status") {
    KANBAN_TASK_STATUSES.forEach((name, i) => rank.set(name, i));
  } else if (by === "tenant" || by === "assignee") {
    const list = by === "tenant" ? known.tenants : known.assignees;
    (list ?? []).forEach((name, i) => rank.set(name, i));
  }

  const last = Number.MAX_SAFE_INTEGER;
  const scoreOf = (group: TaskGroup): number => {
    if (group.key === UNSET_GROUP_KEY || group.key === OTHER_STATUS_GROUP_KEY) return last;
    // 응답 목록에 없는 값은 알려진 값들 뒤, 그러나 "없음" 그룹보다는 앞.
    return rank.get(group.key) ?? last - 1;
  };

  return groups.sort((a, b) => {
    const diff = scoreOf(a) - scoreOf(b);
    if (diff !== 0) return diff;
    if (a.key === b.key) return 0;
    // 같은 점수(둘 다 미지의 값)면 이름순 — 재조회마다 순서가 흔들리지 않게.
    return a.key.localeCompare(b.key);
  });
}

// ---------------------------------------------------------------------------
// 진행률 — 두 가지를 섞지 않는다
// ---------------------------------------------------------------------------

/**
 * 카드 진행률 = 그 카드의 **자식 카드** 완료 수. 자식이 없으면 `null` 이고 바를 그리지 않는다.
 * 0/0 을 0% 로 그리면 "시작도 안 한 일" 처럼 보인다 — 실제로는 셀 자식이 없는 것뿐이다.
 */
export function cardProgress(task: KanbanTask): { done: number; total: number } | null {
  const p = task.progress;
  if (!p || p.total <= 0) return null;
  return { done: Math.max(0, Math.min(p.done, p.total)), total: p.total };
}

export type StatusSegment = { status: KanbanTaskStatus; count: number };

/**
 * 묶음 진행률 = 상태 분포 세그먼트. 카드 진행률과 다른 수치이므로 화면에서도 다른 모양이다.
 *
 * **`archived` 는 분모에서 뺀다.** 보관한 일을 미완으로 세면 진행률이 영영 100% 에 닿지 않는다.
 * 모르는 상태도 세지 않는다(상태를 발명하지 않는다) — 대신 `counted` 로 몇 장을 셌는지 밝힌다.
 */
export function statusSegments(tasks: readonly KanbanTask[]): {
  segments: StatusSegment[];
  counted: number;
} {
  const counts = new Map<KanbanTaskStatus, number>();
  let counted = 0;
  for (const task of tasks) {
    if (task.status === "archived") continue;
    if (!isTaskStatus(task.status)) continue;
    counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
    counted += 1;
  }
  const segments = KANBAN_TASK_STATUSES.filter((s) => s !== "archived")
    .map((status) => ({ status, count: counts.get(status) ?? 0 }))
    .filter((segment) => segment.count > 0);
  return { segments, counted };
}

/** 세그먼트 바의 폭(%). `counted` 가 0이면 빈 배열 — 0% 바를 그리지 않는다. */
export function segmentWidths(
  segments: readonly StatusSegment[],
  counted: number,
): Array<StatusSegment & { percent: number }> {
  if (counted <= 0) return [];
  return segments.map((segment) => ({ ...segment, percent: (segment.count / counted) * 100 }));
}

// ---------------------------------------------------------------------------
// 하위 트리 (D1(a) — 펼친 카드만 상세를 부른다)
// ---------------------------------------------------------------------------

/** 카드에 직계 자식이 있는가. 전체 자손 수가 아니다 — 보드 응답은 직계 수만 준다. */
export function directChildCount(task: KanbanTask): number {
  return Math.max(0, task.link_counts?.children ?? 0);
}

/**
 * 부모가 **지금 보이는 목록에 없는** 카드를 루트로 올린다.
 *
 * `include_archived=false` 로 부모가 걸러졌을 때 자식이 트리 어디에도 안 붙어 사라지는 것을
 * 막는다. 화면에서 조용히 없어진 카드는 사용자가 찾을 방법이 없다.
 */
export function promoteOrphans(
  tasks: readonly KanbanTask[],
  parentOf: ReadonlyMap<string, string | undefined>,
): { roots: KanbanTask[]; childrenOf: Map<string, KanbanTask[]> } {
  const present = new Set(tasks.map((t) => t.id));
  const roots: KanbanTask[] = [];
  const childrenOf = new Map<string, KanbanTask[]>();
  for (const task of tasks) {
    const parent = parentOf.get(task.id);
    if (parent && present.has(parent)) {
      const siblings = childrenOf.get(parent) ?? [];
      siblings.push(task);
      childrenOf.set(parent, siblings);
    } else {
      roots.push(task);
    }
  }
  return { roots, childrenOf };
}

/**
 * 부모가 아직 안 끝나서 이 카드가 못 움직이는 상태인가.
 *
 * Hermes 는 부모가 전부 done/archived 일 때만 `todo`→`ready` 로 올리고, 그전에는 claim 을
 * `parents_not_done` 으로 거절한다. 그래서 상태가 `todo` 인데 아무도 집지 않는 카드가 생기는데,
 * 화면이 이유를 말하지 않으면 멈춘 것처럼 보인다.
 */
export function isWaitingOnParents(
  task: KanbanTask,
  parents: readonly KanbanTask[] | undefined,
): boolean {
  if (task.status !== "todo") return false;
  if (!parents || parents.length === 0) return false;
  return parents.some((p) => p.status !== "done" && p.status !== "archived");
}
