import type { MeetingDiscussionState } from "../../lib/meeting-discussion-state";
import { sanitizeClientFinalSpeech, sanitizeClientStreamingSpeech } from "./stream-text";

export type MeetingExecutionState = Pick<
  MeetingDiscussionState,
  "isWaitingInput" | "currentSpeaker" | "rawStreams"
>;

export function restoreMeetingExecution(state: MeetingExecutionState | null | undefined) {
  const rawStreams = { ...state?.rawStreams };
  return {
    rawStreams,
    streams: Object.fromEntries(
      Object.entries(rawStreams).map(([id, body]) => [id, sanitizeClientStreamingSpeech(body)]),
    ),
    currentSpeaker: state?.currentSpeaker ?? null,
    isWaitingInput: state?.isWaitingInput === true,
  };
}

export function restoreMeetingChat<T extends { senderType: string; content: string }>(
  discussion: MeetingDiscussionState | null | undefined,
  messages: readonly T[],
) {
  return {
    // A finished meeting belongs in minutes, not the next meeting's chat.
    messages: discussion
      ? messages.map((message) => ({
          ...message,
          content:
            message.senderType === "npc"
              ? sanitizeClientFinalSpeech(message.content)
              : message.content,
        }))
      : [],
    ...restoreMeetingExecution(discussion),
  };
}
