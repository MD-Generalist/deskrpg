import test from "node:test";
import assert from "node:assert/strict";
import { MotionSnapshotCache, untouchedSpawn, type MotionSnapshot } from "./motion-snapshot";
import { NpcMovementOwnership } from "./npc-movement-ownership";
const state: MotionSnapshot = {
  channelId: "office",
  revision: 4,
  ambientLeaderId: "a",
  seats: [{ seatId: "80:112", actorId: "npc", ownerSocketId: "b", x: 80, y: 112 }],
  npcs: [
    {
      npcId: "npc",
      x: 80,
      y: 112,
      homeX: 16,
      homeY: 16,
      direction: "up",
      ownerSocketId: "b",
      phase: "waiting",
      moving: false,
      revision: 4,
    },
  ],
};
test("late-join snapshot survives model load and excludes unknown caller NPC from leader ambient", () => {
  const cache = new MotionSnapshotCache();
  assert.equal(cache.accept(state, "office"), true);
  assert.equal(cache.accept({ ...state, channelId: "other", revision: 8 }, "office"), false);
  assert.equal(cache.accept({ ...state, revision: 3 }, "office"), false);
  // Model becomes ready afterward and consumes the retained authoritative public-seat position.
  const npc = cache.current!.npcs[0];
  const ownership = new NpcMovementOwnership();
  ownership.claim(npc.npcId, npc.ownerSocketId!);
  assert.equal(ownership.mayDrive("npc", "a", true), false);
  assert.deepEqual([npc.x, npc.y, npc.phase], [80, 112, "waiting"]);
  assert.equal(cache.current!.seats[0].actorId, "npc");
  cache.clear();
  assert.equal(cache.current, null);
  assert.equal(cache.accept({ ...state, revision: 1 }, "office"), true);
});
test("initial spawn acknowledgement applies before input but never relocates a moving or click-directed player", () => {
  const initial = { x: 80, y: 112 };
  assert.equal(untouchedSpawn(initial, { ...initial }, false), true);
  assert.equal(untouchedSpawn(initial, { ...initial }, true), false);
  assert.equal(untouchedSpawn(initial, { x: 81, y: 112 }, false), false);
  assert.equal(untouchedSpawn(null, initial, false), false);
});

test("ambient leader departure preserves an already owned call while restoring unowned ambient motion", async () => {
  const { restoreOnSnapshot } = await import("./motion-snapshot");
  const called = { ...state.npcs[0], phase: "called" as const, moving: true };
  assert.equal(restoreOnSnapshot(false, true, called), false);
  assert.equal(
    restoreOnSnapshot(false, true, { ...called, phase: "ambient", ownerSocketId: null }),
    true,
  );
  assert.equal(restoreOnSnapshot(true, false, called), true);
});

test("authoritative home adoption repairs a reactivated sprite and later roster reallocations", async () => {
  const { adoptNpcMotionHome } = await import("./motion-snapshot");
  const npc = { homeCol: 2, homeRow: 2 };
  assert.equal(adoptNpcMotionHome(npc, { homeX: 432, homeY: 80 }), true);
  assert.deepEqual(npc, { homeCol: 13, homeRow: 2 });
  // A call/return consumer sees the new tile on every snapshot, not just creation.
  assert.equal(adoptNpcMotionHome(npc, { homeX: 464, homeY: 80 }), true);
  assert.deepEqual(npc, { homeCol: 14, homeRow: 2 });
  assert.equal(adoptNpcMotionHome(npc, { homeX: 464, homeY: 80 }), false);
});
