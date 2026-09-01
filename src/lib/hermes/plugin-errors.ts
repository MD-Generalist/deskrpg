/**
 * 플러그인 응답을 화면이 쓸 실패 서술로 옮긴다.
 *
 * 플러그인은 실패를 **정직하게** 보고하도록 만들어졌다(읽을 수 없는 파일은
 * 500 이 아니라 `unreadable: true` / 409, 삭제 거절은 이유와 셸 명령 포함).
 * 화면이 그걸 "오류가 발생했습니다" 로 뭉개면 그 설계가 통째로 무의미해진다.
 *
 * `blocksEditor` 가 참이면 편집기를 **열지 않는다** — 빈 편집기를 열면
 * 사용자가 저장 버튼 한 번으로 사람이 쓴 인격을 지운다.
 */

export type PluginFailure = {
  code: string;
  message: string;
  /** 편집기를 열면 안 되는 상태인가 (빈 화면으로 원본을 덮어쓸 위험) */
  blocksEditor: boolean;
  /** 사용자가 셸에서 실행해야 하는 명령. 없으면 null */
  showsShellCommand: string | null;
};

/** 파일을 해석할 수 없다는 뜻의 코드들 — 전부 편집기를 막는다. */
const UNREADABLE_CODES = new Set(["identity_unreadable", "config_unreadable"]);

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

function extractShellCommand(reason: string): string | null {
  // 플러그인이 `... 셸에서 정리하세요: hermes profile delete noah` 형태로 준다.
  const match = /:\s*(hermes\s+[^\n]+?)\s*$/.exec(reason);
  return match ? match[1] : null;
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
      };
    }
    return null;
  }

  const code = typeof record.error === "string" ? record.error : "plugin_error";
  const message = typeof record.reason === "string" ? record.reason : "";

  return {
    code,
    message,
    blocksEditor: UNREADABLE_CODES.has(code),
    showsShellCommand: message ? extractShellCommand(message) : null,
  };
}
