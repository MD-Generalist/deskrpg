type Translator = (key: string, params?: Record<string, string | number>) => string;

const NPC_RESPONSE_MESSAGE_KEYS = {
  no_agent: "npc.noAgent",
  gateway_not_connected: "npc.gatewayNotConnected",
  /**
   * 하위 호환 폴백. 예전 서버·예전 클라이언트가 주고받던 뭉뚱그린 코드라 지우지 않는다 —
   * 새 코드는 아래 네 가지 중 하나를 쓴다(classify-gateway-failure.ts).
   */
  gateway_error: "npc.gatewayError",
  /** 게이트웨이 주소에 아무도 없다 — 프로세스가 떠 있는지부터 본다. */
  gateway_unreachable: "npc.gatewayUnreachable",
  /** 게이트웨이는 응답했지만 키를 거부했다 — 채널 설정에서 키를 고친다. */
  gateway_auth_failed: "npc.gatewayAuthFailed",
  /** 닿았고 인증도 됐는데 응답이 오지 않았다 — 모델·도구가 굳었을 수 있다. */
  gateway_timeout: "npc.gatewayTimeout",
  /** 위 셋 어디에도 들어맞지 않는 실패. 상세는 서버 로그에 있다. */
  gateway_unknown_error: "npc.gatewayUnknownError",
  unsupported_adapter: "npc.unsupportedAdapter",
  wait_before_sending: "npc.waitBeforeSending",
  npc_not_found: "npc.notFound",
  unsupported_file_type: "npc.unsupportedFileType",
  file_too_large: "npc.fileTooLarge",
  too_many_files: "npc.tooManyFiles",
  npc_unbound: "npc.unbound",
  hermes_image_unsupported: "npc.hermesImageUnsupported",
} as const;

export type NpcResponseMessageCode = keyof typeof NPC_RESPONSE_MESSAGE_KEYS;

export interface NpcResponsePayload {
  npcId: string;
  chunk: string;
  done: boolean;
  messageCode?: NpcResponseMessageCode;
  /** Upgraded clients render this request through npc:response-state. */
  responseRequestId?: string;
}

export function isNpcResponseMessageCode(value: unknown): value is NpcResponseMessageCode {
  return typeof value === "string" && value in NPC_RESPONSE_MESSAGE_KEYS;
}

export function getNpcResponseMessageKey(code: NpcResponseMessageCode): string {
  return NPC_RESPONSE_MESSAGE_KEYS[code];
}

export function resolveNpcResponseChunk(
  payload: Pick<NpcResponsePayload, "chunk" | "messageCode">,
  t: Translator,
): string {
  if (payload.messageCode && isNpcResponseMessageCode(payload.messageCode)) {
    return t(getNpcResponseMessageKey(payload.messageCode));
  }

  return payload.chunk;
}
