/**
 * Importing a Hermes profile that already exists on a gateway — made on the host with
 * `hermes profile create`, or before DeskRPG connected — as an employee, without anyone
 * pasting its key.
 *
 * The plugin mints the key on the owner key (`POST /deskrpg/profiles/{name}/key`, capability
 * `profile_key_issue`); it never reads an existing key back. The key is stored encrypted at once
 * and never leaves the server. Only the gateway owner imports — the same line as registering a
 * profile by hand.
 */
import { and, eq } from "drizzle-orm";

import { db, hermesProfiles } from "@/db";
import { decryptGatewayToken, getAccessibleGatewayResource } from "@/lib/gateway-resources";
import { registerHermesProfile } from "@/lib/hermes-profiles";
import { createPluginClient } from "@/lib/hermes/plugin-client";
import { isValidProfileName } from "@/lib/hermes/profile-name";
import { hireProfileIntoBoundChannels } from "@/lib/npc-roster";

/** Codes the plugin's key route answers with — anything else on a 404/405 means an older plugin. */
const KEY_ROUTE_CODES = new Set([
  "key_exists",
  "external_secret_provider",
  "no_profile",
  "default_profile",
]);

type Refusal = { ok: false; status: number; errorCode: string; upstream?: boolean };

async function ownedGateway(userId: string, gatewayId: string) {
  const access = await getAccessibleGatewayResource(userId, gatewayId);
  if (!access) return { ok: false, status: 404, errorCode: "gateway_not_found" } as Refusal;
  if (!access.isOwner) return { ok: false, status: 403, errorCode: "forbidden" } as Refusal;
  return {
    ok: true as const,
    client: createPluginClient({
      baseUrl: access.resource.baseUrl,
      defaultToken: decryptGatewayToken(access.resource.tokenEncrypted),
    }),
  };
}

async function registeredNames(gatewayId: string): Promise<Set<string>> {
  const rows = await db
    .select({ profileName: hermesProfiles.profileName })
    .from(hermesProfiles)
    .where(eq(hermesProfiles.gatewayId, gatewayId));
  return new Set(rows.map((r) => r.profileName));
}

/** The gateway's profiles that are not employees yet (never `default` — its key is the owner key). */
export async function listImportableProfiles(
  userId: string,
  gatewayId: string,
): Promise<{ ok: true; profiles: { name: string; description: string }[] } | Refusal> {
  const gate = await ownedGateway(userId, gatewayId);
  if (!gate.ok) return gate;
  const res = await gate.client.listProfiles();
  if (!res.ok) {
    // The list lives on the root listener, so a 404/405 means the plugin has no such route yet.
    const code =
      res.status === 404 || res.status === 405 ? "plugin_update_required" : res.failure.code;
    return { ok: false, status: 200, errorCode: code, upstream: true };
  }
  const taken = await registeredNames(gatewayId);
  const profiles = res.data.profiles
    .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>) : {}))
    .filter((p): p is { name: string; description?: unknown } => typeof p.name === "string")
    .filter((p) => p.name !== "default" && !taken.has(p.name))
    .map((p) => ({
      name: p.name,
      description: typeof p.description === "string" ? p.description : "",
    }));
  return { ok: true, profiles };
}

export type ImportedProfile = {
  profile: Omit<typeof hermesProfiles.$inferSelect, "tokenEncrypted">;
  attendedChannels: number;
  rotated: boolean;
};

type OwnedGateway = Extract<Awaited<ReturnType<typeof ownedGateway>>, { ok: true }>;

export async function importHermesProfile(input: {
  userId: string;
  gatewayId: string;
  profileName: string;
  rotate: boolean;
}): Promise<({ ok: true } & ImportedProfile) | Refusal> {
  const gate = await ownedGateway(input.userId, input.gatewayId);
  if (!gate.ok) return gate;
  return importOne(gate, input);
}

