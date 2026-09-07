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

export type PluginResponse<T> =
  { ok: true; data: T } | { ok: false; failure: PluginFailure; status: number };

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
  putConfig(
    name: string,
    profileToken: string,
    patch: Record<string, unknown>,
  ): Promise<PluginResponse<Record<string, unknown>>>;
};

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

export function createPluginClient(input: {
  baseUrl: string;
  defaultToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): PluginClient {
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = input.baseUrl.replace(/\/+$/, "");
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call<T>(
    path: string,
    token: string,
    init: { method?: string; body?: unknown } = {},
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
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
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

  // 프로필 이름은 검증을 통과하지 않은 채 들어올 수 있는 경로가 있다(사용자 입력).
  const seg = (name: string) => encodeURIComponent(name);

  return {
    listProfiles: () => call("/deskrpg/profiles", input.defaultToken),

    createProfile: (name) =>
      call("/deskrpg/profiles", input.defaultToken, { method: "POST", body: { name } }),

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

    putConfig: (name, profileToken, patch) =>
      call(`/p/${seg(name)}/deskrpg/config`, profileToken, { method: "PUT", body: patch }),
  };
}
