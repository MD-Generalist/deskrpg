import { after, test } from "node:test";
import assert from "node:assert/strict";

import { startFakePluginServer, type FakePluginServer } from "@/lib/hermes/fake-plugin-server";
import type { RoomMessage } from "@/lib/chat-rooms-policy";
import {
  seedChannel,
  seedGateway,
  seedHermesProfile,
  seedNpc,
  seedUser,
  setupThrowawaySqlite,
} from "@/test-setup/npc-seed";

// T5. 폴러 — 커서 저장, "지금" 토큰, unknown_cursor 복구, has_more 페이지 순회, last_error,
// 그리고 실제 배선(createLiveIngestDeps)으로 사무실 방에 notice_json 이 남는지까지.
setupThrowawaySqlite("automation-poller-test");

const OWNER_TOKEN = "gateway-owner-key-1234567890";
const PROFILE_TOKEN = "profile-key-1234567890";

const servers: FakePluginServer[] = [];
async function startPlugin(info?: { version?: string; capabilities?: string[] }) {
  const server = await startFakePluginServer({
    ownerToken: OWNER_TOKEN,
    profileTokens: { sophie: PROFILE_TOKEN, noah: PROFILE_TOKEN },
    ...(info ? { info } : {}),
  });
  servers.push(server);
  return server;
}
after(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

type Emitted = { channelId: string; event: string; payload: unknown };

/** 채널 하나 + 가짜 플러그인을 가리키는 게이트웨이 + 프로필 sophie 의 출근 NPC. */
async function seedBoundChannel(server: FakePluginServer, opts: { npcActive?: boolean } = {}) {
  const owner = await seedUser("poller-owner");
  const gateway = await seedGateway(owner.id, server.baseUrl);
  const channel = await seedChannel(owner.id, "폴링 채널");
  const { bindGatewayToChannel } = await import("@/lib/gateway-resources");
  await bindGatewayToChannel({
    channelId: channel.id,
    gatewayId: gateway.id,
    boundByUserId: owner.id,
  });
  const profile = await seedHermesProfile(gateway.id, {
    profileName: "sophie",
    displayName: "소피",
  });
  const npc = await seedNpc({
    channelId: channel.id,
    hermesProfileId: profile.id,
    name: "STALE",
    positionX: 0,
    positionY: 0,
    active: opts.npcActive ?? true,
  });
  return { owner, gateway, channel, profile, npc };
}

async function makeDeps(overrides: Partial<import("./automation-poller").PollOnceDeps> = {}) {
  const { createDefaultPollDeps } = await import("./automation-poller");
  const emitted: Emitted[] = [];
  const roomEmits: Array<{ roomId: string; message: RoomMessage }> = [];
  const deps = createDefaultPollDeps({
    emitChannel: (channelId, event, payload) => emitted.push({ channelId, event, payload }),
    emitRoomMessage: (roomId, message) => roomEmits.push({ roomId, message }),
  });
  return { deps: { ...deps, ...overrides }, emitted, roomEmits };
}

async function readRow(channelId: string) {
  const { getChannelBoard } = await import("@/lib/kanban-boards");
  return (await getChannelBoard(channelId))!;
}

function slugOf(channelId: string) {
  return `deskrpg-${channelId.replace(/-/g, "").toLowerCase()}`;
}

function eventPolls(server: FakePluginServer) {
  return server.requests().filter((r) => r.path.startsWith("/deskrpg/events"));
}

test("첫 폴링(커서 없음)은 '지금' 토큰만 저장하고 아무것도 방송하지 않는다 — 과거 재생 없음", async () => {
  const plugin = await startPlugin();
  const { channel } = await seedBoundChannel(plugin);
  // 폴러가 붙기 전에 이미 쌓여 있던 사건 — 재생되면 안 된다.
  plugin.pushEvent({
    kind: "task.status",
    board: slugOf(channel.id),
    task_id: "old",
    payload: { from: "running", to: "done", parent_count: 0, title: "옛 카드", assignee: "sophie" },
  });

  const { pollChannelOnce } = await import("./automation-poller");
  const h = await makeDeps();
  const outcome = await pollChannelOnce(channel.id, h.deps);
  assert.ok(outcome.ok, JSON.stringify(outcome));
  assert.equal(outcome.events, 0);

  const polls = eventPolls(plugin);
  assert.equal(polls.length, 1);
  assert.ok(!polls[0].path.includes("cursor="), "커서 없이 부른다");
  assert.ok(polls[0].path.includes(`board=${slugOf(channel.id)}`), "보드로 좁힌다");
  assert.match(polls[0].path, /include=artifacts/, "아티팩트 사건도 함께 묻는다");

  const row = await readRow(channel.id);
  assert.ok(row.eventCursor, "지금 토큰이 저장된다");
  assert.equal(row.lastError, null);
  assert.ok(row.lastPolledAt, "last_polled_at 이 찍힌다");
  assert.equal(h.emitted.length, 0);
  assert.equal(h.roomEmits.length, 0);
});

test("토큰 이후의 사건은 ingest 되고 커서가 전진한다; 다음 바퀴에서 다시 처리하지 않는다", async () => {
  const plugin = await startPlugin();
  const { channel, npc } = await seedBoundChannel(plugin);
  const { pollChannelOnce } = await import("./automation-poller");
  const h = await makeDeps();
  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);
  const firstCursor = (await readRow(channel.id)).eventCursor;

  plugin.pushEvent({
    kind: "task.status",
    board: slugOf(channel.id),
    task_id: "t1",
    payload: { from: "running", to: "done", parent_count: 0, title: "보고서", assignee: "sophie" },
  });
  const second = await pollChannelOnce(channel.id, h.deps);
  assert.ok(second.ok);
  assert.equal(second.events, 1);
  assert.notEqual((await readRow(channel.id)).eventCursor, firstCursor);

  // 실제 배선: 사무실 방에 NPC 발화로 저장되고 notice_json 이 되읽힌다.
  assert.equal(h.roomEmits.length, 1);
  const message = h.roomEmits[0].message;
  assert.equal(message.senderKind, "npc");
  assert.equal(message.senderId, npc.id);
  assert.equal(message.senderName, "소피");
  assert.equal(message.content, "보고서");
  assert.deepEqual(message.notice, {
    kind: "card_done",
    cardId: "t1",
    cardTitle: "보고서",
    boardSlug: slugOf(channel.id),
    npcName: "소피",
  });
  const { recentRoomMessages } = await import("@/lib/chat-rooms");
  const stored = await recentRoomMessages(h.roomEmits[0].roomId, 10);
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].notice, message.notice, "notice_json → RoomMessage.notice");
  assert.deepEqual(
    h.emitted.map((e) => e.event),
    ["kanban:event"],
  );

  const third = await pollChannelOnce(channel.id, h.deps);
  assert.ok(third.ok);
  assert.equal(third.events, 0, "커서가 전진했으니 같은 사건은 다시 오지 않는다");
  assert.equal(h.roomEmits.length, 1);
});

