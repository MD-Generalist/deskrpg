import crypto from "node:crypto";

import { and, count, eq, inArray } from "drizzle-orm";

import {
  channelGatewayBindings,
  channels,
  db,
  gatewayResources,
  gatewayShares,
  isPostgres,
  meetingMinutes,
  users,
} from "@/db";
import {
  type GatewayRuntimeStatus,
  getCachedGatewayRuntimeState,
  invalidateGatewayRuntimeState,
  setGatewayRuntimeState,
} from "@/lib/gateway-runtime-cache";
import { restorePluginInfo } from "@/lib/hermes/plugin-cache-update";
import { supportsProfileClone } from "@/lib/hermes/plugin-capability";
import { workerPluginWarning, type WorkerPluginWarning } from "@/lib/hermes/worker-plugin";

type GatewayShareRow = typeof gatewayShares.$inferSelect;

function nowForDb() {
  return (isPostgres ? new Date() : new Date().toISOString()) as unknown as Date;
}

import { selectChannelNpcs } from "./npc-projection";
// 순환 import 다(kanban-boards → 이 파일의 getChannelGatewayBinding/decryptGatewayToken).
// 모듈 평가 시점에는 쓰지 않고 함수 안에서만 부르므로 안전하다.
import { ensureChannelBoard } from "./kanban-boards";
import { probeHermesGateway } from "@/lib/hermes/gateway-probe";
import { DEV_JWT_SECRET } from "./dev-constants";

function getGatewayCipherKey() {
  // Priority: INTERNAL_RPC_SECRET > JWT_SECRET > dev fallback
  // In production, gateway cipher and JWT auth may use different secrets (separate concerns).
  const source =
    process.env.INTERNAL_RPC_SECRET ||
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV !== "production" ? DEV_JWT_SECRET : "");
  if (!source) {
    throw new Error("Missing JWT_SECRET or INTERNAL_RPC_SECRET for gateway token encryption");
  }
  return crypto.createHash("sha256").update(source).digest();
}

