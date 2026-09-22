import { after, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { startFakePluginServer, type FakePluginServer } from "@/lib/hermes/fake-plugin-server";
import {
  authHeaders,
  seedChannel,
  seedGateway,
  seedUser,
  setupThrowawaySqlite,
  startStubHermesGateway,
} from "@/test-setup/npc-seed";

// T4. 채널이 게이트웨이에 묶이는 순간 DeskRPG 는 그 게이트웨이에 칸반 보드를 확보한다.
//
// - 보드는 Hermes 가 정본이다. 여기 남기는 것은 (채널, 게이트웨이, slug) 연결 기록뿐이다.
// - 확보 실패는 바인딩을 막지 않는다 — `last_error` 에 이유를 남기고 다음 진입 때 재시도한다.
// - 게이트웨이를 바꾸면 카드와 크론은 이전 게이트웨이에 남는다(응답에 경고를 실어 준다).
//
// `[id]` 세그먼트 밖에 둔다 — node 테스트 러너가 `[id]` 를 문자 클래스로 오인해 그 안의
// *.test.ts 를 못 줍는다(gateway-bind-hires.test.ts 와 같은 이유).
setupThrowawaySqlite("kanban-board-ensure-test");

// `seedGateway` 가 심는 오너 키와 같아야 가짜 서버가 오너 경로를 열어 준다.
const OWNER_TOKEN = "gateway-owner-key-1234567890";
const SLUG_RE = /^deskrpg-[0-9a-f]{32}$/;

const servers: FakePluginServer[] = [];
async function startPlugin(info?: { version?: string; capabilities?: string[] }) {
  const server = await startFakePluginServer({
    ownerToken: OWNER_TOKEN,
    profileTokens: { sophie: "profile-key-1234567890" },
    info,
  });
  servers.push(server);
  return server;
}
after(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

function bindRequest(channelId: string, userId: string, gatewayId: string) {
  return new NextRequest(`http://localhost/api/channels/${channelId}/gateway`, {
    method: "PUT",
    body: JSON.stringify({ gatewayId }),
    headers: authHeaders(userId),
  });
}

async function bind(channelId: string, userId: string, gatewayId: string) {
  const { PUT } = await import("./[id]/gateway/route");
  return PUT(bindRequest(channelId, userId, gatewayId), {
    params: Promise.resolve({ id: channelId }),
  });
}

async function rename(channelId: string, userId: string, name: string) {
  const { PUT } = await import("./[id]/route");
  return PUT(
    new NextRequest(`http://localhost/api/channels/${channelId}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
      headers: authHeaders(userId),
    }),
    { params: Promise.resolve({ id: channelId }) },
  );
}

async function readBoardRow(channelId: string) {
  const { getChannelBoard } = await import("@/lib/kanban-boards");
  return getChannelBoard(channelId);
}

function boardRequests(server: FakePluginServer) {
  return server.requests().filter((r) => r.path.startsWith("/deskrpg/kanban/boards"));
}

test("channelBoardSlug — `deskrpg-` + 하이픈 뺀 UUID 32자 소문자", async () => {
  const { channelBoardSlug } = await import("@/lib/kanban-boards");
  assert.equal(
    channelBoardSlug("0F8FAD5B-D9CB-469F-A165-70867728950E"),
    "deskrpg-0f8fad5bd9cb469fa16570867728950e",
  );
  assert.match(channelBoardSlug(crypto.randomUUID()), SLUG_RE);
});

test("최초 바인딩은 보드를 만든다 — slug 규칙, 표시 이름 = 채널 이름, 연결 행 기록", async () => {
  const plugin = await startPlugin();
  const user = await seedUser("board-owner");
  const gateway = await seedGateway(user.id, plugin.baseUrl);
  const channel = await seedChannel(user.id, "기획팀 채널");

  const res = await bind(channel.id, user.id, gateway.id);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.warning, undefined, "최초 바인딩에는 경고가 없다");

  const created = boardRequests(plugin).filter((r) => r.method === "POST");
  assert.equal(created.length, 1, "POST /deskrpg/kanban/boards 한 번");
  const sent = created[0].json as { slug: string; name: string };
  assert.match(sent.slug, SLUG_RE);
  assert.equal(sent.slug, `deskrpg-${channel.id.replace(/-/g, "").toLowerCase()}`);
  assert.equal(sent.name, "기획팀 채널");
  assert.equal(created[0].status, 201);

  const row = await readBoardRow(channel.id);
  assert.ok(row, "channel_kanban_boards 행이 있어야 한다");
  assert.equal(row.gatewayId, gateway.id);
  assert.equal(row.boardSlug, sent.slug);
  assert.equal(row.lastError, null);
  assert.ok(row.boardNameSyncedAt, "이름을 맞춘 시각이 찍힌다");
});

test("같은 게이트웨이에 다시 바인딩하면 보드를 재사용한다 — 중복 생성 없음", async () => {
  const plugin = await startPlugin();
  const user = await seedUser("board-owner");
  const gateway = await seedGateway(user.id, plugin.baseUrl);
  const channel = await seedChannel(user.id, "재사용 채널");

  assert.equal((await bind(channel.id, user.id, gateway.id)).status, 200);
  assert.equal((await bind(channel.id, user.id, gateway.id)).status, 200);

  const { ensureChannelBoard } = await import("@/lib/kanban-boards");
  const again = await ensureChannelBoard(channel.id);
  assert.equal(again.ok, true, "멱등 — 다시 불러도 성공");

  const posts = boardRequests(plugin).filter((r) => r.method === "POST");
  assert.ok(posts.length >= 2, "재시도마다 POST 는 나가지만");
  assert.deepEqual(
    posts.slice(1).map((r) => r.status),
    posts.slice(1).map(() => 200),
    "두 번째부터는 기존 보드를 200 으로 돌려준다",
  );

  const { createOwnerPluginClient } = await import("@/lib/hermes/plugin-client");
  const client = createOwnerPluginClient({ baseUrl: plugin.baseUrl, ownerToken: OWNER_TOKEN });
  const boards = await client.kanban.listBoards();
  assert.ok(boards.ok);
  assert.equal(boards.data.boards.length, 1, "보드는 하나뿐");
});

test("플러그인이 없어도(404) 바인딩은 성공하고 행에 이유가 남는다 — 칸반 호출 없음", async () => {
  const stub = await startStubHermesGateway();
  try {
    const user = await seedUser("board-owner");
    const gateway = await seedGateway(user.id, stub.baseUrl);
    const channel = await seedChannel(user.id, "플러그인 없음");

    const res = await bind(channel.id, user.id, gateway.id);
    assert.equal(res.status, 200, "확보 실패는 바인딩을 막지 않는다");

    const row = await readBoardRow(channel.id);
    assert.ok(row);
    assert.equal(row.gatewayId, gateway.id);
    assert.match(row.boardSlug, SLUG_RE, "slug 는 계산된 값으로 둔다");
    assert.equal(row.lastError, "plugin_absent");
    assert.equal(row.boardNameSyncedAt, null);
  } finally {
    stub.close();
  }
});

test("오너 키가 틀리면(401) 바인딩은 성공하고 last_error 는 plugin_unauthorized", async () => {
  const plugin = await startPlugin();
  const user = await seedUser("board-owner");
  const { db, gatewayResources } = await import("@/db");
  const { encryptGatewayToken } = await import("@/lib/gateway-resources");
  const [gateway] = await db
    .insert(gatewayResources)
    .values({
      ownerUserId: user.id,
      displayName: "Wrong Key Gateway",
      baseUrl: plugin.baseUrl,
      tokenEncrypted: encryptGatewayToken("not-the-owner-key"),
    })
    .returning();
  const channel = await seedChannel(user.id, "권한 없음");

  assert.equal((await bind(channel.id, user.id, gateway.id)).status, 200);

  const row = await readBoardRow(channel.id);
  assert.ok(row);
  assert.equal(row.lastError, "plugin_unauthorized");
  assert.equal(boardRequests(plugin).length, 0, "칸반 경로는 건드리지 않는다");
});

test("플러그인 0.6.0 미만이면 확보를 시도하지 않고 plugin_upgrade_required 를 남긴다", async () => {
  const plugin = await startPlugin({ version: "0.5.9" });
  const user = await seedUser("board-owner");
  const gateway = await seedGateway(user.id, plugin.baseUrl);
  const channel = await seedChannel(user.id, "버전 미달");

  assert.equal((await bind(channel.id, user.id, gateway.id)).status, 200);

  const row = await readBoardRow(channel.id);
  assert.ok(row);
  assert.equal(row.lastError, "plugin_upgrade_required");
  assert.equal(boardRequests(plugin).length, 0, "칸반 경로는 건드리지 않는다");

  // 판정 근거(info 블록)는 게이트웨이 캐시에 남는다.
  const { db, gatewayResources } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const [cached] = await db
    .select()
    .from(gatewayResources)
    .where(eq(gatewayResources.id, gateway.id));
  assert.equal(cached.pluginStatus, "plugin_ready");
  assert.equal(cached.pluginVersion, "0.5.9");
  assert.ok(cached.pluginInfoJson, "plugin_info_json 이 채워진다");
  assert.deepEqual(JSON.parse(cached.pluginInfoJson as string).capabilities, [
    "kanban",
    "cron",
    "events",
    "swarm",
    "kanban_views",
    "initial_status",
    "kanban_review_policy_v1",
  ]);
});

test("캐시가 신선한 plugin_ready 인데 info_json 이 없으면 재프로브한 뒤 보드를 확보한다", async () => {
  // 설정 마법사(setup/service.ts)가 예전에 남긴 캐시 모양 — status/version 만 있고 info 는 없다.
  // 이것을 "계약 미달" 로 읽으면 한 시간 동안 보드 확보가 막힌다(독립 검토 지적).
  const plugin = await startPlugin();
  const user = await seedUser("board-owner");
  const gateway = await seedGateway(user.id, plugin.baseUrl);
  const channel = await seedChannel(user.id, "캐시만 있는 채널");
  const { db, gatewayResources, nowForDb } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  await db
    .update(gatewayResources)
    .set({
      pluginStatus: "plugin_ready",
      pluginVersion: "0.6.0",
      pluginCheckedAt: nowForDb(),
      pluginInfoJson: null,
    })
    .where(eq(gatewayResources.id, gateway.id));

  assert.equal((await bind(channel.id, user.id, gateway.id)).status, 200);

  const paths = plugin.requests().map((r) => `${r.method} ${r.path}`);
  assert.ok(paths.includes("GET /deskrpg/info"), "info 를 다시 찌른다");
  assert.ok(paths.includes("POST /deskrpg/kanban/boards"), "그 뒤 보드를 확보한다");

  const row = await readBoardRow(channel.id);
  assert.ok(row);
  assert.equal(row.lastError, null);

  const [cached] = await db
    .select()
    .from(gatewayResources)
    .where(eq(gatewayResources.id, gateway.id));
  assert.ok(cached.pluginInfoJson, "재프로브 결과의 info 가 캐시에 채워진다");
});

test("게이트웨이를 바꾸면 새 게이트웨이에 보드를 확보하고 이전 보드는 남는다 + 경고", async () => {
  const pluginA = await startPlugin();
  const pluginB = await startPlugin();
  const user = await seedUser("board-owner");
  const gatewayA = await seedGateway(user.id, pluginA.baseUrl);
  const gatewayB = await seedGateway(user.id, pluginB.baseUrl);
  const channel = await seedChannel(user.id, "이사 가는 채널");

  assert.equal((await bind(channel.id, user.id, gatewayA.id)).status, 200);
  const res = await bind(channel.id, user.id, gatewayB.id);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.warning, "previous_board_retained");

  const row = await readBoardRow(channel.id);
  assert.ok(row);
  assert.equal(row.gatewayId, gatewayB.id, "행은 새 게이트웨이로 대체된다");
  assert.equal(row.lastError, null);

  assert.equal(boardRequests(pluginB).filter((r) => r.method === "POST").length, 1);
  assert.equal(
    boardRequests(pluginA).filter((r) => r.method === "DELETE").length,
    0,
    "이전 게이트웨이의 보드는 지우지 않는다",
  );

  // 같은 게이트웨이를 다시 저장하는 것은 교체가 아니다 — 경고 없음.
  const same = await (await bind(channel.id, user.id, gatewayB.id)).json();
  assert.equal(same.warning, undefined);
});

test("게이트웨이 연결을 해제해도 연결 행은 남는다(보드도 Hermes 에 남는다)", async () => {
  const plugin = await startPlugin();
  const user = await seedUser("board-owner");
  const gateway = await seedGateway(user.id, plugin.baseUrl);
  const channel = await seedChannel(user.id, "해제 채널");
  assert.equal((await bind(channel.id, user.id, gateway.id)).status, 200);

  const { DELETE } = await import("./[id]/gateway/route");
  const res = await DELETE(
    new NextRequest(`http://localhost/api/channels/${channel.id}/gateway`, {
      method: "DELETE",
      headers: authHeaders(user.id),
    }),
    { params: Promise.resolve({ id: channel.id }) },
  );
  assert.equal(res.status, 200);
  assert.ok(await readBoardRow(channel.id), "연결 기록은 유지한다");
  assert.equal(boardRequests(plugin).filter((r) => r.method === "DELETE").length, 0);
});

