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

// T7. 크론 REST 와 출처 장부(cron_job_origins).
//
// Hermes 가 정본이고 DeskRPG 는 "누가 어느 채널에서 만들었는가" 만 기록한다. 여기서
// 고정하는 것은 권한표(보기 = 멤버, 만들기 = 멤버, 고치기 = 출처 채널 멤버만)와 장부의
// 생명주기(성공 뒤에만 기록, 삭제 때 제거, 게이트웨이가 바뀌면 무시, 프로필이 사라지면
// 정리)다. 라우트 핸들러를 직접 부르고 플러그인은 가짜 서버가 받는다.
//
// `[id]` 세그먼트 밖에 둔다 — node 테스트 러너가 `[id]` 를 문자 클래스로 오인해 그 안의
// *.test.ts 를 못 줍는다.
setupThrowawaySqlite("cron-routes-test");

// npc-seed 의 씨앗이 쓰는 토큰과 같아야 가짜 서버가 인증을 통과시킨다.
const OWNER_TOKEN = "gateway-owner-key-1234567890";
const PROFILE_TOKEN = "profile-key-1234567890";

let server: FakePluginServer;

before(async () => {
  server = await startFakePluginServer({
    ownerToken: OWNER_TOKEN,
    profileTokens: { sophie: PROFILE_TOKEN, noah: PROFILE_TOKEN },
  });
});

after(async () => {
  await server.close();
});

type Routes = {
  jobs: typeof import("./[id]/cron/jobs/route");
  job: typeof import("./[id]/cron/jobs/[jobId]/route");
  runs: typeof import("./[id]/cron/jobs/[jobId]/runs/route");
  pause: typeof import("./[id]/cron/jobs/[jobId]/pause/route");
  resume: typeof import("./[id]/cron/jobs/[jobId]/resume/route");
  run: typeof import("./[id]/cron/jobs/[jobId]/run/route");
  targets: typeof import("./[id]/cron/delivery-targets/route");
  blueprints: typeof import("./[id]/cron/blueprints/route");
  instantiate: typeof import("./[id]/cron/blueprints/instantiate/route");
};

async function loadRoutes(): Promise<Routes> {
  return {
    jobs: await import("./[id]/cron/jobs/route"),
    job: await import("./[id]/cron/jobs/[jobId]/route"),
    runs: await import("./[id]/cron/jobs/[jobId]/runs/route"),
    pause: await import("./[id]/cron/jobs/[jobId]/pause/route"),
    resume: await import("./[id]/cron/jobs/[jobId]/resume/route"),
    run: await import("./[id]/cron/jobs/[jobId]/run/route"),
    targets: await import("./[id]/cron/delivery-targets/route"),
    blueprints: await import("./[id]/cron/blueprints/route"),
    instantiate: await import("./[id]/cron/blueprints/instantiate/route"),
  };
}

