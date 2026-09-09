/**
 * 멘션 입력창의 순수 모델. DOM·React 를 모르므로 node:test 가 바로 붙는다.
 *
 * 입력창 안의 내용은 텍스트 조각과 멘션 칩의 나열이다. 서버(`mention.ts` `parseAllMentions`)는
 * `@[이름]` 문자열만 이해하므로, 칩은 전송 순간에만 그 문자열로 바뀐다 — 사용자가 손으로
 * `@[소피]` 를 치던 시절과 와이어 포맷이 같다.
 */

export type MentionCandidate = { id: string; name: string };

export type Segment =
  { kind: "text"; text: string } | { kind: "mention"; id: string; name: string };

export function serializeSegments(segments: Segment[]): string {
  return segments.map((s) => (s.kind === "text" ? s.text : `@[${s.name}]`)).join("");
}

/**
 * 캐럿 바로 앞의 텍스트에서 "열린 @쿼리" 를 찾는다. `@` 는 줄 처음이거나 공백 뒤에만
 * 멘션 시작이다(`a@b` 같은 이메일은 아니다). 쿼리 안에 공백이 들어오면 닫힌 것으로 본다.
 */
export function findMentionQuery(textBeforeCaret: string): { start: number; query: string } | null {
  const at = textBeforeCaret.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(textBeforeCaret[at - 1])) return null;
  const query = textBeforeCaret.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { start: at, query };
}

export function filterCandidates(
  query: string,
  candidates: MentionCandidate[],
): MentionCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return candidates;
  return candidates.filter((c) => c.name.toLowerCase().includes(q));
}

export type DropdownState = { open: boolean; index: number; count: number; select?: number };

/** 드롭다운이 열린 상태에서의 키 처리. `select` 가 있으면 그 인덱스를 고른다. */
export function reduceDropdown(state: DropdownState, key: string): DropdownState {
  const { index, count } = state;
  const base = { open: state.open, index, count };
  if (!state.open) return base;
  switch (key) {
    case "ArrowDown":
      return { ...base, index: count === 0 ? 0 : (index + 1) % count };
    case "ArrowUp":
      return { ...base, index: count === 0 ? 0 : (index - 1 + count) % count };
    case "Escape":
      return { ...base, open: false };
    case "Enter":
    case "Tab":
      return count === 0 ? base : { ...base, select: index };
    default:
      return base;
  }
}
