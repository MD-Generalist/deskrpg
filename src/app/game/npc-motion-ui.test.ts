import test from "node:test";
import assert from "node:assert/strict";
import { npcMotionUi } from "./npc-motion-ui";
import type { MotionSnapshot } from "../../game/motion-snapshot";
const snapshot: MotionSnapshot = {
  channelId: "office",
  revision: 2,
  ambientLeaderId: "new",
  seats: [],
  npcs: [
    {
      npcId: "noah",
      x: 112,
      y: 144,
      homeX: 48,
      homeY: 48,
      direction: "up",
      phase: "waiting",
      ownerSocketId: "new",
      moving: false,
      revision: 2,
    },
  ],
};
test("rejoined waiting owner retains return control despite late local idle/old-owner state", () => {
  assert.deepEqual(npcMotionUi(snapshot, "noah", "idle", "old"), {
    phase: "waiting",
    caller: "new",
  });
});
test("authoritative returned state removes stale return control", () => {
  const returned = {
    ...snapshot,
    npcs: [{ ...snapshot.npcs[0], phase: "idle" as const, ownerSocketId: null }],
  };
  assert.deepEqual(npcMotionUi(returned, "noah", "waiting", "old"), {
    phase: "idle",
    caller: undefined,
  });
});
test("only absent snapshots use local optimistic state", () => {
  assert.deepEqual(npcMotionUi(null, "noah", "moving-to-player", "self"), {
    phase: "moving-to-player",
    caller: "self",
  });
});