function req(userId: string, method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: authHeaders(userId),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const base = (channelId: string) => `http://localhost/api/channels/${channelId}/cron`;
// jobId 가 없는 라우트(RouteParams 는 jobId 를 선택으로 둔다)에도 같은 모양으로 넘긴다.
const ctx = (id: string, jobId = "") => ({ params: Promise.resolve({ id, jobId }) });

/**
 * 채널 하나 + 가짜 플러그인 서버를 가리키는 게이트웨이 + 프로필 `sophie` 의 active NPC.
 * `extraProfiles` 로 같은 게이트웨이에 다른 프로필/NPC 를 더 붙일 수 있다.
 */
async function seedCronChannel(opts: { extraProfiles?: string[]; displayName?: string } = {}) {
  const owner = await seedUser("cron-owner");
  const gateway = await seedGateway(owner.id, server.baseUrl);
  const channel = await seedChannel(owner.id);
  const { bindGatewayToChannel } = await import("@/lib/gateway-resources");
  await bindGatewayToChannel({
    channelId: channel.id,
    gatewayId: gateway.id,
    boundByUserId: owner.id,
  });
  const profile = await seedHermesProfile(gateway.id, {
    profileName: "sophie",
    displayName: opts.displayName ?? "소피",
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
  return {
    ownerId: owner.id,
    gatewayId: gateway.id,
    channelId: channel.id,
    profileId: profile.id,
    npcId: npc.id,
    extras,
  };
}

/** 같은 게이트웨이(프로필 sophie)를 다른 채널에 묶고, 거기에도 sophie NPC 를 둔다. */
async function seedSiblingChannel(gatewayId: string, profileId: string) {
  const member = await seedUser("sibling-owner");
  const channel = await seedChannel(member.id, "Sibling Channel");
  const { bindGatewayToChannel } = await import("@/lib/gateway-resources");
  await bindGatewayToChannel({
    channelId: channel.id,
    gatewayId,
    boundByUserId: member.id,
  });
  const npc = await seedNpc({
    channelId: channel.id,
    hermesProfileId: profileId,
    positionX: 0,
    positionY: 0,
  });
  return { userId: member.id, channelId: channel.id, npcId: npc.id };
}

async function addMember(channelId: string, userId: string) {
  const { db, channelMembers } = await import("@/db");
  await db.insert(channelMembers).values({ channelId, userId, role: "member" });
}

async function createJob(
  routes: Routes,
  userId: string,
  channelId: string,
  npcId: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await routes.jobs.POST(
    req(userId, "POST", `${base(channelId)}/jobs`, {
      npcId,
      name: "아침 브리핑",
      prompt: "오늘 일정을 요약해",
      schedule: "daily at 09:00",
      ...overrides,
    }),
    ctx(channelId),
  );
  return { status: res.status, body: await res.json() };
}

async function countOrigins(gatewayId: string) {
  const { db, cronJobOrigins } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  return (await db.select().from(cronJobOrigins).where(eq(cronJobOrigins.gatewayId, gatewayId)))
    .length;
}

test("멤버가 아니면 403, 로그인 없으면 401", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedCronChannel();
  const stranger = await seedUser("stranger");

  const forbidden = await routes.jobs.GET(
    req(stranger.id, "GET", `${base(seed.channelId)}/jobs`),
    ctx(seed.channelId),
  );
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).code, "not_a_member");

  const anonymous = await routes.jobs.GET(
    new NextRequest(`${base(seed.channelId)}/jobs`),
    ctx(seed.channelId),
  );
  assert.equal(anonymous.status, 401);
});

