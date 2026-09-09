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
