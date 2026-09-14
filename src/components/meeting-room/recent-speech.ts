import type { MeetingMessageLike } from "./message-state";
import { buildSpeechBubblePreview } from "./speech-preview";

// Final text must remain readable even when the provider emits one complete chunk.
export function recentMeetingSpeech(
  messages: readonly MeetingMessageLike[], senderId: string, now: number,
): string | null {
  const message = messages.findLast((item) => item.senderId === senderId);
  if (!message || now - message.timestamp >= 6000) return null;
  return buildSpeechBubblePreview(message.content) || null;
}
