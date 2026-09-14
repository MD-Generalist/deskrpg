import test from "node:test";
import assert from "node:assert/strict";
import { isMeetingChair, selectMeetingNpcs } from "./participants";

test("only two selected NPCs participate out of the ten-person catalog", () => {
  const catalog = Array.from({ length: 10 }, (_, i) => ({ id: `npc-${i}`, name: `Person ${i}` }));
  const selection = new Set(["npc-2", "npc-7"]);
  const snapshot = selectMeetingNpcs(catalog, selection);
  assert.deepEqual(
    snapshot.map((npc) => npc.id),
    ["npc-2", "npc-7"],
  );
  assert.equal(1 + snapshot.length, 3);
  selection.add("npc-5");
  catalog.push({ id: "npc-10", name: "New hire" });
  assert.equal(snapshot.length, 2, "running roster remains the submitted snapshot");
});
test("unknown and empty selections do not admit other NPCs", () => {
  assert.deepEqual(selectMeetingNpcs([{ id: "one" }], new Set(["missing"])), []);
  assert.deepEqual(selectMeetingNpcs([{ id: "one" }], new Set()), []);
});

import { restoreMeetingNpcs } from "../../lib/meeting-discussion-state";
test("observer restores the authoritative selected roster rather than all channel NPCs", () => {
  const catalog = Array.from({ length: 10 }, (_, i) => ({
    id: `npc-${i}`,
    name: `Catalog ${i}`,
    appearance: { look: i },
  }));
  const restored = restoreMeetingNpcs(
    [
      { id: "npc-2", name: "소피" },
      { id: "npc-7", name: "마틴" },
      { id: "uncached", name: "새 프로필" },
    ],
    catalog,
  );
  assert.deepEqual(
    restored.map((npc) => npc.name),
    ["소피", "마틴", "새 프로필"],
  );
  assert.deepEqual(restored[0].appearance, { look: 2 });
  assert.equal(restored[2].appearance, null);
});

test("chair follows initiator user identity for both observers and reconnects", () => {
  const chair = { id: "socket-a", userId: "user-a", type: "user" as const };
  const observer = { id: "socket-b", userId: "user-b", type: "user" as const };
  assert.equal(isMeetingChair(chair, "user-a"), true);
  assert.equal(isMeetingChair(observer, "user-a"), false);
  const reconnectedChair = { ...chair, id: "socket-a-reconnected" };
  assert.equal(isMeetingChair(reconnectedChair, "user-a"), true);
  assert.equal(isMeetingChair({ type: "npc", userId: "user-a" }, "user-a"), false);
  assert.equal(isMeetingChair({ type: "user" }, "user-a"), false);
  assert.equal(isMeetingChair(chair, null), false);
});
