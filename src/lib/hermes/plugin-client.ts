import { transportFetch } from "./setup/transport";
/**
 * `deskrpg-hermes-plugin` 라우트 호출 래퍼.
 *
 * **토큰 선택을 이 파일 밖으로 새어 나가지 않게 한다.** Hermes 의 인증은
 * 프로필별 fail-closed 라, 어떤 경로에 어떤 키를 쓰는지 틀리면 전부 401 이다:
 *
 *     /deskrpg/*            → default(게이트웨이) 토큰
 *     /p/{name}/deskrpg/*   → 그 프로필의 토큰
 *
 * 호출부마다 이 규칙을 기억하게 하면 언젠가 틀린다. 여기 한 곳에 가둔다.
 *
 * 어떤 메서드도 **던지지 않는다** — 네트워크 실패까지 `{ok:false}` 로 돌려준다.
 * 프록시 라우트가 그것을 200 + errorCode 로 옮기기 때문이다.
 *
 * 리뷰 라운드 1:
 * - I-1: 200 인데 JSON 이 아니면(게이트웨이 앞단이 HTML 오류 페이지를 주는 경우가
 *   실제로 있었다) 예전엔 `{ok:true, data:null}` 을 내보내 호출부가 그 다음 줄에서
 *   던졌다. 형제 모듈 `plugin-capability.ts` 와 같은 기준으로 접는다 — 성공을
 *   자칭하지 않는다. (204 를 쓰는 라우트는 이 API 에 없다.)
 * - I-3: `probeDeskrpgPlugin` 은 타임아웃이 있는데 정작 데이터를 주고받는 이 파일은
 *   없어서, 게이트웨이가 소켓을 열어두면 라우트 핸들러가 무한정 매달렸다. 재시도할
 *   문제(`unreachable`)와 주소를 확인할 문제(`timeout`)는 사용자가 할 일이 달라 코드를
 *   분리한다.
 */

import { mapPluginFailure, type PluginFailure } from "./plugin-errors";

import type {
  ArtifactsApi,
  CardProposalsApi,
  CronApi,
  EventsApi,
  KanbanApi,
  OwnerPluginClient,
  PluginClient,
  PluginResponse,
  ProfilePluginClient,
  RawPluginResponse,
} from "./plugin-client-types";
export type {
  PluginResponse,
  RawPluginResponse,
  IdentityPayload,
  CreateProfilePayload,
  CreateProfileOptions,
  DeleteProfilePayload,
  CatalogPayload,
  ToolsetRow,
  ToolsetsPayload,
  ToolProviderRow,
  ToolProvidersPayload,
  ToolProviderSelectResult,
  SkillRow,
  SkillsPayload,
  ProviderAuthType,
  OAuthStartPayload,
  OAuthPollPayload,
  ProviderKeyPayload,
  PluginClient,
  KanbanApi,
  EventsApi,
  ArtifactsApi,
  ArtifactListQuery,
  CronApi,
  OwnerPluginClient,
  ProfilePluginClient,
} from "./plugin-client-types";

const UNREACHABLE: PluginFailure = {
  code: "unreachable",
  message: "",
  blocksEditor: true,
  showsShellCommand: null,
  details: {},
};

// I-3: 게이트웨이에 닿았고 응답을 기다리는 중에 시간이 다 됐다. `unreachable` 과
// 사용자가 할 일이 다르다 — 재시도가 아니라 주소·상태를 먼저 확인해야 한다.
const TIMEOUT: PluginFailure = {
  code: "timeout",
  message: "",
  blocksEditor: true,
  showsShellCommand: null,
  details: {},
};

// I-1: 2xx 인데 본문이 JSON 객체가 아니면(HTML 오류 페이지, `null`, 파싱 실패 등)
// 성공을 자칭하지 않는다. `plugin-capability.ts:28` 의 판정 기준과 맞춘다.
const MALFORMED_RESPONSE: PluginFailure = {
  code: "malformed_response",
  message: "",
  blocksEditor: true,
  showsShellCommand: null,
  details: {},
};

const DEFAULT_TIMEOUT_MS = 15000;

