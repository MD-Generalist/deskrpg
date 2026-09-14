/**
 * `deskrpg-hermes-plugin` 자동화 계약(v0.6.0+)의 와이어 타입.
 *
 * 플러그인 스펙 A.1(오너 키 스코프 — 칸반·이벤트)과 A.2(프로필 키 스코프 — 크론)의
 * JSON 모양을 **그대로** 옮긴 것이다. 여기서는 해석하지 않는다 — 카드 상태 전이 규칙,
 * 담당자 권한, 커서 의미 같은 판단은 전부 서버(DeskRPG)나 플러그인 쪽 몫이고, 이 파일은
 * 응답을 타입으로만 고정한다.
 *
 * 브라우저·서버 양쪽에서 import 된다. **타입만** 둔다 — 값(런타임 코드)을 넣지 않는다.
 * 유일한 예외는 `KANBAN_TASK_STATUSES`/`CRON_JOB_STATES` 같은 리터럴 배열인데, 그것도
 * Node 전용 모듈을 끌어오지 않는 순수 상수다.
 */

// ---------------------------------------------------------------------------
// 공통 — /deskrpg/info
// ---------------------------------------------------------------------------

/**
 * `GET /deskrpg/info` 의 본문. `capabilities` 에 kanban·cron·events 가 있어야 자동화가 켜진다.
 *
 * `timezone` 이 `null` 일 수 있는 것은 0.6.0 이전 플러그인이 그 필드를 주지 않기 때문이다 —
 * 파서(`parsePluginInfo`)가 구버전 본문도 이 모양으로 접어 캐시에 남긴다.
 */
export type PluginInfo = {
  plugin: "deskrpg";
  version: string;
  capabilities: string[];
  timezone: string | null;
  kanban: { dispatcher_present: boolean; attachments: boolean };
};

// ---------------------------------------------------------------------------
// A.1 칸반 — 보드·카드
// ---------------------------------------------------------------------------

export const KANBAN_TASK_STATUSES = [
  "triage",
  "todo",
  "scheduled",
  "ready",
  "running",
  "blocked",
  "review",
  "done",
  "archived",
] as const;

export type KanbanTaskStatus = (typeof KANBAN_TASK_STATUSES)[number];

export type BoardMeta = {
  slug: string;
  name?: string;
  description?: string;
  is_current?: boolean;
  total?: number;
  default_workdir?: string;
  default_workspace_kind?: string;
  project_id?: string;
  project_name?: string;
};

export type DiagnosticAction = {
  kind: string;
  label: string;
  payload?: Record<string, unknown>;
  suggested?: boolean;
};

export type Diagnostic = {
  kind: string;
  severity: "critical" | "error" | "warning";
  title: string;
  detail: string;
  actions: DiagnosticAction[];
  count: number;
  last_seen_at: string;
  data: Record<string, unknown>;
};

/** 보드 열에 실리는 카드 요약. */
export type KanbanTask = {
  id: string;
  title: string;
  body?: string;
  status: KanbanTaskStatus;
  assignee?: string;
  priority?: string;
  tenant?: string;
  created_at?: string;
  latest_summary?: string;
  comment_count?: number;
  link_counts?: { parents: number; children: number };
  progress?: { done: number; total: number };
  warnings?: { count: number; highest_severity?: string };
  started_at?: string;
  worker_pid?: number;
  last_heartbeat_at?: string;
};

/** 카드 상세(`GET /kanban/tasks/{id}`)에서만 오는 필드까지 포함한 전체 모양. */
export type KanbanTaskFull = KanbanTask & {
  result?: string;
  created_by?: string;
  model_override?: string;
  provider_override?: string;
  reasoning_effort?: string;
  completed_at?: string;
  last_failure_error?: string;
  workspace_kind?: string;
  workspace_path?: string;
  branch_name?: string;
  consecutive_failures?: number;
  diagnostics?: Diagnostic[];
};

export type KanbanRun = {
  id: string;
  profile?: string;
  status: string;
  outcome?: string;
  summary?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  worker_pid?: number;
  started_at?: string;
  ended_at?: string;
};

export type KanbanComment = {
  id: string;
  author: string;
  body: string;
  created_at: string;
};

/** 카드 상세에 실리는 카드별 이력. 통합 이벤트 스트림(`Event`)과는 다른 모양이다. */
export type KanbanEvent = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type KanbanAttachment = {
  id: string;
  filename: string;
  size?: number;
};

export type KanbanColumn = {
  name: string;
  tasks: KanbanTask[];
};

export type KanbanBoard = {
  columns: KanbanColumn[];
  tenants: string[];
  assignees: string[];
  latest_event_id: string | null;
  now: string;
};

export type KanbanTaskDetail = {
  task: KanbanTaskFull;
  comments: KanbanComment[];
  events: KanbanEvent[];
  /** 플러그인에 첨부 기능이 없으면(`info.kanban.attachments === false`) null */
  attachments: KanbanAttachment[] | null;
  links: { parents: string[]; children: string[] };
  runs: KanbanRun[];
};

export type WorkspaceKind = "scratch" | "worktree" | "dir";

export type CreateTaskBody = {
  title: string;
  body?: string;
  assignee?: string;
  tenant?: string;
  priority?: string;
  workspace_kind?: WorkspaceKind;
  workspace_path?: string;
  parents?: string[];
  triage?: boolean;
  idempotency_key?: string;
  max_runtime_seconds?: number;
  skills?: string[];
  goal_mode?: boolean;
  goal_max_turns?: number;
  model_override?: string;
  provider_override?: string;
  reasoning_effort?: string;
  project_id?: string;
};