test("생성 → 출처 기록(성공 뒤에만), 출처 채널 멤버는 편집·멈춤·재개·실행·삭제 가능", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedCronChannel();
  const member = await seedUser("member");
  await addMember(seed.channelId, member.id);

  // 실패한 생성(schedule 없음 → 플러그인 400)은 장부에 남지 않는다.
  const failed = await createJob(routes, member.id, seed.channelId, seed.npcId, {
    schedule: "",
  });
  assert.equal(failed.status, 400);
  assert.equal(await countOrigins(seed.gatewayId), 0, "실패한 생성은 출처를 남기지 않는다");

  const created = await createJob(routes, member.id, seed.channelId, seed.npcId);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const job = created.body.job;
  assert.equal(job.npcId, seed.npcId);
  assert.equal(job.npcName, "소피", "npcName 은 프로필 display_name 이다");
  assert.deepEqual(job.origin, { channelId: seed.channelId, createdByUserId: member.id });
  assert.equal(job.editable, true);
  assert.equal(await countOrigins(seed.gatewayId), 1);

  // 플러그인으로 나간 본문에 npcId 가 섞이지 않고, deliver 기본값은 local 이다.
  const sent = server.requests().find((r) => r.method === "POST" && r.path.endsWith("/jobs"));
  assert.ok(sent);
  assert.equal(sent.auth, `Bearer ${PROFILE_TOKEN}`, "프로필 토큰으로 부른다");
  assert.equal((sent.json as Record<string, unknown>).npcId, undefined);
  assert.equal((sent.json as Record<string, unknown>).deliver, "local");

  // 수정
  const updated = await routes.job.PUT(
    req(seed.ownerId, "PUT", `${base(seed.channelId)}/jobs/${job.id}`, {
      npcId: seed.npcId,
      updates: { name: "저녁 브리핑", model: null },
    }),
    ctx(seed.channelId, job.id),
  );
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).job.name, "저녁 브리핑");

  // 멈춤 / 재개
  const paused = await routes.pause.POST(
    req(member.id, "POST", `${base(seed.channelId)}/jobs/${job.id}/pause`, { npcId: seed.npcId }),
    ctx(seed.channelId, job.id),
  );
  assert.equal(paused.status, 200);
  assert.equal((await paused.json()).job.state, "paused");
  const resumed = await routes.resume.POST(
    req(member.id, "POST", `${base(seed.channelId)}/jobs/${job.id}/resume`, {
      npcId: seed.npcId,
    }),
    ctx(seed.channelId, job.id),
  );
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json()).job.state, "scheduled");

  // 지금 실행 → 202
  const ran = await routes.run.POST(
    req(member.id, "POST", `${base(seed.channelId)}/jobs/${job.id}/run`, { npcId: seed.npcId }),
    ctx(seed.channelId, job.id),
  );
  assert.equal(ran.status, 202);
  assert.deepEqual(await ran.json(), { accepted: true });

  // 이력
  const runs = await routes.runs.GET(
    req(
      member.id,
      "GET",
      `${base(seed.channelId)}/jobs/${job.id}/runs?npcId=${seed.npcId}&limit=5`,
    ),
    ctx(seed.channelId, job.id),
  );
  assert.equal(runs.status, 200);
  const runsBody = await runs.json();
  assert.equal(runsBody.limit, 5);
  assert.equal(runsBody.runs.length, 1);

  // 상세
  const detail = await routes.job.GET(
    req(member.id, "GET", `${base(seed.channelId)}/jobs/${job.id}?npcId=${seed.npcId}`),
    ctx(seed.channelId, job.id),
  );
  assert.equal(detail.status, 200);
  const detailBody = await detail.json();
  assert.equal(detailBody.job.editable, true);
  assert.equal(detailBody.timezone, "Asia/Seoul");

  // 삭제 → 장부 제거
  const deleted = await routes.job.DELETE(
    req(member.id, "DELETE", `${base(seed.channelId)}/jobs/${job.id}?npcId=${seed.npcId}`),
    ctx(seed.channelId, job.id),
  );
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { ok: true });
  assert.equal(await countOrigins(seed.gatewayId), 0, "삭제하면 출처도 지운다");
});

test("같은 NPC 의 다른 채널 멤버는 보이지만 고칠 수 없다(403 cron_read_only)", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedCronChannel();
  const sibling = await seedSiblingChannel(seed.gatewayId, seed.profileId);

  const created = await createJob(routes, seed.ownerId, seed.channelId, seed.npcId);
  assert.equal(created.status, 201);
  const jobId = created.body.job.id;

  const listed = await routes.jobs.GET(
    req(sibling.userId, "GET", `${base(sibling.channelId)}/jobs`),
    ctx(sibling.channelId),
  );
  assert.equal(listed.status, 200);
  const body = await listed.json();
  assert.equal(body.jobs.length, 1);
  assert.equal(body.jobs[0].id, jobId);
  assert.equal(body.jobs[0].npcId, sibling.npcId, "npcId 는 요청 채널의 NPC 행이다");
  assert.equal(body.jobs[0].editable, false);
  assert.deepEqual(body.jobs[0].origin, {
    channelId: seed.channelId,
    createdByUserId: seed.ownerId,
  });

  const before = server.requests().length;
  const mutations = [
    routes.job.PUT(
      req(sibling.userId, "PUT", `${base(sibling.channelId)}/jobs/${jobId}`, {
        npcId: sibling.npcId,
        updates: { name: "x" },
      }),
      ctx(sibling.channelId, jobId),
    ),
    routes.pause.POST(
      req(sibling.userId, "POST", `${base(sibling.channelId)}/jobs/${jobId}/pause`, {
        npcId: sibling.npcId,
      }),
      ctx(sibling.channelId, jobId),
    ),
    routes.run.POST(
      req(sibling.userId, "POST", `${base(sibling.channelId)}/jobs/${jobId}/run`, {
        npcId: sibling.npcId,
      }),
      ctx(sibling.channelId, jobId),
    ),
    routes.job.DELETE(
      req(
        sibling.userId,
        "DELETE",
        `${base(sibling.channelId)}/jobs/${jobId}?npcId=${sibling.npcId}`,
      ),
      ctx(sibling.channelId, jobId),
    ),
  ];
  for (const res of await Promise.all(mutations)) {
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, "cron_read_only");
  }
  assert.equal(server.requests().length, before, "읽기 전용 거절은 Hermes 를 부르기 전에 끝난다");
  assert.equal(await countOrigins(seed.gatewayId), 1, "장부는 그대로");
});