test("잠든 NPC 의 카드는 시스템 메시지로 — 실제 DB 조회 경로", async () => {
  const plugin = await startPlugin();
  const { channel } = await seedBoundChannel(plugin, { npcActive: false });
  const { pollChannelOnce } = await import("./automation-poller");
  const h = await makeDeps();
  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);
  plugin.pushEvent({
    kind: "task.status",
    board: slugOf(channel.id),
    task_id: "t1",
    payload: { from: "ready", to: "blocked", parent_count: 1, title: "막힘", assignee: "sophie" },
  });
  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);
  assert.equal(h.roomEmits.length, 1);
  assert.equal(h.roomEmits[0].message.senderKind, "system");
  assert.equal(h.roomEmits[0].message.senderId, null);
  assert.equal(h.roomEmits[0].message.content, "소피: 막힘");
  assert.equal(h.roomEmits[0].message.notice?.kind, "card_blocked");
});

test("크론 결과 — 출처 장부가 이 채널이면 게시, 다른 채널이면 게시하지 않는다(실제 장부)", async () => {
  const plugin = await startPlugin();
  const mine = await seedBoundChannel(plugin);
  const other = await seedChannel(mine.owner.id, "다른 채널");
  const { recordCronOrigin } = await import("@/lib/cron-origins");
  await recordCronOrigin({
    gatewayId: mine.gateway.id,
    profileName: "sophie",
    jobId: "job-mine",
    channelId: mine.channel.id,
    createdByUserId: mine.owner.id,
  });
  await recordCronOrigin({
    gatewayId: mine.gateway.id,
    profileName: "sophie",
    jobId: "job-other",
    channelId: other.id,
    createdByUserId: mine.owner.id,
  });

  const { pollChannelOnce } = await import("./automation-poller");
  const h = await makeDeps();
  assert.ok((await pollChannelOnce(mine.channel.id, h.deps)).ok);
  const finished = (jobId: string, text: string) =>
    plugin.pushEvent({
      kind: "cron.run.finished",
      profile: "sophie",
      job_id: jobId,
      run_id: `run-${jobId}`,
      payload: {
        job_id: jobId,
        job_name: `작업 ${jobId}`,
        profile: "sophie",
        session_id: "s",
        started_at: "2026-09-14T00:00:00Z",
        status: "ok",
        ended_at: "2026-09-14T00:01:00Z",
        result_text: text,
      },
    });
  finished("job-mine", "내 결과");
  finished("job-other", "남의 결과");
  finished("job-nobody", "출처 없음");

  const outcome = await pollChannelOnce(mine.channel.id, h.deps);
  assert.ok(outcome.ok);
  assert.equal(outcome.events, 3, "크론 사건은 보드 필터를 통과한다");
  assert.equal(h.emitted.filter((e) => e.event === "cron:event").length, 3);
  assert.equal(h.roomEmits.length, 1, "이 채널 출처만 게시");
  assert.equal(h.roomEmits[0].message.content, "내 결과");
  assert.deepEqual(h.roomEmits[0].message.notice, {
    kind: "cron_result",
    jobId: "job-mine",
    jobName: "작업 job-mine",
    npcName: "소피",
    status: "ok",
  });
});