/** `PATCH /kanban/tasks/{id}` — 부분 갱신. */
export type UpdateTaskBody = Partial<Omit<CreateTaskBody, "idempotency_key">> & {
  status?: KanbanTaskStatus;
};

export type CreateBoardBody = {
  slug: string;
  name: string;
  default_workdir?: string;
};

export type UpdateBoardBody = {
  name?: string;
  description?: string;
  default_workdir?: string;
};

/** `POST /kanban/tasks/{id}/{action}` 의 액션 이름 집합. */
export const KANBAN_TASK_ACTIONS = [
  "reassign",
  "reclaim",
  "specify",
  "decompose",
  "estimate",
  "approve",
  "request-changes",
  "unblock",
  "terminate",
  "archive",
] as const;

export type KanbanTaskAction = (typeof KANBAN_TASK_ACTIONS)[number];

export type OrchestrationSettings = {
  orchestrator_profile: string | null;
  default_assignee: string | null;
  auto_decompose: boolean;
  resolved_orchestrator_profile: string | null;
  resolved_default_assignee: string | null;
  max_in_progress?: number;
  max_in_progress_per_profile?: number;
};

export type UpdateOrchestrationBody = {
  orchestrator_profile?: string | null;
  default_assignee?: string | null;
  auto_decompose?: boolean;
  max_in_progress?: number;
  max_in_progress_per_profile?: number;
};

export type WorkerLog = {
  exists: boolean;
  size_bytes: number;
  content: string;
  truncated: boolean;
};

export type KanbanProfileSummary = {
  name: string;
  is_default: boolean;
  description: string;
};

export type DispatchResult = {
  spawned: Array<{ task_id: string; profile?: string; run_id?: string }>;
};

// ---------------------------------------------------------------------------
// A.1 통합 이벤트 — /deskrpg/events
// ---------------------------------------------------------------------------

export const PLUGIN_EVENT_KINDS = [
  "task.created",
  "task.status",
  "task.comment",
  "task.run.started",
  "task.run.finished",
  "task.deleted",
  "task.link",
  "task.updated",
  "cron.run.started",
  "cron.run.finished",
] as const;

export type PluginEventKind = (typeof PLUGIN_EVENT_KINDS)[number];

/** 제목·설명·우선순위·담당·첨부 변경 — 바뀐 필드 이름 목록. 화면은 보드 재조회로 반영한다. */
export type TaskUpdatedEventPayload = { fields: string[] };

export type TaskStatusEventPayload = {
  from: KanbanTaskStatus | null;
  to: KanbanTaskStatus;
  parent_count: number;
  title: string;
  assignee: string | null;
};

export type CronRunStartedPayload = {
  job_id: string;
  job_name: string;
  profile: string;
  session_id: string;
  started_at: string;
};

export type CronRunFinishedPayload = CronRunStartedPayload & {
  status: "ok" | "error";
  ended_at: string;
  result_text: string;
};

export type PluginEvent = {
  id: string;
  /** epoch 밀리초 */
  ts: number;
  kind: PluginEventKind;
  board?: string;
  task_id?: string;
  profile?: string;
  job_id?: string;
  run_id?: string;
  payload: Record<string, unknown>;
};

export type EventsPage = {
  events: PluginEvent[];
  cursor: string;
  has_more: boolean;
};

// ---------------------------------------------------------------------------
// A.2 크론 — /p/{profile}/deskrpg/cron
// ---------------------------------------------------------------------------

export const CRON_JOB_STATES = [
  "scheduled",
  "paused",
  "running",
  "error",
  "completed",
  "disabled",
] as const;

export type CronJobState = (typeof CRON_JOB_STATES)[number];

export type CronSchedule = {
  kind: string;
  expr?: string;
  minutes?: number;
  run_at?: string;
  display?: string;
};

export type CronJob = {
  id: string;
  name: string;
  prompt: string;
  schedule: CronSchedule;
  schedule_display: string;
  repeat: boolean;
  enabled: boolean;
  state: CronJobState;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  deliver: string | null;
  skills: string[];
  model: string | null;
  provider: string | null;
  created_at: string;
};

export type CronRun = {
  id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  summary: string;
  result_text: string;
};

export type CreateCronJobBody = {
  schedule: string;
  /** 스크립트 전용 잡이 아니면 필수. 서버 라우트가 `script` 부재 시에만 요구한다. */
  prompt?: string;
  /** 스크립트 전용 잡 — Hermes 가 프롬프트 대신 실행한다. 그대로 전달한다. */
  script?: string;
  name: string;
  deliver?: string;
  model?: string;
  provider?: string;
  skills?: string[];
  paused?: boolean;
  repeat?: boolean;
};

export type UpdateCronJobBody = {
  updates: {
    schedule?: string;
    prompt?: string;
    name?: string;
    deliver?: string;
    model?: string | null;
    provider?: string | null;
    enabled?: boolean;
  };
};

export type CronDeliveryTarget = {
  id: string;
  name: string;
  home_target_set: boolean;
  home_env_var: string;
};

export type BlueprintField = {
  name: string;
  type: "enum" | "text" | "time" | "weekdays";
  label: string;
  default?: string;
  options?: string[];
  optional?: boolean;
  strict?: boolean;
  help?: string;
};

export type AutomationBlueprint = {
  key: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  fields: BlueprintField[];
  command: string;
  appUrl: string;
};

export type InstantiateBlueprintBody = {
  blueprint: string;
  values: Record<string, string>;
};
