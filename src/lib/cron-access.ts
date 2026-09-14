/**
 * 크론 REST(`/api/channels/:id/cron/**`)의 문지기.
 *
 * 순서가 곧 규칙이다: 로그인 → 채널 멤버 → 채널의 게이트웨이 → 플러그인 계약(428) →
 * 담당 NPC 의 프로필 클라이언트. 앞 단계가 막히면 뒤 단계(특히 Hermes 호출)는 일어나지
 * 않는다 — 권한 거절이 원격 왕복 뒤에 오면 거절당한 요청도 Hermes 에 흔적을 남긴다.
 *
 * 브라우저는 Hermes 를 직접 부르지 않는다. 프로필 토큰은 여기서 복호화해 클라이언트에
 * 가두고, 응답에는 절대 싣지 않는다.
 *
 * 칸반 쪽 접근 제어(`kanban-access.ts`)와는 **별개 파일**이다 — 두 기능은 스코프(오너 키
 * vs 프로필 키)와 권한 단위(보드 vs 출처 채널)가 달라 합치면 서로의 규칙을 오염시킨다.
 */

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { channelMembers, channels, db, gatewayResources, hermesProfiles, npcs } from "@/db";
import { decryptGatewayToken, getChannelGatewayBinding } from "@/lib/gateway-resources";
import type { PluginInfo } from "@/lib/hermes/deskrpg-plugin-types";
import {
  buildPluginCacheUpdate,
  buildPluginInfoCacheUpdate,
  restorePluginInfo,
} from "@/lib/hermes/plugin-cache-update";
import {
  meetsAutomationContract,
  probeDeskrpgPluginWithInfo,
  shouldReprobePlugin,
} from "@/lib/hermes/plugin-capability";
import { createProfilePluginClient } from "@/lib/hermes/plugin-client";
import type { PluginResponse, ProfilePluginClient } from "@/lib/hermes/plugin-client-types";
import { transportFetch } from "@/lib/hermes/setup/transport";

type GatewayResourceRow = typeof gatewayResources.$inferSelect;
type HermesProfileRow = typeof hermesProfiles.$inferSelect;
type NpcRow = typeof npcs.$inferSelect;

export type CronErrorBody = { code: string; message: string } & Record<string, unknown>;

export function cronError(status: number, code: string, message: string, extra?: object) {
  return NextResponse.json({ code, message, ...(extra ?? {}) } satisfies CronErrorBody, {
    status,
  });
}

// ---------------------------------------------------------------------------
// 채널 멤버
// ---------------------------------------------------------------------------

export type ChannelAccess =
  { ok: true; channel: { id: string; ownerId: string } } | { ok: false; response: NextResponse };

/** 보기·만들기의 최소 조건 — 채널 소유자이거나 `channel_members` 에 있어야 한다. */
export async function requireChannelMember(
  channelId: string,
  userId: string,
): Promise<ChannelAccess> {
  const [channel] = await db
    .select({ id: channels.id, ownerId: channels.ownerId })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  if (!channel) {
    return { ok: false, response: cronError(404, "channel_not_found", "Channel not found") };
  }
  if (channel.ownerId === userId) return { ok: true, channel };

  const [member] = await db
    .select({ id: channelMembers.id })
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
    .limit(1);
  if (!member) {
    return { ok: false, response: cronError(403, "not_a_member", "Not a member") };
  }
  return { ok: true, channel };
}

// ---------------------------------------------------------------------------
// 플러그인 계약 게이트 (E10)
// ---------------------------------------------------------------------------

export type PluginGate = { ok: true; info: PluginInfo } | { ok: false; response: NextResponse };

