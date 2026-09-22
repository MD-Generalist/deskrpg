import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import {
  authHeaders,
  seedChannel,
  seedGateway,
  seedHermesProfile,
  seedNpc,
  seedUser,
  setupThrowawaySqlite,
} from "@/test-setup/npc-seed";
import { startFakePluginServer, type FakePluginServer } from "@/lib/hermes/fake-plugin-server";

// T6. 칸반 REST + 자동화 상태 + 즉시 폴링 배선.
//
// Hermes 가 정본이고 카드는 한 장도 여기 저장하지 않는다. 여기서 고정하는 것은
// 권한표(보기·카드 조작 = 멤버, 보드 작업 폴더 = 채널 소유자, 호스트 운영 설정 읽기 = 채널
// 소유자, 수정 = 게이트웨이 소유자), 담당자 검증(채널의 active NPC 만), 생성·상태 변경 뒤의
// dispatch 한 번 + 즉시 폴링, 그리고 게이트(428·409·503·404 attachments_unsupported)다.
//
// `[id]` 세그먼트 밖에 둔다 — node 테스트 러너가 `[id]` 를 문자 클래스로 오인해 그 안의
// *.test.ts 를 못 줍는다.
setupThrowawaySqlite("kanban-routes-test");

const OWNER_TOKEN = "gateway-owner-key-1234567890";
const PROFILE_TOKEN = "profile-key-1234567890";

let server: FakePluginServer;
/** 라우트가 요청한 즉시 폴링의 채널 id 들 — 실제 폴러 대신 여기에 쌓인다. */
let polled: string[] = [];

before(async () => {
  server = await startFakePluginServer({
    ownerToken: OWNER_TOKEN,
    profileTokens: { sophie: PROFILE_TOKEN, noah: PROFILE_TOKEN },
  });
  // 라우트는 `@/server/*` 를 직접 보지 않고 레지스트리로 폴러를 만난다 — 여기에 기록기를 꽂는다.
  const { registerAutomationHooks } = await import("@/lib/automation-registry");
  registerAutomationHooks({
    pollNow: async (channelId) => {
      polled.push(channelId);
      return null;
    },
    refreshPollers: async () => {},
    getWorkingSnapshot: () => [],
    emitRoomMessage: () => {},
  });
});

beforeEach(() => {
  polled = [];
});

after(async () => {
  const { resetAutomationHooksForTests } = await import("@/lib/automation-registry");
  resetAutomationHooksForTests();
  await server.close();
});

type Routes = {
  board: typeof import("./[id]/kanban/board/route");
  runs: typeof import("./[id]/kanban/runs/route");
  boardAttachments: typeof import("./[id]/kanban/attachments/route");
  tasks: typeof import("./[id]/kanban/tasks/route");
  task: typeof import("./[id]/kanban/tasks/[taskId]/route");
  comments: typeof import("./[id]/kanban/tasks/[taskId]/comments/route");
  reassign: typeof import("./[id]/kanban/tasks/[taskId]/reassign/route");
  reclaim: typeof import("./[id]/kanban/tasks/[taskId]/reclaim/route");
  approve: typeof import("./[id]/kanban/tasks/[taskId]/approve/route");
  requestChanges: typeof import("./[id]/kanban/tasks/[taskId]/request-changes/route");
  unblock: typeof import("./[id]/kanban/tasks/[taskId]/unblock/route");
  terminate: typeof import("./[id]/kanban/tasks/[taskId]/terminate/route");
  archive: typeof import("./[id]/kanban/tasks/[taskId]/archive/route");
  specify: typeof import("./[id]/kanban/tasks/[taskId]/specify/route");
  log: typeof import("./[id]/kanban/tasks/[taskId]/log/route");
  taskAttachments: typeof import("./[id]/kanban/tasks/[taskId]/attachments/route");
  attachment: typeof import("./[id]/kanban/attachments/[attachmentId]/route");
  links: typeof import("./[id]/kanban/links/route");
  dispatch: typeof import("./[id]/kanban/dispatch/route");
  settings: typeof import("./[id]/kanban/settings/route");
  status: typeof import("./[id]/automation/status/route");
};

async function loadRoutes(): Promise<Routes> {
  return {
    board: await import("./[id]/kanban/board/route"),
    tasks: await import("./[id]/kanban/tasks/route"),
    task: await import("./[id]/kanban/tasks/[taskId]/route"),
    comments: await import("./[id]/kanban/tasks/[taskId]/comments/route"),
    reassign: await import("./[id]/kanban/tasks/[taskId]/reassign/route"),
    reclaim: await import("./[id]/kanban/tasks/[taskId]/reclaim/route"),
    approve: await import("./[id]/kanban/tasks/[taskId]/approve/route"),
    requestChanges: await import("./[id]/kanban/tasks/[taskId]/request-changes/route"),
    unblock: await import("./[id]/kanban/tasks/[taskId]/unblock/route"),
    terminate: await import("./[id]/kanban/tasks/[taskId]/terminate/route"),
    archive: await import("./[id]/kanban/tasks/[taskId]/archive/route"),
    specify: await import("./[id]/kanban/tasks/[taskId]/specify/route"),
    log: await import("./[id]/kanban/tasks/[taskId]/log/route"),
    taskAttachments: await import("./[id]/kanban/tasks/[taskId]/attachments/route"),
    attachment: await import("./[id]/kanban/attachments/[attachmentId]/route"),
    links: await import("./[id]/kanban/links/route"),
    runs: await import("./[id]/kanban/runs/route"),
    boardAttachments: await import("./[id]/kanban/attachments/route"),
    dispatch: await import("./[id]/kanban/dispatch/route"),
    settings: await import("./[id]/kanban/settings/route"),
    status: await import("./[id]/automation/status/route"),
  };
}

function req(userId: string, method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: authHeaders(userId),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const base = (channelId: string) => `http://localhost/api/channels/${channelId}/kanban`;
const ctx = (id: string, taskId = "", attachmentId = "") => ({
  params: Promise.resolve({ id, taskId, attachmentId }),
});

/**
 * 채널 하나 + 가짜 플러그인 서버를 가리키는 게이트웨이(소유자 = 채널 소유자) + 프로필
 * `sophie` 의 active NPC. `gatewayOwnerId` 를 주면 게이트웨이 소유자를 따로 둔다.
 */
async function seedKanbanChannel(
  opts: { extraProfiles?: string[]; gatewayOwnerId?: string; baseUrl?: string } = {},
) {
  const owner = await seedUser("kanban-owner");
  const gatewayOwnerId = opts.gatewayOwnerId ?? owner.id;
  const gateway = await seedGateway(gatewayOwnerId, opts.baseUrl ?? server.baseUrl);
  const channel = await seedChannel(owner.id, "칸반 채널");
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
    name: "STALE-NPC-NAME",
    positionX: 0,
    positionY: 0,
  });
  const extras: Array<{ profileId: string; npcId: string; name: string }> = [];
  let column = 1;
  for (const name of opts.extraProfiles ?? []) {
    const extra = await seedHermesProfile(gateway.id, { profileName: name });
    const extraNpc = await seedNpc({
      channelId: channel.id,
      hermesProfileId: extra.id,
      positionX: column++,
      positionY: 0,
    });
    extras.push({ profileId: extra.id, npcId: extraNpc.id, name });
  }
  const { channelBoardSlug } = await import("@/lib/kanban-boards");
  return {
    ownerId: owner.id,
    gatewayOwnerId,
    gatewayId: gateway.id,
    channelId: channel.id,
    profileId: profile.id,
    npcId: npc.id,
    boardSlug: channelBoardSlug(channel.id),
    extras,
  };
}

async function addMember(channelId: string, userId: string) {
  const { db, channelMembers } = await import("@/db");
  await db.insert(channelMembers).values({ channelId, userId, role: "member" });
}

async function createTask(
  routes: Routes,
  userId: string,
  channelId: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await routes.tasks.POST(
    req(userId, "POST", `${base(channelId)}/tasks`, { title: "첫 카드", ...overrides }),
    ctx(channelId),
  );
  return { status: res.status, body: await res.json() };
}

function dispatchCalls(sinceIndex: number) {
  return server
    .requests()
    .slice(sinceIndex)
    .filter((r) => r.method === "POST" && r.path.startsWith("/deskrpg/kanban/dispatch"));
}