test("채널 이름을 바꾸면 보드 이름도 PATCH 로 맞추고 synced_at 을 갱신한다", async () => {
  const plugin = await startPlugin();
  const user = await seedUser("board-owner");
  const gateway = await seedGateway(user.id, plugin.baseUrl);
  const channel = await seedChannel(user.id, "옛 이름");
  assert.equal((await bind(channel.id, user.id, gateway.id)).status, 200);
  const before = (await readBoardRow(channel.id))!.boardNameSyncedAt as unknown as string;
  await new Promise((r) => setTimeout(r, 5));

  const res = await rename(channel.id, user.id, "새 이름");
  assert.equal(res.status, 200);

  const patch = plugin.lastRequest();
  assert.ok(patch);
  assert.equal(patch.method, "PATCH");
  assert.equal(patch.path, `/deskrpg/kanban/boards/${channelBoardSlugOf(channel.id)}`);
  assert.deepEqual(patch.json, { name: "새 이름" });

  const row = await readBoardRow(channel.id);
  assert.ok(row);
  assert.notEqual(row.boardNameSyncedAt, before, "synced_at 이 앞으로 간다");
  assert.equal(row.lastError, null);

  const { createOwnerPluginClient } = await import("@/lib/hermes/plugin-client");
  const client = createOwnerPluginClient({ baseUrl: plugin.baseUrl, ownerToken: OWNER_TOKEN });
  const boards = await client.kanban.listBoards();
  assert.ok(boards.ok);
  assert.equal(boards.data.boards[0].name, "새 이름");
});

