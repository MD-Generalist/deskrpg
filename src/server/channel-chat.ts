import type { ChannelChatMessage, PlayerState } from "./socket-handlers";

export type ChatSendResult =
  | { kind: "ignored" }
  | { kind: "not_joined" }
  | { kind: "sent"; message: ChannelChatMessage; mentions: boolean };

/** NPC 는 지명받을 때만 깨어난다. parseAllMentions 가 런타임에서 다시 정확히 판정한다. */
const MENTION_RE = /@\[|^TO:/i;

/**
 * `chat:send` 의 판정부. 소켓·io 를 모르므로 node:test 로 바로 돈다.
 *
 * `player` 가 없으면(재연결 뒤 새 socket.id, 또는 join 전) 조용히 버리지 않고
 * `not_joined` 를 돌려준다 — 호출부가 `chat:error` 로 알린다. 이전에는 여기서 `return`
 * 해서 입력창만 비워지고 아무 일도 안 일어났다(docs/BACKLOG.md 2026-09-09).
 */
export function handleChatSend(args: {
  socketId: string;
  player: PlayerState | undefined;
  message: unknown;
  now: number;
  lastChatTime: Map<string, number>;
  channelChatHistory: Map<string, ChannelChatMessage[]>;
  fallbackSender: string;
  cooldownMs: number;
}): ChatSendResult {
  const { socketId, player, now, lastChatTime, channelChatHistory, fallbackSender, cooldownMs } =
    args;
  if (!player) return { kind: "not_joined" };
  const trimmed = String(args.message || "")
    .trim()
    .slice(0, 500);
  if (!trimmed) return { kind: "ignored" };
  if (now - (lastChatTime.get(socketId) || 0) < cooldownMs) return { kind: "ignored" };
  lastChatTime.set(socketId, now);

  const message: ChannelChatMessage = {
    id: `chat-${now}-${Math.random().toString(36).slice(2, 6)}`,
    sender: player.characterName || fallbackSender,
    senderId: socketId,
    content: trimmed,
    timestamp: now,
  };
  const history = channelChatHistory.get(player.mapId) || [];
  history.push(message);
  channelChatHistory.set(player.mapId, history);
  return { kind: "sent", message, mentions: MENTION_RE.test(trimmed) };
}
