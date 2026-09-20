import test, { after, before } from "node:test";
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

// 프로젝트 목록표 REST (설계 2026-09-21 project-registry).
//
// 여기서 고정하는 것: 보드 = 프로젝트라는 대응, 메타 행의 지연 생성(이관 전 채널이 막히지 않게),
// 권한층(보기 = 멤버, 변경 = 채널 소유자), 테넌트 슬러그 규칙, 보관 시 사건 수신 보드 이전,
// 그리고 **이름·진행률을 우리가 저장하지 않는다**는 것(Hermes 값이 그대로 실려 나온다).
//
// `[id]` 세그먼트 밖에 둔다 — node 테스트 러너가 `[id]` 를 문자 클래스로 오인한다.
setupThrowawaySqlite("project-routes-test");

const OWNER_TOKEN = "gateway-owner-key-1234567890";

let server: FakePluginServer;

before(async () => {
  server = await startFakePluginServer({ ownerToken: OWNER_TOKEN, profileTokens: { sophie: "p" } });
  const { registerAutomationHooks } = await import("@/lib/automation-registry");
  registerAutomationHooks({
    pollNow: async () => null,
    refreshPollers: async () => {},
    getWorkingSnapshot: () => [],
    emitRoomMessage: () => {},
  });
});

after(async () => {
  const { resetAutomationHooksForTests } = await import("@/lib/automation-registry");
  resetAutomationHooksForTests();
  await server.close();
});

type Routes = {
  projects: typeof import("./[id]/projects/route");
  project: typeof import("./[id]/projects/[projectId]/route");
  archive: typeof import("./[id]/projects/[projectId]/archive/route");
  subprojects: typeof import("./[id]/projects/[projectId]/subprojects/route");
  subproject: typeof import("./[id]/projects/[projectId]/subprojects/[subprojectId]/route");
};

async function loadRoutes(): Promise<Routes> {
  return {
    projects: await import("./[id]/projects/route"),
    project: await import("./[id]/projects/[projectId]/route"),
    archive: await import("./[id]/projects/[projectId]/archive/route"),
    subprojects: await import("./[id]/projects/[projectId]/subprojects/route"),
    subproject: await import("./[id]/projects/[projectId]/subprojects/[subprojectId]/route"),
  };
}

function req(userId: string, method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: authHeaders(userId),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const base = (channelId: string) => `http://localhost/api/channels/${channelId}/projects`;
const ctx = (id: string, projectId = "", subprojectId = "") => ({
  params: Promise.resolve({ id, projectId, subprojectId }),
});

async function seedProjectChannel() {
  const owner = await seedUser("proj-owner");
  const gateway = await seedGateway(owner.id, server.baseUrl);
  const channel = await seedChannel(owner.id, "프로젝트 채널");
  const { bindGatewayToChannel } = await import("@/lib/gateway-resources");
  await bindGatewayToChannel({
    channelId: channel.id,
    gatewayId: gateway.id,
    boundByUserId: owner.id,
  });
  const profile = await seedHermesProfile(gateway.id, { profileName: "sophie" });
  const npc = await seedNpc({
    channelId: channel.id,
    hermesProfileId: profile.id,
    positionX: 0,
    positionY: 0,
  });
  const { channelBoardSlug } = await import("@/lib/kanban-boards");
  return {
    ownerId: owner.id,
    channelId: channel.id,
    npcId: npc.id,
    boardSlug: channelBoardSlug(channel.id),
  };
}

type ProjectView = {
  id: string;
  boardSlug: string;
  isEventCarrier: boolean;
  name: string | null;
  status: string;
  progress: { total: number; counts: Record<string, number> } | null;
};

async function listProjects(routes: Routes, userId: string, channelId: string) {
  const res = await routes.projects.GET(req(userId, "GET", base(channelId)), ctx(channelId));
  assert.equal(res.status, 200, await res.clone().text());
  return ((await res.json()) as { projects: ProjectView[] }).projects;
}

// ---------------------------------------------------------------------------
// 지연 생성 — 이관 전 채널이 "프로젝트 없음" 으로 막히지 않는다
// ---------------------------------------------------------------------------

test("메타 행이 없던 기존 채널도 목록에서 프로젝트 하나를 받는다", async () => {
  const routes = await loadRoutes();
  const seed = await seedProjectChannel();

  const { db, channelProjects } = await import("@/db");
  assert.equal((await db.select().from(channelProjects)).length, 0, "사전 조건: 메타 행이 없다");

  const projects = await listProjects(routes, seed.ownerId, seed.channelId);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].boardSlug, seed.boardSlug);
  assert.equal(projects[0].isEventCarrier, true, "기본 프로젝트는 사건 수신 보드다");
  assert.equal(projects[0].status, "planned");
});