test("보드 보기 — 멤버는 200 + 로스터, 비멤버 403, 로그인 없음 401", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel({ extraProfiles: ["noah"] });
  const member = await seedUser("member");
  await addMember(seed.channelId, member.id);
  const stranger = await seedUser("stranger");

  // noah 를 재워도 로스터에는 active=false 로 남는다(assignee → npc 매핑용).
  const { setNpcActive } = await import("@/lib/npc-roster");
  await setNpcActive(seed.extras[0].npcId, false);

  const ok = await routes.board.GET(
    req(member.id, "GET", `${base(seed.channelId)}/board`),
    ctx(seed.channelId),
  );
  assert.equal(ok.status, 200, JSON.stringify(await ok.clone().json()));
  const body = await ok.json();
  assert.ok(Array.isArray(body.columns));
  assert.ok(!body.columns.some((c: { name: string }) => c.name === "archived"));
  assert.deepEqual(
    body.npcs
      .toSorted((a: { profileName: string }, b: { profileName: string }) =>
        a.profileName.localeCompare(b.profileName),
      )
      .map((n: Record<string, unknown>) => ({
        npcId: n.npcId,
        npcName: n.npcName,
        profileName: n.profileName,
        active: n.active,
      })),
    [
      { npcId: seed.extras[0].npcId, npcName: "noah", profileName: "noah", active: false },
      { npcId: seed.npcId, npcName: "소피", profileName: "sophie", active: true },
    ],
  );

  const archived = await routes.board.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/board?include_archived=true`),
    ctx(seed.channelId),
  );
  assert.ok((await archived.json()).columns.some((c: { name: string }) => c.name === "archived"));

  const forbidden = await routes.board.GET(
    req(stranger.id, "GET", `${base(seed.channelId)}/board`),
    ctx(seed.channelId),
  );
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).code, "not_a_member");

  const anonymous = await routes.board.GET(
    new NextRequest(`${base(seed.channelId)}/board`),
    ctx(seed.channelId),
  );
  assert.equal(anonymous.status, 401);
});

test("게이트웨이가 안 묶였으면 409 gateway_not_bound", async () => {
  server.reset();
  const routes = await loadRoutes();
  const owner = await seedUser("unbound-owner");
  const channel = await seedChannel(owner.id);
  const res = await routes.board.GET(
    req(owner.id, "GET", `${base(channel.id)}/board`),
    ctx(channel.id),
  );
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "gateway_not_bound");
});

test("캐시가 0.5.0 이라고 하면 Hermes 를 부르지 않고 428 plugin_upgrade_required", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();
  const { db, gatewayResources, nowForDb } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  await db
    .update(gatewayResources)
    .set({
      pluginStatus: "plugin_ready",
      pluginVersion: "0.5.0",
      pluginCheckedAt: nowForDb(),
      pluginInfoJson: JSON.stringify({
        plugin: "deskrpg",
        version: "0.5.0",
        capabilities: [],
        timezone: null,
        kanban: { dispatcher_present: false, attachments: false },
      }),
    })
    .where(eq(gatewayResources.id, seed.gatewayId));

  const before = server.requests().length;
  const res = await routes.board.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/board`),
    ctx(seed.channelId),
  );
  assert.equal(res.status, 428);
  const body = await res.json();
  assert.equal(body.code, "plugin_upgrade_required");
  assert.equal(body.minVersion, "0.6.0");
  assert.equal(server.requests().length, before, "신선한 캐시면 Hermes 를 부르지 않는다");
});

