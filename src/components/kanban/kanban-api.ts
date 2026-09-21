/**
 * 칸반 REST(`/api/channels/:id/kanban/**`, `/automation/status`)의 브라우저 쪽 호출.
 *
 * 브라우저는 Hermes 를 직접 부르지 않는다 — 전부 같은 출처의 DeskRPG 라우트이고, 인증은
 * 앱의 다른 fetch 와 같이 세션 쿠키로 간다. 실패는 서버가 내려 준 `{code, message, …}` 를
 * 그대로 `KanbanApiError` 에 실어 던진다(R32) — 여기서 번역하거나 접지 않는다.
 *
 * 낙관적 갱신은 없다(R26). 조작 함수는 응답만 돌려주고, 화면이 성공 후 재조회한다.
 */

import type {
  DispatchResult,
  KanbanAttachment,
  KanbanBoardAttachment,
  KanbanBoard,
  KanbanComment,
  KanbanTask,
  KanbanTaskAction,
  KanbanLinksPage,
  KanbanRunsPage,
  KanbanTaskDetail,
  OrchestrationSettings,
  SwarmCreated,
  WorkerLog,
} from "@/lib/hermes/deskrpg-plugin-types";

import type { BoardNpc, KanbanFailure } from "./kanban-view-model";

export class KanbanApiError extends Error implements KanbanFailure {
  readonly status: number;
  readonly code: string;
  readonly minVersion?: string;
  readonly extra: Record<string, unknown>;

  constructor(failure: KanbanFailure & { extra?: Record<string, unknown> }) {
    super(failure.message);
    this.name = "KanbanApiError";
    this.status = failure.status;
    this.code = failure.code;
    this.minVersion = failure.minVersion;
    this.extra = failure.extra ?? {};
  }
}

export type BoardResponse = KanbanBoard & { npcs: BoardNpc[] };

export type AutomationStatus = {
  pluginStatus: string | null;
  pluginVersion: string | null;
  capabilities: string[];
  timezone: string | null;
  boardSlug: string;
  dispatcherPresent: boolean;
  attachments: boolean;
  lastPolledAt: string | null;
  lastError: string | null;
  minVersion: string;
  working: Array<{
    npcId: string;
    working: boolean;
    sources: { runningCards: number; cronRuns: number };
  }>;
};

export type BoardSettings = {
  board: { slug: string; name: string | null; default_workdir: string | null; editable: boolean };
  orchestration: (OrchestrationSettings & { editable: boolean }) | null;
  hints: { default_assignee_recommend_empty?: boolean };
};

export type CreateTaskResponse = { task: KanbanTask; warning?: string };

/** 카드 상세 응답에 `warning` 은 없다 — 생성 응답의 경고는 화면이 따로 들고 있는다(R9). */

export type FetchLike = typeof fetch;

/** 프로젝트 목록 한 줄 — 선택기가 쓰는 만큼만. 전체 모양은 `ProjectView`(서버). */
export type ProjectSummary = {
  id: string;
  boardSlug: string;
  name: string | null;
  status: string;
  isEventCarrier: boolean;
  /**
   * `YYYY-MM-DD` 또는 null. 서버(`project-registry.ts` 의 `ProjectView`)는 처음부터 보냈고
   * 이 타입만 선택기용으로 좁혀져 있었다. 타임라인의 목표일 선이 이 값을 읽는다.
   */
  targetDate: string | null;
};

function base(channelId: string): string {
  return `/api/channels/${encodeURIComponent(channelId)}/kanban`;
}

async function parseFailure(res: Response): Promise<KanbanApiError> {
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await res.json();
    if (typeof parsed === "object" && parsed !== null) body = parsed as Record<string, unknown>;
  } catch {
    // 본문이 JSON 이 아니면 상태 코드만으로 만든다.
  }
  const code =
    typeof body.code === "string"
      ? body.code
      : typeof body.errorCode === "string"
        ? body.errorCode
        : typeof body.error === "string"
          ? body.error
          : `http_${res.status}`;
  const message =
    typeof body.message === "string" && body.message ? body.message : res.statusText || code;
  const { code: _c, message: _m, minVersion, ...extra } = body;
  return new KanbanApiError({
    status: res.status,
    code,
    message,
    minVersion: typeof minVersion === "string" ? minVersion : undefined,
    extra,
  });
}

