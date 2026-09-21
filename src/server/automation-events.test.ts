import { test } from "node:test";
import assert from "node:assert/strict";

import type { PluginEvent } from "@/lib/hermes/deskrpg-plugin-types";
import type { RoomMessage } from "@/lib/chat-rooms-policy";
import {
  AUTOMATION_SOCKET_EVENTS,
  createAutomationState,
  getWorkingSnapshot,
  ingest,
  type ChannelNpcLookup,
  type IngestDeps,
  type NpcWorkingPayload,
} from "./automation-events";

// T5. 단일 사건 싱크 `ingest()` — 폴러와(나중에) 푸시 라우트가 같은 함수를 부른다(R25).
// 여기서는 DB 없이 의존성을 전부 가짜로 꽂아 규칙만 고정한다:
// 방송(kanban:event / cron:event), 맵 상태(npc:working 의 차분 방송), 방 알림(R28~R30),
// 잠든·빠진 NPC 의 시스템 메시지(R22), 같은 사건 ID 의 중복 처리 금지.

const CHANNEL = "channel-1";
const GATEWAY = "gateway-1";
const BOARD = "deskrpg-board";

type Emitted = { channelId: string; event: string; payload: unknown };
type Posted = Parameters<IngestDeps["appendRoomMessage"]>[0];

function harness(
  opts: {
    npcs?: Record<string, ChannelNpcLookup | null>;
    origins?: Record<string, { channelId: string; gatewayId: string }>;
    officeRoomId?: string | null;
    maxResultLength?: number;
    dedupeLimit?: number;
  } = {},
) {
  const emitted: Emitted[] = [];
  const posted: Posted[] = [];
  const roomEmits: Array<{ roomId: string; message: RoomMessage }> = [];
  let seq = 0;
  const deps: IngestDeps = {
    gatewayId: GATEWAY,
    boardSlug: BOARD,
    state: createAutomationState(),
    maxResultLength: opts.maxResultLength,
    dedupeLimit: opts.dedupeLimit,
    findNpcByProfile: async (_channelId, profileName) => opts.npcs?.[profileName] ?? null,
    findCronOriginChannel: async (key) =>
      opts.origins?.[`${key.gatewayId}/${key.profileName}/${key.jobId}`] ?? null,
    ensureOfficeRoomId: async () =>
      opts.officeRoomId === undefined ? "office-room" : opts.officeRoomId,
    appendRoomMessage: async (args) => {
      posted.push(args);
      return {
        id: `msg-${(seq += 1)}`,
        roomId: args.roomId,
        senderKind: args.senderKind,
        senderId: args.senderId,
        senderName: args.senderName,
        content: args.content,
        createdAt: new Date().toISOString(),
        notice: args.notice ?? null,
      };
    },
    emitChannel: (channelId, event, payload) => emitted.push({ channelId, event, payload }),
    emitRoomMessage: (roomId, message) => roomEmits.push({ roomId, message }),
  };
  return { deps, emitted, posted, roomEmits };
}

let eventSeq = 0;
function ev(input: Partial<PluginEvent> & { kind: PluginEvent["kind"] }): PluginEvent {
  return {
    id: input.id ?? `ev_${(eventSeq += 1)}`,
    ts: input.ts ?? Date.now(),
    kind: input.kind,
    board: input.board ?? BOARD,
    task_id: input.task_id,
    profile: input.profile,
    job_id: input.job_id,
    run_id: input.run_id,
    payload: input.payload ?? {},
  };
}

function statusEvent(input: {
  to: string;
  parent_count?: number;
  assignee?: string | null;
  title?: string;
  task_id?: string;
  id?: string;
}) {
  return ev({
    id: input.id,
    kind: "task.status",
    task_id: input.task_id ?? "task-1",
    payload: {
      from: "running",
      to: input.to,
      parent_count: input.parent_count ?? 0,
      title: input.title ?? "보고서 초안",
      assignee: input.assignee === undefined ? "sophie" : input.assignee,
    },
  });
}

