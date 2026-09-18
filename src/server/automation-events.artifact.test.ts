import { test } from "node:test";
import assert from "node:assert/strict";

import type { PluginEvent } from "@/lib/hermes/deskrpg-plugin-types";
import type { RoomMessage } from "@/lib/chat-rooms-policy";
import {
  createAutomationState,
  ingest,
  type ChannelNpcLookup,
  type IngestDeps,
} from "./automation-events";

// T6. 방송 허용 목록 — 모르는 kind 는 어느 채널로도 나가지 않는다. 아티팩트 사건은
// 채널 NPC 프로필이거나 채널 보드일 때만 `artifact:event` 로 나가고, 삭제 사건은
// `artifact_id` 만 싣는다. 방·작업 중 표시는 `artifact.*` 에 반응하지 않는다.

const GATEWAY = "gateway-1";

type Emitted = { channelId: string; event: string; payload: unknown };

function makeDeps(opts: { npcProfiles?: string[]; boardSlug?: string } = {}) {
  const emitted: Emitted[] = [];
  const appended: Array<Parameters<IngestDeps["appendRoomMessage"]>[0]> = [];
  const npcProfiles = new Set(opts.npcProfiles ?? []);
  const deps: IngestDeps = {
    gatewayId: GATEWAY,
    boardSlug: opts.boardSlug ?? "b1",
    state: createAutomationState(),
    findNpcByProfile: async (_channelId, profileName): Promise<ChannelNpcLookup | null> =>
      npcProfiles.has(profileName)
        ? {
            profileName,
            npc: { id: `n-${profileName}`, active: true },
            displayName: profileName,
          }
        : null,
    findCronOriginChannel: async () => null,
    ensureOfficeRoomId: async () => "office-room",
    appendRoomMessage: async (args) => {
      appended.push(args);
      return {
        id: "msg-1",
        roomId: args.roomId,
        senderKind: args.senderKind,
        senderId: args.senderId,
        senderName: args.senderName,
        content: args.content,
        createdAt: new Date().toISOString(),
        notice: args.notice ?? null,
      } satisfies RoomMessage;
    },
    emitChannel: (channelId, event, payload) => emitted.push({ channelId, event, payload }),
    emitRoomMessage: () => {},
  };
  return { deps, emitted, appended };
}

let eventSeq = 0;
function ev(
  input: Partial<PluginEvent> & { kind: PluginEvent["kind"]; profile?: string; board?: string },
): PluginEvent {
  return {
    id: input.id ?? `ev_${(eventSeq += 1)}`,
    ts: input.ts ?? 1_758_000_000,
    kind: input.kind,
    board: input.board,
    task_id: input.task_id,
    profile: input.profile,
    job_id: input.job_id,
    run_id: input.run_id,
    payload: input.payload ?? {},
  };
}

test("모르는 kind 는 어느 채널로도 방송하지 않는다", async () => {
  const { deps, emitted } = makeDeps();
  await ingest("ch-1", [ev({ kind: "foo.bar" as never })], deps);
  assert.deepEqual(emitted, []);
});

test("아티팩트 사건은 채널 NPC 프로필이나 채널 보드일 때만 artifact:event 로 간다", async () => {
  const { deps, emitted } = makeDeps({ npcProfiles: ["sophie"], boardSlug: "b1" });
  await ingest(
    "ch-1",
    [
      ev({
        kind: "artifact.created",
        profile: "sophie",
        payload: { artifact_id: "a1", title: "보고서", profile: "sophie" },
      }),
      ev({
        kind: "artifact.created",
        profile: "other",
        board: "b1",
        payload: { artifact_id: "a2", board: "b1", profile: "other" },
      }),
      ev({
        kind: "artifact.created",
        profile: "stranger",
        payload: { artifact_id: "a3", profile: "stranger" },
      }),
    ],
    deps,
  );
  assert.deepEqual(
    emitted.map((e) => [
      e.event,
      (e.payload as { event: { payload: { artifact_id: string } } }).event.payload.artifact_id,
    ]),
    [
      ["artifact:event", "a1"],
      ["artifact:event", "a2"],
    ],
  );
  assert.equal(
    emitted.some((e) => e.event === "kanban:event"),
    false,
  );
});

test("artifact.deleted 는 범위 정보가 없어 artifact_id 만 싣고 보낸다", async () => {
  const { deps, emitted } = makeDeps();
  await ingest(
    "ch-1",
    [ev({ kind: "artifact.deleted", payload: { artifact_id: "a9", deleted_by: "human:u" } })],
    deps,
  );
  assert.deepEqual(
    emitted.map((e) => (e.payload as { event: { payload: unknown } }).event.payload),
    [{ artifact_id: "a9" }],
  );
});

test("아티팩트 사건은 방 알림·작업 중 표시를 만들지 않는다", async () => {
  const { deps, emitted, appended } = makeDeps({ npcProfiles: ["sophie"] });
  await ingest(
    "ch-1",
    [
      ev({
        kind: "artifact.versioned",
        profile: "sophie",
        payload: { artifact_id: "a1", profile: "sophie" },
      }),
    ],
    deps,
  );
  assert.equal(appended.length, 0);
  assert.equal(
    emitted.some((e) => e.event === "npc:working"),
    false,
  );
});
