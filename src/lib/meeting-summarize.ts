/**
 * "요약 다시 시도" 의 몸통. 라우트는 얇게 두고 판단은 여기서 한다.
 *
 * 트랜스크립트는 이미 회의록에 있으므로 회의를 다시 열 필요가 없다. 요약을 실제로 돌리는
 * 어댑터는 소켓 서버에 있어 `meeting-registry.ts` 훅으로 닿는다.
 */
import type { MeetingOutcome, ParsedMeetingOutcome } from "./meeting-outcome";
import type { ResummarizeInput } from "./meeting-registry";

export type MinutesForSummary = {
  id: string;
  channelId: string;
  topic: string;
  transcript: string;
  initiatorId: string | null;
  participants: Array<{ id: string; name: string; type: string }>;
  summaryStatus: string;
  outcome: MeetingOutcome | null;
};

export type ResummarizeMinutesDeps = {
  loadMinutes: (minutesId: string) => Promise<MinutesForSummary | null>;
  loadChannelOwner: (channelId: string) => Promise<string | null>;
  /** 소켓 서버가 꽂은 훅. 없으면(테스트·CLI 초기) 요약을 돌릴 수 없다. */
  resummarize: ((input: ResummarizeInput) => Promise<ParsedMeetingOutcome>) | undefined;
  saveSummary: (minutesId: string, summary: ParsedMeetingOutcome) => Promise<void>;
};

export type ResummarizeMinutesResult =
  | { ok: true; summary: ParsedMeetingOutcome }
  | {
      ok: false;
      status: 403 | 404 | 409 | 503;
      errorCode: "forbidden" | "not_found" | "already_registered" | "summarizer_unavailable";
    };

export async function resummarizeMinutes(
  args: { minutesId: string; userId: string },
  deps: ResummarizeMinutesDeps,
): Promise<ResummarizeMinutesResult> {
  const minutes = await deps.loadMinutes(args.minutesId);
  if (!minutes) return { ok: false, status: 404, errorCode: "not_found" };

  const ownerId = await deps.loadChannelOwner(minutes.channelId);
  const canManage =
    (ownerId !== null && ownerId === args.userId) ||
    (minutes.initiatorId !== null && minutes.initiatorId === args.userId);
  if (!canManage) return { ok: false, status: 403, errorCode: "forbidden" };

  // 카드가 이미 만들어졌는데 초안을 갈아 끼우면 회의록과 보드가 서로 다른 말을 한다.
  if (minutes.outcome?.registered)
    return { ok: false, status: 409, errorCode: "already_registered" };

  if (!deps.resummarize) return { ok: false, status: 503, errorCode: "summarizer_unavailable" };

  const summary = await deps.resummarize({
    minutesId: minutes.id,
    channelId: minutes.channelId,
    userId: args.userId,
    topic: minutes.topic,
    transcript: minutes.transcript,
    participants: minutes.participants
      .filter((participant) => participant.type === "npc")
      .map((participant) => ({ npcId: participant.id, name: participant.name })),
  });
  await deps.saveSummary(minutes.id, summary);
  return { ok: true, summary };
}