function cronFinished(input: {
  profile?: string;
  job_id?: string;
  status?: "ok" | "error";
  result_text?: string;
  id?: string;
  run_id?: string;
}) {
  const profile = input.profile ?? "sophie";
  const job_id = input.job_id ?? "job-1";
  return ev({
    id: input.id,
    kind: "cron.run.finished",
    board: undefined,
    profile,
    job_id,
    run_id: input.run_id ?? "run-1",
    payload: {
      job_id,
      job_name: "아침 브리핑",
      profile,
      session_id: "sess-1",
      started_at: "2026-09-14T00:00:00Z",
      status: input.status ?? "ok",
      ended_at: "2026-09-14T00:01:00Z",
      result_text: input.result_text ?? "오늘의 브리핑입니다",
    },
  });
}

const SOPHIE_ACTIVE: ChannelNpcLookup = {
  profileName: "sophie",
  displayName: "소피",
  npc: { id: "npc-sophie", active: true },
};
const SOPHIE_ASLEEP: ChannelNpcLookup = {
  ...SOPHIE_ACTIVE,
  npc: { id: "npc-sophie", active: false },
};
const SOPHIE_ABSENT: ChannelNpcLookup = { ...SOPHIE_ACTIVE, npc: null };

const workingEvents = (emitted: Emitted[]) =>
  emitted
    .filter((e) => e.event === AUTOMATION_SOCKET_EVENTS.working)
    .map((e) => e.payload as NpcWorkingPayload);

/** 직원 이름을 싣지 않는 알림 kind(회의 결과)가 있어 유니온에서 바로 읽을 수 없다. */
function noticeNpcName(notice: { kind: string } | null | undefined): string | undefined {
  return notice && "npcName" in notice ? (notice as { npcName: string }).npcName : undefined;
}

test("최상위 카드의 done 진입은 담당 NPC 이름으로 사무실 방에 알림 1건 — notice 포함", async () => {
  const h = harness({ npcs: { sophie: SOPHIE_ACTIVE } });
  await ingest(CHANNEL, [statusEvent({ to: "done", parent_count: 0 })], h.deps);

  assert.equal(h.posted.length, 1);
  const post = h.posted[0];
  assert.equal(post.roomId, "office-room");
  assert.equal(post.senderKind, "npc");
  assert.equal(post.senderId, "npc-sophie");
  assert.equal(post.senderName, "소피");
  assert.equal(post.content, "보고서 초안", "content 는 로케일 무관 폴백 = 카드 제목");
  assert.deepEqual(post.notice, {
    kind: "card_done",
    cardId: "task-1",
    cardTitle: "보고서 초안",
    boardSlug: BOARD,
    npcName: "소피",
  });
  assert.equal(h.roomEmits.length, 1, "저장한 메시지를 방 소켓으로 방송한다");
  assert.equal(h.roomEmits[0].roomId, "office-room");
  assert.equal(h.roomEmits[0].message.notice?.kind, "card_done");
});

test("하위 카드(parent_count > 0)의 done 은 게시하지 않는다", async () => {
  const h = harness({ npcs: { sophie: SOPHIE_ACTIVE } });
  await ingest(CHANNEL, [statusEvent({ to: "done", parent_count: 2 })], h.deps);
  assert.equal(h.posted.length, 0);
});

test("승인 묶음에 든 카드는 부모가 있어도 done 을 게시한다 — 순서로 이은 독립 업무다", async () => {
  // 회의 후속 업무는 "먼저 끝나야 함" 을 부모 링크로 옮긴다. 부모 링크는 묶음이 아니라 실행 순서라
  // 둘째 카드가 하위 카드로 취급돼 끝나도 아무도 보고하지 않았다(스테이징 실측).
  const h = harness({ npcs: { sophie: SOPHIE_ACTIVE } });
  const asked: string[] = [];
  await ingest(
    CHANNEL,
    [
      statusEvent({ to: "done", parent_count: 1, task_id: "followup-2" }),
      statusEvent({ to: "done", parent_count: 1, task_id: "swarm-child" }),
      statusEvent({ to: "done", parent_count: 0, task_id: "root" }),
    ],
    {
      ...h.deps,
      isApprovalBatchCard: async (_channelId, taskId) => {
        asked.push(taskId);
        return taskId === "followup-2";
      },
    },
  );
  assert.deepEqual(
    h.posted.map((p) => [p.notice?.kind, (p.notice as { cardId: string }).cardId]),
    [
      ["card_done", "followup-2"],
      ["card_done", "root"],
    ],
  );
  // 스웜·분해 자식은 승인을 거치지 않으니 조용하다 — 자식 10장이 알림 10개가 되지 않는다.
  // 부모가 없는 카드는 물어볼 필요가 없다.
  assert.deepEqual(asked, ["followup-2", "swarm-child"]);
});

