import assert from "node:assert/strict";
import test from "node:test";
import { setupThrowawaySqlite, seedChannelWithProfiles, seedUser } from "@/test-setup/npc-seed";

setupThrowawaySqlite("room-socket-test");

import * as rooms from "@/lib/chat-rooms";
import { registerRoomHandlers } from "./room-socket";

type Emitted = [string, unknown];

function fakeSocket(emitted: Emitted[], id = "s1") {
  const handlers = new Map<string, (p: unknown) => unknown>();
  const joined = new Set<string>();
  return {
    id,
    joined,
    on(e: string, h: (p: unknown) => unknown) {
      handlers.set(e, h);
    },
    emit(e: string, p: unknown) {
      emitted.push([e, p]);
    },
    join(r: string) {
      joined.add(r);
    },
    leave(r: string) {
      joined.delete(r);
    },
    async trigger(e: string, p: unknown) {
      const h = handlers.get(e);
      assert.ok(h, e);
      await h(p);
    },
  };
}

function fakeIo(emitted: Emitted[]) {
  return {
    to(room: string) {
      return {
        emit(e: string, p: unknown) {
          emitted.push([`${e}@${room}`, p]);
        },
      };
    },
  };
}

type Seeded = Awaited<ReturnType<typeof seedChannelWithProfiles>>;

function setup(opts: { allowed?: boolean; player?: boolean; userId?: string } = {}) {
  const emitted: Emitted[] = [];
  const socket = fakeSocket(emitted);
  const io = fakeIo(emitted);
  const players = new Map();
  const woke: { roomId: string; text: string }[] = [];
  return {
    emitted,
    socket,
    players,
    woke,
    async register(seeded: Seeded) {
      // 기본 신원은 채널 소유자. `userId` 를 주면 그 사람인 척 등록한다 — 권한 갈래용.
      const actingUserId = opts.userId ?? seeded.userId;
      if (opts.player !== false) {
        players.set("s1", {
          id: "s1",
          userId: actingUserId,
          characterId: "c",
          characterName: "단테",
          appearance: null,
          mapId: seeded.channelId,
          x: 0,
          y: 0,
          direction: "down",
          animation: "idle",
        });
      }
      registerRoomHandlers({
        io: io as never,
        socket: socket as never,
        deps: {
          user: { userId: actingUserId, nickname: "dante" },
          players,
          lastChatTime: new Map(),
          cooldownMs: 2000,
          getParticipationAccess: async () => ({ access: { allowed: opts.allowed ?? true } }),
          rooms,
          getRuntime: async (_io, room) =>
            ({
              handleHumanMessage: async (_s: string, text: string) => {
                woke.push({ roomId: room.id, text });
              },
            }) as never,
          invalidateRuntime: () => {},
        },
      });
    },
  };
}

const ev = (emitted: Emitted[], name: string) =>
  emitted.filter(([e]) => e.startsWith(name)).map(([, p]) => p);

test("room:list 는 office 를 포함해 내 방을 준다", async () => {
  const seeded = await seedChannelWithProfiles({ placedActive: 1 });
  const t = setup();
  await t.register(seeded);
  await t.socket.trigger("room:list", { channelId: seeded.channelId });
  const [res] = ev(t.emitted, "room:list-response") as { rooms: { kind: string }[] }[];
  assert.deepEqual(
    res.rooms.map((r) => r.kind),
    ["office"],
  );
});

test("room:send 는 open 하지 않은 방이면 not_open, 빈 메시지면 empty, 쿨다운이면 cooldown — 전부 room:error 로", async () => {
  const seeded = await seedChannelWithProfiles({ placedActive: 1 });
  const t = setup();
  await t.register(seeded);
  const office = await rooms.ensureOfficeRoom(seeded.channelId, seeded.userId);
  await t.socket.trigger("room:send", { roomId: office.id, message: "hi" });
  assert.deepEqual(ev(t.emitted, "room:error").at(-1), { roomId: office.id, code: "not_open" });
  await t.socket.trigger("room:open", { roomId: office.id });
  assert.ok(t.socket.joined.has(`room-${office.id}`));
  await t.socket.trigger("room:send", { roomId: office.id, message: "   " });
  assert.deepEqual(ev(t.emitted, "room:error").at(-1), { roomId: office.id, code: "empty" });
  await t.socket.trigger("room:send", { roomId: office.id, message: "hi" });
  await t.socket.trigger("room:send", { roomId: office.id, message: "again" });
  assert.deepEqual(ev(t.emitted, "room:error").at(-1), { roomId: office.id, code: "cooldown" });
});

