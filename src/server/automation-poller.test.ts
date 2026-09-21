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
import type { PollerTimerHandle, PollerTimers } from "./automation-poller";

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

test("사건 조회는 아티팩트와 카드 제안을 함께 include 한다", async () => {
  // 제안 사건은 아티팩트와 **같은 커서**에 실려 온다. include 에 켜 두지 않으면 플러그인이
  // 걸러 버리고, 나중에 켜도 커서가 지나가 버려 영영 오지 않는다(조용히 죽는다).
  const plugin = await startPlugin();
  const { channel } = await seedBoundChannel(plugin);
  const { pollChannelOnce } = await import("./automation-poller");
  const h = await makeDeps();
  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);

  const includes = eventPolls(plugin).map((r) => decodeURIComponent(r.path));
  assert.ok(includes.length > 0);
  assert.ok(
    includes.every((path) => /include=[^&]*\bartifacts\b/.test(path)),
    "아티팩트를 include 한다",
  );
  assert.ok(
    includes.every((path) => /include=[^&]*\bcard_proposals\b/.test(path)),
    "카드 제안을 include 한다",
  );
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

/**
 * 가짜 시계. 폴러의 대기를 실제 시간 대신 눈금으로 돌린다 — 머신이 바쁠 때 눈금이 밀려
 * 주기 확인이 간헐 실패하던 것을 없앤다(B48).
 */
function createFakeClock() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; handler: () => void }>();
  const timers: PollerTimers = {
    setTimeout(handler: () => void, delayMs: number) {
      const id = (seq += 1);
      pending.set(id, { at: now + delayMs, handler });
      return { id, unref() {} };
    },
    clearTimeout(handle: PollerTimerHandle) {
      const id = (handle as { id?: number }).id;
      if (id != null) pending.delete(id);
    },
  };
  return {
    timers,
    /** 눈금을 밀고, 그 사이 걸린 대기를 시각 순서대로 깨운다. */
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        // 폴러는 pollOnce 를 await 한 뒤에야 다음 대기를 건다 — 훑기 전에 큐를 비운다.
        await new Promise((resolve) => setImmediate(resolve));
        const due = [...pending.entries()]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        pending.delete(id);
        now = timer.at;
        timer.handler();
      }
      now = target;
    },
  };
}