test("지연 생성은 멱등이다 — 두 번 읽어도 프로젝트 id 가 같다", async () => {
  const routes = await loadRoutes();
  const seed = await seedProjectChannel();
  const first = await listProjects(routes, seed.ownerId, seed.channelId);
  const second = await listProjects(routes, seed.ownerId, seed.channelId);
  assert.equal(first[0].id, second[0].id, "읽을 때마다 새 프로젝트가 생깁니다");
});

test("메타 행 없던 채널에 서브프로젝트만 추가하는 경로가 열려 있다", async () => {
  const routes = await loadRoutes();
  const seed = await seedProjectChannel();

  // 덩어리 1의 기본 경로: 목록에서 기본 프로젝트 id 를 얻어 서브프로젝트만 붙인다.
  const projectId = (await listProjects(routes, seed.ownerId, seed.channelId))[0].id;
  const res = await routes.subprojects.POST(
    req(seed.ownerId, "POST", `${base(seed.channelId)}/${projectId}/subprojects`, {
      name: "가격 개편",
    }),
    ctx(seed.channelId, projectId),
  );
  assert.equal(res.status, 201, await res.clone().text());
  const body = (await res.json()) as { subproject: { tenantSlug: string; name: string } };
  assert.equal(body.subproject.name, "가격 개편");
  assert.equal(body.subproject.tenantSlug, "가격-개편", "한글 이름이 빈 슬러그가 되면 안 됩니다");
});

// ---------------------------------------------------------------------------
// 생성
// ---------------------------------------------------------------------------

test("프로젝트를 만들면 보드가 하나 더 붙고 이름은 Hermes 가 갖는다", async () => {
  const routes = await loadRoutes();
  const seed = await seedProjectChannel();

  const res = await routes.projects.POST(
    req(seed.ownerId, "POST", base(seed.channelId), {
      name: "2026 4분기 콘텐츠 파이프라인",
      status: "in_progress",
      subprojects: [{ name: "리서치" }],
    }),
    ctx(seed.channelId),
  );
  assert.equal(res.status, 201, await res.clone().text());
  const body = (await res.json()) as {
    project: ProjectView;
    subprojects: { tenantSlug: string }[];
  };
  assert.equal(body.project.name, "2026 4분기 콘텐츠 파이프라인");
  assert.equal(body.project.status, "in_progress");
  assert.equal(body.project.isEventCarrier, false, "새 보드가 사건 수신 자리를 뺏으면 안 됩니다");
  assert.deepEqual(
    body.subprojects.map((s) => s.tenantSlug),
    ["리서치"],
  );

  // 이름을 우리 표에 저장하지 않는다 — Hermes 에서 읽어 온 것이어야 한다.
  const { db, channelProjects } = await import("@/db");
  const rows = await db.select().from(channelProjects);
  assert.ok(
    !Object.values(rows[0]).includes("2026 4분기 콘텐츠 파이프라인"),
    "프로젝트 이름이 DeskRPG 표에 복사됐습니다 — Hermes 가 정본입니다",
  );

  const projects = await listProjects(routes, seed.ownerId, seed.channelId);
  assert.equal(projects.length, 2);
});

test("이름에 글자·숫자가 없으면 슬러그를 만들 수 없다고 갈라 답한다", async () => {
  const routes = await loadRoutes();
  const seed = await seedProjectChannel();
  const projectId = (await listProjects(routes, seed.ownerId, seed.channelId))[0].id;

  const res = await routes.subprojects.POST(
    req(seed.ownerId, "POST", `${base(seed.channelId)}/${projectId}/subprojects`, {
      name: "!!! ---",
    }),
    ctx(seed.channelId, projectId),
  );
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code: string }).code, "tenant_slug_underivable");
});

