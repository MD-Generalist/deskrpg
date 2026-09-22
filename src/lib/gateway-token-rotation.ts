import { and, eq } from "drizzle-orm";
import { db, gatewayResources, channelGatewayBindings, nowForDb } from "@/db";
import { encryptGatewayToken } from "./gateway-resources";
import { invalidateGatewayRuntimeState } from "./gateway-runtime-cache";
import { schedulePollNow } from "./automation-poll-trigger";
import { probeDeskrpgPluginWithInfo } from "./hermes/plugin-capability";
import { transportFetch } from "./hermes/setup/transport";

/** Rotate credentials in place: a new resource would cascade away profiles and bindings. */
export async function rotateGatewayToken(
  owned: typeof gatewayResources.$inferSelect,
  token: string,
  displayName: string,
) {
  const probe = await probeDeskrpgPluginWithInfo({
    baseUrl: owned.baseUrl,
    token,
    fetchImpl: transportFetch,
  });
  if (probe.capability.status !== "plugin_ready" || !probe.info) {
    return { ok: false as const, errorCode: "connection_failed" as const };
  }
  const [updated] = await db
    .update(gatewayResources)
    .set({
      tokenEncrypted: encryptGatewayToken(token),
      displayName: displayName.trim() || owned.displayName,
      pluginStatus: null,
      pluginVersion: null,
      pluginCheckedAt: null,
      pluginInfoJson: null,
      lastValidatedAt: null,
      lastValidationStatus: null,
      lastValidationError: null,
      updatedAt: nowForDb(),
    })
    .where(
      and(
        eq(gatewayResources.id, owned.id),
        eq(gatewayResources.ownerUserId, owned.ownerUserId),
        eq(gatewayResources.baseUrl, owned.baseUrl),
        eq(gatewayResources.tokenEncrypted, owned.tokenEncrypted),
      ),
    )
    .returning();
  // Another edit during the probe must not be silently overwritten.
  if (!updated) return { ok: false as const, errorCode: "connection_failed" as const };
  invalidateGatewayRuntimeState(owned.id);
  const bindings = await db
    .select({ channelId: channelGatewayBindings.channelId })
    .from(channelGatewayBindings)
    .where(eq(channelGatewayBindings.gatewayId, owned.id));
  for (const binding of bindings) schedulePollNow(binding.channelId);
  return { ok: true as const, gateway: updated };
}