test("DeskRPG 밖에서 만든 크론(출처 없음)은 출처 채널 소유자에게도 읽기 전용이다", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedCronChannel();
  const { createProfilePluginClient } = await import("@/lib/hermes/plugin-client");
  const external = createProfilePluginClient({
    baseUrl: server.baseUrl,
    profileName: "sophie",
    profileToken: PROFILE_TOKEN,
  });
  const made = await external.cron.createJob({
    schedule: "hourly",
    prompt: "외부에서",
    name: "external",
  });
  assert.equal(made.ok, true);
  if (!made.ok) return;
  const jobId = made.data.job.id;

  const detail = await routes.job.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/jobs/${jobId}?npcId=${seed.npcId}`),
    ctx(seed.channelId, jobId),
  );
  assert.equal(detail.status, 200);
  const body = await detail.json();
  assert.equal(body.job.origin, null);
  assert.equal(body.job.editable, false);

  const res = await routes.job.PUT(
    req(seed.ownerId, "PUT", `${base(seed.channelId)}/jobs/${jobId}`, {
      npcId: seed.npcId,
      updates: { name: "x" },
    }),
    ctx(seed.channelId, jobId),
  );
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, "cron_read_only");
});

test("목록은 채널의 active NPC 합집합이고 npcId 로 거른다; 휴면 NPC 는 빠진다", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedCronChannel({ extraProfiles: ["noah"] });
  const noah = seed.extras[0];

  assert.equal((await createJob(routes, seed.ownerId, seed.channelId, seed.npcId)).status, 201);
  assert.equal(
    (
      await createJob(routes, seed.ownerId, seed.channelId, noah.npcId, {
        name: "노아의 일",
        paused: true,
      })
    ).status,
    201,
  );

  const all = await routes.jobs.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/jobs`),
    ctx(seed.channelId),
  );
  assert.equal(all.status, 200);
  const allBody = await all.json();
  assert.equal(allBody.jobs.length, 2, "멈춰 있는 크론도 목록에 보인다");
  assert.deepEqual(
    allBody.jobs.map((j: { npcId: string }) => j.npcId).sort(),
    [seed.npcId, noah.npcId].sort(),
  );
  assert.equal(allBody.timezone, "Asia/Seoul");
  assert.equal(allBody.errors, undefined);

  const filtered = await routes.jobs.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/jobs?npcId=${noah.npcId}`),
    ctx(seed.channelId),
  );
  const filteredBody = await filtered.json();
  assert.equal(filteredBody.jobs.length, 1);
  assert.equal(filteredBody.jobs[0].name, "노아의 일");
  assert.equal(filteredBody.jobs[0].npcName, "noah", "display_name 이 없으면 profile_name");

  // noah 를 재우면 합집합에서 빠진다.
  const { setNpcActive } = await import("@/lib/npc-roster");
  await setNpcActive(noah.npcId, false);
  const afterSleep = await routes.jobs.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/jobs`),
    ctx(seed.channelId),
  );
  assert.equal((await afterSleep.json()).jobs.length, 1);

  const unknown = await routes.jobs.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/jobs?npcId=${noah.npcId}`),
    ctx(seed.channelId),
  );
  assert.equal(unknown.status, 404, "휴면 NPC 는 이 채널의 active NPC 가 아니다");
});

test("한 프로필의 호출이 실패해도 목록은 살아남고 errors 에 그 NPC 만 실린다", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedCronChannel();
  // 게이트웨이에는 있지만 가짜 서버가 모르는 프로필 → 404 Unknown profile.
  const ghost = await seedHermesProfile(seed.gatewayId, { profileName: "ghost" });
  const ghostNpc = await seedNpc({
    channelId: seed.channelId,
    hermesProfileId: ghost.id,
    positionX: 5,
    positionY: 5,
  });
  assert.equal((await createJob(routes, seed.ownerId, seed.channelId, seed.npcId)).status, 201);

  const res = await routes.jobs.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/jobs`),
    ctx(seed.channelId),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.jobs.length, 1);
  assert.equal(body.errors.length, 1);
  assert.equal(body.errors[0].npcId, ghostNpc.id);
  assert.equal(typeof body.errors[0].code, "string");
});