test("형식이 아닌 슬러그를 직접 주면 다른 코드로 거절한다", async () => {
  const routes = await loadRoutes();
  const seed = await seedProjectChannel();
  const projectId = (await listProjects(routes, seed.ownerId, seed.channelId))[0].id;

  const res = await routes.subprojects.POST(
    req(seed.ownerId, "POST", `${base(seed.channelId)}/${projectId}/subprojects`, {
      name: "리서치",
      tenantSlug: "Has Spaces",
    }),
    ctx(seed.channelId, projectId),
  );
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code: string }).code, "invalid_tenant_slug");
});

test("같은 슬러그는 한 프로젝트에 두 번 들어가지 않는다", async () => {
  const routes = await loadRoutes();
  const seed = await seedProjectChannel();
  const projectId = (await listProjects(routes, seed.ownerId, seed.channelId))[0].id;
  const url = `${base(seed.channelId)}/${projectId}/subprojects`;

  assert.equal(
    (
      await routes.subprojects.POST(
        req(seed.ownerId, "POST", url, { name: "리서치" }),
        ctx(seed.channelId, projectId),
      )
    ).status,
    201,
  );
  const dup = await routes.subprojects.POST(
    req(seed.ownerId, "POST", url, { name: "리서치" }),
    ctx(seed.channelId, projectId),
  );
  assert.equal(dup.status, 409);
  assert.equal(((await dup.json()) as { code: string }).code, "subproject_exists");
});

// ---------------------------------------------------------------------------
// 권한
// ---------------------------------------------------------------------------

test("멤버는 볼 수 있고 만들 수는 없다", async () => {
  const routes = await loadRoutes();
  const seed = await seedProjectChannel();
  const member = await seedUser("proj-member");
  const { db, channelMembers } = await import("@/db");
  await db
    .insert(channelMembers)
    .values({ channelId: seed.channelId, userId: member.id, role: "member" });

  const view = await routes.projects.GET(
    req(member.id, "GET", base(seed.channelId)),
    ctx(seed.channelId),
  );
  assert.equal(view.status, 200);

  const create = await routes.projects.POST(
    req(member.id, "POST", base(seed.channelId), { name: "멤버가 만든 프로젝트" }),
    ctx(seed.channelId),
  );
  assert.equal(create.status, 403);
  assert.equal(((await create.json()) as { code: string }).code, "forbidden");
});

test("비멤버는 목록도 못 본다", async () => {
  const routes = await loadRoutes();
  const seed = await seedProjectChannel();
  const stranger = await seedUser("proj-stranger");
  const res = await routes.projects.GET(
    req(stranger.id, "GET", base(seed.channelId)),
    ctx(seed.channelId),
  );
  assert.equal(res.status, 403);
});

test("다른 채널의 프로젝트 id 로는 열리지 않는다", async () => {
  const routes = await loadRoutes();
  const mine = await seedProjectChannel();
  const theirs = await seedProjectChannel();
  const theirProjectId = (await listProjects(routes, theirs.ownerId, theirs.channelId))[0].id;

  const res = await routes.project.GET(
    req(mine.ownerId, "GET", `${base(mine.channelId)}/${theirProjectId}`),
    ctx(mine.channelId, theirProjectId),
  );
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { code: string }).code, "project_not_found");
});

// ---------------------------------------------------------------------------
// 수정·보관
// ---------------------------------------------------------------------------

test("이름 수정은 Hermes 보드로 간다", async () => {
  const routes = await loadRoutes();
  const seed = await seedProjectChannel();
  const projectId = (await listProjects(routes, seed.ownerId, seed.channelId))[0].id;

  const res = await routes.project.PATCH(
    req(seed.ownerId, "PATCH", `${base(seed.channelId)}/${projectId}`, {
      name: "새 이름",
      status: "in_progress",
      leadNpcId: seed.npcId,
    }),
    ctx(seed.channelId, projectId),
  );
  assert.equal(res.status, 200, await res.clone().text());
  const body = (await res.json()) as { project: ProjectView & { leadNpcId: string } };
  assert.equal(body.project.name, "새 이름");
  assert.equal(body.project.status, "in_progress");
  assert.equal(body.project.leadNpcId, seed.npcId);

  // 다시 읽어도 Hermes 쪽 이름이 그대로 보인다.
  assert.equal((await listProjects(routes, seed.ownerId, seed.channelId))[0].name, "새 이름");
});

