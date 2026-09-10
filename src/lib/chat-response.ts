/** Public response lifecycle. Content is a cumulative, sanitized answer, never reasoning. */
export type ChatResponseStatus =
  "queued" | "thinking" | "streaming" | "complete" | "failed" | "cancelled";

export type ChatResponse = {
  requestId: string;
  sourceMessageId: string;
  npcId: string;
  npcName: string;
  status: ChatResponseStatus;
  content: string;
  updatedAt: number;
  messageId?: string;
  error?: string;
};
