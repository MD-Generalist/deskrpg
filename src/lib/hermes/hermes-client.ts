import { streamDiagnostic } from "./stream-diagnostics";
import { transportFetch } from "./setup/transport";
// Profile-scoped HTTP client for the Hermes API Server.
// Knows URLs, auth and error shapes. Knows nothing about DeskRPG's DB.

import { createSseParser, type SseEvent } from "./sse";
import { isTerminalEvent, type HermesCapabilities } from "./types";

export type HermesErrorCode =
  "unauthorized" | "unknown_profile" | "unreachable" | "http_error" | "run_failed";

import { parseRetryAfterMs, retryDelayMs, shouldRetryStatus } from "./retry-policy";

export class HermesError extends Error {
  readonly code: HermesErrorCode;
  readonly status: number;

  constructor(code: HermesErrorCode, message: string, status: number) {
    super(message);
    this.name = "HermesError";
    this.code = code;
    this.status = status;
  }
}

export type HermesClientConfig = {
  baseUrl: string;
  /** null = the gateway's default profile (no /p/ prefix). */
  profileName: string | null;
  token: string;
  fetchImpl?: typeof fetch;
  /** 테스트가 실제로 기다리지 않게 하는 주입 지점. */
  sleepImpl?: (ms: number) => Promise<void>;
};

/** 최초 1회 뒤 몇 번까지 다시 걸어 볼지. 회의 한 턴이 붙들리는 시간을 감안한 값이다. */
const MAX_RETRIES = 2;

function errorCodeForStatus(status: number): HermesErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "unknown_profile";
  return "http_error";
}

export class HermesClient {
  private readonly baseUrl: string;
  private readonly profileName: string | null;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(config: HermesClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.profileName = config.profileName;
    this.token = config.token;
    this.fetchImpl = config.fetchImpl ?? transportFetch;
    this.sleepImpl = config.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  }

