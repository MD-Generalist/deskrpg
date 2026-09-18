// Resource layer for Hermes profiles: registers profiles, validates them against a
// live gateway, and assembles authenticated HermesClient instances. Sits between the
// DB (hermesProfiles/npcs/gatewayResources) and callers (API routes, socket dispatch).

import { and, eq, inArray } from "drizzle-orm";

import {
  db,
  hermesProfiles,
  jsonForDb,
  nowForDb,
  npcs,
  gatewayResources,
  chatRoomMembers,
} from "@/db";
import {
  decryptGatewayToken,
  encryptGatewayToken,
  getAccessibleGatewayResource,
} from "@/lib/gateway-resources";
import { parseDbJson } from "@/lib/db-json";
import { HermesClient, HermesError } from "@/lib/hermes/hermes-client";
import type { HermesCapabilities } from "@/lib/hermes/types";
import { isUniqueViolation } from "./db-unique-violation";
import { pickOfficeLookForNewProfile } from "./profile-look-assignment";

export type ProfileValidationStatus =
  "valid" | "unauthorized" | "unknown_profile" | "unreachable" | "error";

export function mapValidationError(err: unknown): Exclude<ProfileValidationStatus, "valid"> {
  if (err instanceof HermesError) {
    if (err.code === "unauthorized") return "unauthorized";
    if (err.code === "unknown_profile") return "unknown_profile";
    if (err.code === "unreachable") return "unreachable";
  }
  return "error";
}

async function updateHermesProfileToken(
  profileId: string,
  input: { token: string; displayName?: string; provisionedByDeskrpg?: boolean },
  fallbackDisplayName: string | null,
) {
  const [updated] = await db
    .update(hermesProfiles)
    .set({
      tokenEncrypted: encryptGatewayToken(input.token.trim()),
      displayName: input.displayName?.trim() || fallbackDisplayName,
      updatedAt: nowForDb(),
      // 최종 리뷰 I-2: 이 인자가 없거나 false 면 기존 값을 건드리지 않는다 — 수동
      // 재등록(토큰 교체 등) 경로가 이미 서 있는 provisionedByDeskrpg 를 조용히
      // false 로 되돌리면 안 된다. 마법사만 true 를 명시적으로 넘긴다.
      ...(input.provisionedByDeskrpg ? { provisionedByDeskrpg: true } : {}),
    })
    .where(eq(hermesProfiles.id, profileId))
    .returning();
  return updated;
}

export function buildProfileClient(input: {
  baseUrl: string;
  profileName: string;
  tokenEncrypted: string;
  fetchImpl?: typeof fetch;
}): HermesClient {
  return new HermesClient({
    baseUrl: input.baseUrl,
    profileName: input.profileName === "default" ? null : input.profileName,
    token: decryptGatewayToken(input.tokenEncrypted),
    fetchImpl: input.fetchImpl,
  });
}