test("승인 묶음 조회가 없으면 부모 있는 done 은 예전처럼 게시하지 않는다", async () => {
  const h = harness({ npcs: { sophie: SOPHIE_ACTIVE } });
  await ingest(CHANNEL, [statusEvent({ to: "done", parent_count: 1 })], h.deps);
  assert.equal(h.posted.length, 0);
});

test("blocked 진입은 하위 카드여도 게시한다", async () => {
  const h = harness({ npcs: { sophie: SOPHIE_ACTIVE } });
  await ingest(
    CHANNEL,
    [
      statusEvent({ to: "blocked", parent_count: 3, task_id: "child" }),
      statusEvent({ to: "blocked", parent_count: 0, task_id: "root" }),
      statusEvent({ to: "running", parent_count: 0, task_id: "other" }),
    ],
    h.deps,
  );
  assert.deepEqual(
    h.posted.map((p) => [p.notice?.kind, (p.notice as { cardId: string }).cardId]),
    [
      ["card_blocked", "child"],
      ["card_blocked", "root"],
    ],
  );
});

test("승인 대기라서 blocked 인 카드는 막힘 알림을 내지 않는다 — 승인 요청 줄이 이미 말하고 있다", async () => {
  const h = harness({ npcs: { sophie: SOPHIE_ACTIVE } });
  const asked: string[] = [];
  await ingest(
    CHANNEL,
    [
      statusEvent({ to: "blocked", parent_count: 0, task_id: "waiting" }),
      statusEvent({ to: "blocked", parent_count: 0, task_id: "really-stuck" }),
    ],
    {
      ...h.deps,
      isAwaitingApproval: async (_channelId, taskId) => {
        asked.push(taskId);
        return taskId === "waiting";
      },
    },
  );
  assert.deepEqual(asked, ["waiting", "really-stuck"]);
  // 진짜로 막힌 카드는 여전히 알린다.
  assert.deepEqual(
    h.posted.map((p) => (p.notice as { cardId: string }).cardId),
    ["really-stuck"],
  );
});

test("review 진입은 하위 카드여도 게시한다 — 사람의 판단을 기다리는 자리다", async () => {
  const h = harness({ npcs: { sophie: SOPHIE_ACTIVE } });
  await ingest(
    CHANNEL,
    [
      statusEvent({ to: "review", parent_count: 4, task_id: "child" }),
      statusEvent({ to: "review", parent_count: 0, task_id: "root" }),
    ],
    h.deps,
  );
  assert.deepEqual(
    h.posted.map((p) => [p.notice?.kind, (p.notice as { cardId: string }).cardId]),
    [
      ["card_review", "child"],
      ["card_review", "root"],
    ],
  );
  assert.equal(h.posted[0].senderKind, "npc");
  assert.equal(h.posted[0].content, "보고서 초안", "content 는 로케일 무관 폴백 = 카드 제목");
});

test("담당 NPC 가 잠들었거나 채널에 없으면 시스템 메시지 — 본문 앞에 NPC 이름(R22)", async () => {
  for (const lookup of [SOPHIE_ASLEEP, SOPHIE_ABSENT]) {
    const h = harness({ npcs: { sophie: lookup } });
    await ingest(CHANNEL, [statusEvent({ to: "done" })], h.deps);
    assert.equal(h.posted.length, 1);
    const post = h.posted[0];
    assert.equal(post.senderKind, "system");
    assert.equal(post.senderId, null);
    assert.equal(post.senderName, "소피");
    assert.equal(post.content, "소피: 보고서 초안");
    assert.equal(noticeNpcName(post.notice), "소피");
  }
});

test("프로필 자체가 게이트웨이에서 사라졌으면 프로필 이름을 그대로 쓴다 — 놓치지 않는다", async () => {
  const h = harness({ npcs: {} });
  await ingest(CHANNEL, [statusEvent({ to: "blocked", assignee: "ghost" })], h.deps);
  assert.equal(h.posted.length, 1);
  assert.equal(h.posted[0].senderKind, "system");
  assert.equal(h.posted[0].content, "ghost: 보고서 초안");
});

