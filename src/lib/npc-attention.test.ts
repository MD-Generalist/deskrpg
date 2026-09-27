import assert from "node:assert/strict";
import test from "node:test";

import type { AttentionRow } from "./attention-inbox";
import { npcAttentionById } from "./npc-attention";

const roster = [
  { id: "n-sophie", profileName: "sophie" },
  { id: "n-oliver", profileName: "oliver" },
];
const base = { at: null, count: 1 } as const;

test("card approvals, failing cards and tool approvals land on the employee who owns them", () => {
  const rows: AttentionRow[] = [
    { ...base, kind: "approval", id: "a1", title: "a", requestedBy: "sophie", count: 2 },
    {
      ...base,
      kind: "blocked",
      id: "t1",
      title: "t",
      requestedBy: null,
      failures: 2,
      assignee: "oliver",
    },
    {
      ...base,
      kind: "blocked",
      id: "t2",
      title: "t",
      requestedBy: null,
      failures: 1,
      assignee: "oliver",
    },
  ];
  const out = npcAttentionById({ rows, roster, toolApprovals: { "n-sophie": 1 } });
  assert.deepEqual(out, {
    "n-sophie": { approvals: 2, failedCards: 0 },
    "n-oliver": { approvals: 0, failedCards: 2 },
  });
});

test("a plain block, a person's own request and an unknown profile count for nobody", () => {
  const rows: AttentionRow[] = [
    { ...base, kind: "blocked", id: "t1", title: "t", requestedBy: null, assignee: "sophie" },
    { ...base, kind: "approval", id: "a1", title: "a", requestedBy: "deskrpg:user-1" },
    {
      ...base,
      kind: "blocked",
      id: "t2",
      title: "t",
      requestedBy: null,
      failures: 3,
      assignee: "ghost",
    },
  ];
  assert.deepEqual(npcAttentionById({ rows, roster, toolApprovals: {} }), {});
});

test("a card waiting for a person's decision puts its implementer's hand up", () => {
  const rows: AttentionRow[] = [
    { ...base, kind: "review", id: "t1", title: "t", requestedBy: null, implementer: "sophie" },
    // A card merely in review (no decision pending on a person) is not a hand up.
    { ...base, kind: "review", id: "t2", title: "t", requestedBy: null, assignee: "oliver" },
  ];
  assert.deepEqual(npcAttentionById({ rows, roster, toolApprovals: {} }), {
    "n-sophie": { approvals: 1, failedCards: 0 },
  });
});

test("an unattended run blocked on an approval puts that employee's hand up", () => {
  const blocked = {
    ...base,
    kind: "approval_blocked" as const,
    title: "t",
    requestedBy: null,
    npcName: "Oliver",
    source: "kanban" as const,
    blockKind: "command" as const,
    tool: "terminal",
    command: "rm -r x",
    patternKey: null,
    patternDescription: null,
    mcpServer: null,
    jobName: null,
    taskTitle: "t",
    subtitle: "rm -r x",
    canAllowlist: true,
  };
  const rows: AttentionRow[] = [
    { ...blocked, id: "m1", messageId: "m1", npcId: "n-oliver" },
    { ...blocked, id: "m2", messageId: "m2", npcId: "n-oliver" },
    // An employee no longer in this channel's roster counts for nobody.
    { ...blocked, id: "m3", messageId: "m3", npcId: "n-gone" },
  ];
  assert.deepEqual(npcAttentionById({ rows, roster, toolApprovals: {} }), {
    "n-oliver": { approvals: 2, failedCards: 0 },
  });
});
