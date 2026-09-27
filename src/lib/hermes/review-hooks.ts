/**
 * Where the approval hooks do not reach — the plugin's `kanban.review_hooks` report (0.27.0+).
 *
 * Approval policies are enforced by the plugin's tool-call hooks inside each kanban worker, which runs
 * in the assignee profile's own home. A profile where the plugin is not linked and enabled (worker
 * propagation off, or a profile it could not reach) runs its cards with no hooks, so a card waiting
 * for approval can be completed by the employee alone.
 */
import {
  REVIEW_HOOKS_CAPABILITY,
  type PluginInfo,
  type ReviewHooksReport,
} from "./deskrpg-plugin-types";

/** Folds `info.kanban.review_hooks`. `undefined` for old plugins without the key, `null` for a failed check. */
export function parseReviewHooksReport(value: unknown): ReviewHooksReport | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const names = Array.isArray(r.profiles_without_plugin) ? r.profiles_without_plugin : [];
  return {
    propagation: r.propagation === true,
    profiles_without_plugin: names.filter((name): name is string => typeof name === "string"),
  };
}

/** Profiles whose cards can finish without approval. Empty when approvals are not hooks, or when unknown. */
export function unreviewedProfiles(info: PluginInfo | null): string[] {
  if (!info?.capabilities.includes(REVIEW_HOOKS_CAPABILITY)) return [];
  return info.kanban.review_hooks?.profiles_without_plugin ?? [];
}

/** Case-insensitive, like Hermes profile names elsewhere in the board. */
export function isUnreviewed(profileName: string, unreviewed: readonly string[]): boolean {
  const key = profileName.trim().toLowerCase();
  return unreviewed.some((name) => name.trim().toLowerCase() === key);
}