async function request<T>(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    throw new KanbanApiError({
      status: 0,
      code: "network_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  if (!res.ok) throw await parseFailure(res);
  return (await res.json()) as T;
}

function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

/**
 * 채널 하나에 묶인 호출 모음. `fetchImpl` 은 테스트용 — 기본은 전역 fetch 를 **호출 시점에**
 * 읽는다(테스트가 전역을 바꿔 끼우기 때문에 생성 시점에 붙잡으면 안 된다).
 *
 * `boardSlug` 를 주면 칸반 경로로 나가는 **모든** 호출에 `?board=` 가 붙는다. 호출마다 손으로
 * 붙이지 않는 이유는, 그러면 새 호출을 더하는 사람이 잊기 때문이다 — 잊으면 조용히 기본 보드를
 * 만지게 되고, 사용자는 다른 프로젝트를 열어 둔 채 엉뚱한 보드를 고치게 된다. 주입은 fetch 를
 * 한 겹 감싸서 하고, `/automation/status` 처럼 칸반 경로가 아닌 곳에는 붙지 않는다.
 *
 * 생략하면 그 채널의 사건 수신 보드(= 기본 프로젝트)를 쓴다.
 */
export function createKanbanApi(channelId: string, fetchImpl?: FetchLike, boardSlug?: string) {
  const root = base(channelId);
  const withBoard = (url: string) => {
    if (!boardSlug || !url.startsWith(root)) return url;
    return `${url}${url.includes("?") ? "&" : "?"}board=${encodeURIComponent(boardSlug)}`;
  };
  const f: FetchLike = (input, init) =>
    (fetchImpl ?? globalThis.fetch)(typeof input === "string" ? withBoard(input) : input, init);
  const task = (taskId: string) => `${root}/tasks/${encodeURIComponent(taskId)}`;

  return {
    status: () =>
      request<AutomationStatus>(
        f,
        `/api/channels/${encodeURIComponent(channelId)}/automation/status`,
      ),
    /**
     * 이 채널의 프로젝트(= 보드) 목록. 칸반 경로 밖이라 `?board=` 가 붙지 않는다 — 붙으면
     * 목록을 읽을 때마다 고른 보드에 갇힌다.
     */
    projects: () =>
      request<{ projects: ProjectSummary[] }>(
        f,
        `/api/channels/${encodeURIComponent(channelId)}/projects`,
      ),
    board: (includeArchived: boolean) =>
      request<BoardResponse>(f, `${root}/board${includeArchived ? "?include_archived=true" : ""}`),
    taskDetail: (taskId: string) => request<KanbanTaskDetail>(f, task(taskId)),
    /**
     * 묶음 조회 — 보드 전체의 부모·자식 쌍. 플러그인에 `kanban_views` 가 없으면 404 로 실패한다.
     * 화면은 그때 카드마다 `taskDetail()` 을 부르는 길로 내려앉는다.
     */
    links: () => request<KanbanLinksPage>(f, `${root}/links`),
    /** 창 안의 실행 기록. `from`·`to` 는 epoch 초, 생략하면 플러그인이 최근 7일을 준다. */
    runs: (opts?: { from?: number; to?: number; limit?: number }) => {
      const qs = new URLSearchParams();
      for (const key of ["from", "to", "limit"] as const) {
        const value = opts?.[key];
        if (typeof value === "number") qs.set(key, String(value));
      }
      return request<KanbanRunsPage>(f, `${root}/runs${qs.size > 0 ? `?${qs}` : ""}`);
    },
    createTask: (body: Record<string, unknown>) =>
      request<CreateTaskResponse>(f, `${root}/tasks`, json("POST", body)),
    updateTask: (taskId: string, body: Record<string, unknown>) =>
      request<{ task: KanbanTask }>(f, task(taskId), json("PATCH", body)),
    deleteTask: (taskId: string) => request<{ ok: true }>(f, task(taskId), { method: "DELETE" }),
    addComment: (taskId: string, body: string) =>
      request<{ comment: KanbanComment }>(f, `${task(taskId)}/comments`, json("POST", { body })),
    /** `reassign` 은 `{npcId}`, `request-changes`/`unblock` 은 `{comment}`, 나머지는 본문 없음. */
    action: (taskId: string, action: KanbanTaskAction, body?: Record<string, unknown>) =>
      request<{ task: KanbanTask | Record<string, unknown> }>(
        f,
        `${task(taskId)}/${action}`,
        json("POST", body ?? {}),
      ),
    log: (taskId: string, tail = 16384) =>
      request<WorkerLog>(f, `${task(taskId)}/log?tail=${tail}`),
    attachments: (taskId: string) =>
      request<{ attachments: KanbanAttachment[] }>(f, `${task(taskId)}/attachments`),
    uploadAttachment: (taskId: string, file: File) => {
      const form = new FormData();
      form.append("file", file, file.name);
      return request<{ attachment: KanbanAttachment }>(f, `${task(taskId)}/attachments`, {
        method: "POST",
        body: form,
      });
    },
    deleteAttachment: (attachmentId: string) =>
      request<{ ok: true }>(f, `${root}/attachments/${encodeURIComponent(attachmentId)}`, {
        method: "DELETE",
      }),
    // 브라우저가 직접 여는 주소라 fetch 를 거치지 않는다 — 여기만 손으로 붙인다.
    /** 보드 전체 첨부. 플러그인이 목록을 모르면 `supported: false` 로 온다(오류가 아니다). */
    boardAttachments: (cursor?: string) =>
      request<{
        supported: boolean;
        attachments: KanbanBoardAttachment[];
        next_cursor: string | null;
      }>(f, `${root}/attachments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
    attachmentUrl: (attachmentId: string) =>
      withBoard(`${root}/attachments/${encodeURIComponent(attachmentId)}`),
    addLink: (parentId: string, childId: string) =>
      request<{ ok: true }>(
        f,
        `${root}/links`,
        json("POST", { parent_id: parentId, child_id: childId }),
      ),
    removeLink: (parentId: string, childId: string) =>
      request<{ ok: true }>(
        f,
        `${root}/links`,
        json("DELETE", { parent_id: parentId, child_id: childId }),
      ),
    dispatch: (opts?: { max?: number }) => {
      const qs = new URLSearchParams();
      if (typeof opts?.max === "number") qs.set("max", String(opts.max));
      const suffix = qs.size > 0 ? `?${qs}` : "";
      return request<DispatchResult>(f, `${root}/dispatch${suffix}`, { method: "POST" });
    },
    createSwarm: (body: {
      goal: string;
      workers: Array<{ npcId: string; title: string; body?: string; skills?: string[] }>;
      verifierNpcId: string;
      synthesizerNpcId: string;
      idempotencyKey: string;
    }) => request<SwarmCreated>(f, `${root}/swarm`, json("POST", body)),
    blackboard: (taskId: string) =>
      request<{ blackboard: Record<string, unknown> }>(f, `${task(taskId)}/blackboard`),
    /**
     * 카드 제안 해소. 200 `{choice, taskId?, assigneeDropped?}`. 실패는 서버 코드를 그대로
     * 실은 `KanbanApiError` — 409 `already_resolved` 를 화면이 가려 안내할 수 있다.
     */
    resolveProposal: (proposalId: string, choice: "card" | "inline") =>
      request<{ choice: "card" | "inline"; taskId?: string; assigneeDropped?: boolean }>(
        f,
        `${root}/proposals/${encodeURIComponent(proposalId)}/resolve`,
        json("POST", { choice }),
      ),
    settings: () => request<BoardSettings>(f, `${root}/settings`),
    patchSettings: (body: {
      board?: { default_workdir: string };
      orchestration?: Record<string, unknown>;
    }) => request<BoardSettings>(f, `${root}/settings`, json("PATCH", body)),
  };
}

export type KanbanApi = ReturnType<typeof createKanbanApi>;

/** 아무 예외를 `KanbanFailure` 로. 이미 `KanbanApiError` 면 그대로. */
export function toFailure(err: unknown): KanbanFailure {
  if (err instanceof KanbanApiError) {
    return { status: err.status, code: err.code, message: err.message, minVersion: err.minVersion };
  }
  return {
    status: 0,
    code: "unknown_error",
    message: err instanceof Error ? err.message : String(err),
  };
}