test("타이머 레지스트리 — 접속이 켜지면 즉시 한 바퀴, 짧은 주기; 꺼지면 긴 주기; refresh 가 표를 맞춘다", async () => {
  const { createAutomationPoller } = await import("./automation-poller");
  const calls: string[] = [];
  let bound = new Set(["a", "b"]);
  const clock = createFakeClock();
  const poller = createAutomationPoller({
    pollOnce: async (id) => {
      calls.push(id);
      return { ok: true, events: 0, pages: 1, cursor: "c0", restarted: false };
    },
    listBoundChannelIds: async () => [...bound],
    isChannelBound: async (id) => bound.has(id),
    intervals: { activeMs: 15, idleMs: 10_000 },
    timers: clock.timers,
  });
  try {
    await poller.refresh();
    assert.ok(poller.has("a") && poller.has("b"));
    assert.equal(calls.length, 0, "시작만으로는 돌지 않는다(긴 주기 대기)");

    await poller.setActive("a", true);
    assert.deepEqual(calls, ["a"], "켜지면 즉시 한 바퀴");
    await clock.advance(60);
    assert.ok(calls.filter((c) => c === "a").length >= 3, `짧은 주기로 돈다: ${calls}`);
    assert.equal(calls.filter((c) => c === "b").length, 0, "b 는 긴 주기라 아직");

    await poller.setActive("a", false);
    const settled = calls.length;
    await clock.advance(40);
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

// ---------------------------------------------------------------------------
// 다중 보드 (설계 2026-09-21 project-registry)
// ---------------------------------------------------------------------------

async function addBoard(channelId: string): Promise<string> {
  const { ensureChannelBoard, newChannelBoardSlug } = await import("@/lib/kanban-boards");
  const slug = newChannelBoardSlug(channelId);
  const ensured = await ensureChannelBoard(channelId, undefined, slug);
  assert.ok(ensured.ok, "둘째 보드 확보 실패");
  return slug;
}

test("커서는 보드 행 id 로 저장한다 — 채널 단위로 쓰면 다른 보드를 덮는다", async () => {
  const server = await startPlugin();
  const { channel } = await seedBoundChannel(server);
  await addBoard(channel.id);
  const { pollChannelOnce } = await import("./automation-poller");

  // 저장 호출을 가로채 **무엇을 키로 썼는지** 본다. 가짜 서버는 상태가 같으면 두 보드에 같은
  // 커서 토큰을 주므로, 저장된 값만 봐서는 덮어쓰기를 구분할 수 없다.
  const saved: string[] = [];
  const base = await makeDeps();
  const h = await makeDeps({
    saveRow: async (boardLinkId, patch) => {
      saved.push(boardLinkId);
      return base.deps.saveRow(boardLinkId, patch);
    },
  });

  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);

  const { listChannelBoards } = await import("@/lib/kanban-boards");
  const rows = await listChannelBoards(channel.id);
  const ids = new Set(rows.map((r) => r.id));
  assert.equal(ids.size, 2);
  for (const id of saved) {
    assert.ok(
      ids.has(id),
      `연결 행 id 가 아닌 값(${id})으로 저장했습니다 — 채널 단위로 쓰면 다른 보드 커서를 덮습니다`,
    );
  }
  assert.equal(
    new Set(saved).size,
    2,
    "보드 둘을 돌았는데 저장 키가 하나뿐입니다 — 한 행에 두 보드의 커서가 겹쳐 쓰입니다",
  );
});

test("보드가 둘이면 두 보드 모두에서 사건을 받아 온다", async () => {
  const server = await startPlugin();
  const { channel } = await seedBoundChannel(server);
  const second = await addBoard(channel.id);
  const { pollChannelOnce } = await import("./automation-poller");
  const h = await makeDeps();
  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);

  const polledBoards = new Set(
    eventPolls(server).map((r) => new URL(`http://x${r.path}`).searchParams.get("board")),
  );
  assert.ok(polledBoards.has(second), "둘째 보드를 폴링하지 않으면 그 카드는 실시간으로 안 옵니다");
  assert.equal(polledBoards.size, 2);
});

test("include 는 수신 보드에만, 그리고 아티팩트·카드 제안 두 토큰이 늘 함께 붙는다", async () => {
  // 두 출처는 커서 `a` 를 공유한다 — 한쪽만 켜면 다른 쪽 사건을 지나친 채 커서가 전진해 조용히 사라진다.
  // 그리고 둘 다 게이트웨이 전역이라 보드마다 붙이면 보드 수만큼 중복된다.
  const server = await startPlugin();
  const { channel } = await seedBoundChannel(server);
  const second = await addBoard(channel.id);
  const { pollChannelOnce } = await import("./automation-poller");
  const h = await makeDeps();
  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);

  const byBoard = new Map<string | null, Array<string | null>>();
  for (const r of eventPolls(server)) {
    const params = new URL(`http://x${r.path}`).searchParams;
    const board = params.get("board");
    byBoard.set(board, [...(byBoard.get(board) ?? []), params.get("include")]);
  }
  assert.equal(byBoard.size, 2);
  for (const [board, includes] of byBoard) {
    const expected = board === second ? null : "artifacts,card_proposals";
    assert.deepEqual(
      [...new Set(includes)],
      [expected],
      `보드 ${board} 의 include 가 ${JSON.stringify(includes)} 입니다`,
    );
  }
});

test("사건 수신 보드가 아닌 보드는 크론 사건을 버린다", async () => {
  const server = await startPlugin();
  const { channel } = await seedBoundChannel(server);
  await addBoard(channel.id);
  const { pollChannelOnce } = await import("./automation-poller");
  const h = await makeDeps();
  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);

  // 크론 사건은 게이트웨이 전역이라 두 보드의 응답에 모두 실려 온다.
  server.pushEvent({
    kind: "cron.run.finished",
    profile: "sophie",
    job_id: "job-1",
    payload: {
      job_id: "job-1",
      job_name: "정기 보고",
      profile: "sophie",
      status: "ok",
      result_text: "끝",
    },
  });
  const outcome = await pollChannelOnce(channel.id, h.deps);
  assert.ok(outcome.ok);

  const cronEmits = h.emitted.filter((e) => String(e.event).includes("cron"));
  assert.equal(
    cronEmits.length,
    1,
    `크론 사건이 ${cronEmits.length}번 소비됐습니다 — 보드 수만큼 중복되면 안 됩니다`,
  );
});

