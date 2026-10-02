// Expands the skill chips of a chat message into the message Hermes' TUI would send for
// `/skill … instruction`, through the plugin's `skill-invocation` route. The server calls this
// right before handing a message to Hermes; the stored line and the browser only ever see the
// chips (`/skill`) and the instruction.
//
// Failures are codes the chat screens already know how to render (NpcResponseMessageCode for a DM,
// RoomErrorCode for a room). Nothing is sent to Hermes when expansion fails — a message with its
// chips silently dropped would read as an ordinary question.

import { and, eq } from "drizzle-orm";

import { db, hermesProfiles, npcs } from "@/db";
import { MAX_SKILL_CHIPS, formatSkillChipLine, normalizeSkillName } from "@/lib/chat/skill-chips";
import { forceReprobePluginInfo } from "@/lib/automation-gate";
import { decryptGatewayToken, getChannelGatewayBinding } from "@/lib/gateway-resources";
import { SKILL_INVOCATION_CAPABILITY } from "@/lib/hermes/deskrpg-plugin-types";
import { restorePluginInfo } from "@/lib/hermes/plugin-cache-update";
import { createOwnerPluginClient, createProfilePluginClient } from "@/lib/hermes/plugin-client";

export type SkillExpansionErrorCode =
  | "too_many_skills"
  | "skill_not_found"
  | "skill_disabled"
  | "skill_load_failed"
  | "plugin_update_required"
  | "plugin_not_loaded"
  | "npc_not_found"
  | "gateway_not_connected"
  | "gateway_auth_failed"
  | "gateway_unreachable";

export type SkillExpansion =
  { ok: true; message: string } | { ok: false; errorCode: SkillExpansionErrorCode };

export type SkillExpansionInput = {
  channelId: string;
  npcId: string;
  skills: string[];
  instruction: string;
};

/**
 * The chips a socket payload carries, normalized: the leading slash dropped, repeats folded.
 * More than {@link MAX_SKILL_CHIPS} or a name that is not a skill name is refused here, before
 * anything is stored or the plugin is called.
 */
export function validateSkillChips(
  raw: unknown,
):
  { ok: true; skills: string[] } | { ok: false; errorCode: "too_many_skills" | "skill_not_found" } {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > MAX_SKILL_CHIPS) return { ok: false, errorCode: "too_many_skills" };
  const skills: string[] = [];
  for (const item of list) {
    const name = typeof item === "string" ? normalizeSkillName(item) : null;
    if (!name) return { ok: false, errorCode: "skill_not_found" };
    if (!skills.includes(name)) skills.push(name);
  }
  return { ok: true, skills };
}

/** `@[name]` mentions at the start of a room message, as `formatMention` writes them. */
const LEADING_MENTIONS = /^(?:\s*@\[(?:\\.|[^\]\\])*\])+\s*/;

/**
 * A room message split into the mentions it opens with and the instruction after them. The chips go
 * between the two, so the stored line reads `@[Sophie] /research go` and a reader that strips the
 * mention prefix finds the chips first.
 */
export function splitLeadingMentions(text: string): { prefix: string; rest: string } {
  const match = LEADING_MENTIONS.exec(text);
  if (!match) return { prefix: "", rest: text };
  return { prefix: match[0].trim(), rest: text.slice(match[0].length) };
}

/** The line a room stores for a message sent with chips: mentions, then chips, then the instruction. */
export function formatRoomSkillLine(text: string, skills: string[]): string {
  const { prefix, rest } = splitLeadingMentions(text);
  const line = formatSkillChipLine(skills, rest);
  return prefix ? `${prefix} ${line}` : line;
}

/** Stands in for an empty plugin-info cache: no capability, so the gateway is re-probed once. */
const NO_INFO = {
  plugin: "deskrpg" as const,
  version: "0.0.0",
  capabilities: [] as string[],
  timezone: null,
  kanban: { dispatcher_present: false, attachments: false },
};

function invokeFailureCode(status: number, code: string): SkillExpansionErrorCode {
  if (status === 401 || status === 403) return "gateway_auth_failed";
  if (status === 404) return "skill_not_found";
  if (status === 409) return "skill_disabled";
  if (status === 400) return code === "too_many_skills" ? "too_many_skills" : "skill_not_found";
  if (status === 0 || code === "unreachable" || code === "timeout") return "gateway_unreachable";
  return "skill_load_failed";
}

/**
 * Builds the Hermes message for `skills` + `instruction` on the NPC's own profile. The plugin needs
 * capability `skill_invocation`; a cached info without it is re-probed once (throttled per gateway,
 * like `hasPluginCapability`) so a gateway upgraded minutes ago is recognized. When it is still
 * missing, `/deskrpg/info` tells a plugin that is not loaded (404 everywhere) from one that is too
 * old — the user's fix differs.
 */
export async function expandSkillMessage(input: SkillExpansionInput): Promise<SkillExpansion> {
  const valid = validateSkillChips(input.skills);
  if (!valid.ok) return valid;
  if (valid.skills.length === 0) return { ok: false, errorCode: "skill_not_found" };

  const binding = await getChannelGatewayBinding(input.channelId);
  if (!binding) return { ok: false, errorCode: "gateway_not_connected" };
  const gateway = binding.resource;

  // The NPC must be this channel's active employee on the channel's current gateway — an NPC
  // bound to a profile of an old gateway would otherwise be asked with a key that gateway no
  // longer knows. Same rule as `resolveNpcProfileClient`.
  const [row] = await db
    .select({
      profileName: hermesProfiles.profileName,
      tokenEncrypted: hermesProfiles.tokenEncrypted,
      gatewayId: hermesProfiles.gatewayId,
    })
    .from(npcs)
    .innerJoin(hermesProfiles, eq(hermesProfiles.id, npcs.hermesProfileId))
    .where(
      and(eq(npcs.id, input.npcId), eq(npcs.channelId, input.channelId), eq(npcs.active, true)),
    )
    .limit(1);
  if (!row || row.gatewayId !== gateway.id) return { ok: false, errorCode: "npc_not_found" };

  const ownerToken = decryptGatewayToken(gateway.tokenEncrypted);
  const cached = restorePluginInfo(gateway.pluginInfoJson) ?? NO_INFO;
  let capable = cached.capabilities.includes(SKILL_INVOCATION_CAPABILITY);
  if (!capable) {
    const fresh = await forceReprobePluginInfo(gateway, ownerToken);
    capable = fresh?.capabilities.includes(SKILL_INVOCATION_CAPABILITY) ?? false;
  }
  if (!capable) {
    const probe = await createOwnerPluginClient({ baseUrl: gateway.baseUrl, ownerToken }).info();
    const notLoaded = !probe.ok && (probe.status === 404 || probe.status === 405);
    return { ok: false, errorCode: notLoaded ? "plugin_not_loaded" : "plugin_update_required" };
  }

  const client = createProfilePluginClient({
    baseUrl: gateway.baseUrl,
    profileName: row.profileName,
    profileToken: decryptGatewayToken(row.tokenEncrypted),
  });
  const res = await client.skills.invoke({ skills: valid.skills, instruction: input.instruction });
  if (res.ok) return { ok: true, message: res.data.message };
  return { ok: false, errorCode: invokeFailureCode(res.status, res.failure.code) };
}

/** The seam the socket handlers call through, so a test can stand in for the plugin round trip. */
export const skillExpansion = { expand: expandSkillMessage };