type TransportInput = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type CallInit = {
  method?: string;
  /** JSON 본문. `formData` 와 함께 쓰지 않는다. */
  body?: unknown;
  /** multipart 본문(첨부 업로드). content-type 은 fetch 가 boundary 와 함께 붙인다. */
  formData?: FormData;
  headers?: Record<string, string>;
};

/**
 * 세 클라이언트(`createPluginClient`·`createOwnerPluginClient`·`createProfilePluginClient`)가
 * 공유하는 한 겹 — 타임아웃·도달 실패·JSON 판정·`mapPluginFailure` 를 여기 한 곳에 둔다.
 * 토큰은 호출마다 받되, 어느 토큰을 쓸지는 바깥의 각 클라이언트가 생성 시점에 고정한다.
 */
function createPluginTransport(input: TransportInput) {
  const fetchImpl = input.fetchImpl ?? transportFetch;
  const base = input.baseUrl.replace(/\/+$/, "");
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call<T>(
    path: string,
    token: string,
    init: CallInit = {},
  ): Promise<PluginResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method: init.method ?? "GET",
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          ...(init.headers ?? {}),
        },
        ...(init.formData !== undefined
          ? { body: init.formData }
          : init.body === undefined
            ? {}
            : { body: JSON.stringify(init.body) }),
        signal: controller.signal,
      });
    } catch {
      // 중단이 우리가 건 타이머 때문이었는지로 재시도(unreachable)와 타임아웃을 가른다.
      return controller.signal.aborted
        ? { ok: false, failure: TIMEOUT, status: 0 }
        : { ok: false, failure: UNREACHABLE, status: 0 };
    } finally {
      clearTimeout(timer);
    }

    let body: unknown = null;
    let parseFailed = false;
    try {
      body = await res.json();
    } catch {
      parseFailed = true;
    }

    // 2xx 인데 본문이 객체가 아니면(HTML 오류 페이지, 파싱 실패, `null` 등) 그것도
    // 실패다 — 성공을 자칭한 채 null 을 실어 보내면 호출부가 다음 줄에서 던진다.
    const isSuccessStatus = res.status >= 200 && res.status < 300;
    if (isSuccessStatus && (parseFailed || typeof body !== "object" || body === null)) {
      return { ok: false, failure: MALFORMED_RESPONSE, status: res.status };
    }

    const failure = mapPluginFailure({ status: res.status, body });
    if (failure) return { ok: false, failure, status: res.status };
    return { ok: true, data: body as T };
  }

  async function callRaw(
    path: string,
    token: string,
    init: { headers?: Record<string, string> } = {},
  ): Promise<RawPluginResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      // 타임아웃은 응답 머리까지만 — 본문은 스트림이라 오래 걸려도 정상이다.
      res = await fetchImpl(`${base}${path}`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
        signal: controller.signal,
      });
    } catch {
      return controller.signal.aborted
        ? { ok: false, failure: TIMEOUT, status: 0 }
        : { ok: false, failure: UNREACHABLE, status: 0 };
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 200 && res.status < 300) return { ok: true, response: res };
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const failure = mapPluginFailure({ status: res.status, body }) ?? MALFORMED_RESPONSE;
    return { ok: false, failure, status: res.status };
  }

  return { call, callRaw };
}