async function importOne(
  gate: OwnedGateway,
  input: { userId: string; gatewayId: string; profileName: string; rotate: boolean },
): Promise<({ ok: true } & ImportedProfile) | Refusal> {
  const name = input.profileName;
  if (!isValidProfileName(name))
    return { ok: false, status: 400, errorCode: "invalid_profile_name" };
  if (name === "default") return { ok: false, status: 400, errorCode: "default_profile" };
  const [existing] = await db
    .select({ id: hermesProfiles.id })
    .from(hermesProfiles)
    .where(and(eq(hermesProfiles.gatewayId, input.gatewayId), eq(hermesProfiles.profileName, name)))
    .limit(1);
  if (existing) return { ok: false, status: 409, errorCode: "already_registered" };

  const res = await gate.client.issueProfileKey(name, { rotate: input.rotate });
  if (!res.ok) {
    const code = res.failure.code;
    if ((res.status === 404 || res.status === 405) && !KEY_ROUTE_CODES.has(code)) {
      return { ok: false, status: 428, errorCode: "plugin_update_required" };
    }
    return { ok: false, status: 200, errorCode: code, upstream: true };
  }

  // The key now exists in Hermes. If storing it fails, a retry meets `key_exists` and the screen
  // offers to replace it — never a silent dead end.
  const stored = await registerHermesProfile({
    userId: input.userId,
    gatewayId: input.gatewayId,
    profileName: name,
    token: res.data.apiKey,
  });
  if ("error" in stored) return { ok: false, status: 500, errorCode: "key_store_failed" };

  let attendedChannels = 0;
  try {
    attendedChannels = (await hireProfileIntoBoundChannels(stored.profile.id)).created;
  } catch (err) {
    console.error(`Failed to hire imported profile ${stored.profile.id} into bound channels:`, err);
  }
  const { tokenEncrypted: _tokenEncrypted, ...profile } = stored.profile;
  return { ok: true, profile, attendedChannels, rotated: res.data.rotated === true };
}

/** Most profiles one bulk import takes — a Hermes host rarely has more, and each one is a key issue. */
export const BULK_IMPORT_LIMIT = 100;

/**
 * Failures that would repeat for every remaining profile (the gateway is down, refuses the owner key,
 * or its plugin cannot issue keys). The batch stops there instead of waiting out a timeout per profile.
 */
const BATCH_STOPPERS = new Set([
  "unreachable",
  "timeout",
  "gateway_auth_failed",
  "plugin_update_required",
]);

export type BulkImportResult =
  | { name: string; status: "imported"; attendedChannels: number }
  | { name: string; status: "key_exists" }
  | { name: string; status: "failed"; errorCode: string }
  | { name: string; status: "not_tried" };

/**
 * Imports several profiles one after another — never in parallel, so the gateway sees one key issue
 * at a time. A profile that already has a key is skipped (`key_exists`) and never re-keyed here:
 * replacing it cuts off whatever used the old key, so that stays a per-profile choice. Profiles that
 * were imported stay imported when a later one fails.
 */
export async function importHermesProfiles(input: {
  userId: string;
  gatewayId: string;
  profileNames: string[];
}): Promise<{ ok: true; results: BulkImportResult[] } | Refusal> {
  const gate = await ownedGateway(input.userId, input.gatewayId);
  if (!gate.ok) return gate;
  const results: BulkImportResult[] = [];
  let stoppedBy: string | null = null;
  for (const name of input.profileNames) {
    if (stoppedBy) {
      results.push({ name, status: "not_tried" });
      continue;
    }
    const one = await importOne(gate, { ...input, profileName: name, rotate: false });
    if (one.ok) {
      results.push({ name, status: "imported", attendedChannels: one.attendedChannels });
    } else if (one.errorCode === "key_exists") {
      results.push({ name, status: "key_exists" });
    } else {
      results.push({ name, status: "failed", errorCode: one.errorCode });
      if (BATCH_STOPPERS.has(one.errorCode)) stoppedBy = one.errorCode;
    }
  }
  return { ok: true, results };
}
