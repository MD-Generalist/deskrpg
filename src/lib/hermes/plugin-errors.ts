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

  const code = typeof record.error === "string" ? record.error : "plugin_error";
  const message = typeof record.reason === "string" ? record.reason : "";
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