test("보드를 확보할 수 없으면 503 {code, message}", async () => {
  server.reset();
  const routes = await loadRoutes();
  // 게이트웨이는 닿지 않는 주소를 가리키되, 플러그인 캐시는 신선한 "준비됨" 이라
  // 428 게이트는 통과한다 — 보드 확보(createBoard)에서 막혀야 한다.
  const seed = await seedKanbanChannel({ baseUrl: "http://127.0.0.1:1" });
  const { db, gatewayResources, nowForDb } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  await db
    .update(gatewayResources)
    .set({
      pluginStatus: "plugin_ready",
      pluginVersion: "0.6.0",
      pluginCheckedAt: nowForDb(),
      pluginInfoJson: JSON.stringify({
        plugin: "deskrpg",
        version: "0.6.0",
        capabilities: ["kanban", "cron", "events"],
        timezone: "Asia/Seoul",
        kanban: { dispatcher_present: true, attachments: true },
      }),
    })
    .where(eq(gatewayResources.id, seed.gatewayId));

  const res = await routes.board.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/board`),
    ctx(seed.channelId),
  );
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(typeof body.code, "string");
  assert.equal(typeof body.message, "string");
});

test("카드 생성 — assignee 는 npcId 로 받아 profile_name 으로 보내고, dispatch 한 번 + 즉시 폴링", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();
  const member = await seedUser("member");
  await addMember(seed.channelId, member.id);

  const before = server.requests().length;
  const created = await createTask(routes, member.id, seed.channelId, {
    assignee: seed.npcId,
    body: "본문",
    priority: "high",
    skills: ["research"],
    workspace_kind: "scratch",
    goal_mode: true,
    goal_max_turns: 3,
    max_runtime_seconds: 600,
    unknown_field: "버린다",
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.task.assignee, "sophie");
  assert.equal(created.body.task.priority, "high");

  const sent = server
    .requests()
    .slice(before)
    .find((r) => r.method === "POST" && r.path.startsWith("/deskrpg/kanban/tasks?"));
  assert.ok(sent);
  assert.equal(sent.auth, `Bearer ${OWNER_TOKEN}`, "오너 토큰으로 부른다");
  const sentBody = sent.json as Record<string, unknown>;
  assert.equal(sentBody.assignee, "sophie");
  assert.equal(sentBody.npcId, undefined);
  assert.equal(sentBody.unknown_field, undefined);
  assert.deepEqual(sentBody.skills, ["research"]);
  assert.equal(sentBody.goal_max_turns, 3);

  assert.equal(dispatchCalls(before).length, 1, "생성 직후 dispatch 를 한 번 요청한다");
  assert.deepEqual(polled, [seed.channelId], "생성 직후 즉시 폴링을 요청한다");
});

test("카드 생성 — 만든 사람의 캐릭터가 있으면 본문 끝에 요청자 줄, 없으면 본문 그대로", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();
  const { db, characters } = await import("@/db");
  const withChar = await seedUser("requester");
  await addMember(seed.channelId, withChar.id);
  await db
    .insert(characters)
    .values({ userId: withChar.id, name: "곽지호", bio: "단테랩스 대표", appearance: "{}" });
  const noChar = await seedUser("no-character");
  await addMember(seed.channelId, noChar.id);

  const sentBodies = (since: number) =>
    server
      .requests()
      .slice(since)
      .filter((r) => r.method === "POST" && r.path.startsWith("/deskrpg/kanban/tasks?"))
      .map((r) => (r.json as Record<string, unknown>).body);

  let before = server.requests().length;
  assert.equal(
    (await createTask(routes, withChar.id, seed.channelId, { body: "본문" })).status,
    201,
  );
  assert.deepEqual(sentBodies(before), ["본문\n\n요청자: 곽지호 — 단테랩스 대표"]);

  before = server.requests().length;
  assert.equal((await createTask(routes, withChar.id, seed.channelId)).status, 201);
  assert.deepEqual(sentBodies(before), ["요청자: 곽지호 — 단테랩스 대표"]);

  before = server.requests().length;
  assert.equal(
    (await createTask(routes, noChar.id, seed.channelId, { body: "본문" })).status,
    201,
    "캐릭터가 없어도 카드는 만들어진다",
  );
  assert.deepEqual(sentBodies(before), ["본문"]);
});

test("담당자 검증 — 잠든 NPC·다른 채널 NPC 는 400 assignee_not_in_channel 이고 Hermes 를 부르지 않는다", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel({ extraProfiles: ["noah"] });
  const other = await seedKanbanChannel();
  const { setNpcActive } = await import("@/lib/npc-roster");
  await setNpcActive(seed.extras[0].npcId, false);

  const before = server.requests().length;
  for (const assignee of [seed.extras[0].npcId, other.npcId, "no-such-npc"]) {
    const res = await createTask(routes, seed.ownerId, seed.channelId, { assignee });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.code, "assignee_not_in_channel");
  }
  assert.equal(
    server
      .requests()
      .slice(before)
      .filter((r) => r.method === "POST").length,
    0,
    "검증 실패는 플러그인에 닿기 전에 끝난다",
  );
  assert.deepEqual(polled, []);

  // 담당 없이 만들면 Hermes 규칙대로(triage) — 여기서는 상태를 재해석하지 않는다.
  const none = await createTask(routes, seed.ownerId, seed.channelId, { title: "담당 없음" });
  assert.equal(none.status, 201);
  assert.equal(none.body.task.assignee, undefined);
});

test("title 없는 생성은 400 이고, Hermes 400/404 는 상태 코드와 {code, message} 그대로", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();

  const missing = await routes.tasks.POST(
    req(seed.ownerId, "POST", `${base(seed.channelId)}/tasks`, { body: "제목 없음" }),
    ctx(seed.channelId),
  );
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).code, "invalid_body");

  // 없는 부모 → 플러그인 404 unknown_parent 그대로.
  const bad = await createTask(routes, seed.ownerId, seed.channelId, { parents: ["ghost"] });
  assert.equal(bad.status, 404);
  assert.equal(bad.body.code, "unknown_parent");
  assert.equal(typeof bad.body.message, "string");
  assert.deepEqual(polled, [], "실패한 생성은 폴링하지 않는다");

  // 잘못된 상태 → 플러그인 400 invalid_status 그대로.
  const created = await createTask(routes, seed.ownerId, seed.channelId);
  const patched = await routes.task.PATCH(
    req(seed.ownerId, "PATCH", `${base(seed.channelId)}/tasks/${created.body.task.id}`, {
      status: "flying",
    }),
    ctx(seed.channelId, created.body.task.id),
  );
  assert.equal(patched.status, 400);
  assert.equal((await patched.json()).code, "invalid_status");
});

test("상세·PATCH·삭제·댓글·링크·로그·dispatch — 멤버 누구나, 변경 뒤 즉시 폴링", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel({ extraProfiles: ["noah"] });
  const member = await seedUser("member");
  await addMember(seed.channelId, member.id);

  const parent = await createTask(routes, member.id, seed.channelId, { title: "부모" });
  const child = await createTask(routes, member.id, seed.channelId, { title: "자식" });
  const parentId = parent.body.task.id as string;
  const childId = child.body.task.id as string;
  polled = [];

  // PATCH — status 와 assignee(npcId → profile). status 변경 뒤 dispatch 한 번.
  const before = server.requests().length;
  const patched = await routes.task.PATCH(
    req(member.id, "PATCH", `${base(seed.channelId)}/tasks/${childId}`, {
      status: "ready",
      assignee: seed.extras[0].npcId,
      title: "자식(수정)",
    }),
    ctx(seed.channelId, childId),
  );
  assert.equal(patched.status, 200, JSON.stringify(await patched.clone().json()));
  const patchedBody = await patched.json();
  assert.equal(patchedBody.task.assignee, "noah");
  assert.equal(patchedBody.task.title, "자식(수정)");
  // 가짜 서버의 dispatch 는 ready 카드를 running 으로 띄운다.
  assert.equal(dispatchCalls(before).length, 1);
  assert.deepEqual(polled, [seed.channelId]);

  // title 만 고치면 dispatch 는 없다(상태 변경이 아니다).
  const before2 = server.requests().length;
  const renamed = await routes.task.PATCH(
    req(member.id, "PATCH", `${base(seed.channelId)}/tasks/${parentId}`, { title: "부모2" }),
    ctx(seed.channelId, parentId),
  );
  assert.equal(renamed.status, 200);
  assert.equal(dispatchCalls(before2).length, 0);

  // 댓글 — author 는 deskrpg:<닉네임>.
  const { db, users } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const [memberRow] = await db.select().from(users).where(eq(users.id, member.id));
  const commented = await routes.comments.POST(
    req(member.id, "POST", `${base(seed.channelId)}/tasks/${childId}/comments`, {
      body: "잘 부탁해",
    }),
    ctx(seed.channelId, childId),
  );
  assert.equal(commented.status, 201);
  assert.equal((await commented.json()).comment.author, `deskrpg:${memberRow.nickname}`);

  // 링크 추가/삭제
  const linked = await routes.links.POST(
    req(member.id, "POST", `${base(seed.channelId)}/links`, {
      parent_id: parentId,
      child_id: childId,
    }),
    ctx(seed.channelId),
  );
  assert.equal(linked.status, 200);
  const detail = await routes.task.GET(
    req(member.id, "GET", `${base(seed.channelId)}/tasks/${childId}`),
    ctx(seed.channelId, childId),
  );
  assert.equal(detail.status, 200);
  const detailBody = await detail.json();
  assert.deepEqual(detailBody.links.parents, [parentId]);
  assert.equal(detailBody.comments.length, 1);
  const unlinked = await routes.links.DELETE(
    req(member.id, "DELETE", `${base(seed.channelId)}/links`, {
      parent_id: parentId,
      child_id: childId,
    }),
    ctx(seed.channelId),
  );
  assert.equal(unlinked.status, 200);

  // 로그 tail
  server.setTaskLog(seed.boardSlug, childId, "a\nb\nc\n");
  const log = await routes.log.GET(
    req(member.id, "GET", `${base(seed.channelId)}/tasks/${childId}/log?tail=1`),
    ctx(seed.channelId, childId),
  );
  assert.equal(log.status, 200);
  const logBody = await log.json();
  assert.equal(logBody.content, "c\n");
  assert.equal(logBody.truncated, true);

  // 명시적 dispatch
  const dispatched = await routes.dispatch.POST(
    req(member.id, "POST", `${base(seed.channelId)}/dispatch`),
    ctx(seed.channelId),
  );
  assert.equal(dispatched.status, 200);
  assert.ok(Array.isArray((await dispatched.json()).spawned));

  // 삭제
  const deleted = await routes.task.DELETE(
    req(member.id, "DELETE", `${base(seed.channelId)}/tasks/${parentId}`),
    ctx(seed.channelId, parentId),
  );
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { ok: true });
  const gone = await routes.task.GET(
    req(member.id, "GET", `${base(seed.channelId)}/tasks/${parentId}`),
    ctx(seed.channelId, parentId),
  );
  assert.equal(gone.status, 404);

  // 모든 변경이 즉시 폴링을 요청했다: PATCH×2, 댓글, 링크×2, dispatch, 삭제.
  assert.equal(polled.length, 7);
  assert.ok(polled.every((id) => id === seed.channelId));
});

test("dispatch — max 쿼리를 넘기면 플러그인 호출에 실린다, 무인자면 안 실린다", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();
  const member = await seedUser("member");
  await addMember(seed.channelId, member.id);

  const before = server.requests().length;
  const withMax = await routes.dispatch.POST(
    req(member.id, "POST", `${base(seed.channelId)}/dispatch?max=3`),
    ctx(seed.channelId),
  );
  assert.equal(withMax.status, 200);
  const maxCalls = dispatchCalls(before);
  assert.equal(maxCalls.length, 1);
  assert.match(maxCalls[0].path, /[?&]max=3(&|$)/);

  const before2 = server.requests().length;
  const noMax = await routes.dispatch.POST(
    req(member.id, "POST", `${base(seed.channelId)}/dispatch`),
    ctx(seed.channelId),
  );
  assert.equal(noMax.status, 200);
  const noMaxCalls = dispatchCalls(before2);
  assert.equal(noMaxCalls.length, 1);
  assert.doesNotMatch(noMaxCalls[0].path, /[?&]max=/);

  // 음수·비정수는 무시한다 — max 없이 호출한다.
  const before3 = server.requests().length;
  const badMax = await routes.dispatch.POST(
    req(member.id, "POST", `${base(seed.channelId)}/dispatch?max=-1`),
    ctx(seed.channelId),
  );
  assert.equal(badMax.status, 200);
  const badMaxCalls = dispatchCalls(before3);
  assert.equal(badMaxCalls.length, 1);
  assert.doesNotMatch(badMaxCalls[0].path, /[?&]max=/);
});

test("카드 액션 — approve/request-changes/unblock/reassign/reclaim/terminate/archive/specify", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel({ extraProfiles: ["noah"] });
  const member = await seedUser("member");
  await addMember(seed.channelId, member.id);
  const created = await createTask(routes, member.id, seed.channelId, { assignee: seed.npcId });
  const taskId = created.body.task.id as string;
  const url = (action: string) => `${base(seed.channelId)}/tasks/${taskId}/${action}`;

  // reassign — {npcId} → {profile, reclaim_first:true}; 잠든/다른 채널 NPC 는 400.
  const before = server.requests().length;
  const reassigned = await routes.reassign.POST(
    req(member.id, "POST", url("reassign"), { npcId: seed.extras[0].npcId }),
    ctx(seed.channelId, taskId),
  );
  assert.equal(reassigned.status, 200, JSON.stringify(await reassigned.clone().json()));
  assert.equal((await reassigned.json()).task.assignee, "noah");
  const sent = server
    .requests()
    .slice(before)
    .find((r) => r.path.startsWith(`/deskrpg/kanban/tasks/${taskId}/reassign`));
  assert.ok(sent);
  assert.deepEqual(sent.json, { profile: "noah", reclaim_first: true });
  assert.equal(dispatchCalls(before).length, 1);

  const other = await seedKanbanChannel();
  const badReassign = await routes.reassign.POST(
    req(member.id, "POST", url("reassign"), { npcId: other.npcId }),
    ctx(seed.channelId, taskId),
  );
  assert.equal(badReassign.status, 400);
  assert.equal((await badReassign.json()).code, "assignee_not_in_channel");

  // request-changes 는 comment 필수.
  const noComment = await routes.requestChanges.POST(
    req(member.id, "POST", url("request-changes"), {}),
    ctx(seed.channelId, taskId),
  );
  assert.equal(noComment.status, 400);
  assert.equal((await noComment.json()).code, "invalid_body");
  const changes = await routes.requestChanges.POST(
    req(member.id, "POST", url("request-changes"), { comment: "다시" }),
    ctx(seed.channelId, taskId),
  );
  assert.equal(changes.status, 200);

  const unblocked = await routes.unblock.POST(
    req(member.id, "POST", url("unblock"), { comment: "풀었다" }),
    ctx(seed.channelId, taskId),
  );
  assert.equal(unblocked.status, 200);
  assert.equal((await unblocked.json()).task.status, "ready");

  const reclaimed = await routes.reclaim.POST(
    req(member.id, "POST", url("reclaim"), {}),
    ctx(seed.channelId, taskId),
  );
  assert.equal(reclaimed.status, 200);

  const terminated = await routes.terminate.POST(
    req(member.id, "POST", url("terminate"), {}),
    ctx(seed.channelId, taskId),
  );
  assert.equal(terminated.status, 200);
  assert.equal((await terminated.json()).task.status, "blocked");

  const specified = await routes.specify.POST(
    req(member.id, "POST", url("specify"), {}),
    ctx(seed.channelId, taskId),
  );
  assert.equal(specified.status, 200);

  const approved = await routes.approve.POST(
    req(member.id, "POST", url("approve"), {}),
    ctx(seed.channelId, taskId),
  );
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).task.status, "done");

  const archived = await routes.archive.POST(
    req(member.id, "POST", url("archive"), {}),
    ctx(seed.channelId, taskId),
  );
  assert.equal(archived.status, 200);
  assert.equal((await archived.json()).task.status, "archived");

  // 비멤버는 어떤 액션도 못 한다.
  const stranger = await seedUser("stranger");
  const denied = await routes.approve.POST(
    req(stranger.id, "POST", url("approve"), {}),
    ctx(seed.channelId, taskId),
  );
  assert.equal(denied.status, 403);
});

test("첨부 — 목록·업로드·조회·삭제; 플러그인이 지원하지 않으면 404 attachments_unsupported", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();
  const created = await createTask(routes, seed.ownerId, seed.channelId);
  const taskId = created.body.task.id as string;

  const form = new FormData();
  form.append("file", new Blob(["hello"]), "hello.txt");
  const uploaded = await routes.taskAttachments.POST(
    new NextRequest(`${base(seed.channelId)}/tasks/${taskId}/attachments`, {
      method: "POST",
      headers: { "x-user-id": seed.ownerId },
      body: form,
    }),
    ctx(seed.channelId, taskId),
  );
  assert.equal(uploaded.status, 201, JSON.stringify(await uploaded.clone().json()));
  const attachment = (await uploaded.json()).attachment;
  assert.equal(attachment.filename, "hello.txt");
  assert.equal(attachment.size, 5);

  const listed = await routes.taskAttachments.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/tasks/${taskId}/attachments`),
    ctx(seed.channelId, taskId),
  );
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).attachments.length, 1);

  const fetched = await routes.attachment.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/attachments/${attachment.id}`),
    ctx(seed.channelId, "", attachment.id),
  );
  assert.equal(fetched.status, 200);
  assert.equal(await fetched.text(), "hello");
  assert.match(fetched.headers.get("content-disposition") ?? "", /attachment/);
  assert.equal(fetched.headers.get("content-security-policy"), "sandbox");
  assert.equal(fetched.headers.get("x-content-type-options"), "nosniff");

  const removed = await routes.attachment.DELETE(
    req(seed.ownerId, "DELETE", `${base(seed.channelId)}/attachments/${attachment.id}`),
    ctx(seed.channelId, "", attachment.id),
  );
  assert.equal(removed.status, 200);

  // 플러그인이 첨부를 지원하지 않는다고 하면 — 캐시를 갱신시켜 라우트가 그것을 보게 한다.
  server.setInfo({ kanban: { dispatcher_present: true, attachments: false } });
  try {
    const { db, gatewayResources } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    await db
      .update(gatewayResources)
      .set({ pluginCheckedAt: null, pluginInfoJson: null })
      .where(eq(gatewayResources.id, seed.gatewayId));
    const before = server.requests().length;
    const unsupported = await routes.taskAttachments.GET(
      req(seed.ownerId, "GET", `${base(seed.channelId)}/tasks/${taskId}/attachments`),
      ctx(seed.channelId, taskId),
    );
    assert.equal(unsupported.status, 404);
    assert.equal((await unsupported.json()).code, "attachments_unsupported");
    assert.equal(
      server
        .requests()
        .slice(before)
        .filter((r) => r.path.includes("/attachments")).length,
      0,
      "지원하지 않으면 Hermes 첨부 경로를 부르지 않는다",
    );
  } finally {
    server.setInfo({ kanban: { dispatcher_present: true, attachments: true } });
  }
});

test("첨부 — HTML 업로드도 항상 attachment 로 내려받고 CSP sandbox·nosniff 를 강제한다", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();
  const created = await createTask(routes, seed.ownerId, seed.channelId);
  const taskId = created.body.task.id as string;

  const form = new FormData();
  form.append("file", new Blob(["<script>alert(1)</script>"]), "a.html");
  const uploaded = await routes.taskAttachments.POST(
    new NextRequest(`${base(seed.channelId)}/tasks/${taskId}/attachments`, {
      method: "POST",
      headers: { "x-user-id": seed.ownerId },
      body: form,
    }),
    ctx(seed.channelId, taskId),
  );
  assert.equal(uploaded.status, 201, JSON.stringify(await uploaded.clone().json()));
  const attachment = (await uploaded.json()).attachment;

  const fetched = await routes.attachment.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/attachments/${attachment.id}`),
    ctx(seed.channelId, "", attachment.id),
  );
  assert.equal(fetched.status, 200);
  assert.match(fetched.headers.get("content-disposition") ?? "", /^attachment/);
  assert.equal(fetched.headers.get("content-security-policy"), "sandbox");
  assert.equal(fetched.headers.get("x-content-type-options"), "nosniff");
});