test("room:send 성공은 저장 + 방 방송 + 런타임 호출, 채널 권한 없으면 forbidden", async () => {
  const seeded = await seedChannelWithProfiles({ placedActive: 1 });
  const t = setup();
  await t.register(seeded);
  const office = await rooms.ensureOfficeRoom(seeded.channelId, seeded.userId);
  await t.socket.trigger("room:open", { roomId: office.id });
  await t.socket.trigger("room:send", { roomId: office.id, message: "@[소피] 안녕" });
  const [msg] = ev(t.emitted, `room:message@room-${office.id}`) as {
    message: { content: string; senderName: string };
  }[];
  assert.equal(msg.message.content, "@[소피] 안녕");
  assert.equal(msg.message.senderName, "단테");
  assert.deepEqual(t.woke, [{ roomId: office.id, text: "@[소피] 안녕" }]);
  assert.equal((await rooms.recentRoomMessages(office.id, 5)).length, 1);
  const t2 = setup({ allowed: false });
  await t2.register(seeded);
  await t2.socket.trigger("room:open", { roomId: office.id });
  assert.deepEqual(ev(t2.emitted, "room:error").at(-1), { roomId: office.id, code: "forbidden" });
});

test("players 에 없는 소켓은 not_joined", async () => {
  const seeded = await seedChannelWithProfiles({ placedActive: 1 });
  const t = setup({ player: false });
  await t.register(seeded);
  const office = await rooms.ensureOfficeRoom(seeded.channelId, seeded.userId);
  await t.socket.trigger("room:open", { roomId: office.id });
  await t.socket.trigger("room:send", { roomId: office.id, message: "hi" });
  assert.deepEqual(ev(t.emitted, "room:error").at(-1), { roomId: office.id, code: "not_joined" });
});

test("room:create 는 만든 사람을 멤버로 넣고 room:created 를 주며, group 방의 room:send 는 런타임을 깨운다", async () => {
  const seeded = await seedChannelWithProfiles({ placedActive: 2 });
  const t = setup();
  await t.register(seeded);
  await t.socket.trigger("room:create", {
    channelId: seeded.channelId,
    name: "기획",
    npcIds: [seeded.npcIds[0]],
    userIds: [],
  });
  const [created] = ev(t.emitted, "room:created") as {
    room: { id: string; kind: string; members: { kind: string }[] };
  }[];
  assert.equal(created.room.kind, "group");
  assert.deepEqual(created.room.members.map((m) => m.kind).sort(), ["npc", "user"]);
  await t.socket.trigger("room:open", { roomId: created.room.id });
  await t.socket.trigger("room:send", { roomId: created.room.id, message: "다들 어때" });
  assert.equal(t.woke.at(-1)?.roomId, created.room.id);
});

test("room:created 의 requestId 는 요청한 소켓에만 되돌아온다 — 초대된 사람에게는 없다", async () => {
  const seeded = await seedChannelWithProfiles({ placedActive: 1 });
  const invitee = await seedUser("room-invitee");
  const t = setup();
  await t.register(seeded);
  // 초대받을 사람의 소켓. `socketIdsForUsers` 가 이 목록에서 대상 소켓을 고른다.
  t.players.set("s2", {
    id: "s2",
    userId: invitee.id,
    characterId: "c2",
    characterName: "손님",
    appearance: null,
    mapId: seeded.channelId,
    x: 0,
    y: 0,
    direction: "down",
    animation: "idle",
  });

  await t.socket.trigger("room:create", {
    channelId: seeded.channelId,
    name: "기획",
    npcIds: [seeded.npcIds[0]],
    userIds: [invitee.id],
    requestId: "r1",
  });

  // `ev` 는 접두어로 걸러서 `room:created@s2` 까지 잡는다 — 여기서는 두 갈래를 갈라야 한다.
  const mine = t.emitted.filter(([e]) => e === "room:created").map(([, p]) => p);
  const theirs = t.emitted.filter(([e]) => e === "room:created@s2").map(([, p]) => p);
  assert.deepEqual(
    mine.map((p) => (p as { requestId?: string }).requestId),
    ["r1"],
  );
  assert.equal(theirs.length, 1, "초대된 사람도 방이 생긴 것을 알아야 한다");
  assert.equal(
    (theirs[0] as { requestId?: string }).requestId,
    undefined,
    "남의 표를 받으면 그 사람 화면이 남의 방으로 끌려 들어간다",
  );
});

test("쓸 수 없는 requestId 는 무시한다 — 표 없이 방만 만든다", async () => {
  const seeded = await seedChannelWithProfiles({ placedActive: 1 });
  const t = setup();
  await t.register(seeded);
  await t.socket.trigger("room:create", {
    channelId: seeded.channelId,
    name: "기획",
    npcIds: [seeded.npcIds[0]],
    userIds: [],
    requestId: "x".repeat(65),
  });
  const [created] = t.emitted.filter(([e]) => e === "room:created").map(([, p]) => p);
  assert.equal((created as { requestId?: string }).requestId, undefined);
  assert.ok((created as { room: { id: string } }).room.id, "방은 정상으로 만들어진다");
});