export async function registerHermesProfile(input: {
  userId: string;
  gatewayId: string;
  profileName: string;
  token: string;
  displayName?: string;
  /**
   * 최종 리뷰 I-2: 스펙 §3① — "마법사가 이 값을 세운다." 마법사(플러그인 프로필 생성
   * 라우트)만 `true` 를 넘긴다. 수동 등록 화면(`/api/gateways/[id]/profiles`)은 이
   * 인자를 아예 넘기지 않아 기본값(false)이 유지된다 — DeskRPG 가 만든 프로필과
   * 사용자가 손으로 등록한 프로필을 구분하는 유일한 신호이므로, 여기서 잘못 세우면
   * 영원히 되돌릴 방법이 없다.
   */
  provisionedByDeskrpg?: boolean;
}): Promise<{ profile: typeof hermesProfiles.$inferSelect } | { error: "forbidden" }> {
  // Registering writes a credential onto the gateway, so this requires ownership —
  // a shared "use" role is enough to read/validate profiles but not to write one.
  const access = await getAccessibleGatewayResource(input.userId, input.gatewayId);
  if (!access || !access.isOwner) return { error: "forbidden" as const };

  const profileName = input.profileName.trim();
  const existing = await db
    .select()
    .from(hermesProfiles)
    .where(
      and(
        eq(hermesProfiles.gatewayId, input.gatewayId),
        eq(hermesProfiles.profileName, profileName),
      ),
    )
    .limit(1);

  if (existing[0]) {
    const updated = await updateHermesProfileToken(existing[0].id, input, existing[0].displayName);
    return { profile: updated };
  }

  // 새 직원은 외형을 가진 채 태어난다 — 비어 있으면 모두 기본 룩으로 보인다.
  // 기존 행(위 update 경로)의 외형은 사람이 골랐을 수 있으므로 건드리지 않는다.
  const siblings = await db
    .select({ appearance: hermesProfiles.appearance })
    .from(hermesProfiles)
    .where(eq(hermesProfiles.gatewayId, input.gatewayId));
  const appearance = pickOfficeLookForNewProfile(
    siblings.map((row) => parseDbJson<unknown>(row.appearance) ?? row.appearance),
  );

  try {
    const [created] = await db
      .insert(hermesProfiles)
      .values({
        gatewayId: input.gatewayId,
        profileName,
        tokenEncrypted: encryptGatewayToken(input.token.trim()),
        displayName: input.displayName?.trim() || profileName,
        provisionedByDeskrpg: input.provisionedByDeskrpg ?? false,
        appearance: jsonForDb(appearance),
      })
      .returning();
    return { profile: created };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;

    // Lost the race: another registration for this (gatewayId, profileName) landed
    // between our existence check and our insert. Converge to an update rather than
    // surfacing a raw constraint violation.
    const [raced] = await db
      .select()
      .from(hermesProfiles)
      .where(
        and(
          eq(hermesProfiles.gatewayId, input.gatewayId),
          eq(hermesProfiles.profileName, profileName),
        ),
      )
      .limit(1);
    if (!raced) throw err;

    const updated = await updateHermesProfileToken(raced.id, input, raced.displayName);
    return { profile: updated };
  }
}

export async function listHermesProfiles(userId: string, gatewayId: string) {
  const access = await getAccessibleGatewayResource(userId, gatewayId);
  if (!access) return [];

  const rows = await db
    .select()
    .from(hermesProfiles)
    .where(eq(hermesProfiles.gatewayId, gatewayId));

  // 한 프로필은 NPC 하나에만 붙인다 — 둘이 같은 프로필을 쓰면 같은 Hermes 세션과
  // 기억을 공유해 서로의 대화가 섞인다. 어느 프로필이 이미 묶였는지는 서버만 알 수
  // 있으므로 여기서 알려준다(화면이 NPC 목록을 따로 들고 다니지 않아도 되게).
  const boundRows = await db.select({ profileId: npcs.hermesProfileId }).from(npcs);
  const bound = new Set(boundRows.map((r) => r.profileId).filter(Boolean));

  return rows.map((row) => ({
    id: row.id,
    profileName: row.profileName,
    displayName: row.displayName,
    lastValidationStatus: row.lastValidationStatus,
    // 외형은 프로필이 정본이다. 목록에 실어 주지 않으면 게이트웨이 화면의 외형
    // 편집기가 기본값에서 시작해, 저장 한 번에 그 인격의 생김새를 조용히 갈아 치운다.
    appearance: parseDbJson<unknown>(row.appearance) ?? null,
    inUse: bound.has(row.id),
  }));
}

/**
 * 프로필 수정. 토큰은 **보낼 때만** 바뀐다 — 게이트웨이 PATCH 와 같은 규약이다
 * (화면이 빈 칸을 아예 보내지 않는다). 빈 문자열로 자격증명을 지우는 사고를 막는다.
 *
 * `profileName` 은 바꾸지 않는다. 그것은 Hermes 쪽 정체성이고 `/p/<name>/` 라우팅과
 * 세션 키가 그 이름에 걸려 있어, 바꾸는 것은 사실상 다른 프로필이다 — 새로 만들어야 한다.
 */
