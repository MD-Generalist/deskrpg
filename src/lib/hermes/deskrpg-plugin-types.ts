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
  /**
   * 0.7.1 — Hermes 대시보드 공개 주소. 대시보드가 꺼졌거나 주소가 없으면 null.
   * 파서가 http(s) 만 남긴다. 구버전 플러그인·기존 캐시에는 키가 없어 선택으로 둔다.
   */
  dashboard_url?: string | null;
  /**
   * 0.12.0 — 칸반 워커·크론에서 플러그인이 안 뜨는 직원(`worker-plugin.ts`). 옛 플러그인에는
   * 키가 없고(undefined), 판정 실패면 null 이다. 둘을 섞지 않는다.
   */
  worker_plugin?: WorkerPluginReport | null;
};

/** 한 직원의 워커 플러그인 상태. `link`: linked · missing · other. */
export type WorkerPluginGap = {
  profile: string;
  link: string;
  enabled: boolean;
  /** 운영자가 `plugins.disabled` 로 끈 직원 — 적용해도 켜지지 않는다. */
  disabled: boolean;
};

export type WorkerPluginReport = { missing: WorkerPluginGap[] };

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

/**
 * 플러그인이 보내는 시각. **epoch 초(정수)가 정본**이고(플러그인 `docs/contracts.md`), 가짜
 * 플러그인 서버는 ISO 문자열을 보낸다. 읽을 때는 `taskTimeMs()` 를 쓴다 — `Date.parse` 를
 * 직접 부르면 정수에서 NaN 이 나와 시각이 조용히 사라진다.
 */
export type PluginTime = string | number;

/** 보드 열에 실리는 카드 요약. */
export type KanbanReviewPolicy = {
  version: 1;
  mode: "human" | "agent";
  reviewer_profile: string | null;
};

export type KanbanReviewState = {
  policy: KanbanReviewPolicy;
  policy_revision: number;
  submission: null | {
    id: string;
    run_id: string | number | null;
    hash: string;
    policy_revision: number;
  };
  review_round: number;
  state: "awaiting_submission" | "submitted" | "reviewing" | "human_required" | "approved";
  reason: string | null;
  approval: null | {
    actor_kind: "human" | "agent";
    actor_id: string;
    actor_name?: string;
    submission_id: string;
    policy_revision: number;
    hash: string;
    approved_at: number;
    request_id: string | null;
  };
};

export type KanbanTask = {
  review?: KanbanReviewState | null;
  id: string;
  title: string;
  body?: string;
  status: KanbanTaskStatus;
  assignee?: string;
  priority?: string;
  tenant?: string;
  created_at?: PluginTime;
  latest_summary?: string;
  comment_count?: number;
  link_counts?: { parents: number; children: number };
  progress?: { done: number; total: number };
  warnings?: { count: number; highest_severity?: string };
  started_at?: PluginTime;
  worker_pid?: number;
  last_heartbeat_at?: PluginTime;
};

/** 카드 상세(`GET /kanban/tasks/{id}`)에서만 오는 필드까지 포함한 전체 모양. */
export type KanbanTaskFull = KanbanTask & {
  result?: string;
  created_by?: string;
  model_override?: string;
  provider_override?: string;
  reasoning_effort?: string;
  completed_at?: PluginTime;
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
  started_at?: PluginTime;
  ended_at?: PluginTime;
};

export type KanbanComment = {
  id: string;
  author: string;
  body: string;
  created_at: PluginTime;
};

/** 카드 상세에 실리는 카드별 이력. 통합 이벤트 스트림(`Event`)과는 다른 모양이다. */
export type KanbanEvent = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  created_at: PluginTime;
};

export type KanbanAttachment = {
  id: string;
  filename: string;
  size?: number;
};

/**
 * 보드 전체 첨부 목록의 한 건(`GET /deskrpg/kanban/attachments`, capability `kanban_attachment_list`).
 * 카드 하나의 첨부와 같은 모양에 **어느 카드의 것인지** 를 더했다. 카드가 지워졌으면
 * `task_title` 이 null 일 수 있다(플러그인 계약).
 */
export type KanbanBoardAttachment = KanbanAttachment & {
  content_type?: string | null;
  created_at?: number | null;
  task_id: string;
  task_title: string | null;
};
export type KanbanBoardAttachmentsPage = {
  attachments: KanbanBoardAttachment[];
  next_cursor: string | null;
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
  now: PluginTime;
};

/**
 * 타임라인용 실행 기록(`GET /kanban/runs`, capability `kanban_views`).
 *
 * 카드별 `runs[]`(`KanbanRun`)보다 넓다 — 어느 카드·어느 서브프로젝트·어느 보드의 실적인지가
 * 응답만 보고 가려져야 카드 목록과 다시 조인하지 않는다. 카드가 지워진 실행도 남으므로
 * `tenant`·`task_title` 은 없을 수 있다(일한 사실이 없어지지는 않는다).
 */
export type KanbanTimelineRun = KanbanRun & {
  task_id: string;
  board: string;
  task_title?: string;
  tenant?: string;
  step_key?: string;
};

/** `GET /kanban/runs` 의 본문. `window` 는 epoch 초. */
export type KanbanRunsPage = {
  runs: KanbanTimelineRun[];
  board: string;
  window: { from: number; to: number };
  /**
   * 상한에 걸려 **최근 것만** 남았는가. 화면은 이걸 반드시 보여야 한다 — 잘린 창을 그대로
   * 그리면 "그 시간대에 아무도 일하지 않았다" 로 읽힌다.
   */
  truncated: boolean;
};

