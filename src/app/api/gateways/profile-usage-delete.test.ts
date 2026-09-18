import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import {
  authHeaders,
  seedGatewayBoundToChannels,
  seedProfile,
  setupThrowawaySqlite,
} from "@/test-setup/npc-seed";

// Task 6. 프로필 삭제는 이제 **해고**다 — `npcs.hermes_profile_id` 의 CASCADE 가
// NPC 행을 함께 지운다. 예전 응답 필드 `unboundNpcs`("연결만 풀렸다")는 더 이상
// 사실이 아니라 `deletedNpcs` + `channels` 로 바뀌었고, 삭제 전에 그 수를 미리
// 보여줄 수 있도록 GET 이 같은 수치를 준다.
setupThrowawaySqlite("profile-usage-delete-test");

async function hiredProfile() {
  const { gatewayId, channelIds, userId } = await seedGatewayBoundToChannels({ channels: 2 });
  const profileId = await seedProfile(gatewayId);
  const { hireProfileIntoBoundChannels } = await import("@/lib/npc-roster");
  await hireProfileIntoBoundChannels(profileId);
  return { gatewayId, channelIds, userId, profileId };
}

test("GET 은 이 프로필이 몇 개의 NPC 로 몇 채널에 나가 있는지 알려준다", async () => {
  const { gatewayId, userId, profileId } = await hiredProfile();
  const { GET } = await import("./[id]/profiles/[profileId]/route");

  const res = await GET(
    new NextRequest(`http://localhost/api/gateways/${gatewayId}/profiles/${profileId}`, {
      headers: authHeaders(userId),
    }),
    { params: Promise.resolve({ id: gatewayId, profileId }) },
  );
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).usage, { npcs: 2, channels: 2 });
});

test("DELETE 는 지워진 NPC 수와 채널 수를 돌려주고, npcs 에 그 프로필 행이 남지 않는다", async () => {
  const { gatewayId, userId, profileId } = await hiredProfile();
  const { DELETE } = await import("./[id]/profiles/[profileId]/route");

  const res = await DELETE(
    new NextRequest(`http://localhost/api/gateways/${gatewayId}/profiles/${profileId}`, {
      method: "DELETE",
      headers: authHeaders(userId),
    }),
    { params: Promise.resolve({ id: gatewayId, profileId }) },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.deletedNpcs, 2);
  assert.equal(body.channels, 2);

  const { profileUsage } = await import("@/lib/hermes-profiles");
  assert.deepEqual(await profileUsage(profileId), { npcs: 0, channels: 0 });
});

// 외형의 정본 형태는 `{ officeLookId, bodyType }` 다(office-appearance.ts) — api/characters 가
// 쓰는 것과 같은 모양의 픽스처를 쓴다.
const MALE_APPEARANCE = { officeLookId: "office-jun", bodyType: "male" };
const FEMALE_APPEARANCE = { officeLookId: "office-nari", bodyType: "female" };

test("외형은 소유자만 바꾼다 — 공유받은 사용자는 forbidden", async () => {
  const { gatewayId, userId, profileId } = await hiredProfile();
  const { PATCH } = await import("./[id]/profiles/[profileId]/route");
  const patch = (actorId: string, appearance: unknown) =>
    PATCH(
      new NextRequest(`http://localhost/api/gateways/${gatewayId}/profiles/${profileId}`, {
        method: "PATCH",
        body: JSON.stringify({ appearance }),
        headers: authHeaders(actorId),
      }),
      { params: Promise.resolve({ id: gatewayId, profileId }) },
    );

  assert.equal((await patch(userId, MALE_APPEARANCE)).status, 200);
  const { selectChannelNpcs } = await import("@/lib/npc-projection");
  const { db, npcs } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const [row] = await db.select().from(npcs).where(eq(npcs.hermesProfileId, profileId)).limit(1);
  const roster = await selectChannelNpcs(row.channelId, { roster: true });
  assert.deepEqual(
    (roster.find((n) => n.hermesProfileId === profileId)?.appearance as { bodyType?: string })
      ?.bodyType,
    "male",
    "외형은 프로필이 정본이므로 모든 채널의 NPC 가 함께 바뀐다",
  );

  const { seedUser } = await import("@/test-setup/npc-seed");
  const { createGatewayShare } = await import("@/lib/gateway-resources");
  const other = await seedUser("shared-user");
  const shared = await createGatewayShare({
    ownerUserId: userId,
    gatewayId,
    targetLoginId: other.loginId,
  });
  assert.ok(shared.share, "공유가 실제로 만들어져야 이 테스트가 의미 있다");
  assert.equal((await patch(other.id, FEMALE_APPEARANCE)).status, 403);
});

test("망가진 외형은 400 으로 막는다 — 프로필이 정본이라 모든 채널이 한꺼번에 깨진다", async () => {
  const { gatewayId, userId, profileId } = await hiredProfile();
  const { PATCH } = await import("./[id]/profiles/[profileId]/route");

  const res = await PATCH(
    new NextRequest(`http://localhost/api/gateways/${gatewayId}/profiles/${profileId}`, {
      method: "PATCH",
      body: JSON.stringify({ appearance: "garbage" }),
      headers: authHeaders(userId),
    }),
    { params: Promise.resolve({ id: gatewayId, profileId }) },
  );
  const unknownLook = await PATCH(
    new NextRequest(`http://localhost/api/gateways/${gatewayId}/profiles/${profileId}`, {
      method: "PATCH",
      body: JSON.stringify({ appearance: { officeLookId: "office-nobody", bodyType: "male" } }),
      headers: authHeaders(userId),
    }),
    { params: Promise.resolve({ id: gatewayId, profileId }) },
  );
  assert.equal(unknownLook.status, 400);
  assert.equal((await unknownLook.json()).errorCode, "character_appearance_invalid");
  assert.equal(res.status, 400);
  // api/characters 두 라우트와 같은 코드를 쓴다 — 화면의 번역이 이미 있다.
  assert.equal((await res.json()).errorCode, "character_appearance_invalid");
});

test("GET 은 URL 의 게이트웨이에 속하지 않은 프로필을 404 로 막는다", async () => {
  const a = await hiredProfile();
  const b = await hiredProfile();
  const { GET } = await import("./[id]/profiles/[profileId]/route");

  // A 의 게이트웨이 URL 로 B 의 프로필 수치를 캐낼 수 없다.
  const res = await GET(
    new NextRequest(`http://localhost/api/gateways/${a.gatewayId}/profiles/${b.profileId}`, {
      headers: authHeaders(a.userId),
    }),
    { params: Promise.resolve({ id: a.gatewayId, profileId: b.profileId }) },
  );
  assert.equal(res.status, 404);
  assert.equal((await res.json()).errorCode, "profile_not_found");
});
