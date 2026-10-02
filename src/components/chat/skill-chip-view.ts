/**
 * What the chat panel needs to offer skill chips and draw them back: the `/` candidates for an
 * employee, who a room message's chips are for, and how a stored `/skill … instruction` line splits
 * into chips again. Pure — the panel owns the fetching.
 */
import { parseSkillChipLine } from "@/lib/chat/skill-chips";
import type { SkillListView } from "@/components/skills/skills-api";
import type {
  MentionCandidate,
  Segment,
  SkillCandidate,
} from "@/components/mention-input/mention-model";
import type { SkillsBlockedReason } from "@/components/mention-input/MentionEditor";

/**
 * One employee's skills as the chat uses them: `candidates` (on) for `/`, `known` (every name, on or
 * off) for drawing lines already sent — a skill turned off later still reads as a chip.
 */
export type NpcChatSkills = { candidates: SkillCandidate[]; known: string[]; invocation: boolean };

/**
 * Whether the gateway's plugin can expand skill chips (`skill_invocation`). Read in one place so the
 * list field it comes from can change without touching the screens.
 */
export function skillInvocationReady(view: SkillListView): boolean {
  return view.skillInvocation === true;
}

/** Only skills that are on can be invoked. */
export function chatSkillsFrom(view: SkillListView): NpcChatSkills {
  const rows = Array.isArray(view.skills) ? view.skills : [];
  return {
    candidates: rows
      .filter((s) => !s.disabled)
      .map((s) => ({ name: s.name, description: s.description ?? "" })),
    known: rows.map((s) => s.name),
    invocation: skillInvocationReady(view),
  };
}

/** The `/` props for an input whose chips go to one employee. Unknown yet: `/` stays plain. */
export function skillInputProps(skills: NpcChatSkills | undefined): {
  skillCandidates?: SkillCandidate[];
  skillsBlockedReason?: SkillsBlockedReason;
} {
  if (!skills) return {};
  return skills.invocation
    ? { skillCandidates: skills.candidates }
    : { skillsBlockedReason: "plugin_update" };
}

/** The one employee a room draft names, or null when it names none or several (chips need exactly one). */
export function roomSkillTarget(
  segments: Segment[],
  candidates: MentionCandidate[],
): string | null {
  const ids = new Set(
    segments.flatMap((s) =>
      s.kind === "mention" && candidates.some((c) => c.id === s.id) ? [s.id] : [],
    ),
  );
  return ids.size === 1 ? [...ids][0] : null;
}

const LEADING_MENTION = /^@\[((?:\\.|[^\]\\])*)\]\s+/;

/** The employee name a room line is addressed to (`@[name] …`), if it starts with one. */
export function leadingMentionName(content: string): string | null {
  const match = LEADING_MENTION.exec(content);
  return match ? match[1].replace(/\\(.)/g, "$1").trim() : null;
}

/**
 * A sent line drawn as chips. Only names the employee has count — "/tmp clean it" stays text — and
 * with no known names yet (list not loaded) the line is drawn as written: returns null.
 * `mention` lets a room line keep its leading `@[name] ` before the chips.
 */
export function splitSkillBubble(
  content: string,
  known: ReadonlySet<string> | null,
  opts: { mention?: boolean } = {},
): { prefix: string; skills: string[]; instruction: string } | null {
  if (!known || known.size === 0) return null;
  const match = opts.mention ? LEADING_MENTION.exec(content) : null;
  const prefix = match ? match[0] : "";
  if (opts.mention && !match) return null;
  const { skills, instruction } = parseSkillChipLine(content.slice(prefix.length), known);
  return skills.length ? { prefix, skills, instruction } : null;
}
