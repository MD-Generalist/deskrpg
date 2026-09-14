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
    body.npcs.map((n: Record<string, unknown>) => ({
      npcId: n.npcId,
      npcName: n.npcName,
      profileName: n.profileName,
      active: n.active,
    })),
    [
      { npcId: seed.npcId, npcName: "소피", profileName: "sophie", active: true },
      { npcId: seed.extras[0].npcId, npcName: "noah", profileName: "noah", active: false },
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
  assert.equal((await fetched.json()).id, attachment.id);

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
  assert.deepEqual(body.capabilities, ["kanban", "cron", "events"]);
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