/**
 * 자동화 계약(버전 ≥ 0.6.0 + capability 세 가지)을 만족하는지 본다.
 *
 * `gateway_resources` 의 캐시(plugin_status/plugin_version/plugin_info_json)를 먼저 쓴다.
 * 캐시가 없거나 1시간이 지났으면(`shouldReprobePlugin`) `/deskrpg/info` 를 다시 쳐서 캐시를
 * 갱신한다. 미달이면 428 `{code:"plugin_upgrade_required", minVersion}` — 사용자가 할 일은
 * 재시도가 아니라 플러그인 업그레이드다.
 *
 * `timezone` 은 여기서 나온 `info` 에서 읽는다(E9 — 플러그인이 안 주면 null).
 */
export async function ensureAutomationPlugin(
  gateway: GatewayResourceRow,
  now = new Date(),
): Promise<PluginGate> {
  let info = restorePluginInfo(gateway.pluginInfoJson);
  const stale = shouldReprobePlugin({ checkedAt: gateway.pluginCheckedAt, now });

  // 캐시가 "준비됨" 이 아니어도 신선하면 그 판정을 믿는다 — 매 요청마다 부재/미인증
  // 게이트웨이를 다시 찌르면 캐시를 둔 이유가 없다.
  if (stale || (gateway.pluginStatus === "plugin_ready" && !info)) {
    const probe = await probeDeskrpgPluginWithInfo({
      baseUrl: gateway.baseUrl,
      token: decryptGatewayToken(gateway.tokenEncrypted),
      fetchImpl: transportFetch,
    });
    await db
      .update(gatewayResources)
      .set({
        ...buildPluginCacheUpdate(probe.capability),
        ...buildPluginInfoCacheUpdate(probe.info),
      })
      .where(eq(gatewayResources.id, gateway.id));
    info = probe.info;
  } else if (gateway.pluginStatus !== "plugin_ready") {
    info = null;
  }

  const verdict = meetsAutomationContract(info);
  if (!verdict.ok) {
    return {
      ok: false,
      response: cronError(
        428,
        "plugin_upgrade_required",
        `deskrpg-hermes-plugin ${verdict.minVersion}+ required (${verdict.reason})`,
        {
          minVersion: verdict.minVersion,
          reason: verdict.reason,
          ...(verdict.missing ? { missing: verdict.missing } : {}),
        },
      ),
    };
  }
  return { ok: true, info: info as PluginInfo };
}

// ---------------------------------------------------------------------------
// 채널 컨텍스트 — 멤버 + 게이트웨이 + 플러그인 게이트를 한 번에
// ---------------------------------------------------------------------------

export type CronChannelContext = {
  userId: string;
  channelId: string;
  gateway: GatewayResourceRow;
  info: PluginInfo;
  /** E9. 플러그인이 시간대를 주지 않으면 null — 라벨("미확인")은 클라이언트 몫이다. */
  timezone: string | null;
};

export type CronContextResult =
  { ok: true; ctx: CronChannelContext } | { ok: false; response: NextResponse };

