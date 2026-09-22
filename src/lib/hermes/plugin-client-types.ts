import type { WorkerPluginResult } from "./worker-plugin";
/** Pure plugin contracts shared by server clients and browser components. */
import type { PluginFailure } from "./plugin-errors";
import type { ArtifactDetail, ArtifactPage, ArtifactVersion } from "./deskrpg-plugin-types";

export type PluginResponse<T> =
  { ok: true; data: T } | { ok: false; failure: PluginFailure; status: number };

export type RawPluginResponse =
  { ok: true; response: Response } | { ok: false; failure: PluginFailure; status: number };

export type ArtifactListQuery = {
  profiles: string[];
  board?: string;
  kind?: string;
  source?: string;
  q?: string;
  cursor?: string;
  limit?: number;
  taskId?: string;
};

export type ArtifactsApi = {
  list(query: ArtifactListQuery): Promise<PluginResponse<ArtifactPage>>;
  get(id: string): Promise<PluginResponse<ArtifactDetail>>;
  content(
    id: string,
    version: number,
    opts: { download?: boolean; range?: string | null },
  ): Promise<RawPluginResponse>;
  addVersion(
    id: string,
    body: { content: string; filename: string; note?: string },
    user: string,
  ): Promise<PluginResponse<{ version: ArtifactVersion }>>;
  remove(id: string, user: string): Promise<PluginResponse<{ ok: true }>>;
};

export type IdentityPayload = {
  body: string | null;
  isDefaultTemplate: boolean | null;
  revision: string | null;
  unreadable?: boolean;
};

export type CreateProfilePayload = {
  name: string;
  apiKey?: string;
  keyIssued: boolean;
  keyError?: string;
  cloned?: { configKeys: string[]; envKeys: string[]; keyScope: CloneKeyScope };
  needsLogin?: string[];
  cloneError?: string;
};

// ---------------------------------------------------------------------------
// 직원 설정 피커(플러그인 0.9.0) — 툴셋·스킬 목록, 프로필 생성 시 복제.
// ---------------------------------------------------------------------------

export type ToolsetRow = {
  name: string;
  label: string;
  description: string;
  enabled: boolean;
  configured: boolean | null;
  /** 0.10.0 — 프로바이더를 고르는 툴셋인가(`hermes tools` 의 TOOL_CATEGORIES). 구버전은 없다. */
  hasProviders?: boolean;
};

/** 도구 프로바이더 행(플러그인 0.10.0). 키 값은 절대 오지 않는다 — 설정 여부만. */
export type ToolProviderRow = {
  name: string;
  badge: string;
  tag: string;
  envVars: Array<{ key: string; prompt: string; url: string | null; isSet: boolean }>;
  active: boolean;
  status: "ready" | "needs_keys" | "needs_auth" | "needs_setup";
  /** none: 고르기만 하면 된다 · keys: 키가 필요하다 · cli: 서버에서 설치·로그인해야 한다 */
  setup: "none" | "keys" | "cli";
};

export type ToolProvidersPayload = {
  toolset: string;
  hasProviders: boolean;
  providers: ToolProviderRow[];
  activeProvider: string | null;
  cliCommand: string;
};

export type ToolProviderSelectResult = { provider: string; isSet: Record<string, boolean> };

export type ToolsetsPayload = { platform: string; toolsets: ToolsetRow[] };

export type SkillRow = {
  name: string;
  category: string;
  description: string;
  disabled: boolean;
  essential: boolean;
};

export type SkillsPayload = { skills: SkillRow[] };

/**
 * 키 복제 범위(플러그인 0.9.0 `cloneKeys`). `referenced` 는 복제한 설정이 가리키는 프로바이더의 키만,
 * `api_keys` 는 API 키 방식 프로바이더 키 전부(범용·OAuth 토큰 제외) + referenced 몫. 생략하면 referenced.
 */
export type CloneKeyScope = "referenced" | "api_keys";

export type CreateProfileOptions = { cloneFrom?: "default"; cloneKeys?: CloneKeyScope };

export type DeleteProfilePayload = {
  name: string;
  removed: { profileDir: boolean; wrapperScript: boolean };
};

export type CatalogPayload = {
  providers: Array<{
    id: string;
    name: string;
    authenticated: boolean;
    authType?: ProviderAuthType;
    envVars?: string[];
    cliCommand?: string | null;
  }>;
  models: Record<string, string[]>;
  reasoningEfforts: string[];
};

