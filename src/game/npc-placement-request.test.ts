import assert from "node:assert/strict";
import test from "node:test";

import { buildPlacementRequest } from "./npc-placement-request";

test("배치는 이미 있는 NPC 에 PUT 으로 자리만 준다", () => {
  const { url, init } = buildPlacementRequest("npc-1", 7, 3);
  assert.equal(url, "/api/npcs/npc-1");
  assert.equal(init.method, "PUT");
  // POST /api/npcs 는 없어졌다 — 새로 만들면 프로필 없는 NPC 가 생긴다.
  assert.notEqual(init.method, "POST");
  assert.deepEqual(JSON.parse(init.body as string), { positionX: 7, positionY: 3 });
});

test("자리 말고는 아무 필드도 보내지 않는다", () => {
  const { init } = buildPlacementRequest("npc-1", 0, 0);
  const body = JSON.parse(init.body as string) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["positionX", "positionY"]);
});
