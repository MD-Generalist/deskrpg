import assert from "node:assert/strict";
import test from "node:test";

import { decideContextInvite } from "./context-invite-decision";
import type { RoomSummary } from "@/lib/chat-rooms-policy";

const groupRoom: RoomSummary = {
  id: "room-1",
  kind: "group",
  name: "그룹",
  replyPolicy: "members",
  createdBy: "u1",
  lastMessageAt: null,
  members: [],
};

const officeRoom: RoomSummary = {
  ...groupRoom,
  id: "room-office",
  kind: "office",
};

test("패널이 보이고 group 방이면 그 방으로 초대한다", () => {
  const decision = decideContextInvite({ visible: true, currentRoom: groupRoom });
  assert.deepEqual(decision, { kind: "invite", roomId: "room-1" });
});

test("group 방이어도 패널이 접혀 있으면 새로 작성한다", () => {
  const decision = decideContextInvite({ visible: false, currentRoom: groupRoom });
  assert.deepEqual(decision, { kind: "compose" });
});

test("패널이 보여도 office 방이면 새로 작성한다", () => {
  const decision = decideContextInvite({ visible: true, currentRoom: officeRoom });
  assert.deepEqual(decision, { kind: "compose" });
});

test("현재 방이 없으면 새로 작성한다", () => {
  const decision = decideContextInvite({ visible: true, currentRoom: null });
  assert.deepEqual(decision, { kind: "compose" });
});

const groupRoomWithSophie: RoomSummary = {
  ...groupRoom,
  members: [{ kind: "npc", id: "npc-sophie", name: "소피" }],
};

test("이미 그 방 멤버인 NPC 를 초대하면 already-member 로 알린다 (M-5)", () => {
  const decision = decideContextInvite({
    visible: true,
    currentRoom: groupRoomWithSophie,
    npcId: "npc-sophie",
  });
  assert.deepEqual(decision, { kind: "already-member", roomId: "room-1" });
});

test("멤버가 아닌 NPC 는 그대로 초대한다 (M-5)", () => {
  const decision = decideContextInvite({
    visible: true,
    currentRoom: groupRoomWithSophie,
    npcId: "npc-other",
  });
  assert.deepEqual(decision, { kind: "invite", roomId: "room-1" });
});
