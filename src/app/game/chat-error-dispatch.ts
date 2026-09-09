/** 서버 `chat:error` 를 UI 동작으로 옮긴다. React·socket 을 모르므로 node:test 가 붙는다. */
export function decideChatError(payload: unknown): { toastKey: string; rejoin: boolean } {
  const code = (payload as { code?: string } | null)?.code;
  if (code === "not_joined") return { toastKey: "game.channelChatNotJoined", rejoin: true };
  return { toastKey: "game.channelChatFailed", rejoin: false };
}
