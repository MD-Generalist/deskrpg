/**
 * Whether a Hermes container next to DeskRPG was set up from an older compose file.
 *
 * The current compose files install the plugin commit the DeskRPG image pins (`plugin-pin` reads it from the same
 * image this app runs from), so on a Compose gateway the running plugin commit always equals `PLUGIN_PIN`. Older
 * compose files keep pulling the plugin's main branch, and Hostinger's Update never re-reads the compose — only
 * replacing the file once fixes it. Its version string usually equals the latest release, so the commit decides;
 * without one (a plugin before 0.30.0) only a version above the pin proves an unreleased build.
 *
 * Pure function — it ships in the client bundle.
 */
import { compareSemver } from "@/lib/hermes/plugin-capability";
import { composeServiceHost } from "@/lib/hermes/setup/gateway-host-target";
import { PLUGIN_PIN, PLUGIN_VERSION } from "@/lib/hermes/setup/pin";

export function isOldComposeInstall(input: {
  baseUrl: string;
  pluginStatus: string | null | undefined;
  pluginVersion: string | null | undefined;
  pluginCommit: string | null | undefined;
}): boolean {
  if (!composeServiceHost(input.baseUrl) || input.pluginStatus !== "plugin_ready") return false;
  if (input.pluginCommit) return input.pluginCommit !== PLUGIN_PIN;
  const version = (input.pluginVersion ?? "").trim();
  return version !== "" && compareSemver(version, PLUGIN_VERSION) === 1;
}

/** Where a Hostinger install learns how to replace its compose file once. */
export const HOSTINGER_COMPOSE_REPLACE_URL =
  "https://github.com/dandacompany/deskrpg/blob/master/deploy/hostinger/README.md#set-up-before-this-change-replace-the-compose-once";

/** For an install cloned from the repository (README "Docker with Hermes"): take the new compose and start again. */
export const CLONED_COMPOSE_UPDATE_COMMAND =
  "git pull && docker compose --env-file .env.hermes -f docker/docker-compose.hermes.yml up -d";
