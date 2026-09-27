/**
 * Per-employee counts of what waits on a person, folded from the judgments inbox and the live tool-approval
 * cards — the input the state map needs for `awaiting_approval` and `stopped_after_failures`.
 *
 * `approvals` counts everything an employee waits on a person for: a live tool approval, cards it asked to have
 * approved, its work on a card whose approval policy now needs a person, and its unattended runs that stopped at
 * a risky step nobody could approve.
 *
 * The inbox names people by **Hermes profile** (a card's assignee, an approval's requester); the office knows
 * employees by NPC id. The roster links the two. A profile no employee in this channel uses is dropped.
 *
 * Pure — safe for the client bundle.
 */

import { parseRequester } from "@/lib/approval-requester";
import type { AttentionRow } from "@/lib/attention-inbox";

export type NpcAttention = { approvals: number; failedCards: number };

export function npcAttentionById(input: {
  rows: readonly AttentionRow[];
  roster: readonly { id: string; profileName?: string | null }[];
  /** Pending tool approvals per NPC id (`pendingApprovalsByNpc`). */
  toolApprovals: Readonly<Record<string, number>>;
}): Record<string, NpcAttention> {
  const npcByProfile = new Map<string, string>();
  const inRoster = new Set<string>();
  for (const npc of input.roster) {
    inRoster.add(npc.id);
    if (npc.profileName) npcByProfile.set(npc.profileName, npc.id);
  }

  const out: Record<string, NpcAttention> = {};
  const bump = (npcId: string | undefined, key: keyof NpcAttention, by = 1) => {
    if (!npcId) return;
    const entry = (out[npcId] ??= { approvals: 0, failedCards: 0 });
    entry[key] += by;
  };

  for (const [npcId, count] of Object.entries(input.toolApprovals)) {
    if (count > 0) bump(npcId, "approvals", count);
  }
  for (const row of input.rows) {
    if (row.kind === "approval" && row.requestedBy) {
      const requester = parseRequester(row.requestedBy);
      if (requester.kind === "profile") bump(npcByProfile.get(requester.profileName), "approvals");
    } else if (row.kind === "blocked" && row.failures && row.assignee) {
      bump(npcByProfile.get(row.assignee), "failedCards");
    } else if (row.kind === "review" && row.implementer) {
      // The card's approval policy is waiting on a person; the employee who did the work waits with it.
      bump(npcByProfile.get(row.implementer), "approvals");
    } else if (row.kind === "approval_blocked") {
      // An unattended run stopped because nobody could approve a risky step — it waits on a person too.
      bump(inRoster.has(row.npcId) ? row.npcId : undefined, "approvals");
    }
  }
  return out;
}
