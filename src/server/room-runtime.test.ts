import assert from "node:assert/strict";
import test from "node:test";
import { setupThrowawaySqlite, seedChannelWithProfiles } from "@/test-setup/npc-seed";

setupThrowawaySqlite("room-runtime-test");

import * as rooms from "@/lib/chat-rooms";
import type { NpcAdapter, AdapterExecuteOptions } from "@/lib/adapters/types";
import {
  getOrCreateRoomRuntime,
  invalidateRoomRuntime,
  type RoomRuntimeDeps,
} from "./room-runtime";

type Emitted = [string, unknown];

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

/** Small settle window retained for legacy event assertions. */
const settle = () => new Promise((r) => setTimeout(r, 30));

const ev = (emitted: Emitted[], name: string) =>
  emitted.filter(([e]) => e.startsWith(name)).map(([, p]) => p);

/** 정해진 답을 돌려주고, 받은 대본을 기록하는 목 어댑터. */
function mockAdapter(reply: string, prompts: string[] = []): NpcAdapter {
  return {
    type: "mock",
    async execute(o: AdapterExecuteOptions) {
      prompts.push(String(o.prompt ?? ""));
      return { response: reply, session: { sessionRef: o.sessionKey } };
    },
    async testConnection() {
      return { status: "ok" as const };
    },
  } as NpcAdapter;
}

/**
 * 게이트웨이·CLI 없이 이 파일의 조립 규칙만 관찰한다. 실제 배선(`getNpcConfigsForChannel`
 * + `resolveNpcAdapter`)은 DB 의 hermes 프로필과 살아 있는 백엔드를 요구한다.
 */
function injected(
  channelId: string,
  npcs: { id: string; name: string; adapter: NpcAdapter }[],
): RoomRuntimeDeps {
  const byId = new Map(npcs.map((n) => [n.id, n]));
  return {
    getNpcConfigs: async () =>
      npcs.map((n) => ({
        id: n.id,
        name: n.name,
        agentId: null,
        sessionKeyPrefix: n.id,
        adapterType: "mock",
        adapterConfig: {},
        hermesProfileId: null,
        _channelId: channelId,
        _name: n.name,
        role: "Participant",
        passPolicy: null,
      })),
    resolveAdapter: async (npc, ctx) => ({
      participant: {
        npcId: npc.id,
        displayName: npc.name,
        role: "동료",
        passPolicy: null,
        instructions: null,
      },
      adapter: byId.get(npc.id)!.adapter,
      sessionKey: `${npc.sessionKeyPrefix}-${ctx.sessionScope}`,
    }),
  };
}

async function seedRoom(opts: { npcCount: number; memberCount: number }) {
  const seeded = await seedChannelWithProfiles({ placedActive: opts.npcCount });
  const room = await rooms.createRoom({
    channelId: seeded.channelId,
    name: "기획",
    createdBy: seeded.userId,
    npcIds: seeded.npcIds.slice(0, opts.memberCount),
    userIds: [],
  });
  return { seeded, room };
}

test("group 방의 참가자는 출근 NPC 전부가 아니라 그 방의 NPC 멤버뿐이다", async () => {
  const { seeded, room } = await seedRoom({ npcCount: 3, memberCount: 2 });
  const emitted: Emitted[] = [];
  const prompts: string[] = [];
  const spoke: string[] = [];
  const deps = injected(seeded.channelId, [
    { id: seeded.npcIds[0], name: "소피", adapter: mockAdapter("네", prompts) },
    { id: seeded.npcIds[1], name: "하늘", adapter: mockAdapter("저도요", prompts) },
    { id: seeded.npcIds[2], name: "단비", adapter: mockAdapter("불려오면 안 됨", prompts) },
  ]);

  invalidateRoomRuntime(room.id);
  const runtime = await getOrCreateRoomRuntime(fakeIo(emitted) as never, room, seeded.userId, deps);
  assert.ok(runtime);

  // members 정책 — 지명이 없으면 멤버 전원이 답한다. 방 밖의 단비는 끼지 않는다.
  await runtime.handleHumanMessage("단테", "다들 어때", "s1");
  await settle();
  for (const p of ev(emitted, `room:message@room-${room.id}`) as {
    message: { senderName: string };
  }[])
    spoke.push(p.message.senderName);
  assert.deepEqual(spoke.sort(), ["소피", "하늘"]);
});

