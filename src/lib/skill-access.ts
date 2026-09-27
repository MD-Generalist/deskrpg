/**
 * The gatekeeper for the NPC skill management REST. Order: login (401) -> channel member
 * (403/404) -> gateway (409) -> automation plugin gate -> the NPC is an active NPC in
 * this channel with a current-gateway profile (404 npc_not_found) -> capability (428,
 * except for the list GET) -> mutations require the gateway owner (403).
 *
 * Skills are **per-profile**. If another channel has also hired the same profile, a
 * change applies to that channel too — the response carries `sharedChannelCount` so the
 * screen can say so.
 */
import { and, countDistinct, eq, ne } from "drizzle-orm";
import type { NextResponse } from "next/server";

import { db, hermesProfiles, npcs } from "@/db";
import { forceReprobePluginInfo } from "@/lib/automation-gate";
import {
  cronError,
  gateError,
  resolveCronChannelContext,
  resolveNpcProfileClient,
  type CronChannelContext,
} from "@/lib/cron-access";
import { decryptGatewayToken } from "@/lib/gateway-resources";
import { SKILL_ADMIN_CAPABILITY, SKILL_ADMIN_MIN_VERSION } from "@/lib/hermes/deskrpg-plugin-types";
import type { ProfilePluginClient } from "@/lib/hermes/plugin-client-types";
import {
  noSkillManagement,
  SKILL_FEATURE_CAPABILITY,
  skillFeaturesOf,
  type SkillFeature,
  type SkillFeatures,
} from "@/lib/skill-features";

export type SkillContext = {
  userId: string;
  channelId: string;
  npcId: string;
  profileName: string;
  isGatewayOwner: boolean;
  /** Any skill management at all (a plugin new enough). Each screen still checks its own feature. */
  capabilityReady: boolean;
  features: SkillFeatures;
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
      ...(await resolveFeatures(channel.ctx)),
      client: npc.value.client,
      gatewayId: channel.ctx.gateway.id,
    },
  };
}

/**
 * The features from the cached plugin info. If one is off, the gateway is probed once more — it may have been
 * upgraded since the cache was filled — instead of once per missing feature.
 */
async function resolveFeatures(
  channel: Pick<CronChannelContext, "gateway" | "info">,
): Promise<{ features: SkillFeatures; capabilityReady: boolean }> {
  let features = skillFeaturesOf(channel.info.capabilities);
  if (Object.values(features).some((on) => !on)) {
    const fresh = await forceReprobePluginInfo(
      channel.gateway,
      decryptGatewayToken(channel.gateway.tokenEncrypted),
    );
    if (fresh) features = skillFeaturesOf(fresh.capabilities);
  }
  return { features, capabilityReady: !noSkillManagement(features) };
}

/**
 * 428 when this route's feature is off. A plugin with no skill management at all needs an upgrade; a newer one
 * that turned only this feature off is running on a Hermes that can't serve it — upgrading the plugin won't help.
 */
export function requireFeature(
  ctx: Pick<SkillContext, "features">,
  feature: SkillFeature,
): NextResponse | null {
  if (ctx.features[feature]) return null;
  if (noSkillManagement(ctx.features))
    return gateError(
      "plugin_upgrade_required",
      `deskrpg-hermes-plugin ${SKILL_ADMIN_MIN_VERSION}+ required`,
      { minVersion: SKILL_ADMIN_MIN_VERSION, missing: [SKILL_ADMIN_CAPABILITY] },
    );
  return cronError(
    428,
    "skill_feature_unavailable",
    `This Hermes can't serve ${feature} for skills`,
    { missing: [SKILL_FEATURE_CAPABILITY[feature]] },
  );
}

export function requireOwner(ctx: Pick<SkillContext, "isGatewayOwner">): NextResponse | null {
  return ctx.isGatewayOwner ? null : cronError(403, "forbidden", "Gateway owner only");
}

/** The number of **other** channels that have the same profile on the same gateway as an NPC (including dormant NPCs — waking one is affected immediately). */
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