test("unknown_cursor 를 받으면 커서 없이 다시 불러 새 토큰을 저장한다 — 재생 없음(E7)", async () => {
  const plugin = await startPlugin();
  const { channel } = await seedBoundChannel(plugin);
  const { pollChannelOnce } = await import("./automation-poller");
  const h = await makeDeps();
  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);

  // 플러그인이 재시작해 커서를 잊었다(요청 기록은 남는다 — 이후 것만 본다).
  plugin.reset();
  const seenBefore = eventPolls(plugin).length;
  plugin.pushEvent({
    kind: "task.status",
    board: slugOf(channel.id),
    task_id: "t1",
    payload: {
      from: "running",
      to: "done",
      parent_count: 0,
      title: "재생 금지",
      assignee: "sophie",
    },
  });
  const before = (await readRow(channel.id)).eventCursor;
  const outcome = await pollChannelOnce(channel.id, h.deps);
  assert.ok(outcome.ok, JSON.stringify(outcome));
  assert.equal(outcome.restarted, true);
  assert.equal(outcome.events, 0, "잊힌 커서 이후의 사건은 재생하지 않는다");

  const polls = eventPolls(plugin).slice(seenBefore);
  assert.equal(polls.length, 2);
  assert.equal(polls[0].status, 400);
  assert.ok(polls[0].path.includes(`cursor=${before}`));
  assert.ok(!polls[1].path.includes("cursor="), "두 번째는 커서 없이");

  const row = await readRow(channel.id);
  assert.ok(row.eventCursor && row.eventCursor !== before, "새 토큰이 저장된다");
  assert.equal(row.lastError, null);
  assert.equal(h.roomEmits.length, 0);
});