test("다른 채널의 NPC 는 리드가 될 수 없다", async () => {
  const routes = await loadRoutes();
  const mine = await seedProjectChannel();
  const theirs = await seedProjectChannel();
  const projectId = (await listProjects(routes, mine.ownerId, mine.channelId))[0].id;

  const res = await routes.project.PATCH(
    req(mine.ownerId, "PATCH", `${base(mine.channelId)}/${projectId}`, { leadNpcId: theirs.npcId }),
    ctx(mine.channelId, projectId),
  );
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code: string }).code, "lead_npc_not_in_channel");
});

test("마지막 활성 프로젝트는 보관되지 않는다", async () => {
  const routes = await loadRoutes();
  const seed = await seedProjectChannel();
  const projectId = (await listProjects(routes, seed.ownerId, seed.channelId))[0].id;

  const res = await routes.archive.POST(
    req(seed.ownerId, "POST", `${base(seed.channelId)}/${projectId}/archive`, {}),
    ctx(seed.channelId, projectId),
  );
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code: string }).code, "last_board");
});

test("사건 수신 보드를 보관하면 그 자리가 다른 보드로 옮겨진다", async () => {
  const routes = await loadRoutes();
  const seed = await seedProjectChannel();

  const created = await routes.projects.POST(
    req(seed.ownerId, "POST", base(seed.channelId), { name: "둘째 프로젝트" }),
    ctx(seed.channelId),
  );
  assert.equal(created.status, 201);
  const secondSlug = ((await created.json()) as { project: ProjectView }).project.boardSlug;

  const projects = await listProjects(routes, seed.ownerId, seed.channelId);
  const carrier = projects.find((p) => p.isEventCarrier);
  assert.ok(carrier);

  const res = await routes.archive.POST(
    req(seed.ownerId, "POST", `${base(seed.channelId)}/${carrier.id}/archive`, {
      status: "completed",
    }),
    ctx(seed.channelId, carrier.id),
  );
  assert.equal(res.status, 200, await res.clone().text());
  const body = (await res.json()) as { carrierMovedTo: string | null };
  assert.equal(body.carrierMovedTo, secondSlug);

  const { listChannelBoards } = await import("@/lib/kanban-boards");
  const rows = await listChannelBoards(seed.channelId);
  assert.equal(
    rows.filter((r) => r.isEventCarrier).length,
    1,
    "사건 수신 보드가 하나가 아니면 크론 사건이 중복되거나 사라집니다",
  );
  assert.equal(rows.find((r) => r.isEventCarrier)?.boardSlug, secondSlug);
});

test("사건 수신 자리를 옮겨도 그 보드의 커서는 살려 둔다", async () => {
  const routes = await loadRoutes();
  const seed = await seedProjectChannel();
  const created = await routes.projects.POST(
    req(seed.ownerId, "POST", base(seed.channelId), { name: "둘째 프로젝트" }),
    ctx(seed.channelId),
  );
  const secondSlug = ((await created.json()) as { project: ProjectView }).project.boardSlug;

  // 둘째 보드가 이미 폴링해 온 위치를 흉내낸다.
  const { db, channelKanbanBoards } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { listChannelBoards } = await import("@/lib/kanban-boards");
  const second = (await listChannelBoards(seed.channelId)).find((r) => r.boardSlug === secondSlug);
  assert.ok(second);
  await db
    .update(channelKanbanBoards)
    .set({ eventCursor: "CURSOR-SECOND" })
    .where(eq(channelKanbanBoards.id, second.id));

  const carrier = (await listProjects(routes, seed.ownerId, seed.channelId)).find(
    (p) => p.isEventCarrier,
  );
  assert.ok(carrier);
  await routes.archive.POST(
    req(seed.ownerId, "POST", `${base(seed.channelId)}/${carrier.id}/archive`, {}),
    ctx(seed.channelId, carrier.id),
  );

  const promoted = (await listChannelBoards(seed.channelId)).find((r) => r.isEventCarrier);
  assert.equal(promoted?.boardSlug, secondSlug);
  assert.equal(
    promoted?.eventCursor,
    "CURSOR-SECOND",
    "승격하며 커서를 버리면 그 보드의 카드 사건을 한 구간 통째로 놓칩니다 — " +
      "`a`(아티팩트)가 없는 커서는 플러그인이 '지금'으로 다루므로 버릴 이유가 없습니다",
  );
});

