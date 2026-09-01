/**
 * 플러그인 응답을 화면이 쓸 실패 서술로 옮긴다.
 *
 * 플러그인은 실패를 **정직하게** 보고하도록 만들어졌다(읽을 수 없는 파일은
 * 500 이 아니라 `unreadable: true` / 409, 삭제 거절은 이유와 셸 명령 포함).
 * 화면이 그걸 "오류가 발생했습니다" 로 뭉개면 그 설계가 통째로 무의미해진다.
 *
 * `blocksEditor` 가 참이면 편집기를 **열지 않는다** — 빈 편집기를 열면
 * 사용자가 저장 버튼 한 번으로 사람이 쓴 인격을 지운다.
 *
 * 리뷰 라운드 1 I-2: `error`/`reason` 외의 구조화 필드(재읽기용 `currentRevision`,
 * 이름 충돌의 `name`, 삭제 거절의 `unit` 등)가 통째로 버려지고 있었다. `details` 에
 * 그대로 옮겨 화면이 "이름 'noah' 가 이미 있습니다" 같은 구체적 문장을 만들 수 있게 한다.
 *
 * 수정 라운드 2 — 라이브 실측(team-lead, MiniPC 게이트웨이, Hermes v0.21.0): `error`
 * 필드가 세 가지 다른 모양으로 온다.
 *
 *     404  { "error": "Unknown or unconfigured profile" }         — 평문 문장
 *     401  { "error": { "message": "...", "type": "gateway_auth_error",
 *                       "code": "gateway_auth_failed" } }         — 객체, 진짜 코드는 안에
 *     409  { "error": "config_unreadable", "reason": "..." }      — 짧은 코드 (기존 가정)
 *
 * `typeof record.error === "string" ? record.error : "plugin_error"` 하나로는 세 모양을
 * 다 다루지 못한다 — 문장이 그대로 `code` 자리에 흘러(위 사전엔 없는 값, Hermes 버전이
 * 바뀌면 문구도 바뀜) `wizard-error-codes.ts` 가 감당 못 하고, 객체는 `plugin_error` 로
 * 접히며 안의 진짜 코드(`gateway_auth_failed`)를 잃는다. `extractCodeAndMessage` 가 세
 * 모양을 각각 다룬다: 코드처럼 생긴 문자열은 그대로 코드로, 객체는 안의 `code`/`message`
 * 를 꺼내고, 그 외(문장)는 코드를 `upstream_error` 로 접되 **문장 자체는 `message` 에
 * 보존**한다 — 코드처럼 생겼는지 판정은 휴리스틱이라 경계에서 틀릴 수 있지만, 문장이
 * 코드 자리에 확실히 오는 지금 상태보다는 낫다.
 */

export type PluginFailure = {
  code: string;
  message: string;
  /** 편집기를 열면 안 되는 상태인가 (빈 화면으로 원본을 덮어쓸 위험) */
  blocksEditor: boolean;
  /** 사용자가 셸에서 실행해야 하는 명령. 없으면 null */
  showsShellCommand: string | null;
  /** `error`/`reason` 을 뺀 나머지 본문 필드(currentRevision·name·unit 등). 없으면 빈 객체 */
  details: Record<string, unknown>;
};

/** 파일을 해석할 수 없다는 뜻의 코드들 — 전부 편집기를 막는다. */
const UNREADABLE_CODES = new Set(["identity_unreadable", "config_unreadable"]);

/**
 * 셸 명령을 화면에 그대로 보여줘도 되는 코드 화이트리스트 (M-3).
 *
 * 예전에는 `message` 가 `: hermes ...` 형태로 끝나기만 하면 코드와 무관하게 뽑아냈다.
 * `revision_conflict` 같은 다른 코드의 설명문이 우연히 같은 모양으로 끝나면 무관한
 * 명령 버튼이 뜬다 — 실제로 셸 정리를 요구하는 `profile_has_service` 로만 좁힌다.
 */
