import assert from "node:assert/strict";
import test from "node:test";
import { navigatorMotion, selectionForEvent } from "./conversation-integration";

test("map and navigator events resolve to the same conversation selection", () => {
  assert.deepEqual(selectionForEvent({ type: "npc", npcId: "n1", npcName: "소피" }), {
    kind: "npc",
    npcId: "n1",
    npcName: "소피",
  });
  assert.deepEqual(selectionForEvent({ type: "public-room", roomId: "office" }), {
    kind: "room",
    roomId: "office",
  });
});

test("navigator motion preserves employment, placement and caller ownership", () => {
  assert.equal(navigatorMotion({ active: false, placed: true }), "resting");
  assert.equal(navigatorMotion({ active: true, placed: false }), "unplaced");
  assert.equal(navigatorMotion({ active: true, placed: true, phase: "waiting" }), "waiting");
  assert.equal(
    navigatorMotion({ active: true, placed: true, phase: "moving-to-player" }),
    "moving",
  );
  assert.equal(navigatorMotion({ active: true, placed: true, phase: "returning" }), "moving");
  assert.equal(navigatorMotion({ active: true, placed: true, phase: "idle" }), "idle");
});
