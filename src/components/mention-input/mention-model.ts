/**
 * The pure model for the mention input. It doesn't know DOM/React, so node:test can attach directly.
 *
 * The content inside the input box is a sequence of text fragments and mention chips. The
 * server (`mention.ts`'s `parseAllMentions`) only understands the `@[name]` string, so a chip
 * only turns into that string at the moment of sending — the wire format is the same as when
 * users used to type `@[Sophie]` by hand.
 *
 * Skill chips (`/research`) live in the same sequence but never reach the text: they travel as the
 * separate `skills[]` of the send, and the server writes the stored `/skill … instruction` line.
 */

import { formatMention } from "@/lib/conversation/mention";

export type MentionCandidate = { id: string; name: string };

export type SkillCandidate = { name: string; description: string };

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "mention"; id: string; name: string }
  | { kind: "skill"; name: string };

/** The text a send carries. Skill chips are dropped — they travel in `skills[]`. */
export function serializeSegments(segments: Segment[]): string {
  return segments
    .map((s) => (s.kind === "text" ? s.text : s.kind === "mention" ? formatMention(s.name) : ""))
    .join("");
}

/** A send's skill chips (first appearance order, no repeats) and its text. */
export function splitSkillSegments(segments: Segment[]): { skills: string[]; text: string } {
  const skills: string[] = [];
  for (const s of segments) if (s.kind === "skill" && !skills.includes(s.name)) skills.push(s.name);
  return { skills, text: serializeSegments(segments) };
}

/** Distinct skill chips in a draft. */
export function countSkillChips(segments: Segment[]): number {
  return splitSkillSegments(segments).skills.length;
}

/**
 * Finds an "open @query" in the text right before the caret. `@` only starts a mention at the
 * beginning of the line or right after whitespace (not an email like `a@b`). A space inside the
 * query is treated as closing it.
 */
export function findMentionQuery(textBeforeCaret: string): { start: number; query: string } | null {
  return findTriggerQuery(textBeforeCaret, "@");
}

/** Same rule for `/`: a path like `a/b` or a URL does not open the skill list. */
export function findSkillQuery(textBeforeCaret: string): { start: number; query: string } | null {
  return findTriggerQuery(textBeforeCaret, "/");
}

function findTriggerQuery(
  textBeforeCaret: string,
  trigger: string,
): { start: number; query: string } | null {
  const at = textBeforeCaret.lastIndexOf(trigger);
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

export function filterSkillCandidates(
  query: string,
  candidates: SkillCandidate[],
): SkillCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return candidates;
  return candidates.filter((c) => c.name.toLowerCase().includes(q));
}

export type DropdownState = { open: boolean; index: number; count: number; select?: number };

/** Key handling while the dropdown is open. If `select` is present, that index is chosen. */
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