test("has_more 는 페이지 상한 안에서 따라간다 — 한 바퀴에 전부 흡수", async () => {
  const plugin = await startPlugin();
  const { channel } = await seedBoundChannel(plugin);
  const { pollChannelOnce } = await import("./automation-poller");
  const h = await makeDeps({ pageLimit: 2, maxPages: 10 });
  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);
  for (let i = 0; i < 5; i += 1) {
    plugin.pushEvent({
      kind: "task.created",
      board: slugOf(channel.id),
      task_id: `t${i}`,
      payload: {},
    });
  }
  const outcome = await pollChannelOnce(channel.id, h.deps);
  assert.ok(outcome.ok);
  assert.equal(outcome.events, 5);
  assert.equal(outcome.pages, 3);
  assert.equal(h.emitted.filter((e) => e.event === "kanban:event").length, 5);
  const again = await pollChannelOnce(channel.id, h.deps);
  assert.ok(again.ok);
  assert.equal(again.events, 0);
});

test("폴링 실패는 삼키고 last_error 에 남긴다; 다음 성공이 지운다(E6)", async () => {
  const plugin = await startPlugin();
  const { channel } = await seedBoundChannel(plugin);
  const { pollChannelOnce } = await import("./automation-poller");
  const h = await makeDeps();
  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);
  const cursor = (await readRow(channel.id)).eventCursor;

  // 이벤트 경로만 죽인다 — 플러그인 판정 캐시는 신선하므로 여기까지 온다.
  const broken = await makeDeps({
    resolveBoard: async (id) => {
      const real = await h.deps.resolveBoard(id);
      if (!real.ok) return real;
      return {
        ...real,
        ownerClient: {
          ...real.ownerClient,
          events: {
            poll: async () => ({
              ok: false as const,
              status: 0,
              failure: {
                code: "unreachable",
                message: "boom",
                blocksEditor: false,
                showsShellCommand: null,
                details: {},
              },
            }),
          },
        },
      };
    },
  });
  const failed = await pollChannelOnce(channel.id, broken.deps);
  assert.equal(failed.ok, false);
  let row = await readRow(channel.id);
  assert.equal(row.lastError, "unreachable");
  assert.equal(row.eventCursor, cursor, "커서는 그대로");

  const recovered = await pollChannelOnce(channel.id, h.deps);
  assert.ok(recovered.ok);
  row = await readRow(channel.id);
  assert.equal(row.lastError, null);
});

test("묶이지 않은 채널은 unbound 로 끝나고 아무것도 쓰지 않는다", async () => {
  const owner = await seedUser("loose-owner");
  const channel = await seedChannel(owner.id, "묶이지 않은 채널");
  const { pollChannelOnce } = await import("./automation-poller");
  const h = await makeDeps();
  const outcome = await pollChannelOnce(channel.id, h.deps);
  assert.deepEqual(outcome.ok, false);
  assert.equal(!outcome.ok && outcome.code, "unbound");
  const { getChannelBoard } = await import("@/lib/kanban-boards");
  assert.equal(await getChannelBoard(channel.id), null);
});

test("연결 행이 없으면(바인딩 때 확보 실패) 먼저 보드를 확보한 뒤 폴링한다", async () => {
  const plugin = await startPlugin();
  const { channel } = await seedBoundChannel(plugin);
  // 바인딩이 만든 행을 지워 "확보 실패로 행이 없는" 상태를 만든다.
  const { db, channelKanbanBoards } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  await db.delete(channelKanbanBoards).where(eq(channelKanbanBoards.channelId, channel.id));
  const requestsBefore = plugin.requests().length;

  const { pollChannelOnce } = await import("./automation-poller");
  const h = await makeDeps();
  const outcome = await pollChannelOnce(channel.id, h.deps);
  assert.ok(outcome.ok, JSON.stringify(outcome));
  const paths = plugin
    .requests()
    .slice(requestsBefore)
    .map((r) => `${r.method} ${r.path.split("?")[0]}`);
  assert.ok(paths.includes("POST /deskrpg/kanban/boards"), `행을 다시 세운다: ${paths}`);
  assert.ok((await readRow(channel.id)).eventCursor);
});

