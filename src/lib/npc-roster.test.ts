import assert from "node:assert/strict";
import test from "node:test";

import {
  setupThrowawaySqlite,
  seedChannelWithProfiles,
  seedGatewayBoundToChannels,
  seedProfile,
} from "@/test-setup/npc-seed";

// `db` 는 지연 초기화 싱글턴이고 node:test 는 파일마다 프로세스를 나누므로, 모듈
// 최상단에서 한 번 임시 DB 를 잡으면 이 파일의 모든 테스트가 그 DB 를 쓴다.
setupThrowawaySqlite("npc-roster-test");

test("연결하면 프로필마다 자리 미정 NPC 가 생기고, 재연결은 중복을 만들지 않는다", async () => {
  const { hireGatewayProfilesIntoChannel } = await import("./npc-roster");
  const { selectChannelNpcs } = await import("./npc-projection");

  const { channelId, gatewayId } = await seedChannelWithProfiles({ profiles: 3, placedActive: 0 });
  const first = await hireGatewayProfilesIntoChannel(channelId, gatewayId);
  assert.deepEqual(first, { created: 3, reactivated: 0 });
  const rows = await selectChannelNpcs(channelId, { roster: true });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.positionX === null && r.active));

  const again = await hireGatewayProfilesIntoChannel(channelId, gatewayId);
  assert.deepEqual(again, { created: 0, reactivated: 0 });
  assert.equal((await selectChannelNpcs(channelId, { roster: true })).length, 3);
});

test("휴면 후 재연결하면 자리를 되찾는다", async () => {
  const { hireGatewayProfilesIntoChannel, sleepChannelNpcs } = await import("./npc-roster");
  const { selectChannelNpcs } = await import("./npc-projection");

  const { channelId, gatewayId } = await seedChannelWithProfiles({ placedActive: 1 });
  const [n] = await selectChannelNpcs(channelId, { roster: true });
  await sleepChannelNpcs(channelId, gatewayId);
  assert.equal((await selectChannelNpcs(channelId)).length, 0, "맵에서 빠진다");
  const r = await hireGatewayProfilesIntoChannel(channelId, gatewayId);
  assert.deepEqual(r, { created: 0, reactivated: 1 });
  const [back] = await selectChannelNpcs(channelId);
  assert.equal(back.positionX, n.positionX, "자리가 보존된다");
});

test("새 프로필은 이미 묶인 채널 전부에 출근한다", async () => {
  const { hireProfileIntoBoundChannels } = await import("./npc-roster");
  const { selectChannelNpcs } = await import("./npc-projection");

  const { gatewayId, channelIds } = await seedGatewayBoundToChannels({ channels: 2 });
  const profileId = await seedProfile(gatewayId);
  const r = await hireProfileIntoBoundChannels(profileId);
  assert.deepEqual(r, { created: 2 });
  for (const c of channelIds) {
    assert.equal((await selectChannelNpcs(c, { roster: true })).length, 1);
  }
});

test("M3: 출근·퇴근·토글이 updated_at 을 갱신한다", async () => {
  const { hireGatewayProfilesIntoChannel, sleepChannelNpcs, setNpcActive } =
    await import("./npc-roster");
  const { selectChannelNpcs } = await import("./npc-projection");
  const { db, npcs } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { isPostgres } = await import("@/db");
  const STALE = (isPostgres
    ? new Date("2020-01-01T00:00:00Z")
    : "2020-01-01T00:00:00.000Z") as unknown as Date;

  // `updated_at` 은 마이그레이션이 "최신 하나" 를 고르는 기준이다. 상태를 바꾸는
  // 경로가 이것을 놔두면 그 판단이 낡은 값 위에서 이뤄진다.
  const { channelId, gatewayId } = await seedChannelWithProfiles({ placedActive: 1 });
  const [seeded] = await selectChannelNpcs(channelId, { roster: true });

  async function updatedAt(id: string) {
    const [row] = await db
      .select({ updatedAt: npcs.updatedAt })
      .from(npcs)
      .where(eq(npcs.id, id))
      .limit(1);
    return row.updatedAt;
  }

  await db.update(npcs).set({ updatedAt: STALE }).where(eq(npcs.id, seeded.id));
  const stale = await updatedAt(seeded.id);

  await sleepChannelNpcs(channelId, gatewayId);
  const afterSleep = await updatedAt(seeded.id);
  assert.notDeepEqual(afterSleep, stale, "퇴근이 updated_at 을 갱신한다");

  await db.update(npcs).set({ updatedAt: STALE }).where(eq(npcs.id, seeded.id));
  await hireGatewayProfilesIntoChannel(channelId, gatewayId);
  assert.notDeepEqual(await updatedAt(seeded.id), stale, "재출근이 updated_at 을 갱신한다");

  await db.update(npcs).set({ updatedAt: STALE }).where(eq(npcs.id, seeded.id));
  await setNpcActive(seeded.id, false);
  assert.notDeepEqual(await updatedAt(seeded.id), stale, "토글이 updated_at 을 갱신한다");
});