test("사건 수신 보드가 0개인 채널은 폴링 한 바퀴에 복구된다", async () => {
  const server = await startPlugin();
  const { channel } = await seedBoundChannel(server);
  await addBoard(channel.id);

  const { db, channelKanbanBoards } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  await db
    .update(channelKanbanBoards)
    .set({ isEventCarrier: false })
    .where(eq(channelKanbanBoards.channelId, channel.id));

  const { listChannelBoards } = await import("@/lib/kanban-boards");
  assert.equal(
    (await listChannelBoards(channel.id)).filter((r) => r.isEventCarrier).length,
    0,
    "사전 조건: carrier 가 0개다",
  );

  const { pollChannelOnce } = await import("./automation-poller");
  const h = await makeDeps();
  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);

  const rows = await listChannelBoards(channel.id);
  assert.equal(
    rows.filter((r) => r.isEventCarrier).length,
    1,
    "carrier 0개가 복구되지 않으면 그 채널은 크론 사건을 아무도 받지 않습니다",
  );
  assert.equal(
    rows.find((r) => r.isEventCarrier)?.boardSlug,
    rows[0].boardSlug,
    "가장 오래된 보드가 그 자리를 맡아야 합니다",
  );
});

test("보관된 프로젝트의 보드는 사건 수신 자리 후보에서 빠진다", async () => {
  const server = await startPlugin();
  const { channel } = await seedBoundChannel(server);
  const second = await addBoard(channel.id);

  const { db, channelKanbanBoards, channelProjects } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { listChannelBoards, ensureChannelCarrier } = await import("@/lib/kanban-boards");

  const rows = await listChannelBoards(channel.id);
  const oldest = rows[0];
  // 가장 오래된 보드를 보관 상태로 둔다 — 그러면 둘째 보드가 자리를 맡아야 한다.
  await db.insert(channelProjects).values({
    boardLinkId: oldest.id,
    channelId: channel.id,
    status: "completed",
  });
  await db
    .update(channelKanbanBoards)
    .set({ isEventCarrier: false })
    .where(eq(channelKanbanBoards.channelId, channel.id));

  await ensureChannelCarrier(channel.id);
  const after = await listChannelBoards(channel.id);
  assert.equal(after.filter((r) => r.isEventCarrier).length, 1);
  assert.equal(
    after.find((r) => r.isEventCarrier)?.boardSlug,
    second,
    "끝난 일의 보드를 사건 수신 자리로 되살리면 보관의 뜻이 무너집니다",
  );
});

// ---------------------------------------------------------------------------
// 재시작 뒤 "일하는 중" 되세우기 (설계 2026-09-21 npc-working-state, 결정 A-1)
// ---------------------------------------------------------------------------

/** 그 보드에 실제 카드를 만들고 running 으로 옮긴다. */
async function seedRunningCard(
  channelId: string,
  slug: string,
  title: string,
  assignee = "sophie",
): Promise<string> {
  const { resolveChannelBoard } = await import("@/lib/kanban-boards");
  const resolved = await resolveChannelBoard(channelId);
  assert.ok(resolved.ok);
  const made = await resolved.ownerClient.kanban.createTask(slug, { title, assignee });
  assert.ok(made.ok, `createTask 실패: ${made.ok ? "" : made.failure.code}`);
  const taskId = made.data.task.id;
  const moved = await resolved.ownerClient.kanban.updateTask(slug, taskId, { status: "running" });
  assert.ok(moved.ok);
  return taskId;
}

/** 프로세스 재시작 — 작업 상태와 재구성 표시를 함께 버린다(커서는 DB 에 남는다). */
async function simulateRestart(channelId: string) {
  const { resetAutomationState } = await import("./automation-events");
  const { resetWorkingResyncForTests } = await import("./automation-poller");
  resetAutomationState();
  resetWorkingResyncForTests(channelId);
}

test("재시작하면 일하는 중이 사라지고, 폴링 한 바퀴가 그것을 되세운다", async () => {
  const server = await startPlugin();
  const { channel, npc } = await seedBoundChannel(server);
  const { pollChannelOnce } = await import("./automation-poller");
  const { getWorkingSnapshot } = await import("./automation-events");
  const { channelBoardSlug } = await import("@/lib/kanban-boards");
  const slug = channelBoardSlug(channel.id);
  const h = await makeDeps();

  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);
  const taskId = await seedRunningCard(channel.id, slug, "돌고 있는 카드");
  server.pushEvent({
    kind: "task.run.started",
    board: slug,
    task_id: taskId,
    payload: { assignee: "sophie" },
  });
  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);
  assert.equal(getWorkingSnapshot(channel.id).length, 1, "사전 조건: 일하는 중이다");

  await simulateRestart(channel.id);
  assert.deepEqual(getWorkingSnapshot(channel.id), [], "재시작하면 사라진다");

  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);
  const restored = getWorkingSnapshot(channel.id);
  assert.equal(restored.length, 1, "폴링 한 바퀴가 되세우지 못했습니다");
  assert.equal(restored[0].npcId, npc.id);
  assert.equal(restored[0].sources.runningCards, 1);
});