test("담당자 없는 카드의 알림은 이름 없는 시스템 메시지", async () => {
  const h = harness();
  await ingest(CHANNEL, [statusEvent({ to: "blocked", assignee: null })], h.deps);
  assert.equal(h.posted.length, 1);
  assert.equal(h.posted[0].senderKind, "system");
  assert.equal(h.posted[0].senderName, "");
  assert.equal(h.posted[0].content, "보고서 초안");
  assert.equal(noticeNpcName(h.posted[0].notice), "");
});

test("사무실 방을 확보하지 못하면 게시는 건너뛰되 방송은 그대로 나간다", async () => {
  const h = harness({ npcs: { sophie: SOPHIE_ACTIVE }, officeRoomId: null });
  const result = await ingest(CHANNEL, [statusEvent({ to: "done" })], h.deps);
  assert.equal(h.posted.length, 0);
  assert.equal(result.processed, 1);
  assert.equal(h.emitted.filter((e) => e.event === AUTOMATION_SOCKET_EVENTS.kanban).length, 1);
});

test("cron.run.finished — 출처가 이 채널이면 담당 NPC 이름으로 결과를 게시한다", async () => {
  const h = harness({
    npcs: { sophie: SOPHIE_ACTIVE },
    origins: { [`${GATEWAY}/sophie/job-1`]: { channelId: CHANNEL, gatewayId: GATEWAY } },
  });
  await ingest(CHANNEL, [cronFinished({})], h.deps);
  assert.equal(h.posted.length, 1);
  const post = h.posted[0];
  assert.equal(post.senderKind, "npc");
  assert.equal(post.senderName, "소피");
  assert.equal(post.content, "오늘의 브리핑입니다");
  assert.deepEqual(post.notice, {
    kind: "cron_result",
    jobId: "job-1",
    jobName: "아침 브리핑",
    npcName: "소피",
    status: "ok",
  });
});

test("cron 결과 — 출처가 다른 채널·출처 없음·다른 게이트웨이면 게시하지 않는다", async () => {
  const cases: Array<{
    name: string;
    origins: Record<string, { channelId: string; gatewayId: string }>;
  }> = [
    {
      name: "다른 채널",
      origins: { [`${GATEWAY}/sophie/job-1`]: { channelId: "other", gatewayId: GATEWAY } },
    },
    { name: "출처 없음", origins: {} },
    {
      name: "다른 게이트웨이",
      origins: { [`${GATEWAY}/sophie/job-1`]: { channelId: CHANNEL, gatewayId: "gateway-old" } },
    },
  ];
  for (const c of cases) {
    const h = harness({ npcs: { sophie: SOPHIE_ACTIVE }, origins: c.origins });
    await ingest(CHANNEL, [cronFinished({})], h.deps);
    assert.equal(h.posted.length, 0, c.name);
    assert.equal(
      h.emitted.filter((e) => e.event === AUTOMATION_SOCKET_EVENTS.cron).length,
      1,
      `${c.name}: 방송은 나간다`,
    );
  }
});

test("cron 결과 — error 는 오류 요약, 빈 결과는 '결과 없음', 긴 결과는 잘라서 '…'(E8)", async () => {
  const origins = { [`${GATEWAY}/sophie/job-1`]: { channelId: CHANNEL, gatewayId: GATEWAY } };
  const npcs = { sophie: SOPHIE_ACTIVE };

  let h = harness({ npcs, origins });
  await ingest(CHANNEL, [cronFinished({ status: "error", result_text: "API 429" })], h.deps);
  assert.equal(h.posted[0].content, "API 429");
  assert.equal(h.posted[0].notice?.kind === "cron_result" && h.posted[0].notice.status, "error");

  h = harness({ npcs, origins });
  await ingest(CHANNEL, [cronFinished({ status: "error", result_text: "  " })], h.deps);
  assert.equal(h.posted[0].content, "실행 실패");

  h = harness({ npcs, origins });
  await ingest(CHANNEL, [cronFinished({ status: "ok", result_text: "" })], h.deps);
  assert.equal(h.posted[0].content, "결과 없음");

  h = harness({ npcs, origins, maxResultLength: 10 });
  await ingest(CHANNEL, [cronFinished({ result_text: "가".repeat(25) })], h.deps);
  assert.equal(h.posted[0].content, "가".repeat(10) + "…");
});