test("보관해도 보드 연결은 남는다 — 폴링이 계속되어야 한다", async () => {
  const routes = await loadRoutes();
  const seed = await seedProjectChannel();
  const created = await routes.projects.POST(
    req(seed.ownerId, "POST", base(seed.channelId), { name: "보관될 프로젝트" }),
    ctx(seed.channelId),
  );
  const target = ((await created.json()) as { project: ProjectView }).project;

  await routes.archive.POST(
    req(seed.ownerId, "POST", `${base(seed.channelId)}/${target.id}/archive`, {}),
    ctx(seed.channelId, target.id),
  );

  const { listChannelBoards } = await import("@/lib/kanban-boards");
  const rows = await listChannelBoards(seed.channelId);
  assert.ok(
    rows.some((r) => r.boardSlug === target.boardSlug),
    "보관이 연결 행을 지웠습니다 — 돌고 있던 카드의 사건이 끊깁니다",
  );
  const projects = await listProjects(routes, seed.ownerId, seed.channelId);
  assert.equal(projects.find((p) => p.id === target.id)?.status, "completed");
});

// ---------------------------------------------------------------------------
// 관측된 테넌트
// ---------------------------------------------------------------------------

test("밖에서 만든 카드의 테넌트는 숨기지 않고 미등록으로 싣는다", async () => {
  const routes = await loadRoutes();
  const seed = await seedProjectChannel();
  const projectId = (await listProjects(routes, seed.ownerId, seed.channelId))[0].id;

  // DeskRPG 를 거치지 않고 보드에 카드가 생긴 상황 — Hermes CLI 나 다른 도구가 만든 것.
  const kanban = await import("./[id]/kanban/tasks/route");
  const made = await kanban.POST(
    new NextRequest(`http://localhost/api/channels/${seed.channelId}/kanban/tasks`, {
      method: "POST",
      headers: authHeaders(seed.ownerId),
      body: JSON.stringify({ title: "밖에서 온 카드", tenant: "외부-테넌트" }),
    }),
    ctx(seed.channelId),
  );
  assert.equal(made.status, 201, await made.clone().text());

  const res = await routes.subprojects.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/${projectId}/subprojects`),
    ctx(seed.channelId, projectId),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { subprojects: unknown[]; unregisteredTenants: string[] };
  assert.deepEqual(body.unregisteredTenants, ["외부-테넌트"]);
  assert.equal(body.subprojects.length, 0);
});

test("등록한 서브프로젝트의 표시 이름은 바꿔도 슬러그는 고정이다", async () => {
  const routes = await loadRoutes();
  const seed = await seedProjectChannel();
  const projectId = (await listProjects(routes, seed.ownerId, seed.channelId))[0].id;

  const made = await routes.subprojects.POST(
    req(seed.ownerId, "POST", `${base(seed.channelId)}/${projectId}/subprojects`, {
      name: "리서치",
    }),
    ctx(seed.channelId, projectId),
  );
  const sub = ((await made.json()) as { subproject: { id: string; tenantSlug: string } })
    .subproject;

  const res = await routes.subproject.PATCH(
    req(seed.ownerId, "PATCH", `${base(seed.channelId)}/${projectId}/subprojects/${sub.id}`, {
      name: "리서치(개편)",
      tenantSlug: "무시되어야-한다",
      status: "in_progress",
    }),
    ctx(seed.channelId, projectId, sub.id),
  );
  assert.equal(res.status, 200, await res.clone().text());
  const body = (await res.json()) as {
    subproject: { name: string; tenantSlug: string; status: string };
  };
  assert.equal(body.subproject.name, "리서치(개편)");
  assert.equal(body.subproject.status, "in_progress");
  assert.equal(
    body.subproject.tenantSlug,
    sub.tenantSlug,
    "슬러그가 바뀌면 이미 만들어진 카드가 고아가 됩니다",
  );
});
