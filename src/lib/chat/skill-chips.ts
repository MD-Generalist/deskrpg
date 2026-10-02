/**
 * Skill chips: the TUI-style `/skill … instruction` line DeskRPG stores for a message sent with
 * skills, and how to read it back.
 *
 * The stored line is plain text, so no schema change is needed. Only names the NPC actually has are
 * read back as chips, so an instruction that merely starts with "/" (e.g. "/tmp clean it") stays text.
 * The chips themselves travel separately (`skills[]` on the socket payload); the server expands them
 * through the plugin right before calling Hermes.
 */

/** Same limit as Hermes' stacked skill invocation (`_MAX_STACKED_SKILLS`). */
export const MAX_SKILL_CHIPS = 5;

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** A skill name usable as a slash key, without the leading slash; null when it is not one. */
export function normalizeSkillName(raw: string): string | null {
  const name = raw.trim().replace(/^\//, "");
  return NAME.test(name) && !name.includes("..") ? name : null;
}

/** `["a","b"], "do it"` → `"/a /b do it"`; with no instruction just the chips. */
export function formatSkillChipLine(skills: string[], instruction: string): string {
  const chips = skills.map((s) => "/" + s).join(" ");
  const text = instruction.trim();
  return text ? `${chips} ${text}` : chips;
}

/**
 * Leading `/token`s that name a known skill become chips (at most {@link MAX_SKILL_CHIPS}, no
 * repeats); reading stops at the first token that is not one. Without chips the text is returned
 * untouched.
 */
export function parseSkillChipLine(
  text: string,
  known: ReadonlySet<string>,
): { skills: string[]; instruction: string } {
  const skills: string[] = [];
  let rest = text.trimStart();
  while (skills.length < MAX_SKILL_CHIPS) {
    const match = /^\/(\S+)(?:\s+|$)/.exec(rest);
    if (!match || !known.has(match[1]) || skills.includes(match[1])) break;
    skills.push(match[1]);
    rest = rest.slice(match[0].length);
  }
  return { skills, instruction: skills.length ? rest.trim() : text };
}