test("cron 결과 — 담당 NPC 가 잠들었으면 시스템 메시지 + 이름 접두", async () => {
  const h = harness({
    npcs: { sophie: SOPHIE_ASLEEP },
    origins: { [`${GATEWAY}/sophie/job-1`]: { channelId: CHANNEL, gatewayId: GATEWAY } },
  });
  await ingest(CHANNEL, [cronFinished({})], h.deps);
  assert.equal(h.posted[0].senderKind, "system");
  assert.equal(h.posted[0].content, "소피: 오늘의 브리핑입니다");
});

test("cron.run.started 는 방 게시 없이 맵 상태만 바꾼다", async () => {
  const h = harness({ npcs: { sophie: SOPHIE_ACTIVE } });
  await ingest(
    CHANNEL,
    [
      ev({
        kind: "cron.run.started",
        board: undefined,
        profile: "sophie",
        job_id: "job-1",
        run_id: "r1",
      }),
    ],
    h.deps,
  );
  assert.equal(h.posted.length, 0);
  assert.deepEqual(workingEvents(h.emitted), [
    { npcId: "npc-sophie", working: true, sources: { runningCards: 0, cronRuns: 1 } },
  ]);
});

test("같은 사건 ID 는 두 번 처리하지 않는다 — 방송·게시·상태 모두", async () => {
  const h = harness({ npcs: { sophie: SOPHIE_ACTIVE } });
  const done = statusEvent({ to: "done", id: "ev_dup" });
  await ingest(CHANNEL, [done], h.deps);
  const second = await ingest(CHANNEL, [done, { ...done }], h.deps);
  assert.equal(h.posted.length, 1);
  assert.equal(h.emitted.filter((e) => e.event === AUTOMATION_SOCKET_EVENTS.kanban).length, 1);
  assert.equal(second.processed, 0);
  assert.equal(second.duplicates, 2);
});

test("중복 판정 집합은 크기 상한을 지킨다 — 오래된 ID 부터 잊는다", async () => {
  const h = harness({ dedupeLimit: 2 });
  await ingest(
    CHANNEL,
    [statusEvent({ to: "running", id: "a" }), statusEvent({ to: "running", id: "b" })],
    h.deps,
  );
  await ingest(CHANNEL, [statusEvent({ to: "running", id: "c" })], h.deps);
  const again = await ingest(CHANNEL, [statusEvent({ to: "running", id: "a" })], h.deps);
  assert.equal(again.processed, 1, "a 는 잊혔으므로 다시 처리된다");
  const stillB = await ingest(CHANNEL, [statusEvent({ to: "running", id: "c" })], h.deps);
  assert.equal(stillB.duplicates, 1);
});

test("ingest 는 task.* 를 kanban:event 로, cron.* 를 cron:event 로 채널에 방송한다", async () => {
  const h = harness({
    npcs: { x: { profileName: "x", displayName: "엑스", npc: { id: "npc-x", active: true } } },
  });
  const taskEv = ev({ kind: "task.created", task_id: "t1" });
  const cronEv = ev({ kind: "cron.run.started", board: undefined, profile: "x", job_id: "j" });
  await ingest(CHANNEL, [taskEv, cronEv], h.deps);
  const byEvent = (name: string) => h.emitted.filter((e) => e.event === name);
  assert.deepEqual(byEvent(AUTOMATION_SOCKET_EVENTS.kanban), [
    { channelId: CHANNEL, event: "kanban:event", payload: { channelId: CHANNEL, event: taskEv } },
  ]);
  assert.deepEqual(byEvent(AUTOMATION_SOCKET_EVENTS.cron), [
    { channelId: CHANNEL, event: "cron:event", payload: { channelId: CHANNEL, event: cronEv } },
  ]);
});