test("되세운 뒤 진짜 finished 가 오면 꺼진다 — 영영 켜져 있지 않는다", async () => {
  const server = await startPlugin();
  const { channel } = await seedBoundChannel(server);
  const { pollChannelOnce } = await import("./automation-poller");
  const { getWorkingSnapshot } = await import("./automation-events");
  const { channelBoardSlug } = await import("@/lib/kanban-boards");
  const slug = channelBoardSlug(channel.id);
  const h = await makeDeps();

  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);
  const taskId = await seedRunningCard(channel.id, slug, "끝날 카드");
  await simulateRestart(channel.id);
  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);
  assert.equal(getWorkingSnapshot(channel.id).length, 1, "사전 조건: 되세워졌다");

  server.pushEvent({
    kind: "task.run.finished",
    board: slug,
    task_id: taskId,
    payload: { assignee: "sophie" },
  });
  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);
  assert.deepEqual(
    getWorkingSnapshot(channel.id),
    [],
    "합성 시작을 진짜 종료가 닫지 못했습니다 — task_id 가 어긋났습니다",
  );
});

test("재생된 옛 finished 뒤에도 running 카드의 담당은 일하는 중이다", async () => {
  const server = await startPlugin();
  const { channel } = await seedBoundChannel(server);
  const { pollChannelOnce } = await import("./automation-poller");
  const { getWorkingSnapshot } = await import("./automation-events");
  const { channelBoardSlug } = await import("@/lib/kanban-boards");
  const slug = channelBoardSlug(channel.id);
  const h = await makeDeps();

  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);
  const taskId = await seedRunningCard(channel.id, slug, "재시도로 다시 도는 카드");

  // 꺼져 있던 동안 쌓인 사건: 그 카드가 한 번 끝났다가 다시 시작했다. 커서는 DB 에 남으므로
  // 재시작 뒤 첫 폴링이 이것을 재생한다. 되세우기를 폴링 **앞**에 두면 재생된 finished 가
  // 합성 started 를 지워 실제로 돌고 있는 카드가 "쉬는 중" 으로 뒤집힌다.
  server.pushEvent({
    kind: "task.run.finished",
    board: slug,
    task_id: taskId,
    payload: { assignee: "sophie" },
  });

  await simulateRestart(channel.id);
  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);

  const snapshot = getWorkingSnapshot(channel.id);
  assert.equal(
    snapshot.length,
    1,
    "재생된 옛 종료가 되세우기를 지웠습니다 — 되세우기는 폴링을 비운 뒤에 와야 합니다",
  );
  assert.equal(snapshot[0].sources.runningCards, 1);
});

// 카드 `…72Q0M` 의 재현. 주장은 "DeskRPG 가 꺼져 있던 동안 난 제안은 영구히 사라진다" 였다.
// 커서는 `channel_kanban_boards.event_cursor` 에 있고 재시작이 그 행을 지우지 않으므로, 재시작
// 뒤 첫 폴링이 그 사이의 제안을 재생한다. 아래 두 단정이 그 성질을 고정한다 — 하나라도 깨지면
// 조회 라우트가 실제로 필요해진다.
test("꺼져 있던 동안 난 카드 제안은 재시작 뒤 첫 폴링에서 알림으로 뜬다", async () => {
  const server = await startPlugin();
  const { channel, npc } = await seedBoundChannel(server);
  const { pollChannelOnce } = await import("./automation-poller");
  const h = await makeDeps();

  // 첫 바퀴가 "지금" 토큰을 DB 에 저장한다.
  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);

  // 여기서부터 DeskRPG 는 꺼져 있다 — 그 사이 직원이 제안을 냈다.
  server.pushEvent({
    kind: "card_proposal.created",
    profile: "sophie",
    payload: {
      proposal_id: "0123456789abcdef0123456789abcdef",
      title: "주간 보고 정리",
      summary: "금요일마다 모은다",
      profile: "sophie",
    },
  });

  await simulateRestart(channel.id);
  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);

  const notices = h.roomEmits.filter((e) => e.message.notice?.kind === "card_proposal");
  assert.equal(
    notices.length,
    1,
    "꺼져 있던 동안의 제안이 오지 않았습니다 — 커서가 재시작에 살아남지 못했다는 뜻입니다",
  );
  const notice = notices[0].message.notice;
  assert.ok(notice?.kind === "card_proposal");
  assert.equal(notice.proposalId, "0123456789abcdef0123456789abcdef");
  assert.equal(notice.npcId, npc.id);

  // 두 번째 성질: 같은 제안의 알림이 둘 생기지 않는다(커서가 전진했다).
  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);
  assert.equal(
    h.roomEmits.filter((e) => e.message.notice?.kind === "card_proposal").length,
    1,
    "같은 제안의 알림이 둘 생겼습니다 — 커서가 전진하지 않았습니다",
  );
});

