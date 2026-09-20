/**
 * 회의 훅 레지스트리 — 라우트(`src/app/**`)가 소켓 서버의 어댑터에 닿는 유일한 길.
 *
 * `automation-registry.ts` 와 같은 무늬다. 라우트는 `src/server/**` 를 import 하지 않는다
 * (`app-server-boundary.test.ts`). 소켓 서버가 뜰 때 실제 구현을 `globalThis` 에 꽂는다.
 */
import type { OutcomeParticipant, ParsedMeetingOutcome } from "./meeting-outcome";

export type ResummarizeInput = {
  minutesId: string;
  channelId: string;
  userId: string;
  topic: string;
  transcript: string;
  /** 회의에 참석했던 직원. 요약을 맡길 후보이자 후속 업무의 담당 후보다. */
  participants: OutcomeParticipant[];
};

export type MeetingHooks = {
  /** 저장된 트랜스크립트로 요약을 다시 만든다. DB 는 건드리지 않는다 — 쓰는 쪽은 라우트다. */
  resummarize(input: ResummarizeInput): Promise<ParsedMeetingOutcome>;
};

const KEY = "__deskrpg_meeting_hooks__";
const g = globalThis as typeof globalThis & Record<string, MeetingHooks | undefined>;

export function registerMeetingHooks(hooks: MeetingHooks): void {
  g[KEY] = hooks;
}

export function unregisterMeetingHooks(): void {
  g[KEY] = undefined;
}

export function getMeetingHooks(): MeetingHooks | undefined {
  const hooks = g[KEY];
  return hooks && typeof hooks === "object" ? hooks : undefined;
}
