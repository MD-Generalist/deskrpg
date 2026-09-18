import { and, eq, inArray } from "drizzle-orm";
import { db, npcs, hermesProfiles, channelGatewayBindings, nowForDb } from "@/db";
import { placeUnplacedNpcs } from "./npc-seating";

/**
 * 채널에 묶인 게이트웨이의 프로필을 전부 "출근" 시킨다 — `(channel_id, hermes_profile_id)`
 * 유니크에 기대어, 없으면 만들고 있으면 `active=true` 로 되살린다. 새로 만든 NPC 는
 * 곧바로 `placeUnplacedNpcs` 가 빈 데스크 좌석(만석이면 서는 칸)에 배치하고, 되살린
 * NPC 는 잠들기 전 자리를 그대로 되찾는다.
 */
export async function hireGatewayProfilesIntoChannel(
  channelId: string,
  gatewayId: string,
): Promise<{ created: number; reactivated: number }> {
  const profiles = await db
    .select({ id: hermesProfiles.id })
    .from(hermesProfiles)
    .where(eq(hermesProfiles.gatewayId, gatewayId));

  let created = 0;
  let reactivated = 0;
  for (const profile of profiles) {
    const [existing] = await db
      .select({ id: npcs.id, active: npcs.active })
      .from(npcs)
      .where(and(eq(npcs.channelId, channelId), eq(npcs.hermesProfileId, profile.id)))
      .limit(1);

    if (!existing) {
      await db
        .insert(npcs)
        .values({ channelId, hermesProfileId: profile.id, active: true, updatedAt: nowForDb() });
      created += 1;
    } else if (!existing.active) {
      await db
        .update(npcs)
        .set({ active: true, updatedAt: nowForDb() })
        .where(eq(npcs.id, existing.id));
      reactivated += 1;
    }
  }
  if (created > 0 || reactivated > 0) await placeUnplacedNpcs(channelId);
  return { created, reactivated };
}

/**
 * 새로 등록된 프로필 하나를, 그 게이트웨이가 이미 묶인 채널 전부에 출근시킨다.
 */
export async function hireProfileIntoBoundChannels(
  profileId: string,
): Promise<{ created: number }> {
  const [profile] = await db
    .select({ gatewayId: hermesProfiles.gatewayId })
    .from(hermesProfiles)
    .where(eq(hermesProfiles.id, profileId))
    .limit(1);
  if (!profile) return { created: 0 };

  const bindings = await db
    .select({ channelId: channelGatewayBindings.channelId })
    .from(channelGatewayBindings)
    .where(eq(channelGatewayBindings.gatewayId, profile.gatewayId));

  let created = 0;
  for (const binding of bindings) {
    const [existing] = await db
      .select({ id: npcs.id })
      .from(npcs)
      .where(and(eq(npcs.channelId, binding.channelId), eq(npcs.hermesProfileId, profileId)))
      .limit(1);
    if (!existing) {
      await db.insert(npcs).values({
        channelId: binding.channelId,
        hermesProfileId: profileId,
        active: true,
        updatedAt: nowForDb(),
      });
      created += 1;
      await placeUnplacedNpcs(binding.channelId);
    }
  }
  return { created };
}

/** 해당 게이트웨이 소속 NPC 를 이 채널에서 재운다 — 자리는 기억한 채 맵에서만 뺀다. */
export async function sleepChannelNpcs(
  channelId: string,
  gatewayId: string,
): Promise<{ slept: number }> {
  const profiles = await db
    .select({ id: hermesProfiles.id })
    .from(hermesProfiles)
    .where(eq(hermesProfiles.gatewayId, gatewayId));
  if (profiles.length === 0) return { slept: 0 };

  const profileIds = profiles.map((p) => p.id);
  const targets = await db
    .select({ id: npcs.id })
    .from(npcs)
    .where(and(eq(npcs.channelId, channelId), inArray(npcs.hermesProfileId, profileIds)));
  if (targets.length === 0) return { slept: 0 };

  const ids = targets.map((t) => t.id);
  await db.update(npcs).set({ active: false, updatedAt: nowForDb() }).where(inArray(npcs.id, ids));
  return { slept: ids.length };
}

/** NPC 하나의 출근 상태를 직접 토글한다. */
export async function setNpcActive(npcId: string, active: boolean): Promise<void> {
  // `updated_at` 은 마이그레이션이 "최신 하나" 를 고르는 기준이다 — 상태를 바꾸는
  // 경로가 전부 같이 갱신해야 그 판단이 낡은 값 위에서 이뤄지지 않는다.
  await db.update(npcs).set({ active, updatedAt: nowForDb() }).where(eq(npcs.id, npcId));
  if (!active) return;
  // 자리 없이 잠들었던 직원(이 기능 이전 데이터)은 되살아나면서 자리를 받는다.
  const [row] = await db
    .select({ channelId: npcs.channelId })
    .from(npcs)
    .where(eq(npcs.id, npcId))
    .limit(1);
  if (row) await placeUnplacedNpcs(row.channelId);
}
