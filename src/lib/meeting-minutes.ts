import { parseDbArray } from "./db-json";
import type { MeetingOutcome } from "./meeting-outcome";

type MeetingParticipant = {
  id: string;
  name: string;
  type: string;
  agentId?: string;
};

type MeetingMinutesRecord = {
  participants?: unknown;
  keyTopics?: unknown;
  outcomeJson?: unknown;
};

/** PG 는 객체로, SQLite 는 문자열로 돌려준다. 모양이 틀리면 결과 없음으로 다룬다. */
function readOutcome(stored: unknown): MeetingOutcome | null {
  let value = stored;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<MeetingOutcome>;
  if (!Array.isArray(candidate.decisions) || !Array.isArray(candidate.followUps)) return null;
  return { ...candidate, project: candidate.project ?? null } as MeetingOutcome;
}

/**
 * 반환 타입을 명시한다. 추론에 맡기면 호출부가 리터럴 객체를 넘겼을 때
 * 스프레드와 덮어쓰기가 불가능한 교차 타입으로 접혀 `never` 가 된다 —
 * 테스트에서 `normalized.participants` 가 "does not exist on type 'never'" 로 터졌다.
 */
export function normalizeMeetingMinutesRecord<T extends MeetingMinutesRecord>(
  record: T,
): Omit<T, "participants" | "keyTopics" | "outcomeJson"> & {
  participants: MeetingParticipant[];
  keyTopics: string[];
  outcome: MeetingOutcome | null;
} {
  // 제네릭 T 의 나머지(rest)는 TS 가 Omit 교차로 좁히지 못한다 — 세 키를 함께 덜어 단언한다.
  const { outcomeJson, participants, keyTopics, ...rest } = record;
  return {
    ...(rest as Omit<T, "participants" | "keyTopics" | "outcomeJson">),
    outcome: readOutcome(outcomeJson),
    participants: parseDbArray<MeetingParticipant>(participants),
    keyTopics: parseDbArray<string>(keyTopics).filter(
      (topic): topic is string => typeof topic === "string",
    ),
  };
}