test("이름이 그대로인 PUT 은 보드를 건드리지 않는다", async () => {
  const plugin = await startPlugin();
  const user = await seedUser("board-owner");
  const gateway = await seedGateway(user.id, plugin.baseUrl);
  const channel = await seedChannel(user.id, "같은 이름");
  assert.equal((await bind(channel.id, user.id, gateway.id)).status, 200);
  const countBefore = plugin.requests().length;

  assert.equal((await rename(channel.id, user.id, "같은 이름")).status, 200);
  assert.equal(plugin.requests().length, countBefore, "요청이 나가지 않는다");
});

test("보드 이름 동기화가 실패해도 채널 개명은 200 이고 synced_at 은 그대로다", async () => {
  const plugin = await startPlugin();
  const user = await seedUser("board-owner");
  const gateway = await seedGateway(user.id, plugin.baseUrl);
  const channel = await seedChannel(user.id, "끊길 채널");
  assert.equal((await bind(channel.id, user.id, gateway.id)).status, 200);
  const before = (await readBoardRow(channel.id))!.boardNameSyncedAt;

  // 게이트웨이가 죽는다. 플러그인 판정 캐시는 아직 신선하므로 PATCH 까지는 가고 거기서 실패한다.
  await plugin.close();
  servers.splice(servers.indexOf(plugin), 1);

  const res = await rename(channel.id, user.id, "바뀐 이름");
  assert.equal(res.status, 200, "개명은 성공한다");
  assert.equal((await res.json()).channel.name, "바뀐 이름");

  const row = await readBoardRow(channel.id);
  assert.ok(row);
  assert.equal(row.boardNameSyncedAt, before, "synced_at 은 바뀌지 않는다");
  assert.equal(row.lastError, "unreachable", "다음 폴링이 재시도할 이유를 남긴다");
});

function channelBoardSlugOf(channelId: string) {
  return `deskrpg-${channelId.replace(/-/g, "").toLowerCase()}`;
}
