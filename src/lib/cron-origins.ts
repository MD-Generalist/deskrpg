/**
 * `cron_job_origins` — DeskRPG 가 만든 Hermes cron 작업의 출처 장부.
 *
 * Hermes 가 정본이다. 여기에는 작업 내용을 한 글자도 복사하지 않고 "(게이트웨이, 프로필,
 * job id) 를 어느 채널의 누가 만들었는가" 만 남긴다(R16). 이 장부가 권한표의 근거다 —
 * 편집·멈춤·실행·삭제는 **출처 채널 멤버만**, 나머지 채널과 DeskRPG 밖에서 만든 작업(출처
 * 없음)은 읽기 전용이다.
 *
 * 장부는 게이트웨이 id 로 묶인다. 채널이 다른 게이트웨이로 갈아타면 옛 게이트웨이의 행은
 * 그 채널에서 **무시**된다(R4) — 지우지는 않는다. 되돌리면 다시 유효해야 하기 때문이다.
 */

import { and, eq, inArray } from "drizzle-orm";

import { cronJobOrigins, db, hermesProfiles } from "@/db";
import type { CronJob } from "@/lib/hermes/deskrpg-plugin-types";

export type CronOriginRow = typeof cronJobOrigins.$inferSelect;

/** 응답에 실리는 출처 요약. 행 id·게이트웨이 id 는 클라이언트가 알 필요 없다. */
export type CronOrigin = { channelId: string; createdByUserId: string | null };

export type CronOriginKey = { gatewayId: string; profileName: string; jobId: string };

/** 응답 한 건 — Hermes 의 작업에 담당 NPC·출처·편집 가능 여부를 얹은 모양. */
export type EnrichedCronJob = CronJob & {
  npcId: string;
  npcName: string;
  origin: CronOrigin | null;
  editable: boolean;
};

function originMapKey(profileName: string, jobId: string): string {
  return `${profileName}\u0000${jobId}`;
}

/**
 * 출처를 기록한다. 같은 (게이트웨이, 프로필, job id) 가 이미 있으면 덮어쓴다 — Hermes 의
 * job id 는 유일하므로 같은 키가 다시 오는 경우는 "지운 뒤 같은 id 로 다시 만들어진" 재사용뿐이고,
 * 그때는 새 출처가 맞다.
 *
 * **플러그인 호출이 성공한 뒤에만 부른다.** 먼저 적어 두고 실패하면 Hermes 에 없는 작업의
 * 출처가 남아 목록 조회 때마다 고아로 보인다.
 */
export async function recordCronOrigin(
  input: CronOriginKey & { channelId: string; createdByUserId: string | null },
): Promise<CronOriginRow> {
  await deleteCronOrigin(input);
  const [row] = await db
    .insert(cronJobOrigins)
    .values({
      gatewayId: input.gatewayId,
      profileName: input.profileName,
      jobId: input.jobId,
      channelId: input.channelId,
      createdByUserId: input.createdByUserId,
    })
    .returning();
  return row;
}

export async function findCronOrigin(key: CronOriginKey): Promise<CronOriginRow | null> {
  const [row] = await db
    .select()
    .from(cronJobOrigins)
    .where(
      and(
        eq(cronJobOrigins.gatewayId, key.gatewayId),
        eq(cronJobOrigins.profileName, key.profileName),
        eq(cronJobOrigins.jobId, key.jobId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** 한 게이트웨이의 출처 행 전부를 `(프로필, job id)` 로 찾을 수 있게 묶는다. 목록 조회용. */
export async function loadCronOriginIndex(gatewayId: string): Promise<CronOriginIndex> {
  const rows = await db
    .select()
    .from(cronJobOrigins)
    .where(eq(cronJobOrigins.gatewayId, gatewayId));
  const map = new Map<string, CronOriginRow>();
  for (const row of rows) map.set(originMapKey(row.profileName, row.jobId), row);
  return {
    get: (profileName, jobId) => map.get(originMapKey(profileName, jobId)) ?? null,
  };
}

export type CronOriginIndex = {
  get(profileName: string, jobId: string): CronOriginRow | null;
};

export async function deleteCronOrigin(key: CronOriginKey): Promise<void> {
  await db
    .delete(cronJobOrigins)
    .where(
      and(
        eq(cronJobOrigins.gatewayId, key.gatewayId),
        eq(cronJobOrigins.profileName, key.profileName),
        eq(cronJobOrigins.jobId, key.jobId),
      ),
    );
}

/**
 * E3. 프로필이 사라진 출처 행을 정리한다 — 이 게이트웨이의 `hermes_profiles` 에 없는 프로필
 * 이름을 가진 행을 지운다. 목록 조회 때 부른다. 지운 행 수를 돌려준다.
 *
 * 게이트웨이가 다른 행은 건드리지 않는다(R4 — 그 행은 그 게이트웨이로 되돌아갔을 때 필요하다).
 */
export async function cleanupOrphanCronOrigins(gatewayId: string): Promise<number> {
  const [rows, profiles] = await Promise.all([
    db
      .select({ id: cronJobOrigins.id, profileName: cronJobOrigins.profileName })
      .from(cronJobOrigins)
      .where(eq(cronJobOrigins.gatewayId, gatewayId)),
    db
      .select({ profileName: hermesProfiles.profileName })
      .from(hermesProfiles)
      .where(eq(hermesProfiles.gatewayId, gatewayId)),
  ]);
  const live = new Set(profiles.map((p) => p.profileName));
  const orphanIds = rows.filter((r) => !live.has(r.profileName)).map((r) => r.id);
  if (orphanIds.length === 0) return 0;
  await db.delete(cronJobOrigins).where(inArray(cronJobOrigins.id, orphanIds));
  return orphanIds.length;
}

/**
 * R4. 출처 행이 채널의 **현재** 게이트웨이 것이 아니면 없는 셈 친다. 목록·상세·editable
 * 계산 전부 이 함수를 거쳐야 옛 게이트웨이의 행이 새 게이트웨이의 같은 job id 에 붙지 않는다.
 */
export function resolveOriginForGateway(
  origin: CronOriginRow | null,
  currentGatewayId: string,
): CronOriginRow | null {
  if (!origin) return null;
  return origin.gatewayId === currentGatewayId ? origin : null;
}

/**
 * 권한표(R16): 편집 가능 = 출처가 있고, 그 출처가 현재 게이트웨이 것이며, 출처 채널이
 * 요청 채널과 같다. 멤버 여부는 라우트가 이미 확인했으므로 여기서는 채널만 본다.
 */
export function computeEditable(
  origin: CronOriginRow | null,
  channelId: string,
  currentGatewayId: string,
): boolean {
  const effective = resolveOriginForGateway(origin, currentGatewayId);
  return effective !== null && effective.channelId === channelId;
}

export function toCronOrigin(origin: CronOriginRow | null): CronOrigin | null {
  return origin ? { channelId: origin.channelId, createdByUserId: origin.createdByUserId } : null;
}

/** Hermes 의 작업에 담당 NPC·출처·editable 을 얹는다. `origin` 은 원시 행(게이트웨이 필터 전). */
export function enrichJob(
  job: CronJob,
  ctx: {
    npcId: string;
    npcName: string;
    origin: CronOriginRow | null;
    channelId: string;
    currentGatewayId: string;
  },
): EnrichedCronJob {
  const effective = resolveOriginForGateway(ctx.origin, ctx.currentGatewayId);
  return {
    ...job,
    npcId: ctx.npcId,
    npcName: ctx.npcName,
    origin: toCronOrigin(effective),
    editable: computeEditable(effective, ctx.channelId, ctx.currentGatewayId),
  };
}
