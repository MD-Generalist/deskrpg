import assert from "node:assert/strict";
import test from "node:test";

import { decideNpcUpdate, type ProjectedNpcLike } from "./npc-updated-dispatch";

function projected(overrides: Partial<ProjectedNpcLike> = {}): ProjectedNpcLike {
  return {
    id: "n1",
    name: "소피",
    positionX: 3,
    positionY: 4,
    direction: "down",
    appearance: { body: "light" },
    active: true,
    ...overrides,
  };
}

const noSprites = () => false;
const hasSprites = () => true;

test("옛 모양은 스프라이트가 있을 때만 갱신한다", () => {
  assert.deepEqual(decideNpcUpdate({ npcId: "n1", name: "소피" }, hasSprites), {
    kind: "update",
    npcId: "n1",
    fields: { name: "소피", direction: undefined, appearance: undefined },
  });
  assert.deepEqual(decideNpcUpdate({ npcId: "n1", name: "소피" }, noSprites), { kind: "ignore" });
});

test("퇴근한 NPC 는 맵에서 뺀다", () => {
  assert.deepEqual(decideNpcUpdate({ npc: projected({ active: false }) }, hasSprites), {
    kind: "remove",
    npcId: "n1",
  });
});

test("자리를 잃은 NPC 도 맵에서 뺀다", () => {
  assert.deepEqual(
    decideNpcUpdate({ npc: projected({ positionX: null, positionY: null }) }, hasSprites),
    { kind: "remove", npcId: "n1" },
  );
});

test("출근했고 스프라이트가 없으면 새로 그린다", () => {
  assert.deepEqual(decideNpcUpdate({ npc: projected() }, noSprites), {
    kind: "spawn",
    npc: {
      id: "n1",
      name: "소피",
      positionX: 3,
      positionY: 4,
      direction: "down",
      appearance: { body: "light" },
    },
  });
});

test("출근했고 스프라이트가 있으면 갱신한다", () => {
  assert.deepEqual(decideNpcUpdate({ npc: projected({ name: "새이름" }) }, hasSprites), {
    kind: "update",
    npcId: "n1",
    fields: { name: "새이름", direction: "down", appearance: { body: "light" } },
  });
});

test("빈 payload 는 무시한다", () => {
  assert.deepEqual(decideNpcUpdate(null, hasSprites), { kind: "ignore" });
  assert.deepEqual(decideNpcUpdate({}, hasSprites), { kind: "ignore" });
});