// ---------------------------------------------------------------------------
// 프로바이더 인증(플러그인 0.9.0) — OAuth 디바이스 로그인 · API 키 입력.
// ---------------------------------------------------------------------------

export type ProviderAuthType = "api_key" | "oauth_device" | "external";

export type OAuthStartPayload = {
  sessionId: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  pollInterval: number;
};

export type OAuthPollPayload = {
  status: "pending" | "approved" | "denied" | "expired" | "error";
  error: string | null;
  expiresAt: number | null;
  retryable: boolean | null;
  retryAfter: number | null;
};

export type ProviderKeyPayload = {
  configured: boolean;
  envVar?: string;
  removed?: string[];
};

export type PluginClient = {
  listProfiles(): Promise<PluginResponse<{ profiles: unknown[] }>>;
  /** 0.12.0 — 칸반 워커·크론이 뜨는 프로필 홈에도 플러그인을 둔다(소유자 키). 이름이 없으면 전부. */
  ensureWorkerPlugin(
    profiles?: string[],
  ): Promise<PluginResponse<{ results: WorkerPluginResult[] }>>;
  createProfile(
    name: string,
    options?: CreateProfileOptions,
  ): Promise<PluginResponse<CreateProfilePayload>>;
  deleteProfile(name: string): Promise<PluginResponse<DeleteProfilePayload>>;
  getIdentity(name: string, profileToken: string): Promise<PluginResponse<IdentityPayload>>;
  putIdentity(
    name: string,
    profileToken: string,
    input: { body: string; ifRevision: string },
  ): Promise<PluginResponse<{ revision: string }>>;
  getConfig(name: string, profileToken: string): Promise<PluginResponse<Record<string, unknown>>>;
  getCatalog(name: string, profileToken: string): Promise<PluginResponse<CatalogPayload>>;
  putConfig(
    name: string,
    profileToken: string,
    patch: Record<string, unknown>,
  ): Promise<PluginResponse<Record<string, unknown>>>;
  // 직원 설정 피커(0.9.0). 프로필 스코프 — 스킬 폴더와 키 설정 여부가 프로필마다 다르다.
  getToolsets(name: string, profileToken: string): Promise<PluginResponse<ToolsetsPayload>>;
  getSkills(name: string, profileToken: string): Promise<PluginResponse<SkillsPayload>>;
  // 도구별 프로바이더(0.10.0). 프로필 스코프 — 키는 쓰기 전용이다.
  getToolProviders(
    name: string,
    profileToken: string,
    toolset: string,
  ): Promise<PluginResponse<ToolProvidersPayload>>;
  putToolProvider(
    name: string,
    profileToken: string,
    toolset: string,
    body: { provider: string; env: Record<string, string> },
  ): Promise<PluginResponse<ToolProviderSelectResult>>;
  // 프로바이더 인증(0.9.0). 전부 프로필 스코프 — 게이트웨이 소유자 권한 체크는 라우트 계층 몫이다.
  startOAuth(
    name: string,
    profileToken: string,
    provider: string,
  ): Promise<PluginResponse<OAuthStartPayload>>;
  pollOAuth(
    name: string,
    profileToken: string,
    provider: string,
    sessionId: string,
  ): Promise<PluginResponse<OAuthPollPayload>>;
  cancelOAuth(
    name: string,
    profileToken: string,
    sessionId: string,
  ): Promise<PluginResponse<{ ok: boolean }>>;
  disconnectOAuth(
    name: string,
    profileToken: string,
    provider: string,
  ): Promise<PluginResponse<{ ok: boolean }>>;
  putProviderKey(
    name: string,
    profileToken: string,
    provider: string,
    value: string,
  ): Promise<PluginResponse<ProviderKeyPayload>>;
  deleteProviderKey(
    name: string,
    profileToken: string,
    provider: string,
  ): Promise<PluginResponse<ProviderKeyPayload>>;
};

// ---------------------------------------------------------------------------
// 자동화 계약(v0.6.0+) — 칸반·이벤트(오너 키) / 크론(프로필 키)
//
// 두 스코프를 **별도 클라이언트**로 나눈다. `PluginClient` 는 메서드마다 토큰을 받아
// 호출부가 섞을 여지가 있었는데, 칸반은 오너 키만·크론은 프로필 키만 받으므로 생성
// 시점에 토큰을 고정해 섞을 자리 자체를 없앤다.
// ---------------------------------------------------------------------------