test("mention 정책(office)은 지명한 NPC 만 깨운다", async () => {
  const seeded = await seedChannelWithProfiles({ placedActive: 2 });
  const office = await rooms.ensureOfficeRoom(seeded.channelId, seeded.userId);
  const emitted: Emitted[] = [];
  const deps = injected(seeded.channelId, [
    { id: seeded.npcIds[0], name: "소피", adapter: mockAdapter("네") },
    { id: seeded.npcIds[1], name: "하늘", adapter: mockAdapter("저도요") },
  ]);

  invalidateRoomRuntime(office.id);
  const runtime = await getOrCreateRoomRuntime(
    fakeIo(emitted) as never,
    office,
    seeded.userId,
    deps,
  );
  assert.ok(runtime);

  // office 방은 채널의 출근 NPC 전부가 참가자다(멤버 표가 아니라 출근부가 정본).
  await runtime.handleHumanMessage("단테", "@[소피] 안녕", "s1");
  await settle();
  const said = (
    ev(emitted, `room:message@room-${office.id}`) as { message: { senderName: string } }[]
  ).map((p) => p.message.senderName);
  assert.deepEqual(said, ["소피"], "지명하지 않은 하늘은 답하지 않는다");
});

test("NPC 의 답은 DB 에 남고 room-<id> 로 방송된다", async () => {
  const { seeded, room } = await seedRoom({ npcCount: 1, memberCount: 1 });
  const emitted: Emitted[] = [];
  const deps = injected(seeded.channelId, [
    { id: seeded.npcIds[0], name: "소피", adapter: mockAdapter("점심은 김치찌개요") },
  ]);

  invalidateRoomRuntime(room.id);
  const runtime = await getOrCreateRoomRuntime(fakeIo(emitted) as never, room, seeded.userId, deps);
  assert.ok(runtime);
  await runtime.handleHumanMessage("단테", "뭐 먹지", "s1");
  await settle();

  const [broadcast] = ev(emitted, `room:message@room-${room.id}`) as {
    roomId: string;
    message: { senderKind: string; senderId: string; senderName: string; content: string };
  }[];
  assert.equal(broadcast.roomId, room.id);
  assert.equal(broadcast.message.senderKind, "npc");
  assert.equal(broadcast.message.senderId, seeded.npcIds[0]);
  assert.equal(broadcast.message.content, "점심은 김치찌개요");

  const stored = await rooms.recentRoomMessages(room.id, 10);
  assert.deepEqual(
    stored.map((m) => [m.senderKind, m.content]),
    [["npc", "점심은 김치찌개요"]],
    "사람 메시지는 소켓 계층이 저장한다 — 런타임은 NPC 의 답만 남긴다",
  );
});

test("턴이 열리면 npc:come-to-player 가 채널 룸으로, roomId 를 달고 나간다", async () => {
  const { seeded, room } = await seedRoom({ npcCount: 1, memberCount: 1 });
  const emitted: Emitted[] = [];
  const deps = injected(seeded.channelId, [
    { id: seeded.npcIds[0], name: "소피", adapter: mockAdapter("네") },
  ]);

  invalidateRoomRuntime(room.id);
  const runtime = await getOrCreateRoomRuntime(fakeIo(emitted) as never, room, seeded.userId, deps);
  assert.ok(runtime);
  await runtime.handleHumanMessage("단테", "소피야", "socket-abc");

  const [call] = ev(emitted, `npc:come-to-player@${seeded.channelId}`) as {
    npcId: string;
    targetPlayerId: string;
    reason: string;
    roomId: string;
  }[];
  assert.deepEqual(call, {
    npcId: seeded.npcIds[0],
    targetPlayerId: "socket-abc",
    reason: "map-chat",
    roomId: room.id,
  });
});

test("최근 대화는 10줄까지만 실리고, 같은 말이라도 다른 메시지면 둘 다 남는다", async () => {
  const { seeded, room } = await seedRoom({ npcCount: 1, memberCount: 1 });
  const emitted: Emitted[] = [];
  const prompts: string[] = [];
  const deps = injected(seeded.channelId, [
    { id: seeded.npcIds[0], name: "소피", adapter: mockAdapter("응", prompts) },
  ]);

  const contents = ["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "네", "네"];
  for (const content of contents) {
    await rooms.appendRoomMessage({
      roomId: room.id,
      senderKind: "user",
      senderId: seeded.userId,
      senderName: "단테",
      content,
    });
  }
  // 시스템 메시지는 프롬프트에 실리지 않아야 한다.
  await rooms.appendRoomMessage({
    roomId: room.id,
    senderKind: "system",
    senderId: null,
    senderName: "",
    content: JSON.stringify({ kind: "renamed", name: "기획 2팀" }),
  });
  // 사람의 말은 소켓 계층이 먼저 저장한다 — 런타임은 그 뒤에 깨어난다.
  await rooms.appendRoomMessage({
    roomId: room.id,
    senderKind: "user",
    senderId: seeded.userId,
    senderName: "단테",
    content: "질문",
  });

  invalidateRoomRuntime(room.id);
  const runtime = await getOrCreateRoomRuntime(fakeIo(emitted) as never, room, seeded.userId, deps);
  assert.ok(runtime);
  await runtime.handleHumanMessage("단테", "질문", "s1");

  const recentBlock = prompts[0].split("[최근 대화]")[1].split("[답하는 법]")[0].trim();
  const lines = recentBlock.split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 10, "최근 10줄만 싣는다");
  assert.equal(lines.filter((l) => l === "단테: 네").length, 2, "같은 말도 다른 메시지면 둘 다");
  assert.equal(lines.at(-1), "단테: 질문");
  assert.ok(!recentBlock.includes("renamed"), "시스템 메시지는 대본에 실리지 않는다");
  assert.ok(!lines.includes("단테: m0"), "가장 오래된 줄은 밀려난다");
});

