import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { authHeaders, seedUser, setupThrowawaySqlite } from "@/test-setup/npc-seed";

/**
 * 채널 목록(`GET /api/channels`)은 카드에 맵 썸네일과 참여자를 그릴 재료를 싣는다 —
 * `environmentId`(맵으로 판정), `memberCount`(소유자 + channel_members), `participants`(앞 다섯 명의
 * 닉네임·최근 캐릭터 외형). 하드코딩돼 있던 `playerCount` 는 더 싣지 않는다.
 *
 * `[id]` 세그먼트 밖에 둔다 — node 테스트 러너가 `[id]` 를 문자 클래스로 오인한다.
 */
setupThrowawaySqlite("channel-list-summary-test");

async function seedOwnerWithGroup() {
  const owner = await seedUser("list-owner");
  const { db, groups, groupMembers } = await import("@/db");
  const [group] = await db
    .insert(groups)
    .values({
      name: "Default",
      slug: `default-${owner.id.slice(0, 8)}`,
      description: "channel list summary test",
      isDefault: true,
      createdBy: owner.id,
    })
    .returning();
  await db
    .insert(groupMembers)
    .values({ groupId: group.id, userId: owner.id, role: "group_admin" });
  return { owner, groupId: group.id };
}

// 테스트 DB 는 SQLite 라 JSON·시각 컬럼이 text 다 — 저장 모양을 그대로 흉내 낸다.
async function addCharacter(
  userId: string,
  appearance: Record<string, unknown>,
  updatedAt: string,
) {
  const { db, characters } = await import("@/db");
  await db.insert(characters).values({
    userId,
    name: `c-${userId.slice(0, 6)}`,
    appearance: JSON.stringify(appearance),
    createdAt: updatedAt,
    updatedAt,
  } as never);
}

test("목록은 환경 ID·참여자 수·앞 다섯 명 미리보기를 싣고 playerCount 는 싣지 않는다", async () => {
  const { owner, groupId } = await seedOwnerWithGroup();
  await addCharacter(owner.id, { officeLookId: "old-look" }, "2026-01-01T00:00:00.000Z");
  await addCharacter(owner.id, { officeLookId: "office-eun" }, "2026-02-01T00:00:00.000Z");

  const { POST, GET } = await import("./route");
  const created = await POST(
    new NextRequest("http://localhost/api/channels", {
      method: "POST",
      headers: authHeaders(owner.id),
      body: JSON.stringify({ name: "기술팀", isPublic: true, groupId, environmentId: "tech" }),
    }),
  );
  const createdBody = (await created.json()) as { channel?: { id: string } };
  assert.equal(created.status, 201, JSON.stringify(createdBody));
  const channelId = createdBody.channel!.id;

  const member = await seedUser("list-member");
  await addCharacter(member.id, { officeLookId: "office-min" }, "2026-03-01T00:00:00.000Z");
  const { db, channelMembers } = await import("@/db");
  await db.insert(channelMembers).values({ channelId, userId: member.id, role: "member" });

  const res = await GET(
    new NextRequest("http://localhost/api/channels", { headers: authHeaders(owner.id) }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { channels: Array<Record<string, unknown>> };
  const channel = body.channels.find((c) => c.id === channelId)!;
  assert.equal(channel.environmentId, "tech");
  assert.equal(channel.memberCount, 2);
  assert.deepEqual(channel.participants, [
    { nickname: owner.nickname, appearance: { officeLookId: "office-eun" } },
    { nickname: member.nickname, appearance: { officeLookId: "office-min" } },
  ]);
  assert.equal("playerCount" in channel, false);
});