test("게이트웨이를 바꾸면 옛 게이트웨이의 출처는 무시된다", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedCronChannel();
  const created = await createJob(routes, seed.ownerId, seed.channelId, seed.npcId);
  assert.equal(created.status, 201);
  const jobId = created.body.job.id;

  // 같은 가짜 서버를 가리키는 두 번째 게이트웨이 + 같은 이름의 프로필로 갈아탄다.
  const gatewayB = await seedGateway(seed.ownerId, server.baseUrl);
  const profileB = await seedHermesProfile(gatewayB.id, { profileName: "sophie" });
  const { bindGatewayToChannel } = await import("@/lib/gateway-resources");
  await bindGatewayToChannel({
    channelId: seed.channelId,
    gatewayId: gatewayB.id,
    boundByUserId: seed.ownerId,
  });
  const { setNpcActive } = await import("@/lib/npc-roster");
  await setNpcActive(seed.npcId, false);
  const npcB = await seedNpc({
    channelId: seed.channelId,
    hermesProfileId: profileB.id,
    positionX: 1,
    positionY: 1,
  });

  const listed = await routes.jobs.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/jobs`),
    ctx(seed.channelId),
  );
  const body = await listed.json();
  assert.equal(body.jobs.length, 1);
  assert.equal(body.jobs[0].id, jobId);
  assert.equal(body.jobs[0].npcId, npcB.id);
  assert.equal(body.jobs[0].origin, null, "옛 게이트웨이의 출처 행은 무시한다");
  assert.equal(body.jobs[0].editable, false);
  assert.equal(await countOrigins(seed.gatewayId), 1, "행 자체는 지우지 않는다");
});

test("프로필이 사라진 출처 행은 목록 조회 때 정리된다", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedCronChannel();
  const { db, cronJobOrigins, hermesProfiles } = await import("@/db");
  const { eq } = await import("drizzle-orm");

  // 지금은 없는 프로필 이름의 출처 행(프로필이 지워진 뒤 남은 고아).
  await db.insert(cronJobOrigins).values({
    gatewayId: seed.gatewayId,
    profileName: "departed",
    jobId: "job-old",
    channelId: seed.channelId,
    createdByUserId: seed.ownerId,
  });
  // 살아 있는 프로필의 출처 행은 남아야 한다.
  await db.insert(cronJobOrigins).values({
    gatewayId: seed.gatewayId,
    profileName: "sophie",
    jobId: "job-live",
    channelId: seed.channelId,
    createdByUserId: seed.ownerId,
  });
  assert.equal(await countOrigins(seed.gatewayId), 2);

  const res = await routes.jobs.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/jobs`),
    ctx(seed.channelId),
  );
  assert.equal(res.status, 200);
  const rows = await db
    .select({ profileName: cronJobOrigins.profileName })
    .from(cronJobOrigins)
    .where(eq(cronJobOrigins.gatewayId, seed.gatewayId));
  assert.deepEqual(
    rows.map((r) => r.profileName),
    ["sophie"],
  );
  // 살아 있는 프로필 수는 그대로다(정리는 장부만 건드린다).
  const live = await db
    .select({ id: hermesProfiles.id })
    .from(hermesProfiles)
    .where(eq(hermesProfiles.gatewayId, seed.gatewayId));
  assert.equal(live.length, 1);
});