export async function resolveCronChannelContext(input: {
  userId: string | null;
  channelId: string;
}): Promise<CronContextResult> {
  if (!input.userId) {
    return { ok: false, response: cronError(401, "unauthorized", "unauthorized") };
  }
  const access = await requireChannelMember(input.channelId, input.userId);
  if (!access.ok) return access;

  const binding = await getChannelGatewayBinding(input.channelId);
  if (!binding) {
    return {
      ok: false,
      response: cronError(409, "gateway_not_bound", "Channel has no gateway bound"),
    };
  }

  const gate = await ensureAutomationPlugin(binding.resource);
  if (!gate.ok) return gate;

  return {
    ok: true,
    ctx: {
      userId: input.userId,
      channelId: input.channelId,
      gateway: binding.resource,
      info: gate.info,
      timezone: gate.info.timezone ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// NPC → 프로필 → 프로필 키 클라이언트
// ---------------------------------------------------------------------------

export type NpcProfileClient = {
  npc: NpcRow;
  profile: HermesProfileRow;
  /** `hermes_profiles.display_name ?? profile_name` — `npcs.name` 은 절대 읽지 않는다. */
  npcName: string;
  client: ProfilePluginClient;
};

export type NpcProfileClientResult =
  { ok: true; value: NpcProfileClient } | { ok: false; response: NextResponse };

function displayNameOf(profile: HermesProfileRow): string {
  return profile.displayName?.trim() || profile.profileName;
}

function buildClient(gateway: GatewayResourceRow, profile: HermesProfileRow): ProfilePluginClient {
  return createProfilePluginClient({
    baseUrl: gateway.baseUrl,
    profileName: profile.profileName,
    profileToken: decryptGatewayToken(profile.tokenEncrypted),
  });
}

/**
 * `npcId` 를 이 채널의 **active** NPC 행으로 풀고, 그 프로필이 채널의 현재 게이트웨이
 * 것인지까지 확인한 뒤 프로필 키 클라이언트를 만든다. 다른 채널의 NPC·휴면 NPC·옛
 * 게이트웨이의 NPC 는 전부 404 `npc_not_found` — 존재 여부를 채널 밖으로 흘리지 않는다.
 */
export async function resolveNpcProfileClient(
  ctx: Pick<CronChannelContext, "channelId" | "gateway">,
  npcId: string,
): Promise<NpcProfileClientResult> {
  const [row] = await db
    .select({ npc: npcs, profile: hermesProfiles })
    .from(npcs)
    .innerJoin(hermesProfiles, eq(hermesProfiles.id, npcs.hermesProfileId))
    .where(and(eq(npcs.id, npcId), eq(npcs.channelId, ctx.channelId), eq(npcs.active, true)))
    .limit(1);
  if (!row || row.profile.gatewayId !== ctx.gateway.id) {
    return {
      ok: false,
      response: cronError(404, "npc_not_found", "NPC not found in this channel"),
    };
  }
  return {
    ok: true,
    value: {
      npc: row.npc,
      profile: row.profile,
      npcName: displayNameOf(row.profile),
      client: buildClient(ctx.gateway, row.profile),
    },
  };
}

/** 채널의 active NPC 전부(현재 게이트웨이의 프로필만) — 합집합 목록(R15)용. */
export async function listNpcProfileClients(
  ctx: Pick<CronChannelContext, "channelId" | "gateway">,
): Promise<NpcProfileClient[]> {
  const rows = await db
    .select({ npc: npcs, profile: hermesProfiles })
    .from(npcs)
    .innerJoin(hermesProfiles, eq(hermesProfiles.id, npcs.hermesProfileId))
    .where(
      and(
        eq(npcs.channelId, ctx.channelId),
        eq(npcs.active, true),
        eq(hermesProfiles.gatewayId, ctx.gateway.id),
      ),
    );
  return rows.map((row) => ({
    npc: row.npc,
    profile: row.profile,
    npcName: displayNameOf(row.profile),
    client: buildClient(ctx.gateway, row.profile),
  }));
}

// ---------------------------------------------------------------------------
// Hermes 오류 그대로 전달 (R32)
// ---------------------------------------------------------------------------

/**
 * 플러그인 실패를 HTTP 응답으로 옮긴다. 상태 코드는 Hermes 가 준 것을 그대로, 본문은
 * `{code, message}`. 로컬 대체는 없다. 클라이언트 계층에서 난 실패(status 0)만 우리가
 * 코드를 정한다 — 닿지 못했으면 502, 기다리다 끝났으면 504.
 */
export function pluginFailureResponse(res: Extract<PluginResponse<unknown>, { ok: false }>) {
  const status = res.status > 0 ? res.status : res.failure.code === "timeout" ? 504 : 502;
  return cronError(status, res.failure.code, res.failure.message, res.failure.details);
}

/** 실패 목록 항목(합집합 목록에서 프로필 하나가 실패했을 때). */
export function pluginFailureSummary(res: Extract<PluginResponse<unknown>, { ok: false }>) {
  return { code: res.failure.code, message: res.failure.message };
}