test("cron.* 는 프로필이 이 채널의 NPC 로 풀릴 때만 cron:event 로 방송한다 — 남의 프로필은 새지 않는다", async () => {
  const cronOf = (profile: string | undefined) =>
    ev({
      kind: "cron.run.started",
      board: undefined,
      profile,
      job_id: "j",
      run_id: `r-${profile}`,
    });
  const cronEvents = (h: ReturnType<typeof harness>) =>
    h.emitted.filter((e) => e.event === AUTOMATION_SOCKET_EVENTS.cron);

  // 프로필은 게이트웨이에 있지만 이 채널에 NPC 행이 없다 → 방송 없음.
  const stranger = harness({
    npcs: { noah: { profileName: "noah", displayName: "노아", npc: null } },
  });
  await ingest(CHANNEL, [cronOf("noah")], stranger.deps);
  assert.equal(cronEvents(stranger).length, 0, "채널 밖 프로필");

  // 프로필 자체가 게이트웨이에 없다 → 방송 없음.
  const unknown = harness();
  await ingest(CHANNEL, [cronOf("ghost")], unknown.deps);
  assert.equal(cronEvents(unknown).length, 0, "모르는 프로필");

  // 프로필이 없는 사건 → 방송 없음.
  const anonymous = harness({ npcs: { sophie: SOPHIE_ACTIVE } });
  await ingest(CHANNEL, [cronOf(undefined)], anonymous.deps);
  assert.equal(cronEvents(anonymous).length, 0, "프로필 없는 사건");

  // 잠든 NPC 라도 이 채널의 NPC 면 방송한다(작업 중 집계와 같은 기준).
  const dormant = harness({
    npcs: { sophie: { ...SOPHIE_ACTIVE, npc: { id: "npc-sophie", active: false } } },
  });
  await ingest(CHANNEL, [cronOf("sophie")], dormant.deps);
  assert.equal(cronEvents(dormant).length, 1, "잠든 NPC");
});

test("npc:working — run started/finished 로 켜지고 꺼지며, 변화가 없으면 다시 쏘지 않는다", async () => {
  const h = harness({ npcs: { sophie: SOPHIE_ACTIVE } });
  const started = (task: string, id?: string) =>
    ev({ kind: "task.run.started", id, task_id: task, profile: "sophie", run_id: `run-${task}` });
  const finished = (task: string) =>
    ev({
      kind: "task.run.finished",
      task_id: task,
      run_id: `run-${task}`,
      payload: { status: "ok" },
    });

  await ingest(CHANNEL, [started("t1")], h.deps);
  assert.deepEqual(workingEvents(h.emitted), [
    { npcId: "npc-sophie", working: true, sources: { runningCards: 1, cronRuns: 0 } },
  ]);

  // 모르는 실행의 종료·이미 없는 카드 — 상태가 그대로면 방송도 없다.
  await ingest(CHANNEL, [finished("unknown")], h.deps);
  assert.equal(workingEvents(h.emitted).length, 1);

  await ingest(CHANNEL, [started("t2")], h.deps);
  assert.deepEqual(workingEvents(h.emitted).at(-1), {
    npcId: "npc-sophie",
    working: true,
    sources: { runningCards: 2, cronRuns: 0 },
  });

  await ingest(CHANNEL, [finished("t1")], h.deps);
  assert.equal(workingEvents(h.emitted).at(-1)!.sources.runningCards, 1);
  assert.deepEqual(getWorkingSnapshot(CHANNEL, h.deps.state), [
    { npcId: "npc-sophie", working: true, sources: { runningCards: 1, cronRuns: 0 } },
  ]);

  await ingest(CHANNEL, [finished("t2")], h.deps);
  assert.deepEqual(workingEvents(h.emitted).at(-1), {
    npcId: "npc-sophie",
    working: false,
    sources: { runningCards: 0, cronRuns: 0 },
  });
  assert.deepEqual(getWorkingSnapshot(CHANNEL, h.deps.state), [], "끝난 NPC 는 스냅샷에서 빠진다");
  assert.equal(workingEvents(h.emitted).length, 4);
});

test("npc:working — 카드와 크론이 함께 있으면 둘 다 끝나야 꺼진다; 잠든 NPC 도 집계한다", async () => {
  const h = harness({ npcs: { sophie: SOPHIE_ASLEEP } });
  await ingest(
    CHANNEL,
    [
      ev({ kind: "task.run.started", task_id: "t1", profile: "sophie", run_id: "r1" }),
      ev({
        kind: "cron.run.started",
        board: undefined,
        profile: "sophie",
        job_id: "j1",
        run_id: "cr1",
      }),
    ],
    h.deps,
  );
  assert.deepEqual(workingEvents(h.emitted).at(-1), {
    npcId: "npc-sophie",
    working: true,
    sources: { runningCards: 1, cronRuns: 1 },
  });
  await ingest(
    CHANNEL,
    [
      ev({
        kind: "cron.run.finished",
        board: undefined,
        profile: "sophie",
        job_id: "j1",
        run_id: "cr1",
      }),
    ],
    h.deps,
  );
  assert.deepEqual(workingEvents(h.emitted).at(-1)!.sources, { runningCards: 1, cronRuns: 0 });
  assert.equal(workingEvents(h.emitted).at(-1)!.working, true);
});

