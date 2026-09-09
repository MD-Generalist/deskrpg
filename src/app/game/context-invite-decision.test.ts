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
