/**
 * 저장된 회의록의 요약을 다시 만든다.
 *
 * 회의가 끝난 뒤에는 브로커도 요약용 어댑터도 남아 있지 않다. 그래서 참석했던 직원 가운데
 * **지금도 채널에 있고 어댑터가 풀리는** 첫 사람에게 다시 맡긴다. 세션은 회의 세션과 분리한다 —
 * 요약 프롬프트가 그 직원의 대화 맥락에 섞이면 다음 발언이 오염된다.
 */
import type { NpcAdapter } from "../lib/adapters/types";
import type { OutcomeParticipant, ParsedMeetingOutcome } from "../lib/meeting-outcome";
import type { ResummarizeInput } from "../lib/meeting-registry";

type NpcRef = { id: string; name: string };

export type ResummarizerDeps<Npc extends NpcRef> = {
  getNpcConfigsForChannel: (channelId: string) => Promise<Npc[]>;
  resolveAdapter: (
    npc: Npc,
    ctx: { sessionScope: string; userId: string },
  ) => Promise<{ adapter: NpcAdapter; sessionKey: string } | { excluded: unknown }>;
  generateMeetingSummary: (
    adapter: NpcAdapter,
    sessionKey: string,
    topic: string,
    transcript: string,
    participants?: OutcomeParticipant[],
  ) => Promise<ParsedMeetingOutcome>;
};

export function createResummarizer<Npc extends NpcRef>(deps: ResummarizerDeps<Npc>) {
  return async function resummarize(input: ResummarizeInput): Promise<ParsedMeetingOutcome> {
    const present = new Map(
      (await deps.getNpcConfigsForChannel(input.channelId)).map((npc) => [npc.id, npc]),
    );
    for (const participant of input.participants) {
      const npc = present.get(participant.npcId);
      if (!npc) continue;
      const resolved = await deps.resolveAdapter(npc, {
        sessionScope: `minutes-${input.minutesId}-summary`,
        userId: input.userId,
      });
      if (!("adapter" in resolved)) continue;
      return deps.generateMeetingSummary(
        resolved.adapter,
        resolved.sessionKey,
        input.topic,
        input.transcript,
        input.participants,
      );
    }
    // 다시 시도해도 같은 결과다 — 실패와 구분한다.
    return { status: "skipped", keyTopics: [], conclusions: null, outcome: null };
  };
}