test("바인딩 때 게이트에 막혀 보드가 없던 채널은 플러그인을 올린 뒤 다음 바퀴에 보드를 만든다(R5)", async () => {
  const plugin = await startPlugin({ version: "0.5.0" });
  const { channel, gateway } = await seedBoundChannel(plugin);
  let row = await readRow(channel.id);
  assert.equal(row.lastError, "plugin_upgrade_required", "바인딩은 성공하되 이유가 남는다");
  assert.equal(row.boardNameSyncedAt, null, "보드가 한 번도 확보되지 않았다");
  assert.equal(
    plugin.requests().filter((r) => r.path.startsWith("/deskrpg/kanban/boards")).length,
    0,
  );

  const { pollChannelOnce } = await import("./automation-poller");
  const h = await makeDeps();
  const blocked = await pollChannelOnce(channel.id, h.deps);
  assert.equal(blocked.ok, false);
  assert.equal(!blocked.ok && blocked.code, "plugin_upgrade_required");

  // 플러그인을 0.6.0 으로 올렸다. 판정 캐시(1시간)는 지나간 것으로 둔다 — 캐시가 신선한 동안은
  // 어느 경로도 Hermes 를 다시 찌르지 않는 것이 규칙이다.
  plugin.setInfo({ version: "0.6.0", capabilities: ["kanban", "cron", "events"] });
  const { db, gatewayResources } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  await db
    .update(gatewayResources)
    .set({ pluginCheckedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() as never })
    .where(eq(gatewayResources.id, gateway.id));

  const outcome = await pollChannelOnce(channel.id, h.deps);
  assert.ok(outcome.ok, JSON.stringify(outcome));
  assert.equal(
    plugin.requests().filter((r) => r.method === "POST" && r.path === "/deskrpg/kanban/boards")
      .length,
    1,
    "다음 바퀴가 보드를 만든다",
  );
  row = await readRow(channel.id);
  assert.equal(row.lastError, null);
  assert.ok(row.boardNameSyncedAt, "확보 시각이 찍힌다");
  assert.ok(row.eventCursor, "그 바퀴에서 바로 토큰까지 받는다");
});

test("채널 개명 뒤 이름 동기화가 뒤처져 있으면 폴링이 한 번 다시 맞추고, 맞춘 뒤에는 건드리지 않는다(R2)", async () => {
  const plugin = await startPlugin();
  const { channel } = await seedBoundChannel(plugin);
  const { pollChannelOnce } = await import("./automation-poller");
  const h = await makeDeps();
  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);
  const patches = () =>
    plugin
      .requests()
      .filter((r) => r.method === "PATCH" && r.path.startsWith("/deskrpg/kanban/boards/"));
  assert.equal(patches().length, 0);

  // 개명은 됐는데 보드 이름 동기화가 실패한 상태 — 채널의 updated_at 이 synced_at 보다 뒤다.
  const { db, channels, channelKanbanBoards } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const renamedAt = new Date(Date.now() - 5_000);
  await db
    .update(channelKanbanBoards)
    .set({ boardNameSyncedAt: new Date(renamedAt.getTime() - 5_000).toISOString() as never })
    .where(eq(channelKanbanBoards.channelId, channel.id));
  await db
    .update(channels)
    .set({ name: "새 이름", updatedAt: renamedAt.toISOString() as never })
    .where(eq(channels.id, channel.id));

  const outcome = await pollChannelOnce(channel.id, h.deps);
  assert.ok(outcome.ok, JSON.stringify(outcome));
  assert.equal(patches().length, 1, "한 바퀴에 한 번");
  assert.deepEqual(patches()[0].json, { name: "새 이름" });
  const row = await readRow(channel.id);
  assert.equal(row.lastError, null);
  assert.ok(
    new Date(row.boardNameSyncedAt as unknown as string).getTime() >= renamedAt.getTime(),
    "동기화 시각이 개명 시각을 넘어선다",
  );

  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);
  assert.equal(patches().length, 1, "맞춘 뒤에는 다시 부르지 않는다");
});