import type {
  AutomationBlueprint,
  Blackboard,
  BoardMeta,
  CreateBoardBody,
  CreateCronJobBody,
  CreateTaskBody,
  CronDeliveryTarget,
  CronJob,
  CronRun,
  DispatchResult,
  EventsPage,
  InstantiateBlueprintBody,
  KanbanAttachment,
  KanbanBoardAttachmentsPage,
  KanbanBoard,
  KanbanComment,
  KanbanLinksPage,
  KanbanProfileSummary,
  KanbanRunsPage,
  KanbanTask,
  KanbanTaskAction,
  KanbanTaskDetail,
  OrchestrationSettings,
  PluginInfo,
  SwarmCreated,
  SwarmRequest,
  UpdateBoardBody,
  UpdateCronJobBody,
  UpdateOrchestrationBody,
  UpdateTaskBody,
  WorkerLog,
} from "./deskrpg-plugin-types";

/** 카드 액션별 본문. reassign·request-changes·unblock 외의 액션은 빈 객체다. */
export type KanbanTaskActionInput<A extends KanbanTaskAction> = A extends "approve"
  ? { submission_id?: string; request_id?: string }
  : A extends "reassign"
    ? { profile: string; reclaim_first: true }
    : A extends "request-changes"
      ? { comment: string }
      : A extends "unblock"
        ? { comment?: string }
        : Record<string, never>;

export type KanbanApi = {
  listBoards(): Promise<PluginResponse<{ boards: BoardMeta[]; current: string | null }>>;
  createBoard(body: CreateBoardBody): Promise<PluginResponse<{ board: BoardMeta }>>;
  updateBoard(slug: string, body: UpdateBoardBody): Promise<PluginResponse<{ board: BoardMeta }>>;

  getBoard(
    board: string,
    opts?: { includeArchived?: boolean },
  ): Promise<PluginResponse<KanbanBoard>>;
  getTask(board: string, id: string): Promise<PluginResponse<KanbanTaskDetail>>;
  /** 묶음 조회 — capability `kanban_views` 가 있어야 한다(없으면 404). */
  listLinks(board: string): Promise<PluginResponse<KanbanLinksPage>>;
  listRuns(
    board: string,
    opts?: { from?: number; to?: number; limit?: number },
  ): Promise<PluginResponse<KanbanRunsPage>>;
  createTask(
    board: string,
    body: CreateTaskBody,
  ): Promise<PluginResponse<{ task: KanbanTask; warning?: string }>>;
  updateTask(
    board: string,
    id: string,
    body: UpdateTaskBody,
  ): Promise<PluginResponse<{ task: KanbanTask }>>;
  deleteTask(board: string, id: string): Promise<PluginResponse<{ ok: true }>>;
  addComment(
    board: string,
    id: string,
    body: { author: string; body: string },
  ): Promise<PluginResponse<{ comment: KanbanComment }>>;
  runTaskAction<A extends KanbanTaskAction>(
    board: string,
    id: string,
    action: A,
    body: KanbanTaskActionInput<A>,
    actor?: { userId: string; name?: string },
  ): Promise<PluginResponse<{ task: KanbanTask }>>;

  listAttachments(
    board: string,
    id: string,
  ): Promise<PluginResponse<{ attachments: KanbanAttachment[] }>>;
  /** 보드 전체 첨부 — capability `kanban_attachment_list` 가 있어야 한다(없으면 404). */
  listBoardAttachments(
    board: string,
    opts?: { limit?: number; cursor?: string },
  ): Promise<PluginResponse<KanbanBoardAttachmentsPage>>;
  uploadAttachment(
    board: string,
    id: string,
    file: { filename: string; content: Blob | string },
  ): Promise<PluginResponse<{ attachment: KanbanAttachment }>>;
  attachmentContent(
    board: string,
    attachmentId: string,
    opts: { range?: string | null },
  ): Promise<RawPluginResponse>;
  deleteAttachment(board: string, attachmentId: string): Promise<PluginResponse<{ ok: true }>>;

  addLink(
    board: string,
    body: { parent_id: string; child_id: string },
  ): Promise<PluginResponse<{ ok: true }>>;
  removeLink(
    board: string,
    body: { parent_id: string; child_id: string },
  ): Promise<PluginResponse<{ ok: true }>>;

  dispatch(board: string, opts?: { max?: number }): Promise<PluginResponse<DispatchResult>>;

  createSwarm(board: string, body: SwarmRequest): Promise<PluginResponse<SwarmCreated>>;
  getBlackboard(board: string, taskId: string): Promise<PluginResponse<{ blackboard: Blackboard }>>;

  getTaskLog(
    board: string,
    id: string,
    opts?: { tail?: number },
  ): Promise<PluginResponse<WorkerLog>>;

  getOrchestration(): Promise<PluginResponse<OrchestrationSettings>>;
  updateOrchestration(
    body: UpdateOrchestrationBody,
  ): Promise<PluginResponse<OrchestrationSettings>>;
  listProfiles(): Promise<PluginResponse<{ profiles: KanbanProfileSummary[] }>>;
};