test("캐시가 0.5.0 이라고 하면 Hermes 를 부르지 않고 428 plugin_upgrade_required", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedCronChannel();
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
  const res = await routes.jobs.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/jobs`),
    ctx(seed.channelId),
  );
  assert.equal(res.status, 428);
  const body = await res.json();
  assert.equal(body.code, "plugin_upgrade_required");
  assert.equal(body.minVersion, "0.6.0");
  assert.equal(server.requests().length, before, "신선한 캐시면 재확인하지 않는다");

  // 캐시가 오래됐으면 /deskrpg/info 로 다시 확인해 캐시를 갱신한다.
  await db
    .update(gatewayResources)
    .set({ pluginCheckedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() as never })
    .where(eq(gatewayResources.id, seed.gatewayId));
  const fresh = await routes.jobs.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/jobs`),
    ctx(seed.channelId),
  );
  assert.equal(fresh.status, 200);
  assert.ok(server.requests().some((r) => r.path === "/deskrpg/info"));
  const [row] = await db
    .select({ pluginVersion: gatewayResources.pluginVersion })
    .from(gatewayResources)
    .where(eq(gatewayResources.id, seed.gatewayId));
  assert.equal(row.pluginVersion, "0.6.0");
});

test("플러그인이 시간대를 주지 않으면 timezone 은 null 이다", async () => {
  server.reset();
  server.setInfo({ timezone: null });
  try {
    const routes = await loadRoutes();
    const seed = await seedCronChannel();
    const res = await routes.jobs.GET(
      req(seed.ownerId, "GET", `${base(seed.channelId)}/jobs`),
      ctx(seed.channelId),
    );
    assert.equal(res.status, 200);
    assert.equal((await res.json()).timezone, null);
  } finally {
    server.setInfo({ timezone: "Asia/Seoul" });
  }
});