const SHELL_COMMAND_CODES = new Set(["profile_has_service"]);

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

function extractShellCommand(reason: string): string | null {
  // 플러그인이 `... 셸에서 정리하세요: hermes profile delete noah` 형태로 준다.
  const match = /:\s*(hermes\s+[^\n]+?)\s*$/.exec(reason);
  return match ? match[1] : null;
}

/** `record` 에서 `error`/`reason`(과 `unreadable`)을 뺀 나머지를 `details` 로 옮긴다. */
function extractDetails(record: Record<string, unknown>, omit: string[]): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!omit.includes(key)) details[key] = value;
  }
  return details;
}

/**
 * 공백이 없고 문자·숫자·밑줄·하이픈만으로 이뤄져 있으면 "코드처럼 생겼다" 고 본다
 * (`config_unreadable`, `already_exists`, `gateway_auth_failed` 는 통과, `Unknown or
 * unconfigured profile` 은 공백 때문에 탈락). 휴리스틱이라 경계에서 틀릴 수 있지만,
 * 실측된 세 모양(모듈 주석 참조)을 가르는 데는 이걸로 충분하고, 애매할 때 문장을
 * 코드 자리에 흘리는 것보다는 안전한 쪽으로 접는다.
 */
const CODE_LIKE_RE = /^[a-z][a-z0-9_-]*$/i;

function isCodeLikeString(value: string): boolean {
  return CODE_LIKE_RE.test(value);
}

/**
 * `record.error` 의 세 모양(문자열-코드 / 문자열-문장 / 객체)을 갈라 `{code, message}`
 * 로 접는다. 모듈 주석의 라이브 실측 참조.
 */
function extractCodeAndMessage(record: Record<string, unknown>): { code: string; message: string } {
  const errorField = record.error;
  const reason = typeof record.reason === "string" ? record.reason : "";

  if (errorField && typeof errorField === "object" && !Array.isArray(errorField)) {
    // 401 gateway_auth_error 모양 — 진짜 코드는 안에 있다. 없으면 뭉뚱그린다.
    const nested = errorField as Record<string, unknown>;
    const nestedCode = typeof nested.code === "string" ? nested.code : "plugin_error";
    const nestedMessage = typeof nested.message === "string" ? nested.message : reason;
    return { code: nestedCode, message: nestedMessage };
  }

  if (typeof errorField === "string") {
    if (isCodeLikeString(errorField)) return { code: errorField, message: reason };
    // 평문 문장이다 — 코드 자리에 문장을 넣지 않는다. 문장은 잃지 않고 message 에 담는다.
    return { code: "upstream_error", message: errorField || reason };
  }

  return { code: "plugin_error", message: reason };
}

export function mapPluginFailure(input: { status: number; body: unknown }): PluginFailure | null {
  const record = asRecord(input.body);

  if (input.status >= 200 && input.status < 300) {
    // 200 인데도 실패인 유일한 경우 — 파일을 읽지 못했다.
    if (record.unreadable === true) {
      return {
        code: "unreadable",
        message: typeof record.reason === "string" ? record.reason : "",
        blocksEditor: true,
        showsShellCommand: null,
        details: extractDetails(record, ["reason", "unreadable"]),
      };
    }
    return null;
  }

  const { code, message } = extractCodeAndMessage(record);
  const showsShellCommand =
    message && SHELL_COMMAND_CODES.has(code) ? extractShellCommand(message) : null;

  return {
    code,
    message,
    // M-4: unreachable(클라이언트 계층)과 마찬가지로 5xx 는 "서버가 응답을 못 줬다" 는
    // 뜻이라 이름 있는 unreadable 코드와 같은 취급을 한다 — 열어봤자 저장 시점에 다시 실패한다.
    blocksEditor: UNREADABLE_CODES.has(code) || input.status >= 500,
    showsShellCommand,
    details: extractDetails(record, ["error", "reason"]),
  };
}