/** `GET /kanban/links` 의 본문. 쌍만 온다 — 카드 본문의 정본은 보드 응답이다. */
export type KanbanLinksPage = {
  links: Array<{ parent_id: string; child_id: string }>;
  board: string;
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
  review_policy?: KanbanReviewPolicy;
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
  /**
   * 생성 시점에만 지정할 수 있는 상태. 플러그인이 `{"running","blocked"}` 만 받는다.
   * `blocked` 는 Hermes 에서 sticky 라 사람이 풀 때까지 디스패치되지 않는다 —
   * 실행 전 승인 관문이 쓰는 자리다(`triage` 는 게이트웨이가 자동 분해해 쓸 수 없다).
   */
  initial_status?: "running" | "blocked";
};

/** `PATCH /kanban/tasks/{id}` — 부분 갱신. */
export type UpdateTaskBody = Partial<Omit<CreateTaskBody, "idempotency_key">> & {
  status?: KanbanTaskStatus;
  expected_revision?: number;
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
  "artifact.created",
  "artifact.versioned",
  "artifact.deleted",
  "card_proposal.created",
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

/**
 * NPC 가 대화 중 발견한 "업무 카드로 남길 만한 요청". 카드가 **아니다** — Hermes 쪽 제안
 * 레코드의 사본이고, 카드 등록 여부는 사용자가 방 알림에서 고른다.
 * `body`·`acceptance` 는 없으면 **키 자체가 빠진다**(빈 문자열이 아니다).
 */
export type CardProposalEventPayload = {
  proposal_id: string;
  title: string;
  summary: string;
  body?: string;
  acceptance?: string;
  profile: string;
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
  /** epoch 초(플러그인 0.6.0+ 전 출처). 화면은 epochSecondsToMs 로 바꾼다 */
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

// ---------------------------------------------------------------------------
// 스웜(v0.7.0+) — /deskrpg/kanban/swarm, /deskrpg/kanban/tasks/{id}/blackboard
// ---------------------------------------------------------------------------

/** `POST /deskrpg/kanban/swarm` 의 본문. 프로필 이름은 **서버가** NPC id 에서 푼 값이다. */
export type SwarmRequest = {
  goal: string;
  workers: Array<{ profile: string; title: string; body?: string; skills?: string[] }>;
  verifier: string;
  synthesizer: string;
  tenant?: string | null;
  priority?: number;
  idempotency_key?: string;
};

/** Hermes `SwarmCreated.as_dict()` 그대로. 키 이름을 바꾸지 않는다. */
export type SwarmCreated = {
  root_id: string;
  worker_ids: string[];
  verifier_id: string;
  synthesizer_id: string;
};

/** 루트 카드의 블랙보드. key 별 최신값 + `_authors`. 값의 모양은 Hermes 가 정한다. */
export type Blackboard = Record<string, unknown>;

// ---------------------------------------------------------------------------
// 아티팩트(0.8.0+) — /deskrpg/artifacts
// ---------------------------------------------------------------------------

export const ARTIFACT_KINDS = [
  "document",
  "image",
  "media",
  "web",
  "react",
  "data",
  "file",
  "link",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export const ARTIFACT_SOURCES = ["chat", "kanban", "cron"] as const;
export type ArtifactSource = (typeof ARTIFACT_SOURCES)[number];

/**
 * 화면 탭 묶음(2026-09-18 follow-up). `media`=image+media, `file`=document+web+react+data+file,
 * `link`=link. 순서가 탭 표시 순서다(전체 다음 미디어·파일·링크). 플러그인 쪽 매핑은
 * deskrpg-hermes-plugin `GET /deskrpg/artifacts?kind=<쉼표 목록>`(0.8.4+)이 받는다.
 */
export const ARTIFACT_CATEGORIES = {
  media: ["image", "media"],
  file: ["document", "web", "react", "data", "file"],
  link: ["link"],
} as const satisfies Record<string, readonly ArtifactKind[]>;
export type ArtifactCategory = keyof typeof ARTIFACT_CATEGORIES;
export const ARTIFACTS_MIN_VERSION = "0.8.0";
export const ARTIFACTS_TASK_FILTER_MIN_VERSION = "0.8.4";
export type ArtifactSummary = {
  id: string;
  kind: ArtifactKind;
  title: string;
  summary?: string | null;
  profile: string;
  source_kind: ArtifactSource;
  session_id: string;
  board?: string | null;
  task_id?: string | null;
  job_id?: string | null;
  run_id?: string | null;
  current_version: number;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  created_at: number;
  updated_at: number;
  missing?: true;
};
export type ArtifactVersion = {
  version: number;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  origin_path?: string | null;
  created_by: string;
  captured_via: "tool" | "hook" | "edit" | "response";
  note?: string | null;
  created_at: number;
  pruned_at?: number;
};
export type ArtifactPage = { artifacts: ArtifactSummary[]; cursor: string; has_more: boolean };
export type ArtifactDetail = { artifact: ArtifactSummary; versions: ArtifactVersion[] };
export type ArtifactEventPayload = {
  artifact_id: string;
  version?: number;
  kind?: ArtifactKind;
  title?: string;
  profile?: string;
  source_kind?: ArtifactSource;
  board?: string | null;
  task_id?: string | null;
  captured_via?: string;
};
