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

// T6. `createSwarm`/`getBlackboard` — 이 기능의 유일한 권한 경계다. 클라이언트는 NPC id 만
// 보내고 서버가 채널의 active NPC 를 프로필 이름으로 바꿔서 Hermes 로 보낸다. 하나라도
// 채널 밖이면 아무것도 만들지 않는다(부분 생성 금지). 능력 판정(428)은 NPC 해석보다 먼저다.
setupThrowawaySqlite("kanban-routes-swarm-test");

const OWNER_TOKEN = "gateway-owner-key-1234567890";
const PROFILE_TOKEN = "profile-key-1234567890";

let server: FakePluginServer;

before(async () => {
  server = await startFakePluginServer({
    ownerToken: OWNER_TOKEN,
    profileTokens: {
      nova: PROFILE_TOKEN,
      luna: PROFILE_TOKEN,
      sophie: PROFILE_TOKEN,
      dante: PROFILE_TOKEN,
    },
  });
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

const base = (channelId: string) => `http://localhost/api/channels/${channelId}/kanban`;

function req(userId: string, method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: authHeaders(userId),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function swarmRequests() {
  return server
    .requests()
    .filter((r) => r.method === "POST" && r.path.startsWith("/deskrpg/kanban/swarm"));
}

/**
 * 채널 하나 + 가짜 플러그인 서버를 가리키는 게이트웨이(소유자 = 채널 소유자) + `names` 순서로
 * active NPC 를 만든다. `capabilities` 를 주면 이 테스트 동안 플러그인 계약을 그 값으로
 * 좁힌다(스웜 게이트 실패를 재현하는 용도).
 */
async function seedChannelWithNpcs(names: string[], opts: { capabilities?: string[] } = {}) {
  server.reset();
  if (opts.capabilities) {
    server.setInfo({ capabilities: opts.capabilities });
  } else {
    server.setInfo({ capabilities: ["kanban", "cron", "events", "swarm"] });
  }

  const owner = await seedUser("swarm-owner");
  const gateway = await seedGateway(owner.id, server.baseUrl);
  const channel = await seedChannel(owner.id, "스웜 채널");
  const { bindGatewayToChannel } = await import("@/lib/gateway-resources");
  await bindGatewayToChannel({
    channelId: channel.id,
    gatewayId: gateway.id,
    boundByUserId: owner.id,
  });

  const npcIds: Record<string, string> = {};
  let column = 0;
  for (const name of names) {
    const profile = await seedHermesProfile(gateway.id, { profileName: name });
    const npc = await seedNpc({
      channelId: channel.id,
      hermesProfileId: profile.id,
      positionX: column++,
      positionY: 0,
    });
    npcIds[name] = npc.id;
  }

  return {
    ownerId: owner.id,
    channelId: channel.id,
    npcIds,
    fakePlugin: {
      lastSwarmBody: () => swarmRequests().at(-1)?.json as Record<string, unknown> | undefined,
      swarmCallCount: () => swarmRequests().length,
    },
  };
}

type SwarmCtx = Awaited<ReturnType<typeof seedChannelWithNpcs>>;

function postRequest(ctx: SwarmCtx, body: unknown) {
  return req(ctx.ownerId, "POST", `${base(ctx.channelId)}/swarm`, body);
}

function getRequest(ctx: SwarmCtx, taskId: string) {
  return req(ctx.ownerId, "GET", `${base(ctx.channelId)}/tasks/${taskId}/blackboard`);
}

test("신규 스웜은 정책 계약이 없으면 어떤 카드도 만들지 않고 428", async () => {
  const { createSwarm } = await import("@/lib/kanban-routes");
  const ctx = await seedChannelWithNpcs(["nova", "sophie", "dante"]);
  const res = await createSwarm(
    postRequest(ctx, {
      goal: "목표",
      workers: [{ npcId: ctx.npcIds.nova, title: "조사" }],
      verifierNpcId: ctx.npcIds.sophie,
      synthesizerNpcId: ctx.npcIds.dante,
    }),
    ctx.channelId,
  );
  assert.equal(res.status, 428);
  assert.equal((await res.json()).code, "swarm_review_policy_unsupported");
  assert.equal(ctx.fakePlugin.swarmCallCount(), 0);
});

test("플러그인이 스웜을 못 하면 getBlackboard 도 428 을 낸다", async () => {
  // createSwarm 과 같은 게이트다. 플러그인 계약 판정은 게이트웨이당 1시간 캐시되므로(R5·
  // automation-gate.ts), 능력이 있는 채널에서 먼저 만든 taskId 를 나중에 캐시만 바꿔 재조회하면
  // 캐시가 여전히 "swarm 있음" 을 돌려줘 이 게이트를 못 때린다. 그래서 createSwarm 428 테스트와
  // 같은 방식으로 **처음부터** swarm 없는 채널을 만들고, 게이트가 NPC 해석보다 먼저 걸리는지만
  // 본다(taskId 는 존재할 필요가 없다 — 게이트가 그 전에 막는다).
  const { getBlackboard } = await import("@/lib/kanban-routes");
  const ctx = await seedChannelWithNpcs(["nova", "sophie", "dante"], {
    capabilities: ["kanban", "cron", "events"],
  });
  const res = await getBlackboard(getRequest(ctx, "any-task-id"), ctx.channelId, "any-task-id");
  assert.equal(res.status, 428);
  const body = await res.json();
  assert.equal(body.code, "plugin_upgrade_required");
  assert.deepEqual(body.missing, ["swarm"]);
});

test("블랙보드를 그대로 돌려준다", async () => {
  const { getBlackboard } = await import("@/lib/kanban-routes");
  const ctx = await seedChannelWithNpcs(["nova", "sophie", "dante"]);
  const { resolveKanbanChannelContext } = await import("@/lib/kanban-access");
  const resolved = await resolveKanbanChannelContext({
    userId: ctx.ownerId,
    channelId: ctx.channelId,
  });
  assert.ok(resolved.ok);
  // 업그레이드 전에 존재하던 스웜을 fake Hermes에 심는다.
  const created = await resolved.ctx.client.kanban.createSwarm(resolved.ctx.boardSlug, {
    goal: "기존",
    workers: [{ profile: "nova", title: "조사" }],
    verifier: "sophie",
    synthesizer: "dante",
  });
  assert.ok(created.ok);
  const { root_id } = created.data;
  const res = await getBlackboard(getRequest(ctx, root_id), ctx.channelId, root_id);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.blackboard.topology, "object");
});
