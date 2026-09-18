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
  versions: typeof import("./[id]/artifacts/[artifactId]/versions/route");
  content: typeof import("./[id]/artifacts/[artifactId]/versions/[v]/content/route");
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
    versions: await import("./[id]/artifacts/[artifactId]/versions/route"),
    content: await import("./[id]/artifacts/[artifactId]/versions/[v]/content/route"),
  };
});

after(async () => {
  await server.close();
});

function req(userId: string, method: string, url: string, body?: unknown): NextRequest {
  const headers = new Headers(authHeaders(userId));
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
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

test("category 는 쉼표 목록으로 플러그인에 전달된다", async () => {
  const { owner, channel } = await seedArtifactChannel();
  const res = await routes.list.GET(
    req(owner.id, "GET", `${base(channel.id)}?category=media`),
    ctx(channel.id),
  );
  assert.equal(res.status, 200);
  assert.match(server.lastRequest()!.path, /kind=image%2Cmedia|kind=image,media/);
});

test("모르는 category 는 400 invalid_field", async () => {
  const { owner, channel } = await seedArtifactChannel();
  const res = await routes.list.GET(
    req(owner.id, "GET", `${base(channel.id)}?category=bogus`),
    ctx(channel.id),
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "invalid_field");
});

test("category 와 kind 를 함께 주면 400 invalid_field", async () => {
  const { owner, channel } = await seedArtifactChannel();
  const res = await routes.list.GET(
    req(owner.id, "GET", `${base(channel.id)}?category=media&kind=image`),
    ctx(channel.id),
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "invalid_field");
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

test("내용은 Range 를 넘기고 206 스트림을, 범위 밖은 404 를 준다", async () => {
  const { owner, channel } = await seedArtifactChannel();
  server.seedArtifact({
    id: "c1",
    title: "t",
    profile: "sophie",
    body: "0123456789",
    mime: "text/plain",
  });
  const r = new NextRequest(`${base(channel.id)}/c1/versions/1/content`, {
    headers: { ...authHeaders(owner.id), range: "bytes=2-5" },
  });
  const res = await routes.content.GET(r, ctx(channel.id, "c1", "1"));
  assert.equal(res.status, 206);
  assert.equal(await res.text(), "2345");
  assert.equal(res.headers.get("content-security-policy"), "sandbox");
  server.seedArtifact({ id: "c2", title: "t", profile: "stranger", body: "x" });
  const out = await routes.content.GET(
    req(owner.id, "GET", `${base(channel.id)}/c2/versions/1/content`),
    ctx(channel.id, "c2", "1"),
  );
  assert.equal(out.status, 404);
  const bad = await routes.content.GET(
    req(owner.id, "GET", `${base(channel.id)}/c1/versions/x/content`),
    ctx(channel.id, "c1", "x"),
  );
  assert.equal(bad.status, 400);
});

test("새 버전은 사용자 id 를 X-DeskRPG-User 로 붙여 201", async () => {
  const { owner, channel } = await seedArtifactChannel();
  server.seedArtifact({ id: "e1", title: "t", profile: "sophie", body: "v1" });
  const res = await routes.versions.POST(
    req(owner.id, "POST", `${base(channel.id)}/e1/versions`, {
      content: "v2",
      filename: "t.md",
      note: "고침",
    }),
    ctx(channel.id, "e1"),
  );
  assert.equal(res.status, 201);
  assert.equal(server.lastRequest()!.headers["x-deskrpg-user"], owner.id);
  const bad = await routes.versions.POST(
    req(owner.id, "POST", `${base(channel.id)}/e1/versions`, { content: 1 }),
    ctx(channel.id, "e1"),
  );
  assert.equal(bad.status, 400);
});

test("삭제는 범위 안이면 ok, 밖이면 404", async () => {
  const { owner, channel } = await seedArtifactChannel();
  server.seedArtifact({ id: "d1", title: "t", profile: "sophie", body: "x" });
  const ok = await routes.item.DELETE(
    req(owner.id, "DELETE", `${base(channel.id)}/d1`),
    ctx(channel.id, "d1"),
  );
  assert.equal(ok.status, 200);
  server.seedArtifact({ id: "d2", title: "t", profile: "stranger", body: "x" });
  const out = await routes.item.DELETE(
    req(owner.id, "DELETE", `${base(channel.id)}/d2`),
    ctx(channel.id, "d2"),
  );
  assert.equal(out.status, 404);
});

/**
 * 같은 게이트웨이에 묶인 채널 A·B. 프로필 `sophie` 는 두 채널 모두에 고용, `solo` 는 A 에만.
 * (플러그인 게이트는 게이트웨이마다 캐시한다 — 두 채널이 한 게이트웨이를 공유하는 것이 이 경우다.)
 */
async function seedSharedGateway() {
  const owner = await seedUser("artifact-shared-owner");
  const gateway = await seedGateway(owner.id, server.baseUrl);
  const { bindGatewayToChannel } = await import("@/lib/gateway-resources");
  const { channelBoardSlug } = await import("@/lib/kanban-boards");
  const a = await seedChannel(owner.id, "채널 A");
  const b = await seedChannel(owner.id, "채널 B");
  for (const ch of [a, b]) {
    await bindGatewayToChannel({
      channelId: ch.id,
      gatewayId: gateway.id,
      boundByUserId: owner.id,
    });
  }
  const sophie = await seedHermesProfile(gateway.id, {
    profileName: "sophie",
    displayName: "소피",
  });
  const solo = await seedHermesProfile(gateway.id, { profileName: "solo", displayName: "솔로" });
  await seedNpc({ channelId: a.id, hermesProfileId: sophie.id, positionX: 0, positionY: 0 });
  await seedNpc({ channelId: b.id, hermesProfileId: sophie.id, positionX: 1, positionY: 0 });
  await seedNpc({ channelId: a.id, hermesProfileId: solo.id, positionX: 2, positionY: 0 });
  return { owner, a, b, boardA: channelBoardSlug(a.id), boardB: channelBoardSlug(b.id) };
}

function mutatingArtifactRequests(since: number) {
  return server
    .requests()
    .slice(since)
    .filter(
      (r) =>
        r.path.startsWith("/deskrpg/artifacts") &&
        (r.method === "DELETE" || (r.method === "POST" && r.path.includes("/versions"))),
    );
}

test("F3: 다른 채널과 공유한 프로필의 채팅 결과물은 읽기만 된다 — 편집·삭제 403, 플러그인에 안 보낸다", async () => {
  const { owner, b } = await seedSharedGateway();
  server.seedArtifact({ id: "shared-chat", title: "공유", profile: "sophie", body: "v1" });

  const got = await routes.item.GET(
    req(owner.id, "GET", `${base(b.id)}/shared-chat`),
    ctx(b.id, "shared-chat"),
  );
  assert.equal(got.status, 200);
  assert.equal((await got.json()).modifiable, false);

  const before = server.requests().length;
  const edit = await routes.versions.POST(
    req(owner.id, "POST", `${base(b.id)}/shared-chat/versions`, {
      content: "v2",
      filename: "t.md",
    }),
    ctx(b.id, "shared-chat"),
  );
  assert.equal(edit.status, 403);
  const editBody = await edit.json();
  assert.equal(editBody.code, "artifact_read_only_other_channel");
  assert.equal(editBody.message, "Artifacts from another channel are read-only here");
  const del = await routes.item.DELETE(
    req(owner.id, "DELETE", `${base(b.id)}/shared-chat`),
    ctx(b.id, "shared-chat"),
  );
  assert.equal(del.status, 403);
  assert.equal((await del.json()).code, "artifact_read_only_other_channel");
  assert.equal(mutatingArtifactRequests(before).length, 0, "플러그인 변경 경로를 부르지 않는다");
});

test("F3: 이 채널에만 고용된 프로필의 채팅 결과물은 고칠 수 있다", async () => {
  const { owner, a } = await seedSharedGateway();
  server.seedArtifact({ id: "solo-chat", title: "솔로", profile: "solo", body: "v1" });
  const got = await routes.item.GET(
    req(owner.id, "GET", `${base(a.id)}/solo-chat`),
    ctx(a.id, "solo-chat"),
  );
  assert.equal((await got.json()).modifiable, true);
  const edit = await routes.versions.POST(
    req(owner.id, "POST", `${base(a.id)}/solo-chat/versions`, { content: "v2", filename: "t.md" }),
    ctx(a.id, "solo-chat"),
  );
  assert.equal(edit.status, 201);
  const del = await routes.item.DELETE(
    req(owner.id, "DELETE", `${base(a.id)}/solo-chat`),
    ctx(a.id, "solo-chat"),
  );
  assert.equal(del.status, 200);
});

test("F3: 보드 결과물은 그 보드의 채널에서만 고친다 — 다른 채널은 읽기만", async () => {
  const { owner, a, b, boardA } = await seedSharedGateway();
  server.seedArtifact({
    id: "board-a",
    title: "카드 결과",
    profile: "sophie",
    board: boardA,
    source_kind: "kanban",
    task_id: "t-1",
    body: "v1",
  });
  const inB = await routes.item.GET(
    req(owner.id, "GET", `${base(b.id)}/board-a`),
    ctx(b.id, "board-a"),
  );
  assert.equal(inB.status, 200);
  const inBBody = await inB.json();
  assert.equal(inBBody.modifiable, false);
  assert.equal(inBBody.sourceInChannel, false, "다른 보드의 카드로는 출처 이동을 못 한다");

  const before = server.requests().length;
  const editB = await routes.versions.POST(
    req(owner.id, "POST", `${base(b.id)}/board-a/versions`, { content: "v2", filename: "t.md" }),
    ctx(b.id, "board-a"),
  );
  assert.equal(editB.status, 403);
  const delB = await routes.item.DELETE(
    req(owner.id, "DELETE", `${base(b.id)}/board-a`),
    ctx(b.id, "board-a"),
  );
  assert.equal(delB.status, 403);
  assert.equal(mutatingArtifactRequests(before).length, 0);

  const inA = await routes.item.GET(
    req(owner.id, "GET", `${base(a.id)}/board-a`),
    ctx(a.id, "board-a"),
  );
  const inABody = await inA.json();
  assert.equal(inABody.modifiable, true);
  assert.equal(inABody.sourceInChannel, true);
  const editA = await routes.versions.POST(
    req(owner.id, "POST", `${base(a.id)}/board-a/versions`, { content: "v2", filename: "t.md" }),
    ctx(a.id, "board-a"),
  );
  assert.equal(editA.status, 201);
  const delA = await routes.item.DELETE(
    req(owner.id, "DELETE", `${base(a.id)}/board-a`),
    ctx(a.id, "board-a"),
  );
  assert.equal(delA.status, 200);
});

test("F4: '.'·'..'·'a/b' 같은 id 는 플러그인을 부르기 전에 404 artifact_not_found", async () => {
  const { owner, channel } = await seedArtifactChannel();
  for (const bad of [".", "..", "a/b", "", "x".repeat(129), "a b"]) {
    const before = server.requests().length;
    const responses = [
      await routes.item.GET(req(owner.id, "GET", `${base(channel.id)}/x`), ctx(channel.id, bad)),
      await routes.item.DELETE(
        req(owner.id, "DELETE", `${base(channel.id)}/x`),
        ctx(channel.id, bad),
      ),
      await routes.versions.POST(
        req(owner.id, "POST", `${base(channel.id)}/x/versions`, { content: "v", filename: "t" }),
        ctx(channel.id, bad),
      ),
      await routes.content.GET(
        req(owner.id, "GET", `${base(channel.id)}/x/versions/1/content`),
        ctx(channel.id, bad, "1"),
      ),
    ];
    for (const res of responses) {
      assert.equal(res.status, 404, `id ${JSON.stringify(bad)}`);
      assert.equal((await res.json()).code, "artifact_not_found");
    }
    assert.equal(
      server
        .requests()
        .slice(before)
        .filter((r) => r.path.startsWith("/deskrpg/artifacts")).length,
      0,
      `id ${JSON.stringify(bad)} 로 결과물 경로를 부르지 않는다`,
    );
  }
});

test("F4: 플러그인 상세 응답에 artifact 가 없으면 404 로 본다", async () => {
  const { loadScopedArtifact } = await import("@/lib/artifact-access");
  const fakeCtx = {
    userId: "u",
    channelId: "c",
    gatewayId: "g",
    boardSlug: "deskrpg-c",
    profiles: ["sophie"],
    pluginVersion: "0.8.4",
    client: { artifacts: { get: async () => ({ ok: true, data: {} }) } },
  } as unknown as Parameters<typeof loadScopedArtifact>[0];
  const loaded = await loadScopedArtifact(fakeCtx, "abc");
  assert.equal(loaded.ok, false);
  if (!loaded.ok) {
    assert.equal(loaded.response.status, 404);
    assert.equal((await loaded.response.json()).code, "artifact_not_found");
  }
});