test("room:delete 는 만든 사람만, office 는 invalid", async () => {
  const seeded = await seedChannelWithProfiles({ placedActive: 1 });
  const t = setup();
  await t.register(seeded);
  const office = await rooms.ensureOfficeRoom(seeded.channelId, seeded.userId);
  await t.socket.trigger("room:delete", { roomId: office.id });
  assert.deepEqual(ev(t.emitted, "room:error").at(-1), { roomId: office.id, code: "invalid" });
});

test("room:rename 은 만든 사람만 — 멤버라도 남의 방 이름은 못 바꾼다", async () => {
  const seeded = await seedChannelWithProfiles({ placedActive: 1 });
  const owner = setup();
  await owner.register(seeded);
  await owner.socket.trigger("room:create", {
    channelId: seeded.channelId,
    name: "기획",
    npcIds: [seeded.npcIds[0]],
    userIds: [],
  });
  const [created] = ev(owner.emitted, "room:created") as { room: { id: string } }[];

  // 같은 방의 user 멤버지만 만든 사람은 아닌 두 번째 사람.
  const other = await seedUser("room-member");
  await rooms.addMembers(created.room.id, seeded.userId, [], [other.id]);
  const guest = setup({ userId: other.id });
  await guest.register(seeded);
  await guest.socket.trigger("room:rename", { roomId: created.room.id, name: "가로채기" });
  assert.deepEqual(ev(guest.emitted, "room:error").at(-1), {
    roomId: created.room.id,
    code: "forbidden",
  });
  assert.equal((await rooms.getRoom(created.room.id))?.name, "기획", "이름이 바뀌면 안 된다");

  await owner.socket.trigger("room:rename", { roomId: created.room.id, name: "기획 2팀" });
  const [updated] = ev(owner.emitted, `room:updated@room-${created.room.id}`) as {
    room: { name: string };
  }[];
  assert.equal(updated.room.name, "기획 2팀");
  assert.equal((await rooms.getRoom(created.room.id))?.name, "기획 2팀");
});

test("room:open 은 최근 60줄만 돌려준다 — 그보다 오래된 줄은 잘린다", async () => {
  const seeded = await seedChannelWithProfiles({ placedActive: 1 });
  const t = setup();
  await t.register(seeded);
  const office = await rooms.ensureOfficeRoom(seeded.channelId, seeded.userId);
  // sleep 이 없다. 메시지 id 가 UUIDv7 이라 같은 밀리초에 몰아 넣어도
  // `(created_at, id)` 정렬이 넣은 순서를 그대로 돌려준다.
  for (let i = 0; i <= 60; i += 1) {
    await rooms.appendRoomMessage({
      roomId: office.id,
      senderKind: "user",
      senderId: seeded.userId,
      senderName: "단테",
      content: `m${i}`,
    });
  }
  await t.socket.trigger("room:open", { roomId: office.id });
  const [history] = ev(t.emitted, "room:history") as { messages: { content: string }[] }[];
  assert.equal(history.messages.length, 60);
  assert.equal(history.messages[0].content, "m1", "가장 오래된 m0 가 잘린다");
  assert.equal(history.messages.at(-1)?.content, "m60", "오래된 순으로 온다");
});

test("office 방의 주인은 채널 소유자다 — 먼저 들어온 손님이 아니다", async () => {
  const seeded = await seedChannelWithProfiles({ placedActive: 1 });
  const visitor = await seedUser("room-visitor");
  const t = setup({ userId: visitor.id });
  await t.register(seeded);
  await t.socket.trigger("room:list", { channelId: seeded.channelId });
  const [res] = ev(t.emitted, "room:list-response") as {
    rooms: { kind: string; createdBy: string }[];
  }[];
  const officeSummary = res.rooms.find((r) => r.kind === "office");
  assert.ok(officeSummary, "office 방이 목록에 있어야 한다");
  assert.equal(officeSummary.createdBy, seeded.userId);
  assert.notEqual(officeSummary.createdBy, visitor.id);
});

test("채널이 없으면 room:list 는 방을 만들지 않고 not_found 를 준다", async () => {
  const seeded = await seedChannelWithProfiles({ placedActive: 1 });
  const t = setup();
  await t.register(seeded);
  await t.socket.trigger("room:list", { channelId: "00000000-0000-0000-0000-000000000000" });
  assert.deepEqual(ev(t.emitted, "room:error").at(-1), { roomId: null, code: "not_found" });
  assert.deepEqual(ev(t.emitted, "room:list-response"), []);
});