export async function updateHermesProfile(
  userId: string,
  profileId: string,
  input: { token?: string; displayName?: string; appearance?: unknown },
): Promise<{ ok: true } | { ok: false; errorCode: "profile_not_found" | "forbidden" }> {
  const [row] = await db
    .select()
    .from(hermesProfiles)
    .where(eq(hermesProfiles.id, profileId))
    .limit(1);
  if (!row) return { ok: false, errorCode: "profile_not_found" };

  const access = await getAccessibleGatewayResource(userId, row.gatewayId);
  if (!access) return { ok: false, errorCode: "forbidden" };

  const patch: Record<string, unknown> = { updatedAt: nowForDb() };
  if (typeof input.displayName === "string") patch.displayName = input.displayName;
  // 외형은 프로필이 정본이고 그 프로필이 나가는 **모든** 채널의 NPC 모습을 한꺼번에
  // 바꾼다. 공유받은 사용자가 남의 게이트웨이 인격의 얼굴을 갈아치울 수는 없다 —
  // 소유자만 쓴다.
  if (input.appearance !== undefined) {
    if (!access.isOwner) return { ok: false, errorCode: "forbidden" };
    patch.appearance = jsonForDb(input.appearance);
  }
  if (typeof input.token === "string" && input.token.trim()) {
    patch.tokenEncrypted = encryptGatewayToken(input.token.trim());
    // 자격증명이 바뀌었으므로 예전 검증 결과는 더 이상 이 토큰에 대한 것이 아니다.
    // 남겨 두면 "인증 실패" 배지가 새 토큰에 대해서도 계속 붙어 사용자를 오도한다.
    patch.lastValidationStatus = null;
    patch.lastValidationError = null;
    patch.lastValidatedAt = null;
  }

  await db.update(hermesProfiles).set(patch).where(eq(hermesProfiles.id, profileId));
  return { ok: true };
}

/** 이 프로필이 몇 개의 NPC 로, 몇 개의 채널에 나가 있는지 — 삭제 확인 문구가 쓴다. */
export async function profileUsage(profileId: string): Promise<{
  npcs: number;
  channels: number;
}> {
  const rows = await db
    .select({ channelId: npcs.channelId })
    .from(npcs)
    .where(eq(npcs.hermesProfileId, profileId));
  return { npcs: rows.length, channels: new Set(rows.map((r) => r.channelId)).size };
}

/**
 * 프로필 삭제. 프로필이 NPC 의 정본이 된 뒤로 이것은 **해고**다 — `npcs.hermes_profile_id`
 * 의 CASCADE 가 그 프로필의 NPC 행을 함께 지운다. 몇 개가 몇 채널에서 사라지는지는
 * 지우기 전에 세어 돌려준다(지운 뒤에는 셀 수 없다).
 */
export async function deleteHermesProfile(
  userId: string,
  profileId: string,
): Promise<
  | { ok: true; deletedNpcs: number; channels: number }
  | { ok: false; errorCode: "profile_not_found" | "forbidden" }