test("의존성이 던져도 다른 사건은 계속 처리하고 실패를 결과에 남긴다", async () => {
  const h = harness({ npcs: { sophie: SOPHIE_ACTIVE } });
  let calls = 0;
  h.deps.appendRoomMessage = async () => {
    calls += 1;
    throw new Error("db down");
  };
  const result = await ingest(
    CHANNEL,
    [statusEvent({ to: "done", task_id: "a" }), statusEvent({ to: "done", task_id: "b" })],
    h.deps,
  );
  assert.equal(calls, 2);
  assert.equal(result.processed, 2);
  assert.deepEqual(result.errors.length, 2);
  assert.match(result.errors[0], /db down/);
});

// ---- card_proposal.created ------------------------------------------------
// 제안은 카드가 아니다 — Hermes 가 정본이고 DeskRPG 는 방 알림 한 건만 남긴다.

function proposalEvent(
  payload: Record<string, unknown> = {},
  profile: string | undefined = "sophie",
) {
  return ev({
    kind: "card_proposal.created",
    profile,
    payload: {
      proposal_id: "0123456789abcdef0123456789abcdef",
      title: "주간 보고 정리",
      summary: "금요일마다 모은다",
      profile: profile ?? "sophie",
      ...payload,
    },
  });
}

test("card_proposal.created 는 사무실 방 알림 1건을 만든다 — 소켓 이벤트는 없다", async () => {
  const h = harness({ npcs: { sophie: SOPHIE_ACTIVE } });
  await ingest(CHANNEL, [proposalEvent()], h.deps);

  assert.equal(h.posted.length, 1);
  const post = h.posted[0];
  assert.equal(post.roomId, "office-room");
  assert.equal(post.senderKind, "npc");
  assert.equal(post.senderId, "npc-sophie");
  assert.equal(post.content, "주간 보고 정리", "content 는 로케일 무관 폴백 = 제안 제목");
  assert.deepEqual(post.notice, {
    kind: "card_proposal",
    proposalId: "0123456789abcdef0123456789abcdef",
    title: "주간 보고 정리",
    summary: "금요일마다 모은다",
    npcId: "npc-sophie",
    npcName: "소피",
  });
  assert.equal(post.notice?.kind === "card_proposal" && post.notice.resolved, undefined);
  assert.equal(h.emitted.length, 0, "새 소켓 이벤트를 만들지 않는다");
  assert.equal(h.roomEmits.length, 1, "저장한 메시지를 방 소켓으로 방송한다");
});

test("body·acceptance 는 있을 때만 알림에 싣는다", async () => {
  const h = harness({ npcs: { sophie: SOPHIE_ACTIVE } });
  await ingest(CHANNEL, [proposalEvent({ body: "본문", acceptance: "완료 조건" })], h.deps);
  const notice = h.posted[0].notice;
  assert.ok(notice?.kind === "card_proposal");
  assert.equal(notice.body, "본문");
  assert.equal(notice.acceptance, "완료 조건");
});

test("프로필이 이 채널의 NPC 가 아니면 제안 알림을 만들지 않는다 — 오류도 아니다", async () => {
  const h = harness({ npcs: {} });
  const result = await ingest(CHANNEL, [proposalEvent()], h.deps);
  assert.equal(h.posted.length, 0);
  assert.deepEqual(result.errors, []);
});

test("잠든 NPC 의 제안도 놓치지 않는다 — 시스템 메시지로 올린다", async () => {
  const h = harness({ npcs: { sophie: SOPHIE_ASLEEP } });
  await ingest(CHANNEL, [proposalEvent()], h.deps);
  assert.equal(h.posted.length, 1);
  assert.equal(h.posted[0].senderKind, "system");
  assert.equal(h.posted[0].content, "소피: 주간 보고 정리");
  assert.equal(
    h.posted[0].notice?.kind === "card_proposal" && h.posted[0].notice.npcId,
    "npc-sophie",
  );
});

test("proposal_id 나 제목이 없는 제안 사건은 버린다", async () => {
  const h = harness({ npcs: { sophie: SOPHIE_ACTIVE } });
  const result = await ingest(
    CHANNEL,
    [proposalEvent({ proposal_id: undefined }), proposalEvent({ title: "" })],
    h.deps,
  );
  assert.equal(h.posted.length, 0);
  assert.deepEqual(result.errors, []);
});
