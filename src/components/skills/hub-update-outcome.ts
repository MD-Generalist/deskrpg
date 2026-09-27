/**
 * What a finished `hermes skills update` job did, read from its output. The plugin reports only
 * the exit code and the output tail, and "nothing newer" exits 0 just like a real update — the
 * summary line is the only place the difference shows.
 */
export type HubUpdateOutcome = "updated" | "none" | "kept_local";

// Colour codes, in case the CLI ever decides its output is a terminal.
const ANSI = /\u001b\[[0-9;]*m/g;

export function hubUpdateOutcome(outputTail: string): HubUpdateOutcome | null {
  const out = outputTail.replace(ANSI, "");
  if (/Updated \d+ skill/.test(out)) return "updated";
  if (/local edits/.test(out)) return "kept_local";
  if (/No updates available/.test(out)) return "none";
  return null;
}
