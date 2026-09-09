/** 서버가 보내는 방 에러 코드 7종(`src/server/room-socket.ts` 의 `RoomErrorCode`). */
const ROOM_ERROR_CODES = [
  "forbidden",
  "not_found",
  "not_open",
  "empty",
  "cooldown",
  "not_joined",
  "invalid",
] as const;
type RoomErrorCode = (typeof ROOM_ERROR_CODES)[number];

export type ChatErrorDecision = {
  toastKey: string;
  /** 소켓 재조인이 필요하다 — 서버가 이 소켓을 방에 없는 것으로 본다. */
  rejoin: boolean;
  /** 이 방은 더 볼 수 없다(사라졌거나 권한이 없다) — 목록으로 돌아가 새로 받는다. */
  backToList: boolean;
};

function isRoomErrorCode(code: unknown): code is RoomErrorCode {
  return ROOM_ERROR_CODES.includes(code as RoomErrorCode);
}

/** 서버 `room:error` 를 UI 동작으로 옮긴다. React·socket 을 모르므로 node:test 가 붙는다. */
export function decideChatError(payload: unknown): ChatErrorDecision {
  const code = (payload as { code?: unknown } | null)?.code;
  if (!isRoomErrorCode(code)) {
    return { toastKey: "game.channelChatFailed", rejoin: false, backToList: false };
  }
  return {
    toastKey: `game.room.error.${code}`,
    rejoin: code === "not_joined",
    backToList: code === "not_found" || code === "forbidden",
  };
}
