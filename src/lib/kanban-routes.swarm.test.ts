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

test("채널 NPC id 를 프로필 이름으로 바꿔 넘긴다", async () => {
  const { createSwarm } = await import("@/lib/kanban-routes");
  const ctx = await seedChannelWithNpcs(["nova", "luna", "sophie", "dante"]);
  const res = await createSwarm(
    postRequest(ctx, {
      goal: "목표",
      workers: [
        { npcId: ctx.npcIds.nova, title: "조사" },
        { npcId: ctx.npcIds.luna, title: "인터뷰" },
      ],
      verifierNpcId: ctx.npcIds.sophie,
      synthesizerNpcId: ctx.npcIds.dante,
    }),
    ctx.channelId,
  );
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const sent = ctx.fakePlugin.lastSwarmBody() as {
    workers: Array<{ profile: string }>;
    verifier: string;
  };
  assert.deepEqual(
    sent.workers.map((w) => w.profile),
    ["nova", "luna"],
  );
  assert.equal(sent.verifier, "sophie");
});

test("채널 밖 NPC 가 하나라도 있으면 아무것도 만들지 않는다", async () => {
  const { createSwarm } = await import("@/lib/kanban-routes");
  const ctx = await seedChannelWithNpcs(["nova", "sophie", "dante"]);
  const before = ctx.fakePlugin.swarmCallCount();
  const res = await createSwarm(
    postRequest(ctx, {
      goal: "목표",
      workers: [
        { npcId: ctx.npcIds.nova, title: "조사" },
        { npcId: "00000000-0000-0000-0000-000000000000", title: "침입" },
      ],
      verifierNpcId: ctx.npcIds.sophie,
      synthesizerNpcId: ctx.npcIds.dante,
    }),
    ctx.channelId,
  );
  assert.equal(res.status, 400);
  // 부분 생성이 없어야 한다 — 반쯤 연결된 그래프가 남으면 디스패처가 그걸 본다.
  assert.equal(ctx.fakePlugin.swarmCallCount(), before);
});

test("플러그인이 스웜을 못 하면 428 을 낸다", async () => {
  const { createSwarm } = await import("@/lib/kanban-routes");
  const ctx = await seedChannelWithNpcs(["nova", "sophie", "dante"], {
    capabilities: ["kanban", "cron", "events"],
  });
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
  const body = await res.json();
  assert.equal(body.code, "plugin_upgrade_required");
  assert.deepEqual(body.missing, ["swarm"]);
});

test("워커가 없으면 400", async () => {
  const { createSwarm } = await import("@/lib/kanban-routes");
  const ctx = await seedChannelWithNpcs(["sophie", "dante"]);
  const res = await createSwarm(
    postRequest(ctx, {
      goal: "목표",
      workers: [],
      verifierNpcId: ctx.npcIds.sophie,
      synthesizerNpcId: ctx.npcIds.dante,
    }),
    ctx.channelId,
  );
  assert.equal(res.status, 400);
});

test("블랙보드를 그대로 돌려준다", async () => {
  const { createSwarm, getBlackboard } = await import("@/lib/kanban-routes");
  const ctx = await seedChannelWithNpcs(["nova", "sophie", "dante"]);
  const created = await createSwarm(
    postRequest(ctx, {
      goal: "목표",
      workers: [{ npcId: ctx.npcIds.nova, title: "조사" }],
      verifierNpcId: ctx.npcIds.sophie,
      synthesizerNpcId: ctx.npcIds.dante,
    }),
    ctx.channelId,
  );
  const { root_id } = await created.json();
  const res = await getBlackboard(getRequest(ctx, root_id), ctx.channelId, root_id);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.blackboard.topology, "object");
});