/** 쿼리스트링 조립. `undefined` 값은 빼고, 있는 것만 인코딩한다. 비면 빈 문자열. */
function query(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

export function createPluginClient(input: TransportInput & { defaultToken: string }): PluginClient {
  const { call } = createPluginTransport(input);

  // 프로필 이름은 검증을 통과하지 않은 채 들어올 수 있는 경로가 있다(사용자 입력).
  const seg = (name: string) => encodeURIComponent(name);

  return {
    listProfiles: () => call("/deskrpg/profiles", input.defaultToken),

    ensureWorkerPlugin: (profiles) =>
      call("/deskrpg/worker-plugin", input.defaultToken, {
        method: "POST",
        body: profiles ? { profiles } : {},
      }),

    createProfile: (name, options) =>
      call("/deskrpg/profiles", input.defaultToken, {
        method: "POST",
        body: {
          name,
          ...(options?.cloneFrom ? { cloneFrom: options.cloneFrom } : {}),
          ...(options?.cloneKeys ? { cloneKeys: options.cloneKeys } : {}),
        },
      }),

    // `confirm` 이 경로의 이름과 정확히 같아야 플러그인이 지운다(400 가드).
    deleteProfile: (name) =>
      call(
        `/deskrpg/profiles/${seg(name)}?confirm=${encodeURIComponent(name)}`,
        input.defaultToken,
        {
          method: "DELETE",
        },
      ),

    getIdentity: (name, profileToken) => call(`/p/${seg(name)}/deskrpg/identity`, profileToken),

    putIdentity: (name, profileToken, body) =>
      call(`/p/${seg(name)}/deskrpg/identity`, profileToken, { method: "PUT", body }),

    getConfig: (name, profileToken) => call(`/p/${seg(name)}/deskrpg/config`, profileToken),

    // 모델·프로바이더 목록. 프로필 스코프다 — 인증 상태가 프로필별로 갈릴 수 있다.
    getCatalog: (name, profileToken) => call(`/p/${seg(name)}/deskrpg/catalog`, profileToken),

    putConfig: (name, profileToken, patch) =>
      call(`/p/${seg(name)}/deskrpg/config`, profileToken, { method: "PUT", body: patch }),

    // 직원 설정 피커(0.9.0). 프로필 스코프 — 스킬 폴더와 키 설정 여부가 프로필마다 다르다.
    getToolsets: (name, profileToken) => call(`/p/${seg(name)}/deskrpg/toolsets`, profileToken),
    getSkills: (name, profileToken) => call(`/p/${seg(name)}/deskrpg/skills`, profileToken),
    getToolProviders: (name, profileToken, toolset) =>
      call(`/p/${seg(name)}/deskrpg/toolsets/${seg(toolset)}/providers`, profileToken),
    putToolProvider: (name, profileToken, toolset, body) =>
      call(`/p/${seg(name)}/deskrpg/toolsets/${seg(toolset)}/provider`, profileToken, {
        method: "PUT",
        body,
      }),

    // 프로바이더 인증(0.9.0). 전부 프로필 스코프·프로필 토큰 — 세그먼트는 전부 인코딩한다.
    startOAuth: (name, profileToken, provider) =>
      call(`/p/${seg(name)}/deskrpg/oauth/${seg(provider)}/start`, profileToken, {
        method: "POST",
      }),
    pollOAuth: (name, profileToken, provider, sessionId) =>
      call(
        `/p/${seg(name)}/deskrpg/oauth/${seg(provider)}/sessions/${seg(sessionId)}`,
        profileToken,
      ),
    cancelOAuth: (name, profileToken, sessionId) =>
      call(`/p/${seg(name)}/deskrpg/oauth/sessions/${seg(sessionId)}`, profileToken, {
        method: "DELETE",
      }),
    disconnectOAuth: (name, profileToken, provider) =>
      call(`/p/${seg(name)}/deskrpg/oauth/${seg(provider)}`, profileToken, { method: "DELETE" }),
    putProviderKey: (name, profileToken, provider, value) =>
      call(`/p/${seg(name)}/deskrpg/provider-keys/${seg(provider)}`, profileToken, {
        method: "PUT",
        body: { value },
      }),
    deleteProviderKey: (name, profileToken, provider) =>
      call(`/p/${seg(name)}/deskrpg/provider-keys/${seg(provider)}`, profileToken, {
        method: "DELETE",
      }),
  };
}

// ---------------------------------------------------------------------------
// 자동화 계약(v0.6.0+) — 오너 키 클라이언트(칸반·이벤트) / 프로필 키 클라이언트(크론)
//
// 토큰을 **생성 시점에** 고정한다. `PluginClient` 처럼 메서드마다 토큰을 받으면 칸반
// 호출에 프로필 키를 넘기는 실수가 타입으로 막히지 않는다(둘 다 string). 오너 클라이언트에는
// 프로필 경로가 없고 프로필 클라이언트에는 오너 경로가 없으니, 섞을 자리 자체가 없다.
// ---------------------------------------------------------------------------

/** 오너(게이트웨이) 키로만 부르는 표면 — `/deskrpg/info`, `/deskrpg/kanban/*`, `/deskrpg/events`. */
export function createOwnerPluginClient(
  input: TransportInput & { ownerToken: string },
): OwnerPluginClient {
  const { call, callRaw } = createPluginTransport(input);
  const token = input.ownerToken;
  const seg = (value: string) => encodeURIComponent(value);
  const task = (board: string, id: string, suffix = "") =>
    `/deskrpg/kanban/tasks/${seg(id)}${suffix}${query({ board })}`;

  const kanban: KanbanApi = {
    listBoards: () => call("/deskrpg/kanban/boards", token),
    createBoard: (body) => call("/deskrpg/kanban/boards", token, { method: "POST", body }),
    updateBoard: (slug, body) =>
      call(`/deskrpg/kanban/boards/${seg(slug)}`, token, { method: "PATCH", body }),

    getBoard: (board, opts) =>
      call(
        `/deskrpg/kanban/board${query({
          board,
          include_archived: opts?.includeArchived ? true : undefined,
        })}`,
        token,
      ),
    getTask: (board, id) => call(task(board, id), token),
    listLinks: (board) => call(`/deskrpg/kanban/links${query({ board })}`, token),
    listRuns: (board, opts) =>
      call(
        `/deskrpg/kanban/runs${query({
          board,
          from: opts?.from,
          to: opts?.to,
          limit: opts?.limit,
        })}`,
        token,
      ),
    createTask: (board, body) =>
      call(`/deskrpg/kanban/tasks${query({ board })}`, token, { method: "POST", body }),
    updateTask: (board, id, body) => call(task(board, id), token, { method: "PATCH", body }),
    deleteTask: (board, id) => call(task(board, id), token, { method: "DELETE" }),
    addComment: (board, id, body) =>
      call(task(board, id, "/comments"), token, { method: "POST", body }),
    runTaskAction: (board, id, action, body, actor) =>
      call(task(board, id, `/${action}`), token, {
        method: "POST",
        body,
        ...(actor
          ? {
              headers: {
                "X-DeskRPG-User-Id": actor.userId,
                ...(actor.name ? { "X-DeskRPG-User-Name": encodeURIComponent(actor.name) } : {}),
              },
            }
          : {}),
      }),

    listAttachments: (board, id) => call(task(board, id, "/attachments"), token),
    listBoardAttachments: (board, opts) =>
      call(
        `/deskrpg/kanban/attachments${query({ board, limit: opts?.limit, cursor: opts?.cursor })}`,
        token,
      ),
    uploadAttachment: (board, id, file) => {
      const formData = new FormData();
      const blob = typeof file.content === "string" ? new Blob([file.content]) : file.content;
      formData.append("file", blob, file.filename);
      return call(task(board, id, "/attachments"), token, { method: "POST", formData });
    },
    attachmentContent: (board, attachmentId, opts) =>
      callRaw(`/deskrpg/kanban/attachments/${seg(attachmentId)}${query({ board })}`, token, {
        headers: opts.range ? { range: opts.range } : {},
      }),
    deleteAttachment: (board, attachmentId) =>
      call(`/deskrpg/kanban/attachments/${seg(attachmentId)}${query({ board })}`, token, {
        method: "DELETE",
      }),

    addLink: (board, body) =>
      call(`/deskrpg/kanban/links${query({ board })}`, token, { method: "POST", body }),
    removeLink: (board, body) =>
      call(`/deskrpg/kanban/links${query({ board })}`, token, { method: "DELETE", body }),

    dispatch: (board, opts) =>
      call(`/deskrpg/kanban/dispatch${query({ board, max: opts?.max })}`, token, {
        method: "POST",
        body: {},
      }),

    createSwarm: (board, body) =>
      call(`/deskrpg/kanban/swarm?board=${encodeURIComponent(board)}`, token, {
        method: "POST",
        body,
      }),
    getBlackboard: (board, id) => call(task(board, id, "/blackboard"), token),

    getTaskLog: (board, id, opts) =>
      call(`/deskrpg/kanban/tasks/${seg(id)}/log${query({ board, tail: opts?.tail })}`, token),

    getOrchestration: () => call("/deskrpg/kanban/orchestration", token),
    updateOrchestration: (body) =>
      call("/deskrpg/kanban/orchestration", token, { method: "PUT", body }),
    listProfiles: () => call("/deskrpg/kanban/profiles", token),
  };

  const events: EventsApi = {
    poll: (opts) =>
      call(
        `/deskrpg/events${query({
          board: opts.board,
          cursor: opts.cursor,
          limit: opts.limit,
          include: opts.include,
        })}`,
        token,
      ),
  };

  const artifacts: ArtifactsApi = {
    list: (q) =>
      call(
        `/deskrpg/artifacts${query({
          profiles: q.profiles.length ? q.profiles.join(",") : undefined,
          board: q.board,
          kind: q.kind,
          source: q.source,
          q: q.q,
          cursor: q.cursor,
          limit: q.limit,
          task_id: q.taskId,
        })}`,
        token,
      ),
    get: (id) => call(`/deskrpg/artifacts/${seg(id)}`, token),
    content: (id, version, opts) =>
      callRaw(
        `/deskrpg/artifacts/${seg(id)}/versions/${version}/content${query({
          download: opts.download ? 1 : undefined,
        })}`,
        token,
        { headers: opts.range ? { range: opts.range } : {} },
      ),
    addVersion: (id, body, user) =>
      call(`/deskrpg/artifacts/${seg(id)}/versions`, token, {
        method: "POST",
        body,
        headers: { "x-deskrpg-user": user },
      }),
    remove: (id, user) =>
      call(`/deskrpg/artifacts/${seg(id)}`, token, {
        method: "DELETE",
        headers: { "x-deskrpg-user": user },
      }),
  };

  const cardProposals: CardProposalsApi = {
    resolve: (proposalId, body) =>
      call(`/deskrpg/card-proposals/${seg(proposalId)}/resolve`, token, { method: "POST", body }),
    unresolve: (proposalId) =>
      call(`/deskrpg/card-proposals/${seg(proposalId)}/unresolve`, token, {
        method: "POST",
        body: {},
      }),
    recordTask: (proposalId, body) =>
      call(`/deskrpg/card-proposals/${seg(proposalId)}/task`, token, { method: "POST", body }),
  };

  return {
    info: () => call("/deskrpg/info", token),
    kanban,
    events,
    artifacts,
    cardProposals,
  };
}

/** 한 프로필의 키로만 부르는 표면 — `/p/{profile}/deskrpg/cron/*`. */
export function createProfilePluginClient(
  input: TransportInput & { profileName: string; profileToken: string },
): ProfilePluginClient {
  const { call } = createPluginTransport(input);
  const token = input.profileToken;
  const seg = (value: string) => encodeURIComponent(value);
  // `hermes-client.ts` 와 같은 프리픽스 규약 — 프로필 스코프는 `/p/<name>` 뒤에 붙는다.
  const root = `/p/${seg(input.profileName)}/deskrpg/cron`;
  const job = (id: string, suffix = "") => `${root}/jobs/${seg(id)}${suffix}`;

  const cron: CronApi = {
    listJobs: (opts) =>
      call(
        `${root}/jobs${query({ include_disabled: opts?.includeDisabled ? true : undefined })}`,
        token,
      ),
    getJob: (id) => call(job(id), token),
    listRuns: (id, opts) => call(`${job(id, "/runs")}${query({ limit: opts?.limit })}`, token),
    createJob: (body) => call(`${root}/jobs`, token, { method: "POST", body }),
    updateJob: (id, body) => call(job(id), token, { method: "PUT", body }),
    pauseJob: (id) => call(job(id, "/pause"), token, { method: "POST", body: {} }),
    resumeJob: (id) => call(job(id, "/resume"), token, { method: "POST", body: {} }),
    runJob: (id) => call(job(id, "/run"), token, { method: "POST", body: {} }),
    deleteJob: (id) => call(job(id), token, { method: "DELETE" }),
    listDeliveryTargets: () => call(`${root}/delivery-targets`, token),
    listBlueprints: () => call(`${root}/blueprints`, token),
    instantiateBlueprint: (body) =>
      call(`${root}/blueprints/instantiate`, token, { method: "POST", body }),
  };

  return { profileName: input.profileName, cron };
}
