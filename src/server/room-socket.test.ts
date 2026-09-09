import assert from "node:assert/strict";
import test from "node:test";
import { setupThrowawaySqlite, seedChannelWithProfiles } from "@/test-setup/npc-seed";

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

function setup(opts: { allowed?: boolean; player?: boolean } = {}) {
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
      if (opts.player !== false) {
        players.set("s1", {
          id: "s1",
          userId: seeded.userId,
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
          user: { userId: seeded.userId, nickname: "dante" },
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

test("room:delete 는 만든 사람만, office 는 invalid", async () => {
  const seeded = await seedChannelWithProfiles({ placedActive: 1 });
  const t = setup();
  await t.register(seeded);
  const office = await rooms.ensureOfficeRoom(seeded.channelId, seeded.userId);
  await t.socket.trigger("room:delete", { roomId: office.id });
  assert.deepEqual(ev(t.emitted, "room:error").at(-1), { roomId: office.id, code: "invalid" });
});