test("설정 — 멤버는 orchestration:null, 채널 소유자는 보드 폴더 편집, 게이트웨이 소유자는 운영 설정 편집", async () => {
  server.reset();
  const routes = await loadRoutes();
  const gatewayOwner = await seedUser("gateway-owner");
  const seed = await seedKanbanChannel({ gatewayOwnerId: gatewayOwner.id });
  await addMember(seed.channelId, gatewayOwner.id);
  const member = await seedUser("member");
  await addMember(seed.channelId, member.id);

  // 멤버: 보드는 보이되 editable=false, orchestration 은 null.
  const asMember = await routes.settings.GET(
    req(member.id, "GET", `${base(seed.channelId)}/settings`),
    ctx(seed.channelId),
  );
  assert.equal(asMember.status, 200, JSON.stringify(await asMember.clone().json()));
  const memberBody = await asMember.json();
  assert.equal(memberBody.board.slug, seed.boardSlug);
  assert.equal(memberBody.board.name, "칸반 채널");
  assert.equal(memberBody.board.editable, false);
  assert.equal(memberBody.orchestration, null);
  assert.deepEqual(memberBody.hints, { default_assignee_recommend_empty: true });

  // 채널 소유자: 보드 editable, orchestration 은 보이지만 editable=false(게이트웨이 소유자가 아니다).
  const asOwner = await routes.settings.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/settings`),
    ctx(seed.channelId),
  );
  const ownerBody = await asOwner.json();
  assert.equal(ownerBody.board.editable, true);
  assert.equal(ownerBody.orchestration.editable, false);
  assert.equal(typeof ownerBody.orchestration.auto_decompose, "boolean");

  // 멤버가 보드 폴더를 고치면 403 settings_forbidden — Hermes 를 부르기 전에.
  const before = server.requests().length;
  const memberPatch = await routes.settings.PATCH(
    req(member.id, "PATCH", `${base(seed.channelId)}/settings`, {
      board: { default_workdir: "/tmp/x" },
    }),
    ctx(seed.channelId),
  );
  assert.equal(memberPatch.status, 403);
  assert.equal((await memberPatch.json()).code, "settings_forbidden");
  assert.equal(
    server
      .requests()
      .slice(before)
      .filter((r) => r.method === "PATCH" || r.method === "PUT").length,
    0,
  );

  // 채널 소유자가 운영 설정을 고치면 403(게이트웨이 소유자가 아니다).
  const ownerPatchOrch = await routes.settings.PATCH(
    req(seed.ownerId, "PATCH", `${base(seed.channelId)}/settings`, {
      orchestration: { auto_decompose: true },
    }),
    ctx(seed.channelId),
  );
  assert.equal(ownerPatchOrch.status, 403);
  assert.equal((await ownerPatchOrch.json()).code, "settings_forbidden");

  // 채널 소유자의 보드 폴더 변경은 된다.
  const ownerPatch = await routes.settings.PATCH(
    req(seed.ownerId, "PATCH", `${base(seed.channelId)}/settings`, {
      board: { default_workdir: "/srv/work" },
    }),
    ctx(seed.channelId),
  );
  assert.equal(ownerPatch.status, 200, JSON.stringify(await ownerPatch.clone().json()));
  assert.equal((await ownerPatch.json()).board.default_workdir, "/srv/work");

  // 게이트웨이 소유자(멤버)는 운영 설정을 고칠 수 있다.
  const gwPatch = await routes.settings.PATCH(
    req(gatewayOwner.id, "PATCH", `${base(seed.channelId)}/settings`, {
      orchestration: { auto_decompose: true, max_in_progress: 3 },
    }),
    ctx(seed.channelId),
  );
  assert.equal(gwPatch.status, 200, JSON.stringify(await gwPatch.clone().json()));
  const gwBody = await gwPatch.json();
  assert.equal(gwBody.orchestration.auto_decompose, true);
  assert.equal(gwBody.orchestration.max_in_progress, 3);
  assert.equal(gwBody.orchestration.editable, true);

  // 비멤버는 설정도 못 본다.
  const stranger = await seedUser("stranger");
  const denied = await routes.settings.GET(
    req(stranger.id, "GET", `${base(seed.channelId)}/settings`),
    ctx(seed.channelId),
  );
  assert.equal(denied.status, 403);
});

test("자동화 상태 — 멤버에게 플러그인·보드·폴링·작업 중 요약", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();
  const member = await seedUser("member");
  await addMember(seed.channelId, member.id);

  const res = await routes.status.GET(
    req(member.id, "GET", `http://localhost/api/channels/${seed.channelId}/automation/status`),
    ctx(seed.channelId),
  );
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const body = await res.json();
  assert.equal(body.pluginStatus, "plugin_ready");
  assert.equal(body.pluginVersion, "0.6.0");
  assert.deepEqual(body.capabilities, [
    "kanban",
    "cron",
    "events",
    "swarm",
    "kanban_views",
    "initial_status",
    "kanban_review_policy_v1",
  ]);
  assert.equal(body.timezone, "Asia/Seoul");
  assert.equal(body.boardSlug, seed.boardSlug);
  assert.equal(body.dispatcherPresent, true);
  assert.equal(body.attachments, true);
  assert.equal(body.minVersion, "0.6.0");
  assert.ok("lastPolledAt" in body);
  assert.equal(body.lastError, null);
  assert.deepEqual(body.working, []);

  const stranger = await seedUser("stranger");
  const denied = await routes.status.GET(
    req(stranger.id, "GET", `http://localhost/api/channels/${seed.channelId}/automation/status`),
    ctx(seed.channelId),
  );
  assert.equal(denied.status, 403);

  // 묶이지 않은 채널은 409.
  const owner = await seedUser("unbound-owner");
  const channel = await seedChannel(owner.id);
  const unbound = await routes.status.GET(
    req(owner.id, "GET", `http://localhost/api/channels/${channel.id}/automation/status`),
    ctx(channel.id),
  );
  assert.equal(unbound.status, 409);
  assert.equal((await unbound.json()).code, "gateway_not_bound");
});