test("boardNameStale — 동기화 시각이 없거나 채널 수정 시각보다 앞서면 참", async () => {
  const { boardNameStale } = await import("./automation-poller");
  const t0 = new Date("2026-09-14T00:00:00Z");
  const t1 = new Date("2026-09-14T00:00:01Z");
  assert.equal(boardNameStale({ boardNameSyncedAt: null }, t0), true);
  assert.equal(boardNameStale({ boardNameSyncedAt: t0 }, t1), true);
  assert.equal(boardNameStale({ boardNameSyncedAt: t1 }, t0), false);
  assert.equal(boardNameStale({ boardNameSyncedAt: t1 }, t1), false);
  assert.equal(boardNameStale({ boardNameSyncedAt: t1.toISOString() as never }, t1), false);
  assert.equal(boardNameStale({ boardNameSyncedAt: t0 }, null), false, "채널 시각을 모르면 그대로");
});

test("타이머 레지스트리 — 접속이 켜지면 즉시 한 바퀴, 짧은 주기; 꺼지면 긴 주기; refresh 가 표를 맞춘다", async () => {
  const { createAutomationPoller } = await import("./automation-poller");
  const calls: string[] = [];
  let bound = new Set(["a", "b"]);
  const poller = createAutomationPoller({
    pollOnce: async (id) => {
      calls.push(id);
      return { ok: true, events: 0, pages: 1, cursor: "c0", restarted: false };
    },
    listBoundChannelIds: async () => [...bound],
    isChannelBound: async (id) => bound.has(id),
    intervals: { activeMs: 15, idleMs: 10_000 },
  });
  try {
    await poller.refresh();
    assert.ok(poller.has("a") && poller.has("b"));
    assert.equal(calls.length, 0, "시작만으로는 돌지 않는다(긴 주기 대기)");

    await poller.setActive("a", true);
    assert.deepEqual(calls, ["a"], "켜지면 즉시 한 바퀴");
    await new Promise((r) => setTimeout(r, 60));
    assert.ok(calls.filter((c) => c === "a").length >= 3, `짧은 주기로 돈다: ${calls}`);
    assert.equal(calls.filter((c) => c === "b").length, 0, "b 는 긴 주기라 아직");

    await poller.setActive("a", false);
    const settled = calls.length;
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(calls.length, settled, "꺼지면 긴 주기로 돌아간다");

    const outcome = await poller.pollNow("b");
    assert.ok(outcome.ok);
    assert.equal(calls.filter((c) => c === "b").length, 1, "pollNow 는 즉시 한 바퀴");

    // 서버가 뜬 뒤에 묶인 채널: setActive 가 표를 보고 시작한다. 묶이지 않았으면 무시.
    bound = new Set(["a", "c"]);
    await poller.setActive("c", true);
    assert.ok(poller.has("c"));
    await poller.setActive("zzz", true);
    assert.equal(poller.has("zzz"), false);

    await poller.refresh();
    assert.equal(poller.has("b"), false, "풀린 채널은 멈춘다");
    assert.ok(poller.has("c"));
  } finally {
    poller.stopAll();
  }
});

test("타이머 레지스트리 — unbound 결과가 나오면 그 채널의 폴러를 멈춘다", async () => {
  const { createAutomationPoller } = await import("./automation-poller");
  const poller = createAutomationPoller({
    pollOnce: async () => ({ ok: false, code: "unbound", reason: "no binding" }),
    listBoundChannelIds: async () => [],
    isChannelBound: async () => true,
    intervals: { activeMs: 10, idleMs: 10 },
  });
  try {
    await poller.pollNow("x");
    assert.equal(poller.has("x"), false);
  } finally {
    poller.stopAll();
  }
});
