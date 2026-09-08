import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlacementRequest,
  keepsPlacementMode,
  placementBroadcastPlan,
} from "./npc-placement-request";

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

test("자리 이동은 빼고 다시 넣는다 — add 만 보내면 다른 화면이 옛 칸에 남는다", () => {
  assert.deepEqual(placementBroadcastPlan(true), ["remove", "add"]);
});

test("첫 배치는 뺄 것이 없다", () => {
  assert.deepEqual(placementBroadcastPlan(false), ["add"]);
});

test("타일이 점유돼 409 가 나면 배치 모드를 유지한다", () => {
  assert.equal(keepsPlacementMode(409), true);
});

test("성공도 실패도 배치 모드를 끝낸다", () => {
  for (const status of [200, 400, 403, 404, 500]) {
    assert.equal(keepsPlacementMode(status), false, `${status} 는 배치 모드를 끝낸다`);
  }
});
