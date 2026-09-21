import type { MeetingMessageLike } from "./message-state";

export function consumeNpcStreamBuffer(args: {
  streams: Record<string, string>;
  npcId: string;
  fallbackSenderName: string;
  timestamp: number;
  /**
   * 서버가 턴 끝에 보낸 최종 본문. 있으면 스트림 누적분 대신 쓴다 — 델타에는 재시도된 앞선 생성까지
   * 쌓일 수 있어, 누적분으로 확정하면 화면과 회의 기록이 어긋난다.
   */
  finalText?: string;
}): {
  nextStreams: Record<string, string>;
  finalizedMessage: MeetingMessageLike | null;
} {
  const { streams, npcId, fallbackSenderName, timestamp, finalText } = args;
  const content = typeof finalText === "string" && finalText ? finalText : streams[npcId];
  const nextStreams = { ...streams };
  delete nextStreams[npcId];

  if (!content) {
    return {
      nextStreams,
      finalizedMessage: null,
    };
  }

  return {
    nextStreams,
    finalizedMessage: {
      id: `msg-${timestamp}-${npcId}`,
      sender: fallbackSenderName,
      senderId: `npc-${npcId}`,
      senderType: "npc",
      content,
      timestamp,
    },
  };
}
