import assert from "node:assert/strict";
import test from "node:test";

import {
  setupThrowawaySqlite,
  seedUser,
  seedChannel,
  seedChannelWithProfiles,
} from "@/test-setup/npc-seed";

// `db` 는 지연 초기화 싱글턴이고 node:test 는 파일마다 프로세스를 나누므로, 모듈
// 최상단에서 한 번 임시 DB 를 잡으면 이 파일의 모든 테스트가 그 DB 를 쓴다.
// `./chat-rooms` 는 `@/db` 를 정적으로 import 하므로, ESM 호이스팅을 피하려면
// 이 파일도 매 테스트에서 동적 import 를 써야 한다(npc-roster.test.ts 와 동일 패턴).
setupThrowawaySqlite("chat-rooms-test");

test("office 방은 채널당 하나 — 두 번 불러도 같은 id", async () => {
  const { ensureOfficeRoom } = await import("./chat-rooms");
  const owner = await seedUser();
  const ch = await seedChannel(owner.id);
  const a = await ensureOfficeRoom(ch.id, owner.id);
  const b = await ensureOfficeRoom(ch.id, owner.id);
  assert.equal(a.id, b.id);
  assert.equal(a.replyPolicy, "mention");
});

test("목록은 office + 내가 멤버인 group 만", async () => {
  const { ensureOfficeRoom, createRoom, listRoomsForUser, isRoomMember } =
    await import("./chat-rooms");
  const owner = await seedUser("owner");
  const other = await seedUser("other");
  const ch = await seedChannel(owner.id);
  await ensureOfficeRoom(ch.id, owner.id);
  const mine = await createRoom({
    channelId: ch.id,
    name: "기획",
    createdBy: owner.id,
    npcIds: [],
    userIds: [],
  });
  await createRoom({
    channelId: ch.id,
    name: "남의 방",
    createdBy: other.id,
    npcIds: [],
    userIds: [],
  });
  const rooms = await listRoomsForUser(ch.id, owner.id);
  assert.deepEqual(
    rooms.map((r) => r.kind),
    ["office", "group"],
  );
  assert.equal(rooms[1].id, mine.id);
  assert.equal(await isRoomMember(mine.id, owner.id), true, "만든 사람은 자동 멤버");
});

test("메시지를 쌓으면 last_message_at 이 오르고 최근 N 줄을 오래된 순으로 준다", async () => {
  const { createRoom, appendRoomMessage, recentRoomMessages, listRoomsForUser } =
    await import("./chat-rooms");
  const owner = await seedUser();
  const ch = await seedChannel(owner.id);
  const room = await createRoom({
    channelId: ch.id,
    name: "r",
    createdBy: owner.id,
    npcIds: [],
    userIds: [],
  });
  await appendRoomMessage({
    roomId: room.id,
    senderKind: "user",
    senderId: owner.id,
    senderName: "단테",
    content: "1",
  });
  await appendRoomMessage({
    roomId: room.id,
    senderKind: "npc",
    senderId: "n",
    senderName: "소피",
    content: "2",
  });
  await appendRoomMessage({
    roomId: room.id,
    senderKind: "system",
    senderId: null,
    senderName: "",
    content: "3",
  });
  const recent = await recentRoomMessages(room.id, 2);
  assert.deepEqual(
    recent.map((m) => m.content),
    ["2", "3"],
  );
  // 메시지가 하나도 없는 방을 같은 목록 조회에 섞어, 배치 조회(N+1 제거)가 메시지
  // 있는 방과 없는 방을 뒤섞지 않고 각각 올바로 매칭하는지 본다.
  const emptyRoom = await createRoom({
    channelId: ch.id,
    name: "빈 방",
    createdBy: owner.id,
    npcIds: [],
    userIds: [],
  });
  const rooms = await listRoomsForUser(ch.id, owner.id);
  const summary = rooms.find((r) => r.id === room.id);
  const emptySummary = rooms.find((r) => r.id === emptyRoom.id);
  assert.equal(summary?.lastMessage?.content, "3");
  assert.equal(emptySummary?.lastMessage, undefined);
});

test("NPC 멤버 초대는 중복 무시, 방 삭제는 cascade", async () => {
  const {
    createRoom,
    addMembers,
    roomNpcMemberIds,
    appendRoomMessage,
    deleteRoom,
    recentRoomMessages,
  } = await import("./chat-rooms");
  const seeded = await seedChannelWithProfiles({ placedActive: 2 });
  const room = await createRoom({
    channelId: seeded.channelId,
    name: "r",
    createdBy: seeded.userId,
    npcIds: [seeded.npcIds[0]],
    userIds: [],
  });
  await addMembers(room.id, seeded.userId, [seeded.npcIds[0], seeded.npcIds[1]], []);
  assert.deepEqual(
    (await roomNpcMemberIds(room.id)).sort(),
    [seeded.npcIds[0], seeded.npcIds[1]].sort(),
  );
  await appendRoomMessage({
    roomId: room.id,
    senderKind: "user",
    senderId: seeded.userId,
    senderName: "u",
    content: "x",
  });
  await deleteRoom(room.id);
  assert.deepEqual(await recentRoomMessages(room.id, 10), []);
});