test("크론 변경도 즉시 폴링을 요청한다", async () => {
  server.reset();
  const routes = await import("./[id]/cron/jobs/route");
  const jobRoute = await import("./[id]/cron/jobs/[jobId]/route");
  const seed = await seedKanbanChannel();
  const created = await routes.POST(
    req(seed.ownerId, "POST", `http://localhost/api/channels/${seed.channelId}/cron/jobs`, {
      npcId: seed.npcId,
      name: "아침",
      prompt: "요약",
      schedule: "daily at 09:00",
    }),
    { params: Promise.resolve({ id: seed.channelId }) },
  );
  assert.equal(created.status, 201);
  const jobId = (await created.json()).job.id;
  const deleted = await jobRoute.DELETE(
    req(
      seed.ownerId,
      "DELETE",
      `http://localhost/api/channels/${seed.channelId}/cron/jobs/${jobId}?npcId=${seed.npcId}`,
    ),
    { params: Promise.resolve({ id: seed.channelId, jobId }) },
  );
  assert.equal(deleted.status, 200);
  assert.deepEqual(polled, [seed.channelId, seed.channelId]);
});

test("첨부 — '.'·'..'·'a/b' 같은 id 는 플러그인을 부르기 전에 404 attachment_not_found", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();
  for (const bad of [".", "..", "a/b", "", "x".repeat(129)]) {
    const before = server.requests().length;
    const got = await routes.attachment.GET(
      req(seed.ownerId, "GET", `${base(seed.channelId)}/attachments/x`),
      ctx(seed.channelId, "", bad),
    );
    const removed = await routes.attachment.DELETE(
      req(seed.ownerId, "DELETE", `${base(seed.channelId)}/attachments/x`),
      ctx(seed.channelId, "", bad),
    );
    for (const res of [got, removed]) {
      assert.equal(res.status, 404, `id ${JSON.stringify(bad)}`);
      assert.equal((await res.json()).code, "attachment_not_found");
    }
    assert.equal(
      server
        .requests()
        .slice(before)
        .filter((r) => r.path.includes("/kanban/")).length,
      0,
      `id ${JSON.stringify(bad)} 로 칸반 경로를 부르지 않는다`,
    );
  }
});

// ---------------------------------------------------------------------------
// `?board=` — 채널이 보드를 여러 개 갖는다(설계 2026-09-21 project-registry)
//
// 보드 응답에는 slug 가 실리지 않으므로 "어느 보드를 봤는가" 는 **그 보드의 카드**로 가린다.
// ---------------------------------------------------------------------------

