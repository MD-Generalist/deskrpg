import assert from "node:assert/strict";
import test from "node:test";

import { setupThrowawaySqlite, seedChannelWithProfiles } from "@/test-setup/npc-seed";

setupThrowawaySqlite("npc-roster-socket-test");

type RecordedEmit = [string, unknown];

function fakeSocket(emitted: RecordedEmit[]) {
  const handlers = new Map<string, (payload: unknown) => unknown>();
  return {
    id: "socket-1",
    on(event: string, handler: (payload: unknown) => unknown) {
      handlers.set(event, handler);
    },
    emit(event: string, payload: unknown) {
      emitted.push([event, payload]);
    },
    async trigger(event: string, payload: unknown) {
      const handler = handlers.get(event);
      assert.ok(handler, `missing handler for ${event}`);
      await handler(payload);
    },
  };
}

function fakeIo(emitted: RecordedEmit[]) {
  return {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          emitted.push([`${event}@${room}`, payload]);
        },
      };
    },
  };
}

async function setup(opts: { owner?: boolean } = {}) {
  const { registerNpcRosterHandlers } = await import("./npc-roster-socket");
  const { channelId, npcIds, userId } = await seedChannelWithProfiles({ placedActive: 1 });
  const emitted: RecordedEmit[] = [];
  const socket = fakeSocket(emitted);
  const meetingRooms = new Map<string, { participants: Set<string> }>();
  const activeBrokers = new Map<string, unknown>();
  registerNpcRosterHandlers({
    io: fakeIo(emitted),
    socket,
    deps: {
      meetingRooms,
      activeBrokers,
      user: { userId },
      isChannelOwner: async () => opts.owner ?? true,
    },
  });
  return { channelId, npcId: npcIds[0], emitted, socket, meetingRooms, activeBrokers };
}

test("회의 중인 채널의 NPC 는 퇴근시킬 수 없다", async () => {
  const { selectNpcById } = await import("@/lib/npc-projection");
  const { channelId, npcId, emitted, socket, activeBrokers } = await setup();

  activeBrokers.set(channelId, {});
  await socket.trigger("npc:set-active", { channelId, npcId, active: false });
  assert.deepEqual(emitted.at(-1), [
    "npc:set-active:error",
    { npcId, errorCode: "npc_in_meeting" },
  ]);
  assert.equal((await selectNpcById(npcId))!.active, true, "회의 중에는 상태가 바뀌지 않는다");
});

test("회의방에 사람이 앉아 있어도 퇴근을 막는다", async () => {
  const { channelId, npcId, emitted, socket, meetingRooms } = await setup();

  meetingRooms.set(channelId, { participants: new Set(["socket-1"]) });
  await socket.trigger("npc:set-active", { channelId, npcId, active: false });
  assert.deepEqual(emitted.at(-1), [
    "npc:set-active:error",
    { npcId, errorCode: "npc_in_meeting" },
  ]);
});

test("회의가 끝나면 퇴근이 반영되고 채널 전체에 npc:updated 가 간다", async () => {
  const { selectNpcById } = await import("@/lib/npc-projection");
  const { channelId, npcId, emitted, socket, activeBrokers } = await setup();

  activeBrokers.delete(channelId);
  await socket.trigger("npc:set-active", { channelId, npcId, active: false });
  assert.equal((await selectNpcById(npcId))!.active, false);
  const [event, payload] = emitted.at(-1)!;
  assert.equal(event, `npc:updated@${channelId}`);
  assert.equal((payload as { npc: { id: string; active: boolean } }).npc.id, npcId);
  assert.equal((payload as { npc: { active: boolean } }).npc.active, false);
});

test("출근은 회의 중에도 막지 않는다", async () => {
  const { selectNpcById } = await import("@/lib/npc-projection");
  const { setNpcActive } = await import("@/lib/npc-roster");
  const { channelId, npcId, emitted, socket, activeBrokers } = await setup();

  await setNpcActive(npcId, false);
  activeBrokers.set(channelId, {});
  await socket.trigger("npc:set-active", { channelId, npcId, active: true });
  assert.equal((await selectNpcById(npcId))!.active, true);
  assert.equal(emitted.at(-1)![0], `npc:updated@${channelId}`);
});

test("채널 소유자가 아니면 forbidden", async () => {
  const { selectNpcById } = await import("@/lib/npc-projection");
  const { channelId, npcId, emitted, socket } = await setup({ owner: false });

  await socket.trigger("npc:set-active", { channelId, npcId, active: false });
  assert.deepEqual(emitted.at(-1), ["npc:set-active:error", { npcId, errorCode: "forbidden" }]);
  assert.equal((await selectNpcById(npcId))!.active, true);
});

test("다른 채널의 NPC 는 자기 채널 소유권으로 건드릴 수 없다", async () => {
  const { selectNpcById } = await import("@/lib/npc-projection");
  const { channelId, emitted, socket } = await setup();
  const other = await seedChannelWithProfiles({ placedActive: 1 });

  await socket.trigger("npc:set-active", { channelId, npcId: other.npcIds[0], active: false });
  assert.deepEqual(emitted.at(-1), [
    "npc:set-active:error",
    { npcId: other.npcIds[0], errorCode: "npc_not_found" },
  ]);
  assert.equal((await selectNpcById(other.npcIds[0]))!.active, true);
});

test("빈 페이로드는 조용히 무시한다", async () => {
  const { channelId, npcId, emitted, socket } = await setup();

  await socket.trigger("npc:set-active", undefined);
  await socket.trigger("npc:set-active", { channelId, npcId });
  assert.deepEqual(emitted, []);
});
