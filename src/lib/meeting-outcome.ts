/**
 * 회의 요약 응답을 구조화된 결과로 읽는다.
 *
 * 결과는 **초안**이다 — 카드가 아니다. Hermes 에는 사용자가 등록을 누르기 전까지 아무것도 생기지 않는다.
 * 모델이 쓴 담당은 회의 참석자 안에서만 풀고, 못 풀면 미지정으로 둔다. 채널에 없는 프로필 이름이
 * 카드 담당으로 들어가는 길을 막기 위해서다.
 */

export const MEETING_OUTCOME_LIMITS = {
  keyTopics: 10,
  decisions: 10,
  followUps: 12,
  title: 200,
  text: 1000,
} as const;

export type OutcomeParticipant = { npcId: string; name: string };

export type MeetingFollowUp = {
  title: string;
  summary: string | null;
  acceptance: string | null;
  assigneeNpcId: string | null;
  /** 모델이 쓴 이름 그대로. 참석자로 풀리지 않았어도 초안 검토 화면에 보여 준다. */
  assigneeName: string | null;
  /** 먼저 끝나야 하는 항목의 인덱스. 등록할 때 Hermes 부모 링크가 된다. */
  after: number[];
};

export type MeetingOutcome = {
  decisions: string[];
  followUps: MeetingFollowUp[];
  project: { recommended: boolean; name: string | null; reason: string | null } | null;
};

export type MeetingSummaryStatus = "ok" | "failed" | "skipped";

export type ParsedMeetingOutcome = {
  status: MeetingSummaryStatus;
  keyTopics: string[];
  conclusions: string | null;
  outcome: MeetingOutcome | null;
};

const FAILED: ParsedMeetingOutcome = {
  status: "failed",
  keyTopics: [],
  conclusions: null,
  outcome: null,
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function textList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const entry of value) {
    const item = text(entry, maxLength);
    if (item) items.push(item);
    if (items.length === maxItems) break;
  }
  return items;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `from` 에서 `after` 를 따라가 `target` 에 닿는가. */
function reaches(
  after: number[][],
  from: number,
  target: number,
  seen = new Set<number>(),
): boolean {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return after[from].some((next) => reaches(after, next, target, seen));
}

function readFollowUps(value: unknown, participants: OutcomeParticipant[]): MeetingFollowUp[] {
  if (!Array.isArray(value)) return [];
  const byName = new Map(participants.map((p) => [p.name.trim().toLowerCase(), p.npcId]));

  // 제목 없는 항목을 버리면 인덱스가 밀린다 — 원래 번호에서 새 번호로 가는 표를 먼저 만든다.
  const kept: Array<{ source: Record<string, unknown>; title: string }> = [];
  const renumber = new Map<number, number>();
  value.forEach((entry, index) => {
    if (kept.length === MEETING_OUTCOME_LIMITS.followUps || !isRecord(entry)) return;
    const title = text(entry.title, MEETING_OUTCOME_LIMITS.title);
    if (!title) return;
    renumber.set(index, kept.length);
    kept.push({ source: entry, title });
  });

  const after: number[][] = kept.map(() => []);
  kept.forEach(({ source }, index) => {
    if (!Array.isArray(source.after)) return;
    for (const raw of source.after) {
      const target = typeof raw === "number" ? renumber.get(raw) : undefined;
      if (target === undefined || target === index || after[index].includes(target)) continue;
      // 이 링크를 넣으면 고리가 생기는가: target 에서 이미 index 로 올 수 있으면 그렇다.
      if (reaches(after, target, index)) continue;
      after[index].push(target);
    }
  });

  return kept.map(({ source, title }, index) => {
    const assigneeName = text(source.assignee, MEETING_OUTCOME_LIMITS.title);
    return {
      title,
      summary: text(source.summary, MEETING_OUTCOME_LIMITS.text),
      acceptance: text(source.acceptance, MEETING_OUTCOME_LIMITS.text),
      assigneeNpcId: (assigneeName && byName.get(assigneeName.toLowerCase())) || null,
      assigneeName,
      after: after[index],
    };
  });
}

export function parseMeetingOutcome(
  response: string,
  participants: OutcomeParticipant[],
): ParsedMeetingOutcome {
  const match = (response || "").match(/\{[\s\S]*\}/);
  if (!match) return FAILED;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return FAILED;
  }
  if (!isRecord(parsed)) return FAILED;

  const project = isRecord(parsed.project)
    ? {
        recommended: parsed.project.recommended === true,
        name: text(parsed.project.name, MEETING_OUTCOME_LIMITS.title),
        reason: text(parsed.project.reason, MEETING_OUTCOME_LIMITS.text),
      }
    : null;

  return {
    status: "ok",
    keyTopics: textList(
      parsed.keyTopics,
      MEETING_OUTCOME_LIMITS.keyTopics,
      MEETING_OUTCOME_LIMITS.title,
    ),
    conclusions: text(parsed.conclusions, MEETING_OUTCOME_LIMITS.text * 2),
    outcome: {
      decisions: textList(
        parsed.decisions,
        MEETING_OUTCOME_LIMITS.decisions,
        MEETING_OUTCOME_LIMITS.text,
      ),
      followUps: readFollowUps(parsed.followUps, participants),
      project,
    },
  };
}