/** 이 채널에 보드를 하나 더 붙이고 그 slug 를 돌려준다. 사건 수신 보드는 첫 보드 그대로다. */
async function addSecondBoard(channelId: string): Promise<string> {
  const { ensureChannelBoard, newChannelBoardSlug } = await import("@/lib/kanban-boards");
  const slug = newChannelBoardSlug(channelId);
  const ensured = await ensureChannelBoard(channelId, undefined, slug);
  assert.ok(ensured.ok, `둘째 보드 확보 실패: ${ensured.ok ? "" : ensured.code}`);
  return slug;
}

/** 그 보드에 보이는 카드 제목들. `board` 가 없으면 기본(사건 수신) 보드를 본다. */
async function boardTitles(
  routes: Routes,
  userId: string,
  channelId: string,
  board?: string,
): Promise<string[]> {
  const url = `${base(channelId)}/board${board ? `?board=${board}` : ""}`;
  const res = await routes.board.GET(req(userId, "GET", url), ctx(channelId));
  assert.equal(res.status, 200, await res.clone().text());
  const body = (await res.json()) as { columns: { tasks: { title: string }[] }[] };
  return body.columns.flatMap((c) => c.tasks.map((t) => t.title)).sort();
}

async function createOn(
  routes: Routes,
  userId: string,
  channelId: string,
  title: string,
  board?: string,
) {
  const url = `${base(channelId)}/tasks${board ? `?board=${board}` : ""}`;
  return routes.tasks.POST(req(userId, "POST", url, { title }), ctx(channelId));
}

test("?board= 없이 부르면 사건 수신 보드를 쓴다 — 옛 클라이언트의 뜻이 바뀌지 않는다", async () => {
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();
  const second = await addSecondBoard(seed.channelId);

  assert.equal((await createOn(routes, seed.ownerId, seed.channelId, "첫 보드 카드")).status, 201);
  assert.equal(
    (await createOn(routes, seed.ownerId, seed.channelId, "둘째 보드 카드", second)).status,
    201,
  );

  assert.deepEqual(await boardTitles(routes, seed.ownerId, seed.channelId), ["첫 보드 카드"]);
});

test("두 보드의 카드는 서로 섞이지 않는다", async () => {
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();
  const second = await addSecondBoard(seed.channelId);

  await createOn(routes, seed.ownerId, seed.channelId, "첫 보드 카드");
  await createOn(routes, seed.ownerId, seed.channelId, "둘째 보드 카드", second);

  assert.deepEqual(await boardTitles(routes, seed.ownerId, seed.channelId), ["첫 보드 카드"]);
  assert.deepEqual(await boardTitles(routes, seed.ownerId, seed.channelId, second), [
    "둘째 보드 카드",
  ]);
});

test("다른 채널의 보드는 slug 를 알아도 404 다", async () => {
  const routes = await loadRoutes();
  const mine = await seedKanbanChannel();
  const theirs = await seedKanbanChannel();

  const res = await routes.board.GET(
    req(mine.ownerId, "GET", `${base(mine.channelId)}/board?board=${theirs.boardSlug}`),
    ctx(mine.channelId),
  );
  assert.equal(res.status, 404, "남의 보드가 열렸습니다");
  assert.equal(((await res.json()) as { code?: string }).code, "board_not_bound");
});

test("남의 보드로 카드를 만들려 해도 404 이고 카드가 생기지 않는다", async () => {
  const routes = await loadRoutes();
  const mine = await seedKanbanChannel();
  const theirs = await seedKanbanChannel();

  const res = await createOn(
    routes,
    mine.ownerId,
    mine.channelId,
    "남의 보드에 쓰기",
    theirs.boardSlug,
  );
  assert.equal(res.status, 404);
  assert.deepEqual(
    await boardTitles(routes, theirs.ownerId, theirs.channelId),
    [],
    "남의 보드에 카드가 들어갔습니다",
  );
});

test("형식이 아닌 board 값은 400 이고 Hermes 를 부르지 않는다", async () => {
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();
  const res = await routes.board.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/board?board=${encodeURIComponent("../etc")}`),
    ctx(seed.channelId),
  );
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code?: string }).code, "invalid_board");
});

test("빈 board 값은 지정하지 않은 것과 같다", async () => {
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();
  await createOn(routes, seed.ownerId, seed.channelId, "기본 카드");
  const res = await routes.board.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/board?board=`),
    ctx(seed.channelId),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { columns: { tasks: { title: string }[] }[] };
  assert.deepEqual(
    body.columns.flatMap((c) => c.tasks.map((t) => t.title)),
    ["기본 카드"],
  );
});

test("채널에 보드가 여럿이어도 사건 수신 보드는 하나뿐이다", async () => {
  const seed = await seedKanbanChannel();
  await addSecondBoard(seed.channelId);
  await addSecondBoard(seed.channelId);

  const { listChannelBoards } = await import("@/lib/kanban-boards");
  const rows = await listChannelBoards(seed.channelId);
  assert.equal(rows.length, 3);
  assert.equal(
    rows.filter((r) => r.isEventCarrier).length,
    1,
    "사건 수신 보드가 하나가 아니면 크론 사건이 중복 소비됩니다",
  );
  assert.equal(rows.find((r) => r.isEventCarrier)?.boardSlug, seed.boardSlug);
});

// ---------------------------------------------------------------------------
// 묶음 조회 (capability kanban_views) — 목록 트리·실적 타임라인이 쓴다
// ---------------------------------------------------------------------------

test("GET /kanban/links 는 보드 전체의 부모·자식 쌍을 준다", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();
  const parent = await createTask(routes, seed.ownerId, seed.channelId, { title: "부모" });
  const child = await createTask(routes, seed.ownerId, seed.channelId, { title: "자식" });
  const linked = await routes.links.POST(
    req(seed.ownerId, "POST", `${base(seed.channelId)}/links`, {
      parent_id: parent.body.task.id,
      child_id: child.body.task.id,
    }),
    ctx(seed.channelId),
  );
  assert.equal(linked.status, 200, JSON.stringify(await linked.clone().json()));

  const res = await routes.links.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/links`),
    ctx(seed.channelId),
  );
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const body = await res.json();
  assert.deepEqual(
    body.links.map((l: { parent_id: string; child_id: string }) => [l.parent_id, l.child_id]),
    [[parent.body.task.id, child.body.task.id]],
  );
});

test("GET /kanban/runs 는 창과 잘림 여부를 함께 준다", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();

  const res = await routes.runs.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/runs?from=0&to=9999`),
    ctx(seed.channelId),
  );
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const body = await res.json();
  assert.deepEqual(body.window, { from: 0, to: 9999 });
  // 잘렸는지를 화면이 알아야 한다 — 잘린 창을 그대로 그리면 "아무도 일하지 않았다" 로 읽힌다.
  assert.equal(body.truncated, false);
  assert.ok(Array.isArray(body.runs));
});