export type EventsApi = {
  /**
   * 커서 없이 부르면 이벤트 없이 "지금" 토큰만 돌아온다 — 그 토큰으로 다음 호출부터
   * 새 이벤트를 받는다. 모르는 커서는 400 `unknown_cursor` 로 접힌다.
   */
  poll(opts: {
    board?: string;
    cursor?: string;
    limit?: number;
    include?: string;
  }): Promise<PluginResponse<EventsPage>>;
};

/**
 * 카드 제안(플러그인 `card_proposals` capability). 제안의 정본은 플러그인이고, DeskRPG 는
 * 해소 표시와 그 되돌리기만 부른다 — 제안 목록·조회 라우트는 쓰지 않는다.
 */
export type CardProposalsApi = {
  /** 200 `{resolved:true}` · 409 `card_proposal_already_resolved` · 404 · 400 `invalid_field`. */
  resolve(
    proposalId: string,
    body: { choice: "card" | "inline"; task_id?: string },
  ): Promise<PluginResponse<{ resolved: true }>>;
  /**
   * 200 `{resolved:false}` · 409 `card_proposal_not_unresolvable`(미해소이거나 카드가 이미
   * 기록됐다) · 404. 본문 없음.
   */
  unresolve(proposalId: string): Promise<PluginResponse<{ resolved: false }>>;
  /**
   * 해소된 제안에 카드 id 를 **한 번** 기록한다 — 그 뒤로는 `unresolve` 가 409 로 막힌다.
   * 해소(`resolve`)가 카드 생성보다 먼저 일어나므로 `task_id` 는 이 경로로만 채워진다.
   * 200 `{recorded:true}` · 409 `card_proposal_task_not_recordable`(미해소이거나 이미 기록됨)
   * · 404 · 400 `invalid_field`. 덮어쓰기 불가.
   */
  recordTask(
    proposalId: string,
    body: { task_id: string },
  ): Promise<PluginResponse<{ recorded: true }>>;
};

export type OwnerPluginClient = {
  info(): Promise<PluginResponse<PluginInfo>>;
  kanban: KanbanApi;
  events: EventsApi;
  artifacts: ArtifactsApi;
  cardProposals: CardProposalsApi;
};

export type CronApi = {
  listJobs(opts?: { includeDisabled?: boolean }): Promise<PluginResponse<{ jobs: CronJob[] }>>;
  getJob(id: string): Promise<PluginResponse<{ job: CronJob }>>;
  listRuns(id: string, opts?: { limit?: number }): Promise<PluginResponse<{ runs: CronRun[] }>>;
  createJob(body: CreateCronJobBody): Promise<PluginResponse<{ job: CronJob }>>;
  updateJob(id: string, body: UpdateCronJobBody): Promise<PluginResponse<{ job: CronJob }>>;
  pauseJob(id: string): Promise<PluginResponse<{ job: CronJob }>>;
  resumeJob(id: string): Promise<PluginResponse<{ job: CronJob }>>;
  /** 비동기 실행 — 202 `{accepted:true}` 가 성공이다. */
  runJob(id: string): Promise<PluginResponse<{ accepted: true }>>;
  deleteJob(id: string): Promise<PluginResponse<{ ok: true }>>;
  listDeliveryTargets(): Promise<PluginResponse<{ targets: CronDeliveryTarget[] }>>;
  listBlueprints(): Promise<PluginResponse<{ blueprints: AutomationBlueprint[] }>>;
  instantiateBlueprint(body: InstantiateBlueprintBody): Promise<PluginResponse<{ job: CronJob }>>;
};

export type ProfilePluginClient = {
  profileName: string;
  cron: CronApi;
};
