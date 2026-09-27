/**
 * Who did the work on a card whose approval policy now waits for a person (`review.state` `human_required`).
 *
 * Such a card sits in `review` with no assignee, so the card itself no longer names anyone. The plugin keeps the
 * implementer in its approval store but does not put it on the card, so this reads the same trail the plugin falls
 * back to (`kanban_actions._implementer_of`): the first `review_requested` event's `implementer` that is not the
 * reviewer — later ones are the AI reviewer handing its verdict over. Without one, the latest run by someone other
 * than the reviewer, then the latest run at all.
 *
 * Pure — safe for the client bundle.
 */

import { taskTimeMs } from "@/lib/plugin-time";
import type { KanbanEvent, KanbanRun } from "@/lib/hermes/deskrpg-plugin-types";

export function reviewImplementer(
  detail: {
    events: readonly Pick<KanbanEvent, "kind" | "payload">[];
    runs: readonly Pick<KanbanRun, "profile" | "started_at" | "ended_at">[];
  },
  reviewerProfile: string | null | undefined,
): string | null {
  const reviewer = reviewerProfile?.trim().toLowerCase() || null;
  const isReviewer = (profile: string) => profile.trim().toLowerCase() === reviewer;

  for (const event of detail.events) {
    if (event.kind !== "review_requested") continue;
    const who = event.payload?.implementer;
    if (typeof who === "string" && who.trim() && !isReviewer(who)) return who.trim();
  }

  const byRecency = detail.runs
    .filter((run): run is typeof run & { profile: string } => Boolean(run.profile?.trim()))
    .map((run) => ({ profile: run.profile.trim(), at: runMs(run) }))
    .sort((a, b) => b.at - a.at);
  return (byRecency.find((run) => !isReviewer(run.profile)) ?? byRecency[0])?.profile ?? null;
}

function runMs(run: Pick<KanbanRun, "started_at" | "ended_at">): number {
  return taskTimeMs(run.ended_at) ?? taskTimeMs(run.started_at) ?? 0;
}
