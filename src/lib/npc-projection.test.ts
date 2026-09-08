import assert from "node:assert/strict";
import test from "node:test";
import { projectNpcRow, filterForMap } from "./npc-projection";

const npc = {
  id: "n1",
  channelId: "c1",
  name: "옛이름",
  appearance: { old: true },
  positionX: 3,
  positionY: 4,
  direction: "down",
  adapterType: "hermes",
  adapterConfig: null,
  agentConfig: null,
  hermesProfileId: "p1",
  active: true,
  createdAt: null,
  updatedAt: null,
};
const profile = {
  id: "p1",
  gatewayId: "g1",
  profileName: "oliver",
  displayName: "올리버",
  appearance: { new: true },
};

test("이름과 외형은 프로필이 정본이다 — npcs 의 옛 값은 무시한다", () => {
  const p = projectNpcRow(npc, profile, "owner");
  assert.equal(p.name, "올리버");
  assert.deepEqual(p.appearance, { new: true });
});

test("표시 이름이 없으면 프로필 이름으로 떨어진다", () => {
  const p = projectNpcRow(npc, { ...profile, displayName: null }, "owner");
  assert.equal(p.name, "oliver");
});

test("맵 필터는 자리 미정과 휴면을 뺀다", () => {
  const placed = projectNpcRow(npc, profile, "owner");
  const unplaced = projectNpcRow(
    { ...npc, id: "n2", positionX: null, positionY: null },
    profile,
    "owner",
  );
  const dormant = projectNpcRow({ ...npc, id: "n3", active: false }, profile, "owner");
  assert.deepEqual(
    filterForMap([placed, unplaced, dormant]).map((n) => n.id),
    ["n1"],
  );
});
