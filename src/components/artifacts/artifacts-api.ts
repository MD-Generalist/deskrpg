/**
 * 결과물 REST(`/api/channels/:id/artifacts/**`)의 브라우저 쪽 호출.
 *
 * 브라우저는 Hermes 를 직접 부르지 않는다 — 전부 같은 출처의 DeskRPG 라우트이고, 인증은
 * 앱의 다른 fetch 와 같이 세션 쿠키로 간다. 실패는 서버가 내려 준 `{code, message, …}` 를
 * 그대로 `ArtifactsApiError` 에 실어 던진다 — 여기서 번역하거나 접지 않는다.
 */

import type {
  ArtifactDetail,
  ArtifactKind,
  ArtifactPage,
  ArtifactSource,
  ArtifactVersion,
} from "@/lib/hermes/deskrpg-plugin-types";

export class ArtifactsApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly minVersion?: string;

  constructor(status: number, code: string, message: string, minVersion?: string) {
    super(message);
    this.name = "ArtifactsApiError";
    this.status = status;
    this.code = code;
    this.minVersion = minVersion;
  }
}

export type ArtifactListFilter = {
  kind?: ArtifactKind;
  source?: ArtifactSource;
  profile?: string;
  q?: string;
  taskId?: string;
};

type FetchLike = typeof fetch;

function base(channelId: string): string {
  return `/api/channels/${encodeURIComponent(channelId)}/artifacts`;
}

async function parseFailure(res: Response): Promise<ArtifactsApiError> {
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
  const minVersion = typeof body.minVersion === "string" ? body.minVersion : undefined;
  return new ArtifactsApiError(res.status, code, message, minVersion);
}

async function request<T>(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    throw new ArtifactsApiError(
      0,
      "network_error",
      err instanceof Error ? err.message : String(err),
    );
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
 */
export function createArtifactsApi(channelId: string, fetchImpl?: FetchLike) {
  const f: FetchLike = (input, init) => (fetchImpl ?? globalThis.fetch)(input, init);
  const root = base(channelId);
  const artifact = (id: string) => `${root}/${encodeURIComponent(id)}`;

  return {
    list: async (filter: ArtifactListFilter, cursor?: string): Promise<ArtifactPage> => {
      const qs = new URLSearchParams();
      if (filter.kind) qs.set("kind", filter.kind);
      if (filter.source) qs.set("source", filter.source);
      if (filter.profile) qs.set("profile", filter.profile);
      if (filter.q) qs.set("q", filter.q);
      if (filter.taskId) qs.set("taskId", filter.taskId);
      if (cursor) qs.set("cursor", cursor);
      qs.set("limit", "50");
      const suffix = qs.size > 0 ? `?${qs}` : "";
      return request<ArtifactPage>(f, `${root}${suffix}`);
    },
    get: (id: string) => request<ArtifactDetail>(f, artifact(id)),
    contentUrl: (id: string, version: number, download?: boolean): string => {
      const suffix = download ? "?download=1" : "";
      return `${artifact(id)}/versions/${version}/content${suffix}`;
    },
    fetchText: async (
      id: string,
      version: number,
      maxBytes: number,
    ): Promise<{ text: string; truncated: boolean }> => {
      let res: Response;
      try {
        res = await f(`${artifact(id)}/versions/${version}/content`, {
          headers: { range: `bytes=0-${maxBytes - 1}` },
        });
      } catch (err) {
        throw new ArtifactsApiError(
          0,
          "network_error",
          err instanceof Error ? err.message : String(err),
        );
      }
      if (!res.ok) throw await parseFailure(res);
      const text = await res.text();
      const truncated =
        res.status === 206 &&
        (res.headers.get("content-range")?.split("/")[1] || "").localeCompare(String(text.length)) >
          0;
      return { text, truncated };
    },
    fetchBlob: async (id: string, version: number): Promise<Blob> => {
      let res: Response;
      try {
        res = await f(`${artifact(id)}/versions/${version}/content`);
      } catch (err) {
        throw new ArtifactsApiError(
          0,
          "network_error",
          err instanceof Error ? err.message : String(err),
        );
      }
      if (!res.ok) throw await parseFailure(res);
      return res.blob();
    },
    addVersion: async (
      id: string,
      body: { content: string; filename: string; note?: string },
    ): Promise<ArtifactVersion> => {
      const result = await request<{ version: ArtifactVersion }>(
        f,
        `${artifact(id)}/versions`,
        json("POST", body),
      );
      return result.version;
    },
    remove: (id: string) => request<{ ok: true }>(f, artifact(id), { method: "DELETE" }),
  };
}

export type ArtifactsApi = ReturnType<typeof createArtifactsApi>;
