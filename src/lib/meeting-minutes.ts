import { parseDbArray } from "./db-json";

type MeetingParticipant = {
  id: string;
  name: string;
  type: string;
  agentId?: string;
};

type MeetingMinutesRecord = {
  participants?: unknown;
  keyTopics?: unknown;
};

/**
 * 반환 타입을 명시한다. 추론에 맡기면 호출부가 리터럴 객체를 넘겼을 때
 * 스프레드와 덮어쓰기가 불가능한 교차 타입으로 접혀 `never` 가 된다 —
 * 테스트에서 `normalized.participants` 가 "does not exist on type 'never'" 로 터졌다.
 */
export function normalizeMeetingMinutesRecord<T extends MeetingMinutesRecord>(
  record: T,
): Omit<T, "participants" | "keyTopics"> & {
  participants: MeetingParticipant[];
  keyTopics: string[];
} {
  return {
    ...record,
    participants: parseDbArray<MeetingParticipant>(record.participants),
    keyTopics: parseDbArray<string>(record.keyTopics).filter(
      (topic): topic is string => typeof topic === "string",
    ),
  };
}
