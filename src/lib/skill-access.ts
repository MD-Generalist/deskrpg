/**
 * NPC 스킬 관리 REST 의 문지기. 순서: 로그인(401) → 채널 멤버(403/404) → 게이트웨이(409) →
 * 자동화 플러그인 게이트 → NPC 가 이 채널의 active NPC 이고 현재 게이트웨이 프로필(404 npc_not_found) →
 * capability(428, 목록 GET 은 예외) → 변경은 게이트웨이 소유자(403).
 *
 * 스킬은 **프로필 단위**다. 같은 프로필을 다른 채널이 고용했으면 변경이 그 채널에도 적용된다 —
 * `sharedChannelCount` 를 응답에 실어 화면이 알린다.
 */
import { and, countDistinct, eq, ne } from "drizzle-orm";
import type { NextResponse } from "next/server";

import { db, hermesProfiles, npcs } from "@/db";
import { cronError, resolveCronChannelContext, resolveNpcProfileClient } from "@/lib/cron-access";
import { SKILL_ADMIN_CAPABILITY, SKILL_ADMIN_MIN_VERSION } from "@/lib/hermes/deskrpg-plugin-types";
import type { ProfilePluginClient } from "@/lib/hermes/plugin-client-types";

export type SkillContext = {
  userId: string;
  channelId: string;
  npcId: string;
  profileName: string;
  isGatewayOwner: boolean;
  capabilityReady: boolean;
  client: ProfilePluginClient;
  gatewayId: string;
};

type Result<T> = ({ ok: true } & T) | { ok: false; response: NextResponse };

export async function resolveSkillContext(input: {
  userId: string | null;
  channelId: string;
  npcId: string;
}): Promise<Result<{ ctx: SkillContext }>> {
  const channel = await resolveCronChannelContext({
    userId: input.userId,
    channelId: input.channelId,
  });
  if (!channel.ok) return channel;
  const npc = await resolveNpcProfileClient(channel.ctx, input.npcId);
  if (!npc.ok) return npc;
  return {
    ok: true,
    ctx: {
      userId: channel.ctx.userId,
      channelId: input.channelId,
      npcId: input.npcId,
      profileName: npc.value.profile.profileName,
      isGatewayOwner: channel.ctx.gateway.ownerUserId === channel.ctx.userId,
      capabilityReady: channel.ctx.info.capabilities.includes(SKILL_ADMIN_CAPABILITY),
      client: npc.value.client,
      gatewayId: channel.ctx.gateway.id,
    },
  };
}

export function requireCapability(ctx: Pick<SkillContext, "capabilityReady">): NextResponse | null {
  if (ctx.capabilityReady) return null;
  return cronError(
    428,
    "plugin_upgrade_required",
    `deskrpg-hermes-plugin ${SKILL_ADMIN_MIN_VERSION}+ required`,
    { minVersion: SKILL_ADMIN_MIN_VERSION, missing: [SKILL_ADMIN_CAPABILITY] },
  );
}

export function requireOwner(ctx: Pick<SkillContext, "isGatewayOwner">): NextResponse | null {
  return ctx.isGatewayOwner ? null : cronError(403, "forbidden", "Gateway owner only");
}

/** 같은 게이트웨이의 같은 프로필을 NPC 로 가진 **다른** 채널 수(잠든 NPC 포함 — 깨우면 바로 영향을 받는다). */
export async function sharedChannelCount(
  ctx: Pick<SkillContext, "gatewayId" | "profileName" | "channelId">,
): Promise<number> {
  const [row] = await db
    .select({ n: countDistinct(npcs.channelId) })
    .from(npcs)
    .innerJoin(hermesProfiles, eq(hermesProfiles.id, npcs.hermesProfileId))
    .where(
      and(
        eq(hermesProfiles.gatewayId, ctx.gatewayId),
        eq(hermesProfiles.profileName, ctx.profileName),
        ne(npcs.channelId, ctx.channelId),
      ),
    );
  return Number(row?.n ?? 0);
}
