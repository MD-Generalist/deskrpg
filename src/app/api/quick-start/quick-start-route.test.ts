import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import {
  authHeaders,
  seedGateway,
  seedHermesProfile,
  seedNpc,
  seedUser,
  setupThrowawaySqlite,
} from "@/test-setup/npc-seed";

/**
 * 계약 4-B "빠른 시작".
 *
 * 검증의 초점은 **재사용**이다 — 이 라우트는 도메인 규칙을 새로 만들지 않고
 * 캐릭터·채널·배치 라우트를 그대로 부른다. 그래서 여기서 확인할 것은
 * "무엇이 만들어졌는가" 와 "두 번 불러도 늘어나지 않는가", 그리고 채널당
 * `kind=office` 방이 정확히 하나라는 불변식이 그대로인가다.
 */
setupThrowawaySqlite("quick-start-route-test");

async function seedDefaultGroupAdmin() {
  const user = await seedUser("quick-start");
  const { db, groups, groupMembers } = await import("@/db");
  const [group] = await db
    .insert(groups)
    .values({
      name: "Default",
      slug: `default-${user.id.slice(0, 8)}`,
      description: "quick start test workspace",
      isDefault: true,
      createdBy: user.id,
    })
    .returning();
  await db.insert(groupMembers).values({ groupId: group.id, userId: user.id, role: "group_admin" });
  return { userId: user.id, groupId: group.id };
}

function quickStartRequest(userId?: string) {
  return new NextRequest("http://localhost/api/quick-start", {
    method: "POST",
    headers: userId ? authHeaders(userId) : { "Content-Type": "application/json" },
  });
}

async function callQuickStart(userId?: string) {
  const { POST } = await import("./route");
  const response = await POST(quickStartRequest(userId));
  return { response, body: (await response.json()) as Record<string, unknown> };
}

async function countRows(userId: string) {
  const { db, characters, channels } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const chars = await db
    .select({ id: characters.id })
    .from(characters)
    .where(eq(characters.userId, userId));
  const chans = await db
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.ownerId, userId));
  return { characters: chars.length, channels: chans.length };
}

test("캐릭터·채널이 없으면 만든다", async () => {
  const { userId } = await seedDefaultGroupAdmin();

  const { response, body } = await callQuickStart(userId);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(typeof body.channelId, "string");
  assert.equal(typeof body.characterId, "string");

  assert.deepEqual(await countRows(userId), { characters: 1, channels: 1 });

  // 하드 게이트: 채널마다 kind=office 방이 정확히 하나. 채널 라우트의
  // `ensureOfficeRoom` 을 그대로 거쳤다는 증거다.
  const { db, chatRooms } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const offices = await db
    .select({ id: chatRooms.id })
    .from(chatRooms)
    .where(and(eq(chatRooms.channelId, body.channelId as string), eq(chatRooms.kind, "office")));
  assert.equal(offices.length, 1);
});

test("이미 캐릭터·채널이 있으면 그것을 재사용한다", async () => {
  const { userId } = await seedDefaultGroupAdmin();

  const first = await callQuickStart(userId);
  assert.equal(first.response.status, 200);
  const second = await callQuickStart(userId);
  assert.equal(second.response.status, 200);

  assert.equal(second.body.channelId, first.body.channelId, "채널을 다시 만들지 않는다");
  assert.equal(second.body.characterId, first.body.characterId, "캐릭터를 다시 만들지 않는다");
  assert.deepEqual(await countRows(userId), { characters: 1, channels: 1 });
});

test("게이트웨이가 하나도 없어도 성공한다", async () => {
  const { userId } = await seedDefaultGroupAdmin();

  const { db, gatewayResources } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const owned = await db
    .select({ id: gatewayResources.id })
    .from(gatewayResources)
    .where(eq(gatewayResources.ownerUserId, userId));
  assert.equal(owned.length, 0, "전제: 게이트웨이가 없다");

  const { response, body } = await callQuickStart(userId);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(typeof body.channelId, "string");
});

test("게이트웨이를 붙이고 출근시키면 곧바로 데스크 좌석에 앉는다", async () => {
  const { userId } = await seedDefaultGroupAdmin();
  const first = await callQuickStart(userId);
  const channelId = first.body.channelId as string;

  // 게이트웨이를 붙이고 프로필을 출근시킨다 — 고용 경로가 이미 배치까지 끝낸다.
  const gateway = await seedGateway(userId);
  await seedHermesProfile(gateway.id);
  const { bindGatewayToChannel } = await import("@/lib/gateway-resources");
  const { hireGatewayProfilesIntoChannel } = await import("@/lib/npc-roster");
  await bindGatewayToChannel({ channelId, gatewayId: gateway.id, boundByUserId: userId });
  await hireGatewayProfilesIntoChannel(channelId, gateway.id);

  const { db, npcs } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const after = await db.select().from(npcs).where(eq(npcs.channelId, channelId));
  assert.equal(after.length, 1);
  assert.ok(
    Number.isInteger(after[0].positionX) && Number.isInteger(after[0].positionY),
    "데스크 좌석 또는 서는 칸에 이미 앉아 있다",
  );
});

test("빠른 시작은 이 기능 이전에 자리 없이 만들어진 직원의 안전망이다", async () => {
  const { userId } = await seedDefaultGroupAdmin();
  const first = await callQuickStart(userId);
  const channelId = first.body.channelId as string;

  // `hireGatewayProfilesIntoChannel` 을 거치지 않고 자리 미정 NPC 를 직접 심는다 —
  // 이 기능 이전 데이터를 흉내낸다.
  const gateway = await seedGateway(userId);
  const profile = await seedHermesProfile(gateway.id);
  const { bindGatewayToChannel } = await import("@/lib/gateway-resources");
  await bindGatewayToChannel({ channelId, gatewayId: gateway.id, boundByUserId: userId });
  await seedNpc({ channelId, hermesProfileId: profile.id, active: true });

  const { db, npcs } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const before = await db.select().from(npcs).where(eq(npcs.channelId, channelId));
  assert.equal(before.length, 1);
  assert.equal(before[0].positionX, null, "전제: 아직 자리가 없다");

  const second = await callQuickStart(userId);
  assert.equal(second.response.status, 200);

  const after = await db.select().from(npcs).where(eq(npcs.channelId, channelId));
  assert.equal(after.length, 1, "NPC 를 새로 만들지 않는다");
  assert.ok(
    Number.isInteger(after[0].positionX) && Number.isInteger(after[0].positionY),
    "데스크 좌석 또는 서는 칸에 앉았다",
  );
});

test("비로그인은 거부한다", async () => {
  const { response, body } = await callQuickStart();
  assert.equal(response.status, 401);
  assert.equal(body.errorCode, "unauthorized");
});

test("응답에는 식별자 둘뿐이고 토큰이 실리지 않는다", async () => {
  const { userId } = await seedDefaultGroupAdmin();
  const gateway = await seedGateway(userId);
  await seedHermesProfile(gateway.id);

  const { response, body } = await callQuickStart(userId);
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), ["channelId", "characterId"]);

  const serialized = JSON.stringify(body);
  for (const secret of ["token", "Token", "gateway-owner-key", "profile-key", "tokenEncrypted"]) {
    assert.ok(!serialized.includes(secret), `응답에 ${secret} 이(가) 있으면 안 된다`);
  }
});
