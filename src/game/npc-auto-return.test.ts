import assert from "node:assert/strict";
import test from "node:test";
import { shouldAutoReturn, shouldReturnOnRoomChange } from "./npc-auto-return";

test("직접 부른 NPC(calledForRoom=null) 는 대화창이 없으면 타이머를 탄다", () => {
  assert.equal(
    shouldAutoReturn(
      { moveState: "waiting", calledForRoom: null },
      { dialogOpen: false, visibleRoomId: "r1" },
    ),
    true,
  );
  assert.equal(
    shouldAutoReturn(
      { moveState: "waiting", calledForRoom: null },
      { dialogOpen: true, visibleRoomId: null },
    ),
    false,
  );
});
test("방이 부른 NPC 는 그 방이 보이는 동안 머문다 — 다른 방이 보이면 타이머를 탄다", () => {
  assert.equal(
    shouldAutoReturn(
      { moveState: "waiting", calledForRoom: "r1" },
      { dialogOpen: false, visibleRoomId: "r1" },
    ),
    false,
  );
  assert.equal(
    shouldAutoReturn(
      { moveState: "waiting", calledForRoom: "r1" },
      { dialogOpen: false, visibleRoomId: "r2" },
    ),
    true,
  );
  assert.equal(
    shouldAutoReturn(
      { moveState: "waiting", calledForRoom: "r1" },
      { dialogOpen: false, visibleRoomId: null },
    ),
    true,
  );
});
test("보이는 방이 바뀌면, 대기 중이고 그 방이 아닌 NPC 만 즉시 돌아간다", () => {
  assert.equal(shouldReturnOnRoomChange({ moveState: "waiting", calledForRoom: "r1" }, "r2"), true);
  assert.equal(
    shouldReturnOnRoomChange({ moveState: "waiting", calledForRoom: "r1" }, "r1"),
    false,
  );
  assert.equal(
    shouldReturnOnRoomChange({ moveState: "waiting", calledForRoom: null }, null),
    false,
    "직접 부른 NPC 는 방 전환과 무관",
  );
  assert.equal(
    shouldReturnOnRoomChange({ moveState: "returning", calledForRoom: "r1" }, null),
    false,
  );
});