test("GET /kanban/runs 의 잘못된 쿼리는 플러그인 판정을 그대로 전달한다", async () => {
  // 검증을 REST 계층에서 한 번 더 하면 두 곳의 규칙이 갈린다.
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();

  const res = await routes.runs.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/runs?from=2000&to=1000`),
    ctx(seed.channelId),
  );
  assert.equal(res.status, 400);
});

test("묶음 조회도 비멤버는 403", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();
  const stranger = await seedUser("stranger-views");

  for (const call of [
    () =>
      routes.links.GET(
        req(stranger.id, "GET", `${base(seed.channelId)}/links`),
        ctx(seed.channelId),
      ),
    () =>
      routes.runs.GET(req(stranger.id, "GET", `${base(seed.channelId)}/runs`), ctx(seed.channelId)),
  ]) {
    assert.equal((await call()).status, 403);
  }
});

// ---------------------------------------------------------------------------
// 카드 제안 해소 (T7)
// ---------------------------------------------------------------------------

/** 제안 알림 한 줄을 그 채널의 사무실 방에 심고, 플러그인에도 같은 제안을 등록한다. */
async function seedProposal(
  seed: { channelId: string; ownerId: string; npcId: string },
  proposalId = "cp_1",
  overrides: Record<string, unknown> = {},
) {
  const { ensureOfficeRoom } = await import("@/lib/chat-rooms");
  const { db, chatRoomMessages } = await import("@/db");
  const room = await ensureOfficeRoom(seed.channelId, seed.ownerId);
  const notice = {
    kind: "card_proposal",
    proposalId,
    title: "청구서 정리",
    summary: "세 단계짜리 일입니다",
    body: "본문",
    acceptance: "표로 정리",
    npcId: seed.npcId,
    npcName: "소피",
    ...overrides,
  };
  const [row] = await db
    .insert(chatRoomMessages)
    .values({
      roomId: room.id,
      senderKind: "npc",
      senderName: "소피",
      content: "청구서 정리",
      noticeJson: JSON.stringify(notice),
    })
    .returning();
  server.seedCardProposal(proposalId);
  return { messageId: row.id, roomId: room.id, proposalId };
}

async function readNotice(messageId: string) {
  const { db, chatRoomMessages } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const [row] = await db
    .select({ noticeJson: chatRoomMessages.noticeJson })
    .from(chatRoomMessages)
    .where(eq(chatRoomMessages.id, messageId))
    .limit(1);
  const { parseRoomNotice } = await import("@/lib/chat-rooms-policy");
  return parseRoomNotice(row.noticeJson);
}

function proposalCtx(id: string, proposalId: string) {
  return { params: Promise.resolve({ id, proposalId }) };
}

function resolveReq(userId: string, channelId: string, proposalId: string, body: unknown) {
  return req(
    userId,
    "POST",
    `${base(channelId)}/proposals/${encodeURIComponent(proposalId)}/resolve`,
    body,
  );
}

test("제안 해소 — 비멤버 403, 로그인 없음 401, 잘못된 choice 400", async () => {
  server.reset();
  const route = await import("./[id]/kanban/proposals/[proposalId]/resolve/route");
  const seed = await seedKanbanChannel();
  const proposal = await seedProposal(seed);
  const stranger = await seedUser("proposal-stranger");

  const forbidden = await route.POST(
    resolveReq(stranger.id, seed.channelId, proposal.proposalId, { choice: "card" }),
    proposalCtx(seed.channelId, proposal.proposalId),
  );
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).code, "not_a_member");

  const anonymous = await route.POST(
    new NextRequest(`${base(seed.channelId)}/proposals/${proposal.proposalId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ choice: "card" }),
    }),
    proposalCtx(seed.channelId, proposal.proposalId),
  );
  assert.equal(anonymous.status, 401);

  const bad = await route.POST(
    resolveReq(seed.ownerId, seed.channelId, proposal.proposalId, { choice: "무엇" }),
    proposalCtx(seed.channelId, proposal.proposalId),
  );
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, "invalid_field");

  // 어느 갈래도 플러그인의 제안을 건드리지 않았다.
  assert.equal(server.cardProposal(proposal.proposalId)?.resolvedChoice, null);
  const untouched = await readNotice(proposal.messageId);
  assert.equal(untouched?.kind === "card_proposal" ? untouched.resolved : "gone", undefined);
});

test("제안 해소 — 카드 갈래는 카드를 만들고 알림에 결정을 쓴다, 둘째 호출은 409", async () => {
  server.reset();
  const route = await import("./[id]/kanban/proposals/[proposalId]/resolve/route");
  const seed = await seedKanbanChannel();
  const member = await seedUser("proposal-member");
  await addMember(seed.channelId, member.id);
  const proposal = await seedProposal(seed);

  const before = server.requests().length;
  const ok = await route.POST(
    resolveReq(member.id, seed.channelId, proposal.proposalId, { choice: "card" }),
    proposalCtx(seed.channelId, proposal.proposalId),
  );
  assert.equal(ok.status, 200, JSON.stringify(await ok.clone().json()));
  const body = await ok.json();
  assert.equal(body.choice, "card");
  assert.equal(body.assigneeDropped, false);
  assert.ok(body.taskId);

  // 카드는 담당(profile_name)까지 붙어 만들어졌고, 완료 조건은 본문에 실렸다.
  const created = server
    .requests()
    .slice(before)
    .find((r) => r.method === "POST" && r.path.startsWith("/deskrpg/kanban/tasks"));
  const sent = created?.json as Record<string, unknown>;
  assert.equal(sent.title, "청구서 정리");
  assert.equal(sent.assignee, "sophie");
  assert.match(String(sent.body), /본문[\s\S]*표로 정리/);

  // 알림에 결정이 남는다 → 화면의 버튼이 사라지는 근거.
  const notice = await readNotice(proposal.messageId);
  assert.equal(notice?.kind, "card_proposal");
  assert.deepEqual(
    notice?.kind === "card_proposal" && notice.resolved
      ? { choice: notice.resolved.choice, by: notice.resolved.by, taskId: notice.resolved.taskId }
      : null,
    { choice: "card", by: member.id, taskId: body.taskId },
  );

  // dispatch 한 번 + 즉시 폴링.
  assert.equal(dispatchCalls(before).length, 1);
  assert.deepEqual(polled, [seed.channelId]);

  // 두 번째 해소는 409 — 카드는 하나뿐이다.
  const again = await route.POST(
    resolveReq(member.id, seed.channelId, proposal.proposalId, { choice: "card" }),
    proposalCtx(seed.channelId, proposal.proposalId),
  );
  assert.equal(again.status, 409);
  assert.equal((await again.json()).code, "already_resolved");
  const tasks = server
    .requests()
    .slice(before)
    .filter((r) => r.method === "POST" && r.path.startsWith("/deskrpg/kanban/tasks"));
  assert.equal(tasks.length, 1);
});

test("제안 해소 — inline 갈래는 카드를 만들지 않는다", async () => {
  server.reset();
  const route = await import("./[id]/kanban/proposals/[proposalId]/resolve/route");
  const seed = await seedKanbanChannel();
  const proposal = await seedProposal(seed, "cp_inline");

  const before = server.requests().length;
  const res = await route.POST(
    resolveReq(seed.ownerId, seed.channelId, proposal.proposalId, { choice: "inline" }),
    proposalCtx(seed.channelId, proposal.proposalId),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { choice: "inline" });
  assert.equal(
    server
      .requests()
      .slice(before)
      .filter((r) => r.method === "POST" && r.path.startsWith("/deskrpg/kanban/tasks")).length,
    0,
  );
  const notice = await readNotice(proposal.messageId);
  assert.equal(notice?.kind === "card_proposal" ? notice.resolved?.choice : null, "inline");
});

test("제안 해소 — 없는 제안은 404, 플러그인을 부르지 않는다", async () => {
  server.reset();
  const route = await import("./[id]/kanban/proposals/[proposalId]/resolve/route");
  const seed = await seedKanbanChannel();
  const before = server.requests().length;
  const res = await route.POST(
    resolveReq(seed.ownerId, seed.channelId, "cp_missing", { choice: "card" }),
    proposalCtx(seed.channelId, "cp_missing"),
  );
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, "card_proposal_not_found");
  assert.equal(
    server
      .requests()
      .slice(before)
      .filter((r) => r.path.startsWith("/deskrpg/card-proposals")).length,
    0,
  );
});

test("제안 해소 — 제안한 직원이 퇴근했으면 담당 없이 만들고 그 사실을 알린다", async () => {
  server.reset();
  const route = await import("./[id]/kanban/proposals/[proposalId]/resolve/route");
  const seed = await seedKanbanChannel();
  const proposal = await seedProposal(seed, "cp_dropped");
  const { setNpcActive } = await import("@/lib/npc-roster");
  await setNpcActive(seed.npcId, false);

  const before = server.requests().length;
  const res = await route.POST(
    resolveReq(seed.ownerId, seed.channelId, proposal.proposalId, { choice: "card" }),
    proposalCtx(seed.channelId, proposal.proposalId),
  );
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assert.equal((await res.json()).assigneeDropped, true);
  const created = server
    .requests()
    .slice(before)
    .find((r) => r.method === "POST" && r.path.startsWith("/deskrpg/kanban/tasks"));
  assert.equal((created?.json as Record<string, unknown>).assignee, undefined);
});

// ---------------------------------------------------------------------------
// 보드 전체 첨부 — 결과물 갤러리가 아티팩트 뒤에 잇는다.
//
// 워커가 만든 파일은 카드가 끝나면 scratch 와 함께 지워지고 첨부만 남는다. 갤러리가 이 목록을
// 모르면 끝난 카드의 결과물이 어디에도 안 보인다.
// ---------------------------------------------------------------------------