> {
  const [row] = await db
    .select()
    .from(hermesProfiles)
    .where(eq(hermesProfiles.id, profileId))
    .limit(1);
  if (!row) return { ok: false, errorCode: "profile_not_found" };

  const access = await getAccessibleGatewayResource(userId, row.gatewayId);
  if (!access) return { ok: false, errorCode: "forbidden" };

  const usage = await profileUsage(profileId);

  // 프로필 삭제는 npcs 를 cascade 로 지운다 — 그 NPC 가 대화방 멤버로 남아 있던
  // chat_room_members 행은 cascade 대상이 아니므로(멤버 테이블은 npcs 를 FK 로 물지
  // 않는다) 지우기 전에 NPC id 를 먼저 걷어 직접 정리한다.
  // 이 저장소에는 공유 트랜잭션 헬퍼가 없다 — better-sqlite3 의 drizzle 트랜잭션은
  // 동기, PG 쪽은 비동기라 두 드라이버를 같은 헬퍼로 감쌀 수 없다(다른 자원 모듈들도
  // 같은 이유로 트랜잭션을 안 쓴다). 그래서 두 delete 를 트랜잭션 없이 순서대로
  // 실행한다. 순서가 유일한 안전장치다: 멤버 정리 → 프로필/NPC cascade. 이 순서면
  // 중간에 실패해도 최악의 경우 "지워진 NPC 를 여전히 멤버로 가리키는 방"이 아니라
  // "멤버는 지워졌는데 NPC 는 남은" 상태만 생긴다 — 후자는 다음 조회에서 그냥 무해한
  // 유령 멤버가 없는 정상 상태이고, 전자(멤버 정리를 나중에 했다면 생겼을 상태)처럼
  // 존재하지 않는 NPC 를 참조하는 깨진 멤버 행을 만들지 않는다.
  const affectedNpcs = await db
    .select({ id: npcs.id })
    .from(npcs)
    .where(eq(npcs.hermesProfileId, profileId));
  const npcIds = affectedNpcs.map((n) => n.id);
  if (npcIds.length > 0) {
    await db
      .delete(chatRoomMembers)
      .where(and(eq(chatRoomMembers.memberKind, "npc"), inArray(chatRoomMembers.memberId, npcIds)));
  }

  await db.delete(hermesProfiles).where(eq(hermesProfiles.id, profileId));
  return { ok: true, deletedNpcs: usage.npcs, channels: usage.channels };
}

export async function validateHermesProfile(
  userId: string,
  profileId: string,
): Promise<{
  status: ProfileValidationStatus;
  error?: string;
  capabilities?: HermesCapabilities;
}> {
  const [row] = await db
    .select()
    .from(hermesProfiles)
    .where(eq(hermesProfiles.id, profileId))
    .limit(1);
  if (!row) return { status: "error", error: "profile_not_found" };

  const access = await getAccessibleGatewayResource(userId, row.gatewayId);
  if (!access) return { status: "error", error: "forbidden" };

  try {
    const client = buildProfileClient({
      baseUrl: access.resource.baseUrl,
      profileName: row.profileName,
      tokenEncrypted: row.tokenEncrypted,
    });
    const capabilities = await client.getCapabilities();
    await db
      .update(hermesProfiles)
      .set({
        lastValidatedAt: nowForDb(),
        lastValidationStatus: "valid",
        lastValidationError: null,
        updatedAt: nowForDb(),
      })
      .where(eq(hermesProfiles.id, profileId));
    return { status: "valid", capabilities };
  } catch (err) {
    const status = mapValidationError(err);
    const message = err instanceof Error ? err.message : "unknown";
    await db
      .update(hermesProfiles)
      .set({
        lastValidatedAt: nowForDb(),
        lastValidationStatus: status,
        lastValidationError: message,
        updatedAt: nowForDb(),
      })
      .where(eq(hermesProfiles.id, profileId));
    return { status, error: message };
  }
}

export async function getProfileClientForNpc(npcId: string): Promise<HermesClient | null> {
  const rows = await db
    .select({
      profileName: hermesProfiles.profileName,
      tokenEncrypted: hermesProfiles.tokenEncrypted,
      baseUrl: gatewayResources.baseUrl,
    })
    .from(npcs)
    .innerJoin(hermesProfiles, eq(npcs.hermesProfileId, hermesProfiles.id))
    .innerJoin(gatewayResources, eq(hermesProfiles.gatewayId, gatewayResources.id))
    .where(eq(npcs.id, npcId))
    .limit(1);

  if (!rows[0]) return null;
  return buildProfileClient(rows[0]);
}