  url(path: string): string {
    const prefix = this.profileName ? `/p/${encodeURIComponent(this.profileName)}` : "";
    return `${this.baseUrl}${prefix}${path}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  /**
   * 게이트웨이가 동시 실행 상한을 넘겼다고 429 로 거절하면 잠깐 기다렸다 다시 건다.
   *
   * 예전에는 그 거절이 그대로 예외가 되어 호출부까지 올라갔고, 회의 폴링은 실패한
   * 참가자를 조용히 건너뛰었다 — 그 NPC 는 raises 에도 passes 에도 없이 사라졌다.
   * Hermes 는 `Retry-After` 까지 붙여 주므로 버릴 이유가 없다.
   */
  private async request(
    path: string,
    init: RequestInit & { sessionKey?: string } = {},
  ): Promise<Response> {
    const { sessionKey, ...rest } = init;

    for (let attempt = 0; ; attempt += 1) {
      let res: Response;
      try {
        res = await this.fetchImpl(this.url(path), {
          ...rest,
          headers: this.headers(sessionKey ? { "X-Hermes-Session-Key": sessionKey } : undefined),
        });
      } catch (err) {
        throw new HermesError(
          "unreachable",
          err instanceof Error ? err.message : "Gateway unreachable",
          0,
        );
      }

      if (res.ok) return res;

      if (shouldRetryStatus(res.status) && attempt < MAX_RETRIES) {
        // 본문을 읽어 소켓을 비운다 — 읽지 않고 버리면 연결이 재사용되지 않는다.
        await res.text().catch(() => "");
        await this.sleepImpl(
          retryDelayMs(attempt, parseRetryAfterMs(res.headers.get("Retry-After"))),
        );
        continue;
      }

      const text = await res.text().catch(() => "");
      throw new HermesError(
        errorCodeForStatus(res.status),
        text || `HTTP ${res.status}`,
        res.status,
      );
    }
  }

  async getCapabilities(): Promise<HermesCapabilities> {
    const res = await this.request("/v1/capabilities", { method: "GET" });
    return (await res.json()) as HermesCapabilities;
  }

  /** 제목으로 기존 세션을 찾는다. 없으면 null. */
  private async findSessionByTitle(title: string): Promise<string | null> {
    try {
      const res = await this.request("/api/sessions", { method: "GET" });
      const json = (await res.json()) as { data?: { id?: string; title?: string | null }[] };
      const hit = (json.data ?? []).find((s) => s.title === title && s.id);
      return hit?.id ?? null;
    } catch {
      return null;
    }
  }

  async createSession(title: string): Promise<{ sessionId: string }> {
    let res: Response;
    try {
      res = await this.request("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ title }),
      });
    } catch (err) {
      // Hermes 는 제목의 유일성을 강제한다 — 이미 쓰이면 `invalid_title` 로 거절하고
      // 어느 세션이 갖고 있는지까지 말해 준다. 우리 제목은 NPC×사용자 컨텍스트 키라
      // 충돌은 곧 "그 대화가 이미 있다"는 뜻이므로, 새로 만들 게 아니라 이어야 한다.
      // (이전 버전이 응답 파싱에 실패해 Hermes 쪽에만 남긴 고아 세션들이 정확히 이
      //  경우다 — 재시도할 때마다 같은 제목으로 부딪혔다.)
      const isTitleTaken =
        err instanceof HermesError && /invalid_title|Title already in use/i.test(err.message);
      if (!isTitleTaken) throw err;
      const existing = await this.findSessionByTitle(title);
      if (!existing) throw err;
      return { sessionId: existing };
    }
    // 실측(v0.20.2): POST /api/sessions 는 id 를 **중첩해서** 돌려준다 —
    //   { "object": "hermes.session", "session": { "id": "api_…", … } }
    // 최상위 session_id/id 만 보던 탓에 1:1 대화가 "Session create returned no id"
    // 로 죽었다. 두 평평한 형태도 계속 받아 준다(구버전/다른 배포 대비).
    const json = (await res.json()) as {
      session_id?: string;
      id?: string;
      session?: { id?: string; session_id?: string };
    };
    const sessionId = json.session?.id ?? json.session?.session_id ?? json.session_id ?? json.id;
    if (!sessionId) throw new HermesError("http_error", "Session create returned no id", 200);
    return { sessionId };
  }

  /**
   * Drain an SSE body, feeding every event to onEvent and folding the text.
   *
   * On a terminal event we stop reading the underlying stream entirely and
   * cancel the reader. A real Hermes server can keep the HTTP connection
   * open past `run.completed`/`done`/etc — if we only broke the inner
   * `for...of` over parsed events, the outer `reader.read()` loop would
   * keep awaiting the next chunk forever.
   */
  private async drain(
    res: Response,
    onEvent: (event: SseEvent) => void,
  ): Promise<{ text: string; runId: string | null; sessionId: string | null }> {
    const parser = createSseParser();
    const decoder = new TextDecoder();
    const reader = res.body?.getReader();

    let accumulated = "";
    let completed: string | null = null;
    let runId: string | null = null;
    let sessionId: string | null = null;
    let failure: string | null = null;

    if (reader) {
      outer: for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        streamDiagnostic({ stage: "sse-read", runId, bytes: value.byteLength });

        for (const event of parser.push(decoder.decode(value, { stream: true }))) {
          streamDiagnostic({
            stage: "sse-event",
            runId: typeof event.data.run_id === "string" ? event.data.run_id : runId,
            event: event.event,
            length:
              typeof event.data.delta === "string"
                ? event.data.delta.length
                : typeof event.data.content === "string"
                  ? event.data.content.length
                  : 0,
          });
          onEvent(event);

          if (typeof event.data.run_id === "string") runId = event.data.run_id;
          if (typeof event.data.session_id === "string") sessionId = event.data.session_id;

          // 두 엔드포인트가 델타 이벤트 이름을 달리 쓴다(실측 v0.20.2):
          //   1:1  /api/sessions/<id>/chat/stream → assistant.delta / assistant.completed
          //   회의 /v1/runs/<id>/events          → message.delta   / message.completed
          // assistant.* 만 보던 탓에 회의 경로에서는 텍스트가 한 글자도 쌓이지 않았고,
          // 폴링 응답이 빈 문자열이 되어 모든 NPC 가 PASS 로 집계됐다.
          if (
            (event.event === "assistant.delta" || event.event === "message.delta") &&
            typeof event.data.delta === "string"
          ) {
            accumulated += event.data.delta;
          } else if (
            (event.event === "assistant.completed" || event.event === "message.completed") &&
            typeof event.data.content === "string"
          ) {
            completed = event.data.content;
          } else if (
            // 회의 경로(/v1/runs)는 message.completed 를 내지 않고 최종 답을 run.completed 의
            // output(final_response)에 싣는다. 델타는 되돌려지지 않아, 모델 호출이 재시도되면 앞선
            // 시도의 글까지 쌓인다 — 누적분 대신 이것을 본문으로 쓴다. 비었으면 누적분으로 둔다.
            event.event === "run.completed" &&
            typeof event.data.output === "string" &&
            event.data.output.trim()
          ) {
            completed = event.data.output;
          } else if (event.event === "run.failed" || event.event === "error") {
            failure =
              typeof event.data.message === "string" ? event.data.message : "Hermes run failed";
          }

          if (isTerminalEvent(event.event)) {
            // 취소를 **기다리지 않는다**. 여기서 하려는 일은 "더 이상 읽지 않는 것"이지
            // "취소 정리가 끝나는 것"이 아니다. 실측(v0.20.2): 회의 경로
            // (/v1/runs/<id>/events)는 run.completed 를 보낸 뒤에도 연결을 열어 두는데,
            // 그 상태에서 await reader.cancel() 은 resolve 도 reject 도 하지 않고 영영
            // 멈춘다 — .catch() 는 reject 만 잡으므로 이 교착을 막지 못했다. 회의는
            // 폴링 응답을 Promise.allSettled 로 모으므로 참가자 하나가 여기 걸리면 회의
            // 전체가 멈춘다. 1:1 경로(/api/sessions/<id>/chat/stream)는 서버가 스트림을
            // 곧바로 닫아 주기 때문에 이 함정이 드러나지 않았다.
            void reader.cancel().catch(() => {});
            break outer;
          }
        }
      }
    }
    parser.flush();

    // A run.failed/error SSE event is a healthy 200 stream reporting that the
    // agent run itself failed — not an HTTP-layer error. Callers (e.g. NPC
    // chat surfaces) need to tell the two apart to render a useful message.
    if (failure) throw new HermesError("run_failed", failure, 200);
    return { text: completed ?? accumulated, runId, sessionId };
  }

  async streamSessionChat(args: {
    sessionId: string;
    message: string;
    /**
     * 이 턴의 시스템 지시. Hermes 는 `system_message` 를 `instructions` 보다 먼저
     * 보고(api_server 의 `body.get("system_message") or body.get("instructions")`),
     * 둘 다 같은 ephemeral 시스템 프롬프트로 흘러간다. 빈 값이면 필드를 만들지 않는다.
     */
    systemMessage?: string;
    sessionKey?: string;
    onEvent: (event: SseEvent) => void;
  }): Promise<{ text: string; runId: string | null; sessionId: string }> {
    const chatBody: Record<string, unknown> = { message: args.message };
    if (args.systemMessage) chatBody.system_message = args.systemMessage;
    const res = await this.request(
      `/api/sessions/${encodeURIComponent(args.sessionId)}/chat/stream`,
      {
        method: "POST",
        body: JSON.stringify(chatBody),
        sessionKey: args.sessionKey,
      },
    );
    const drained = await this.drain(res, args.onEvent);
    return {
      text: drained.text,
      runId: drained.runId,
      sessionId: drained.sessionId ?? args.sessionId,
    };
  }

  async startRun(args: {
    input: string;
    conversationHistory?: Array<{ role: string; content: string }>;
    instructions?: string;
    sessionKey?: string;
  }): Promise<{ runId: string }> {
    const body: Record<string, unknown> = { input: args.input };
    if (args.conversationHistory?.length) body.conversation_history = args.conversationHistory;
    if (args.instructions) body.instructions = args.instructions;

    const res = await this.request("/v1/runs", {
      method: "POST",
      body: JSON.stringify(body),
      sessionKey: args.sessionKey,
    });
    const json = (await res.json()) as { run_id?: string };
    if (!json.run_id) throw new HermesError("http_error", "Run submission returned no run_id", 202);
    return { runId: json.run_id };
  }

  async streamRunEvents(
    runId: string,
    onEvent: (event: SseEvent) => void,
  ): Promise<{ text: string }> {
    const res = await this.request(`/v1/runs/${encodeURIComponent(runId)}/events`, {
      method: "GET",
    });
    const drained = await this.drain(res, onEvent);
    return { text: drained.text };
  }

  async stopRun(runId: string): Promise<void> {
    await this.request(`/v1/runs/${encodeURIComponent(runId)}/stop`, {
      method: "POST",
      body: "{}",
    });
  }

  async steerRun(runId: string, text: string): Promise<void> {
    await this.request(`/v1/runs/${encodeURIComponent(runId)}/steer`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  }
}
