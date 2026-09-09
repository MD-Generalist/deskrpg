import assert from "node:assert/strict";
import test from "node:test";

import { candidatesForInvite } from "./compose-candidates";
import type { RoomSummary } from "@/lib/chat-rooms-policy";

const room: RoomSummary = {
  id: "g1",
  kind: "group",
  name: "기획",
  replyPolicy: "members",
  createdBy: "u1",
  lastMessageAt: null,
  members: [
    { kind: "npc", id: "a", name: "소피" },
    { kind: "user", id: "u2", name: "제인" },
  ],
};

const npcs = [
  { id: "a", name: "소피" },
  { id: "b", name: "올리버" },
];
const users = [
  { id: "u2", name: "제인", online: true },
  { id: "u3", name: "단테", online: true },
];

test("이미 멤버인 NPC 와 사람은 초대 후보에서 빠진다", () => {
  const got = candidatesForInvite(room, npcs, users);
  assert.deepEqual(
    got.npcs.map((npc) => npc.id),
    ["b"],
  );
  assert.deepEqual(
    got.users.map((user) => user.id),
    ["u3"],
  );
});

test("같은 id 라도 kind 가 다르면 걸러지지 않는다", () => {
  // NPC "u2" 는 사람 멤버 u2 와 id 가 겹칠 뿐 다른 존재다.
  const got = candidatesForInvite(room, [{ id: "u2", name: "동명이인" }], []);
  assert.deepEqual(
    got.npcs.map((npc) => npc.id),
    ["u2"],
  );
});

test("방이 없으면(새 방 만들기) 후보를 그대로 돌려준다", () => {
  const got = candidatesForInvite(null, npcs, users);
  assert.equal(got.npcs.length, 2);
  assert.equal(got.users.length, 2);
});

test("selfUserId 를 주면 본인은 새 방 후보에서 빠진다 (M-6)", () => {
  const got = candidatesForInvite(null, npcs, users, "u3");
  assert.deepEqual(
    got.users.map((user) => user.id),
    ["u2"],
    "본인(u3)이 빠져야 한다",
  );
  assert.equal(got.npcs.length, 2, "NPC 후보는 영향받지 않는다");
});

test("selfUserId 는 기존 멤버 필터와 함께 걸린다 (M-6)", () => {
  const got = candidatesForInvite(room, npcs, users, "u3");
  assert.deepEqual(
    got.users.map((user) => user.id),
    [],
    "u2 는 멤버라 빠지고 u3 는 본인이라 빠진다",
  );
});
