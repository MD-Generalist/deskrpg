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
};

export function createPluginClient(input: {
  baseUrl: string;
  defaultToken: string;
  fetchImpl?: typeof fetch;
}): PluginClient {
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = input.baseUrl.replace(/\/+$/, "");

  async function call<T>(
    path: string,
    token: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<PluginResponse<T>> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method: init.method ?? "GET",
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    } catch {
      return { ok: false, failure: UNREACHABLE, status: 0 };
    }

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
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