async function withBoardAttachmentList<T>(
  seed: { gatewayId: string },
  enabled: boolean,
  run: () => Promise<T>,
): Promise<T> {
  const caps = ["kanban", "cron", "events", "swarm", "kanban_views", "initial_status"];
  server.setInfo({ capabilities: enabled ? [...caps, "kanban_attachment_list"] : caps });
  const { db, gatewayResources } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  // 능력 캐시를 비워 라우트가 새 capability 를 보게 한다.
  await db
    .update(gatewayResources)
    .set({ pluginCheckedAt: null, pluginInfoJson: null })
    .where(eq(gatewayResources.id, seed.gatewayId));
  try {
    return await run();
  } finally {
    server.setInfo({ capabilities: caps });
  }
}

test("보드 첨부 목록 — 어느 카드의 첨부인지와 함께, 최신 것부터 준다", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();
  const created = await createTask(routes, seed.ownerId, seed.channelId);
  const taskId = created.body.task.id as string;
  const board = seed.boardSlug;
  server.seedAttachment({ board, taskId, filename: "first.md", body: "a" });
  server.seedAttachment({ board, taskId, filename: "second.md", body: "b" });

  await withBoardAttachmentList(seed, true, async () => {
    const res = await routes.boardAttachments.GET(
      req(seed.ownerId, "GET", `${base(seed.channelId)}/attachments`),
      ctx(seed.channelId),
    );
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const body = await res.json();
    assert.equal(body.supported, true);
    assert.deepEqual(
      body.attachments.map((a: { filename: string }) => a.filename),
      ["second.md", "first.md"],
    );
    assert.equal(body.attachments[0].task_id, taskId);
    assert.equal(typeof body.attachments[0].task_title, "string", "어느 카드인지 모른다");
    assert.equal(body.next_cursor, null);
  });
});

test("보드 첨부 목록 — 첨부가 없는 보드는 빈 목록이다(지원 안 함과 구별된다)", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();
  await withBoardAttachmentList(seed, true, async () => {
    const res = await routes.boardAttachments.GET(
      req(seed.ownerId, "GET", `${base(seed.channelId)}/attachments`),
      ctx(seed.channelId),
    );
    const body = await res.json();
    assert.equal(body.supported, true);
    assert.deepEqual(body.attachments, []);
  });
});

test("보드 첨부 목록 — 커서로 이어지는 두 쪽을 겹치지 않게 준다", async () => {
  server.reset();
  server.setInfo({ capabilities: ["kanban", "cron", "events", "kanban_review_policy_v1"] });
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();
  const created = await createTask(routes, seed.ownerId, seed.channelId);
  const taskId = created.body.task.id as string;
  const board = seed.boardSlug;
  for (const name of ["a.md", "b.md", "c.md"])
    server.seedAttachment({ board, taskId, filename: name, body: name });

  await withBoardAttachmentList(seed, true, async () => {
    const first = await (
      await routes.boardAttachments.GET(
        req(seed.ownerId, "GET", `${base(seed.channelId)}/attachments?limit=2`),
        ctx(seed.channelId),
      )
    ).json();
    assert.equal(first.attachments.length, 2);
    assert.ok(first.next_cursor, "다음 쪽이 있는데 커서가 없다");
    const second = await (
      await routes.boardAttachments.GET(
        req(
          seed.ownerId,
          "GET",
          `${base(seed.channelId)}/attachments?limit=2&cursor=${encodeURIComponent(first.next_cursor)}`,
        ),
        ctx(seed.channelId),
      )
    ).json();
    const names = [...first.attachments, ...second.attachments].map(
      (a: { filename: string }) => a.filename,
    );
    assert.deepEqual(names, ["c.md", "b.md", "a.md"], "쪽이 겹치거나 빠졌다");
    assert.equal(second.next_cursor, null);
  });
});

test("보드 첨부 목록 — 목록을 모르는 옛 플러그인에는 부르지 않고 supported:false 로 답한다", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();
  await withBoardAttachmentList(seed, false, async () => {
    const before = server.requests().length;
    const res = await routes.boardAttachments.GET(
      req(seed.ownerId, "GET", `${base(seed.channelId)}/attachments`),
      ctx(seed.channelId),
    );
    assert.equal(res.status, 200, "옛 플러그인이 오류가 되면 갤러리 전체가 깨진다");
    const body = await res.json();
    assert.equal(body.supported, false);
    assert.deepEqual(body.attachments, []);
    assert.equal(
      server
        .requests()
        .slice(before)
        .filter((r) => r.path === "/deskrpg/kanban/attachments").length,
      0,
      "없는 라우트를 부른다",
    );
  });
});

test("혼합 승인: 새 카드는 기본 사람 정책이고 null 정책으로 우회할 수 없다", async () => {
  server.reset();
  server.setInfo({ capabilities: ["kanban", "cron", "events", "kanban_review_policy_v1"] });
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();
  const created = await createTask(routes, seed.ownerId, seed.channelId);
  assert.equal(created.status, 201);
  const sent = server
    .requests()
    .filter((r) => r.method === "POST" && r.path.startsWith("/deskrpg/kanban/tasks?"))
    .at(-1)!;
  assert.deepEqual((sent.json as Record<string, unknown>).review_policy, {
    version: 1,
    mode: "human",
    reviewer_profile: null,
  });
  const invalid = await createTask(routes, seed.ownerId, seed.channelId, { reviewPolicy: null });
  assert.equal(invalid.status, 400);
});

test("혼합 승인: 미지원 코어는 새 카드 쓰기를 차단한다", async () => {
  server.reset();
  server.setInfo({ capabilities: ["kanban", "cron", "events"] });
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();
  const before = server.requests().length;
  const created = await createTask(routes, seed.ownerId, seed.channelId);
  assert.equal(created.status, 428);
  assert.equal(
    server
      .requests()
      .slice(before)
      .filter((r) => r.method === "POST" && r.path.startsWith("/deskrpg/kanban/tasks?")).length,
    0,
  );
});

test("혼합 승인: 다른 active 직원만 AI 검토자로 지정한다", async () => {
  server.reset();
  server.setInfo({ capabilities: ["kanban", "cron", "events", "kanban_review_policy_v1"] });
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel({ extraProfiles: ["noah"] });
  const same = await createTask(routes, seed.ownerId, seed.channelId, {
    assignee: seed.npcId,
    reviewPolicy: { mode: "agent", reviewerNpcId: seed.npcId },
  });
  assert.equal(same.status, 400);
  const valid = await createTask(routes, seed.ownerId, seed.channelId, {
    assignee: seed.npcId,
    reviewPolicy: { mode: "agent", reviewerNpcId: seed.extras[0].npcId },
  });
  assert.equal(valid.status, 201);
  const sent = server
    .requests()
    .filter((r) => r.method === "POST" && r.path.startsWith("/deskrpg/kanban/tasks?"))
    .at(-1)!;
  assert.deepEqual((sent.json as Record<string, unknown>).review_policy, {
    version: 1,
    mode: "agent",
    reviewer_profile: "noah",
  });
});

test("혼합 승인: 승인 사용자와 제출은 서버 인증과 명시한 snapshot에서만 온다", async () => {
  server.reset();
  server.setInfo({ capabilities: ["kanban", "cron", "events", "kanban_review_policy_v1"] });
  const routes = await loadRoutes();
  const seed = await seedKanbanChannel();
  const created = await createTask(routes, seed.ownerId, seed.channelId);
  const taskId = created.body.task.id;
  await routes.approve.POST(
    req(seed.ownerId, "POST", `${base(seed.channelId)}/tasks/${taskId}/approve`, {
      submission_id: "s-current",
      request_id: "attempt-1",
      actor_id: "spoof",
      actor_name: "forged-name",
    }),
    ctx(seed.channelId, taskId),
  );
  const sent = server
    .requests()
    .filter((r) => r.path.includes(`/${taskId}/approve`))
    .at(-1)!;
  assert.equal(sent.headers["x-deskrpg-user-id"], seed.ownerId);
  const { commentAuthorFor } = await import("@/lib/kanban-access");
  assert.equal(
    decodeURIComponent(sent.headers["x-deskrpg-user-name"]!),
    (await commentAuthorFor(seed.ownerId)).slice("deskrpg:".length),
  );
  assert.deepEqual(sent.json, { submission_id: "s-current", request_id: "attempt-1" });
});
