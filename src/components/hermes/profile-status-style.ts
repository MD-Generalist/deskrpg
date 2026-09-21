// Tone→CSS class mapping for the profile status badge. Split out from
// HermesProfileList so the only thing left inside JSX is a lookup, not a
// conditional chain — this file has no external dependency so it stays trivial,
// but keeping it separate avoids re-introducing branching logic into the component
// as tones grow (mirrors the profile-status.ts convention).

import type { ProfileStatusTone } from "./profile-status";

export const PROFILE_STATUS_BADGE_CLASS: Record<ProfileStatusTone, string> = {
  ok: "border-success/40 bg-success/10 text-success",
  warn: "border-npc-dark/40 bg-npc-dark/10 text-npc-dark",
  error: "border-danger/40 bg-danger/10 text-danger",
  unknown: "border-border bg-surface-raised text-text-muted",
};