export function normalizeGatewayBaseUrl(url: string) {
  const parsed = new URL(url);
  const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host}${pathname}`;
}

export function encryptGatewayToken(token: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getGatewayCipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptGatewayToken(payload: string) {
  const [version, ivB64, tagB64, encryptedB64] = payload.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !encryptedB64) {
    throw new Error("Invalid gateway token payload");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getGatewayCipherKey(),
    Buffer.from(ivB64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function buildDefaultGatewayDisplayName(baseUrl: string) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** 키를 그대로 두는 저장에서 쓴다 — 주소만으로 내 게이트웨이를 찾는다. */
async function findOwnedGatewayByBaseUrl(ownerUserId: string, baseUrl: string) {
  const [row] = await db
    .select()
    .from(gatewayResources)
    .where(
      and(eq(gatewayResources.ownerUserId, ownerUserId), eq(gatewayResources.baseUrl, baseUrl)),
    )
    .limit(1);
  return row ?? null;
}

async function findMatchingOwnedGateway(ownerUserId: string, baseUrl: string, token: string) {
  const rows = await db
    .select()
    .from(gatewayResources)
    .where(
      and(eq(gatewayResources.ownerUserId, ownerUserId), eq(gatewayResources.baseUrl, baseUrl)),
    );

  return (
    rows.find((row) => {
      try {
        return decryptGatewayToken(row.tokenEncrypted) === token;
      } catch {
        return false;
      }
    }) ?? null
  );
}

/**
 * `token` 을 주지 않으면(=undefined) 이미 저장된 키를 그대로 둔다. 화면이 기존 키를 돌려받지
 * 않게 된 뒤로, URL 만 고치는 저장이 키를 빈 값으로 덮어쓰면 안 되기 때문이다.
 */
export async function upsertOwnedGatewayResource(input: {
  ownerUserId: string;
  baseUrl: string;
  token?: string;
  displayName?: string | null;
}) {
  const baseUrl = normalizeGatewayBaseUrl(input.baseUrl);
  const keepExistingToken = input.token === undefined;
  const token = (input.token ?? "").trim();
  const displayName = input.displayName?.trim() || buildDefaultGatewayDisplayName(baseUrl);
  const existing = keepExistingToken
    ? await findOwnedGatewayByBaseUrl(input.ownerUserId, baseUrl)
    : await findMatchingOwnedGateway(input.ownerUserId, baseUrl, token);

  if (existing) {
    const [updated] = await db
      .update(gatewayResources)
      .set({
        displayName,
        ...(keepExistingToken ? {} : { tokenEncrypted: encryptGatewayToken(token) }),
        updatedAt: nowForDb(),
      })
      .where(eq(gatewayResources.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(gatewayResources)
    .values({
      ownerUserId: input.ownerUserId,
      displayName,
      baseUrl,
      tokenEncrypted: encryptGatewayToken(token),
    })
    .returning();

  return created;
}

export async function getAccessibleGatewayResource(userId: string, gatewayId: string) {
  const [resource] = await db
    .select()
    .from(gatewayResources)
    .where(eq(gatewayResources.id, gatewayId))
    .limit(1);

  if (!resource) return null;
  if (resource.ownerUserId === userId) {
    return { resource, share: null as GatewayShareRow | null, isOwner: true };
  }

  const [share] = await db
    .select()
    .from(gatewayShares)
    .where(and(eq(gatewayShares.gatewayId, gatewayId), eq(gatewayShares.userId, userId)))
    .limit(1);

  if (!share) return null;
  return { resource, share, isOwner: false };
}

export async function getOwnedGatewayResource(ownerUserId: string, gatewayId: string) {
  const [resource] = await db
    .select()
    .from(gatewayResources)
    .where(and(eq(gatewayResources.id, gatewayId), eq(gatewayResources.ownerUserId, ownerUserId)))
    .limit(1);
  return resource ?? null;
}

export async function listAccessibleGatewayResources(userId: string) {
  const owned = await db
    .select()
    .from(gatewayResources)
    .where(eq(gatewayResources.ownerUserId, userId));

  const shares = await db.select().from(gatewayShares).where(eq(gatewayShares.userId, userId));

  const sharedIds = shares.map((share) => share.gatewayId);
  const sharedResources =
    sharedIds.length > 0
      ? await db.select().from(gatewayResources).where(inArray(gatewayResources.id, sharedIds))
      : [];

  return [
    ...owned.map((resource) => ({
      id: resource.id,
      displayName: resource.displayName,
      baseUrl: resource.baseUrl,
      ownerUserId: resource.ownerUserId,
      lastValidatedAt: resource.lastValidatedAt,
      lastValidationStatus: resource.lastValidationStatus,
      lastValidationError: resource.lastValidationError,
      // 최종 리뷰 I-1: 이 캐시(Task 4·9 산출물)를 읽는 소비자가 하나도 없어서
      // HermesProfileList 가 화면 진입마다 무조건 /test 를 다시 쳤다(원격 왕복
      // 2회 + DB UPDATE, 최대 10초). 여기서 내려줘야 `shouldReprobePlugin` 으로
      // 캐시가 신선한지 판단할 수 있다.
      pluginStatus: resource.pluginStatus,
      pluginVersion: resource.pluginVersion,
      pluginCheckedAt: resource.pluginCheckedAt,
      // Hermes 대시보드는 게이트웨이 전체를 다루는 관리 화면이라 소유자에게만 알린다.
      dashboardUrl: restorePluginInfo(resource.pluginInfoJson)?.dashboard_url ?? null,
      // 직원 생성은 소유자만 한다. 플러그인이 기본 프로필 복제를 지원할 때만 채용 마법사가
      // `cloneFrom: "default"` 를 보낸다 — 구버전에 모르는 필드를 보내지 않는다.
      supportsProfileClone: supportsProfileClone(restorePluginInfo(resource.pluginInfoJson)),
      // 칸반·크론 결과물이 쌓이지 않는 직원. 고치는 것도 소유자만 하므로 소유자에게만 알린다.
      workerPluginWarning: workerPluginWarning(restorePluginInfo(resource.pluginInfoJson)),
      canEditCredentials: true,
      shareRole: null as string | null,
      isOwner: true,
    })),
    ...sharedResources.map((resource) => {
      const share = shares.find((entry) => entry.gatewayId === resource.id) ?? null;
      return {
        id: resource.id,
        displayName: resource.displayName,
        baseUrl: resource.baseUrl,
        ownerUserId: resource.ownerUserId,
        lastValidatedAt: resource.lastValidatedAt,
        lastValidationStatus: resource.lastValidationStatus,
        lastValidationError: resource.lastValidationError,
        pluginStatus: resource.pluginStatus,
        pluginVersion: resource.pluginVersion,
        pluginCheckedAt: resource.pluginCheckedAt,
        dashboardUrl: null as string | null,
        workerPluginWarning: null as WorkerPluginWarning | null,
        canEditCredentials: false,
        shareRole: share?.role ?? null,
        isOwner: false,
      };
    }),
  ];
}

export async function listGatewaySharesForOwner(ownerUserId: string, gatewayId: string) {
  const resource = await getOwnedGatewayResource(ownerUserId, gatewayId);
  if (!resource) return null;

  const shares = await db
    .select({
      id: gatewayShares.id,
      userId: gatewayShares.userId,
      role: gatewayShares.role,
      createdAt: gatewayShares.createdAt,
      loginId: users.loginId,
      nickname: users.nickname,
    })
    .from(gatewayShares)
    .innerJoin(users, eq(gatewayShares.userId, users.id))
    .where(eq(gatewayShares.gatewayId, gatewayId));

  return { resource, shares };
}

export async function createGatewayShare(input: {
  ownerUserId: string;
  gatewayId: string;
  targetLoginId: string;
  role?: string;
}) {
  const resource = await getOwnedGatewayResource(input.ownerUserId, input.gatewayId);
  if (!resource) return { resource: null, targetUser: null, share: null };

  const [targetUser] = await db
    .select({ id: users.id, loginId: users.loginId, nickname: users.nickname })
    .from(users)
    .where(eq(users.loginId, input.targetLoginId))
    .limit(1);

  if (!targetUser || targetUser.id === input.ownerUserId) {
    return { resource, targetUser: targetUser ?? null, share: null };
  }

  const existing = await db
    .select()
    .from(gatewayShares)
    .where(
      and(eq(gatewayShares.gatewayId, input.gatewayId), eq(gatewayShares.userId, targetUser.id)),
    )
    .limit(1);

  const role = input.role?.trim() || "use";
  if (existing[0]) {
    const [updated] = await db
      .update(gatewayShares)
      .set({ role })
      .where(eq(gatewayShares.id, existing[0].id))
      .returning();
    return { resource, targetUser, share: updated };
  }

  const [created] = await db
    .insert(gatewayShares)
    .values({
      gatewayId: input.gatewayId,
      userId: targetUser.id,
      role,
    })
    .returning();

  return { resource, targetUser, share: created };
}

export async function removeGatewayShare(input: {
  ownerUserId: string;
  gatewayId: string;
  targetUserId: string;
}) {
  const resource = await getOwnedGatewayResource(input.ownerUserId, input.gatewayId);
  if (!resource) return false;

  await db
    .delete(gatewayShares)
    .where(
      and(
        eq(gatewayShares.gatewayId, input.gatewayId),
        eq(gatewayShares.userId, input.targetUserId),
      ),
    );

  return true;
}

export async function countChannelBindingsForGateway(gatewayId: string) {
  const [{ value }] = await db
    .select({ value: count() })
    .from(channelGatewayBindings)
    .where(eq(channelGatewayBindings.gatewayId, gatewayId));

  return value;
}

/** 게이트웨이를 삭제하려는 사용자에게 "무엇이 막고 있고, 풀면 무엇이 사라지는가"를 보여준다. */
export type GatewayChannelBinding = {
  channelId: string;
  channelName: string;
  /** 요청자가 이 채널의 소유자인가. 연결 해제는 채널 소유자만 할 수 있다. */
  canUnbind: boolean;
  /** 연결을 해제하면 휴면(`active=false`)에 들어가는 NPC 수. 지워지지는 않는다. */
  npcCount: number;
  meetingMinutesCount: number;
};

/**
 * 이 게이트웨이에 묶인 채널들. 삭제가 409 로 거절될 때 "어느 채널이 막고 있는가"를
 * 이름으로 답하기 위한 것 — 개수만 알려주면 사용자가 채널을 찾아 헤매야 한다.
 */
export async function listChannelBindingsForGateway(
  gatewayId: string,
  requesterUserId: string,
): Promise<GatewayChannelBinding[]> {
  const rows = await db
    .select({ channelId: channels.id, channelName: channels.name, ownerId: channels.ownerId })
    .from(channelGatewayBindings)
    .innerJoin(channels, eq(channels.id, channelGatewayBindings.channelId))
    .where(eq(channelGatewayBindings.gatewayId, gatewayId));

  return Promise.all(
    rows.map(async (row) => {
      // 개수도 투영을 거친다 — 화면의 "NPC n명" 과 명부(`/api/npcs?roster=1`)가
      // 같은 집합을 세도록 한다.
      const npcCount = (await selectChannelNpcs(row.channelId, { roster: true })).length;
      const [{ value: meetingMinutesCount }] = await db
        .select({ value: count() })
        .from(meetingMinutes)
        .where(eq(meetingMinutes.channelId, row.channelId));
      return {
        channelId: row.channelId,
        channelName: row.channelName,
        canUnbind: row.ownerId === requesterUserId,
        npcCount,
        meetingMinutesCount,
      };
    }),
  );
}

export async function getChannelGatewayBinding(channelId: string) {
  const [binding] = await db
    .select()
    .from(channelGatewayBindings)
    .where(eq(channelGatewayBindings.channelId, channelId))
    .limit(1);

  if (!binding) return null;

  const [resource] = await db
    .select()
    .from(gatewayResources)
    .where(eq(gatewayResources.id, binding.gatewayId))
    .limit(1);

  if (!resource) return null;

  return {
    binding,
    resource,
  };
}

export async function bindGatewayToChannel(input: {
  channelId: string;
  gatewayId: string;
  boundByUserId: string;
}) {
  const existing = await getChannelGatewayBinding(input.channelId);
  if (existing?.binding.gatewayId === input.gatewayId) {
    // 같은 게이트웨이를 다시 저장하는 것도 보드 확보의 재시도 기회다(R5 — 멱등).
    await ensureChannelBoardAfterBind(input.channelId);
    return existing.binding;
  }

  if (existing) {
    await db
      .update(channelGatewayBindings)
      .set({
        gatewayId: input.gatewayId,
        boundByUserId: input.boundByUserId,
        boundAt: nowForDb(),
      })
      .where(eq(channelGatewayBindings.id, existing.binding.id));
  } else {
    await db.insert(channelGatewayBindings).values({
      channelId: input.channelId,
      gatewayId: input.gatewayId,
      boundByUserId: input.boundByUserId,
    });
  }

  invalidateGatewayRuntimeState(input.gatewayId);
  if (existing?.binding.gatewayId && existing.binding.gatewayId !== input.gatewayId) {
    invalidateGatewayRuntimeState(existing.binding.gatewayId);
  }

  // 바인딩이 커밋된 뒤에 보드를 확보한다(R1). 실패는 바인딩을 실패시키지 않는다(R5).
  await ensureChannelBoardAfterBind(input.channelId);

  const next = await getChannelGatewayBinding(input.channelId);
  return next?.binding ?? null;
}

/** `ensureChannelBoard` 는 던지지 않지만, 바인딩 경로에서는 그것조차 한 번 더 감싼다. */
async function ensureChannelBoardAfterBind(channelId: string) {
  try {
    const result = await ensureChannelBoard(channelId);
    if (!result.ok) {
      console.warn(
        `[gateway-resources] board not ensured for channel ${channelId}: ${result.code} (${result.reason})`,
      );
    }
  } catch (err) {
    console.warn(`[gateway-resources] ensureChannelBoard threw for channel ${channelId}:`, err);
  }
}

export async function unbindGatewayFromChannel(channelId: string) {
  const existing = await getChannelGatewayBinding(channelId);
  if (!existing) return null;
  await db.delete(channelGatewayBindings).where(eq(channelGatewayBindings.id, existing.binding.id));
  invalidateGatewayRuntimeState(existing.binding.gatewayId);
  return existing.binding;
}

function mapGatewayErrorStatus(errorCode: string | undefined, status: number) {
  if (errorCode === "gateway_pairing_required" || errorCode === "PAIRING_REQUIRED") {
    return "pairing_required" as const;
  }
  if (status === 403) return "forbidden" as const;
  if (status === 502 || status === 503 || status === 504) return "unreachable" as const;
  return "error" as const;
}

export async function persistGatewayValidationState(
  gatewayId: string,
  input: {
    status: GatewayRuntimeStatus;
    error?: string | null;
    pairedDeviceId?: string | null;
  },
) {
  await db
    .update(gatewayResources)
    .set({
      lastValidatedAt: nowForDb(),
      lastValidationStatus: input.status,
      lastValidationError: input.error ?? null,
      pairedDeviceId: input.pairedDeviceId ?? undefined,
      updatedAt: nowForDb(),
    })
    .where(eq(gatewayResources.id, gatewayId));
}

export async function getGatewayRuntimeStateForChannel(
  channelId: string,
  options?: { forceRefresh?: boolean },
) {
  const binding = await getChannelGatewayBinding(channelId);
  if (!binding) {
    return { status: "unbound" as const, gateway: null };
  }

  const cached = options?.forceRefresh ? null : getCachedGatewayRuntimeState(binding.resource.id);
  if (cached) {
    return { ...cached, gateway: binding };
  }

  // Hermes 게이트웨이는 HTTP+SSE라 OpenClaw 의 WS 핸드셰이크에 403을 돌려주고, 그
  // 클라이언트는 재시도하며 20초 넘게 매달린다. 이 함수는 NPC 목록 조회 경로에도
  // 있어서(GET /api/npcs → 실측 25초), 그 사이 화면은 "NPC 0명"으로 그려진다.
  // /api/gateways/[id]/test 에 넣은 것과 같은 프로브를 여기에도 둔다.
  const probe = await probeHermesGateway(binding.resource.baseUrl);
  if (probe.kind === "hermes") {
    await persistGatewayValidationState(binding.resource.id, { status: "valid" });
    return {
      ...setGatewayRuntimeState(binding.resource.id, { status: "valid" }),
      gateway: binding,
    };
  }

  // 프로브가 hermes 로 판정하지 못했다. 예전에는 여기서 OpenClaw 의 WS 핸드셰이크를
  // 한 번 더 시도했지만, 그 백엔드는 사라졌다 — 프로브 결과를 그대로 실패로 보고한다.
  {
    const errorCode =
      probe.kind === "unreachable"
        ? "failed_to_reach_test_endpoint"
        : probe.kind === "dashboard"
          ? "gateway_is_not_api_server"
          : "not_a_hermes_gateway";
    const error =
      probe.kind === "unreachable" ? probe.error : `Not a Hermes API Server (HTTP ${probe.status})`;
    const status = mapGatewayErrorStatus(errorCode, 502);
    await persistGatewayValidationState(binding.resource.id, { status, error });
    return {
      ...setGatewayRuntimeState(binding.resource.id, {
        status,
        requestId: null,
        error,
        details: null,
      }),
      gateway: binding,
    };
  }
}

export async function getGatewayRuntimeConfigForChannel(channelId: string) {
  const binding = await getChannelGatewayBinding(channelId);
  if (!binding) return null;
  return {
    gatewayId: binding.resource.id,
    baseUrl: binding.resource.baseUrl,
    token: decryptGatewayToken(binding.resource.tokenEncrypted),
    displayName: binding.resource.displayName,
    binding: binding.binding,
    resource: binding.resource,
  };
}