test("되세우기는 프로세스 수명당 채널마다 한 번만 보드를 읽는다", async () => {
  const server = await startPlugin();
  const { channel } = await seedBoundChannel(server);
  const { pollChannelOnce } = await import("./automation-poller");
  const { channelBoardSlug } = await import("@/lib/kanban-boards");
  const slug = channelBoardSlug(channel.id);
  const h = await makeDeps();

  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);
  await seedRunningCard(channel.id, slug, "카드");
  await simulateRestart(channel.id);

  const before = server.requests().filter((r) => r.path.startsWith("/deskrpg/kanban/board")).length;
  await pollChannelOnce(channel.id, h.deps);
  const afterFirst = server
    .requests()
    .filter((r) => r.path.startsWith("/deskrpg/kanban/board")).length;
  await pollChannelOnce(channel.id, h.deps);
  await pollChannelOnce(channel.id, h.deps);
  const afterMore = server
    .requests()
    .filter((r) => r.path.startsWith("/deskrpg/kanban/board")).length;

  assert.ok(afterFirst > before, "첫 바퀴가 보드를 읽지 않았습니다");
  assert.equal(
    afterMore,
    afterFirst,
    "한가한 채널이 매 바퀴 보드를 조회합니다 — 조건이 '상태가 비었나' 로 잡혀 있습니다",
  );
});

test("되세우기는 담당자 없는 running 카드를 건너뛴다", async () => {
  const server = await startPlugin();
  const { channel } = await seedBoundChannel(server);
  const { pollChannelOnce } = await import("./automation-poller");
  const { getWorkingSnapshot } = await import("./automation-events");
  const { channelBoardSlug, resolveChannelBoard } = await import("@/lib/kanban-boards");
  const slug = channelBoardSlug(channel.id);
  const h = await makeDeps();

  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);
  const resolved = await resolveChannelBoard(channel.id);
  assert.ok(resolved.ok);
  const made = await resolved.ownerClient.kanban.createTask(slug, { title: "담당 없는 카드" });
  assert.ok(made.ok);
  await resolved.ownerClient.kanban.updateTask(slug, made.data.task.id, { status: "running" });

  await simulateRestart(channel.id);
  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);
  assert.deepEqual(
    getWorkingSnapshot(channel.id),
    [],
    "담당자가 없으면 누구를 일하는 중으로 만들지 정할 수 없습니다",
  );
});

test("보드 조회가 실패한 바퀴는 끝난 것으로 표시하지 않는다 — 다음 바퀴에 되세운다", async () => {
  const server = await startPlugin();
  const { channel } = await seedBoundChannel(server);
  const { pollChannelOnce } = await import("./automation-poller");
  const { getWorkingSnapshot } = await import("./automation-events");
  const { channelBoardSlug } = await import("@/lib/kanban-boards");
  const slug = channelBoardSlug(channel.id);
  const h = await makeDeps();

  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);
  await seedRunningCard(channel.id, slug, "재시작 때 돌고 있던 카드");
  await simulateRestart(channel.id);

  // 재시작은 배포와 겹치는 일이 많다 — 되세우기가 도는 바로 그 순간 게이트웨이가 안 닿는다.
  server.failNext("/deskrpg/kanban/board");
  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);
  assert.deepEqual(
    getWorkingSnapshot(channel.id),
    [],
    "사전 조건: 보드를 못 읽었으니 이 바퀴는 아무것도 못 세운다",
  );

  assert.ok((await pollChannelOnce(channel.id, h.deps)).ok);
  const restored = getWorkingSnapshot(channel.id);
  assert.equal(
    restored.length,
    1,
    "실패한 바퀴를 '끝났다' 로 표시했습니다 — 그 채널은 프로세스가 사는 동안 다시 시도하지 않습니다",
  );

  // 성공한 뒤에는 다시 조회하지 않는다(한가한 채널이 매 바퀴 보드를 읽지 않게).
  const after = server.requests().filter((r) => r.path.startsWith("/deskrpg/kanban/board")).length;
  await pollChannelOnce(channel.id, h.deps);
  await pollChannelOnce(channel.id, h.deps);
  assert.equal(
    server.requests().filter((r) => r.path.startsWith("/deskrpg/kanban/board")).length,
    after,
    "성공한 뒤에도 매 바퀴 보드를 조회합니다",
  );
});
