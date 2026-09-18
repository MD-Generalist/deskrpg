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

// T7. 결과물(아티팩트) REST — 목록·상세. 채널 범위는 서버가 정한다(채널 NPC 프로필 전부(잠든
// NPC 포함) OR 채널 보드). 브라우저가 넘긴 profiles 는 무시한다.
//
// `[id]` 세그먼트 밖에 둔다 — node 테스트 러너가 `[id]` 를 문자 클래스로 오인해 그 안의
// *.test.ts 를 못 줍는다.
setupThrowawaySqlite("artifact-routes-test");

let server: FakePluginServer;

type Routes = {
  list: typeof import("./[id]/artifacts/route");
  item: typeof import("./[id]/artifacts/[artifactId]/route");
};

let routes: Routes;

before(async () => {
  server = await startFakePluginServer({
    ownerToken: "gateway-owner-key-1234567890",
    profileTokens: { sophie: "profile-key-1234567890" },
  });
  server.setInfo({ capabilities: ["kanban", "cron", "events", "artifacts"], version: "0.8.4" });
  routes = {
    list: await import("./[id]/artifacts/route"),
    item: await import("./[id]/artifacts/[artifactId]/route"),
  };
});

after(async () => {
  await server.close();
});

function req(userId: string, method: string, url: string): NextRequest {
  return new NextRequest(url, { method, headers: authHeaders(userId) });
}

const base = (channelId: string) => `http://localhost/api/channels/${channelId}/artifacts`;
const ctx = (id: string, artifactId = "", v = "") => ({
  params: Promise.resolve({ id, artifactId, v }),
});

/**
 * 채널 하나 + 가짜 플러그인 서버를 가리키는 게이트웨이(소유자 = 채널 소유자) + 프로필
 * `sophie` 의 active NPC.
 */
async function seedArtifactChannel() {
  const owner = await seedUser("artifact-owner");
  const gateway = await seedGateway(owner.id, server.baseUrl);
  const channel = await seedChannel(owner.id, "결과물 채널");
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
  await seedNpc({ channelId: channel.id, hermesProfileId: profile.id, positionX: 0, positionY: 0 });
  const { channelBoardSlug } = await import("@/lib/kanban-boards");
  return { owner, channel, boardSlug: channelBoardSlug(channel.id) };
}

test("목록은 채널 NPC 프로필과 채널 보드를 서버가 붙이고, 브라우저의 profiles 값은 무시한다", async () => {
  const { owner, channel, boardSlug } = await seedArtifactChannel();
  server.seedArtifact({ id: "mine", title: "내 것", profile: "sophie", body: "x" });
  server.seedArtifact({ id: "card", title: "카드", profile: "other", board: boardSlug, body: "x" });
  server.seedArtifact({
    id: "foreign",
    title: "남의 것",
    profile: "stranger",
    board: "deskrpg-other",
    body: "x",
  });
  const res = await routes.list.GET(
    req(owner.id, "GET", `${base(channel.id)}?profiles=stranger`),
    ctx(channel.id),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.artifacts.map((a: { id: string }) => a.id).sort(), ["card", "mine"]);
  assert.match(server.lastRequest()!.path, /profiles=sophie&board=/);
});

test("profile 필터는 채널 NPC 만 받는다", async () => {
  const { owner, channel } = await seedArtifactChannel();
  const bad = await routes.list.GET(
    req(owner.id, "GET", `${base(channel.id)}?profile=stranger`),
    ctx(channel.id),
  );
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, "invalid_field");
});

test("taskId 는 플러그인 0.8.4 미만이면 428", async () => {
  // 플러그인 게이트는 게이트웨이 바인딩 시점에 프로브해 캐시한다(~1h) — 바뀐 버전을
  // 보게 하려면 setInfo 를 먼저 하고 그 뒤에 채널+게이트웨이를 새로 심는다.
  server.setInfo({ version: "0.8.3" });
  const { owner, channel } = await seedArtifactChannel();
  const res = await routes.list.GET(
    req(owner.id, "GET", `${base(channel.id)}?taskId=t1`),
    ctx(channel.id),
  );
  assert.equal(res.status, 428);
  server.setInfo({ version: "0.8.4" });
});

test("상세는 채널 범위 밖이면 404 artifact_not_found", async () => {
  const { owner, channel } = await seedArtifactChannel();
  server.seedArtifact({ id: "foreign2", title: "남", profile: "stranger", body: "x" });
  const res = await routes.item.GET(
    req(owner.id, "GET", `${base(channel.id)}/foreign2`),
    ctx(channel.id, "foreign2"),
  );
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, "artifact_not_found");
});

test("게이트: 비로그인 401, 비멤버 403/404, artifacts 능력 없음 428", async () => {
  const { channel } = await seedArtifactChannel();
  const stranger = await seedUser("stranger");
  assert.equal(
    (await routes.list.GET(new NextRequest(base(channel.id)), ctx(channel.id))).status,
    401,
  );
  assert.notEqual(
    (await routes.list.GET(req(stranger.id, "GET", base(channel.id)), ctx(channel.id))).status,
    200,
  );
  server.setInfo({ capabilities: ["kanban", "cron", "events"] });
  const { owner: o2, channel: c2 } = await seedArtifactChannel();
  const r = await routes.list.GET(req(o2.id, "GET", base(c2.id)), ctx(c2.id));
  assert.equal(r.status, 428);
  server.setInfo({ capabilities: ["kanban", "cron", "events", "artifacts"] });
});