test("같은 말을 두 번 보내면 두 번 다 대본에 남는다 — 쿨다운(2초)보다 긴 간격의 정당한 반복", async () => {
  const { seeded, room } = await seedRoom({ npcCount: 1, memberCount: 1 });
  const emitted: Emitted[] = [];
  const prompts: string[] = [];
  const deps = injected(seeded.channelId, [
    { id: seeded.npcIds[0], name: "소피", adapter: mockAdapter("응", prompts) },
  ]);

  // 소켓 계층이 하는 일: 사람의 말을 먼저 저장하고 런타임을 깨운다.
  const say = async (content: string) => {
    await rooms.appendRoomMessage({
      roomId: room.id,
      senderKind: "user",
      senderId: seeded.userId,
      senderName: "단테",
      content,
    });
  };

  invalidateRoomRuntime(room.id);
  await say("네");
  const runtime = await getOrCreateRoomRuntime(fakeIo(emitted) as never, room, seeded.userId, deps);
  assert.ok(runtime);
  await runtime.handleHumanMessage("단테", "네", "s1");
  await settle();

  await say("네");
  await runtime.handleHumanMessage("단테", "네", "s1");
  await settle();

  const recentBlock = prompts.at(-1)!.split("[최근 대화]")[1].split("[답하는 법]")[0];
  const lines = recentBlock.split("\n").filter((l) => l.length > 0);
  assert.equal(
    lines.filter((l) => l === "단테: 네").length,
    2,
    "두 번째 '네' 가 사라지면 NPC 는 사람이 다시 물었다는 것을 모른다",
  );
});

test("room emits receipt, thinking and cumulative content before final persisted message", async () => {
  const { seeded, room } = await seedRoom({ npcCount: 1, memberCount: 1 });
  const emitted: Emitted[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let streamed!: () => void;
  const ready = new Promise<void>((resolve) => {
    streamed = resolve;
  });
  const adapter = mockAdapter("안녕하세요");
  adapter.execute = async (opts) => {
    opts.onDelta?.("안녕");
    streamed();
    await gate;
    opts.onDelta?.("하세요");
    return { response: "안녕하세요", session: { sessionRef: "test" } };
  };
  const rt = await getOrCreateRoomRuntime(
    fakeIo(emitted) as never,
    room,
    seeded.userId,
    injected(seeded.channelId, [{ id: seeded.npcIds[0], name: "소피", adapter }]),
  );
  assert.ok(rt);
  const result = rt.handleHumanMessage("단테", "안녕", "socket", "source-message");
  await ready;
  const responses = ev(emitted, "room:response-state") as {
    response: import("@/lib/chat-response").ChatResponse;
  }[];
  const beforeFinalMessages = ev(emitted, "room:message").length;
  release();
  await result;
  assert.deepEqual(
    responses.map((r) => r.response.status),
    ["queued", "thinking", "streaming"],
  );
  assert.equal(responses[2].response.content, "안녕");
  assert.equal(responses[0].response.sourceMessageId, "source-message");
  assert.equal(beforeFinalMessages, 0);
  const final = (
    ev(emitted, "room:response-state").at(-1) as {
      response: import("@/lib/chat-response").ChatResponse;
    }
  ).response;
  assert.equal(final.status, "complete");
  assert.equal(final.content, "안녕하세요");
  const messages = await rooms.recentRoomMessages(room.id, 10);
  assert.equal(final.messageId, messages[0].id);
});

test("invalidated pending room construction cannot replace a newer response snapshot", async () => {
  const { seeded, room } = await seedRoom({ npcCount: 1, memberCount: 1 });
  const emitted: Emitted[] = [];
  const deps = injected(seeded.channelId, [
    { id: seeded.npcIds[0], name: "Sophie", adapter: mockAdapter("hello") },
  ]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const old = getOrCreateRoomRuntime(fakeIo(emitted) as never, room, seeded.userId, {
    ...deps,
    getNpcConfigs: async (...args) => {
      await gate;
      return deps.getNpcConfigs!(...args);
    },
  });
  invalidateRoomRuntime(room.id);
  const current = await getOrCreateRoomRuntime(fakeIo(emitted) as never, room, seeded.userId, deps);
  await current!.handleHumanMessage("Dante", "hello", "socket", "source");
  release();
  assert.equal(await old, null);
  const { getRoomResponseSnapshot } = await import("./room-runtime");
  assert.equal(getRoomResponseSnapshot(room.id).length, 1);
});