test("Hermes 오류는 상태 코드와 {code, message} 그대로 전달한다", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedCronChannel();
  const res = await routes.job.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/jobs/no-such-job?npcId=${seed.npcId}`),
    ctx(seed.channelId, "no-such-job"),
  );
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(typeof body.code, "string");
  assert.equal(typeof body.message, "string");
});

test("전달 대상·템플릿 조회와 템플릿 인스턴스화(출처 기록)", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedCronChannel();
  server.setDeliveryTargets("sophie", [
    { id: "local", name: "Local", home_target_set: true, home_env_var: "" },
  ]);
  server.setBlueprints("sophie", [
    {
      key: "daily-summary",
      title: "일일 요약",
      description: "",
      category: "reports",
      tags: [],
      fields: [{ name: "time", type: "time", label: "시각" }],
      command: "요약해",
      appUrl: "",
    },
  ]);

  const targets = await routes.targets.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/delivery-targets?npcId=${seed.npcId}`),
    ctx(seed.channelId),
  );
  assert.equal(targets.status, 200);
  assert.equal((await targets.json()).targets[0].id, "local");

  const blueprints = await routes.blueprints.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/blueprints?npcId=${seed.npcId}`),
    ctx(seed.channelId),
  );
  assert.equal(blueprints.status, 200);
  assert.equal((await blueprints.json()).blueprints[0].key, "daily-summary");

  const made = await routes.instantiate.POST(
    req(seed.ownerId, "POST", `${base(seed.channelId)}/blueprints/instantiate`, {
      npcId: seed.npcId,
      blueprint: "daily-summary",
      values: { time: "08:30" },
    }),
    ctx(seed.channelId),
  );
  assert.equal(made.status, 201);
  const body = await made.json();
  assert.equal(body.job.editable, true);
  assert.deepEqual(body.job.origin, { channelId: seed.channelId, createdByUserId: seed.ownerId });
  assert.equal(await countOrigins(seed.gatewayId), 1);
});

test("스크립트 전용 잡은 prompt 없이 만들 수 있고, prompt 도 script 도 없으면 400", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedCronChannel();

  const neither = await createJob(routes, seed.ownerId, seed.channelId, seed.npcId, {
    prompt: undefined,
  });
  assert.equal(neither.status, 400);
  assert.equal(neither.body.code, "invalid_body");

  const before = server.requests().length;
  const scripted = await createJob(routes, seed.ownerId, seed.channelId, seed.npcId, {
    prompt: undefined,
    script: "echo hello",
  });
  assert.equal(scripted.status, 201, JSON.stringify(scripted.body));
  const sent = server
    .requests()
    .slice(before)
    .find((r) => r.method === "POST" && r.path.endsWith("/cron/jobs"));
  assert.ok(sent);
  const json = sent.json as Record<string, unknown>;
  assert.equal(json.script, "echo hello", "script 는 그대로 전달된다");
  assert.equal("prompt" in json, false, "빈 prompt 를 지어내지 않는다");
  assert.equal("npcId" in json, false);
});

test("게이트 진단은 뭉치지 않는다 — plugin_absent 는 404, 도달 실패는 503 unreachable", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedCronChannel();
  const { db, gatewayResources, nowForDb } = await import("@/db");
  const { eq } = await import("drizzle-orm");

  // 신선한 plugin_absent 캐시 → Hermes 를 부르지 않고 404. 예전에는 이것을 428 로 오진했다.
  await db
    .update(gatewayResources)
    .set({ pluginStatus: "plugin_absent", pluginCheckedAt: nowForDb(), pluginInfoJson: null })
    .where(eq(gatewayResources.id, seed.gatewayId));
  const before = server.requests().length;
  const absent = await routes.jobs.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/jobs`),
    ctx(seed.channelId),
  );
  assert.equal(absent.status, 404);
  assert.equal((await absent.json()).code, "plugin_absent");
  assert.equal(server.requests().length, before, "신선한 캐시면 재확인하지 않는다");

  // unknown 캐시는 신선해도 다시 찌른다. 게이트웨이가 죽어 있으면 503 unreachable.
  await db
    .update(gatewayResources)
    .set({ baseUrl: "http://127.0.0.1:1", pluginStatus: "unknown", pluginCheckedAt: nowForDb() })
    .where(eq(gatewayResources.id, seed.gatewayId));
  const dead = await routes.jobs.GET(
    req(seed.ownerId, "GET", `${base(seed.channelId)}/jobs`),
    ctx(seed.channelId),
  );
  assert.equal(dead.status, 503);
  assert.equal((await dead.json()).code, "unreachable");
});

test("본문 검증 — npcId 없음/다른 채널의 NPC 는 400/404 이고 Hermes 를 부르지 않는다", async () => {
  server.reset();
  const routes = await loadRoutes();
  const seed = await seedCronChannel();
  const other = await seedCronChannel();
  // reset() 은 요청 기록을 비우지 않는다 — 여기부터 늘어난 것만 센다.
  const before = server.requests().length;

  const missing = await routes.jobs.POST(
    req(seed.ownerId, "POST", `${base(seed.channelId)}/jobs`, { name: "x", prompt: "y" }),
    ctx(seed.channelId),
  );
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).code, "invalid_body");

  const foreign = await createJob(routes, seed.ownerId, seed.channelId, other.npcId);
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.code, "npc_not_found");
  assert.equal(
    server
      .requests()
      .slice(before)
      .filter((r) => r.method === "POST").length,
    0,
    "검증 실패는 플러그인에 닿기 전에 끝난다",
  );
});
