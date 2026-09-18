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
};

export type DeleteProfilePayload = {
  name: string;
  removed: { profileDir: boolean; wrapperScript: boolean };
};

export type CatalogPayload = {
  providers: Array<{ id: string; name: string; authenticated: boolean }>;
  models: Record<string, string[]>;
  reasoningEfforts: string[];
};

export type PluginClient = {
  listProfiles(): Promise<PluginResponse<{ profiles: unknown[] }>>;
  createProfile(name: string): Promise<PluginResponse<CreateProfilePayload>>;
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
  KanbanBoard,
  KanbanComment,
  KanbanProfileSummary,
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
export type KanbanTaskActionInput<A extends KanbanTaskAction> = A extends "reassign"
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
  ): Promise<PluginResponse<{ task: KanbanTask }>>;

  listAttachments(
    board: string,
    id: string,
  ): Promise<PluginResponse<{ attachments: KanbanAttachment[] }>>;
  uploadAttachment(
    board: string,
    id: string,
    file: { filename: string; content: Blob | string },
  ): Promise<PluginResponse<{ attachment: KanbanAttachment }>>;
  getAttachment(board: string, attachmentId: string): Promise<PluginResponse<KanbanAttachment>>;
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

export type OwnerPluginClient = {
  info(): Promise<PluginResponse<PluginInfo>>;
  kanban: KanbanApi;
  events: EventsApi;
  artifacts: ArtifactsApi;
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
