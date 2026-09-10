export function hostSetupAllowed(env: Record<string, string | undefined>, role?: string) {
  return (
    ["1", "true", "yes"].includes(env.DESKRPG_HOST_SETUP_ENABLED ?? "") && role === "system_admin"
  );
}

export function sameOriginMutation(
  origin: string | null,
  host: string | null,
  site?: string | null,
) {
  if (!origin || !host || site === "cross-site") return false;
  try {
    const parsed = new URL(origin);
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      parsed.host === host &&
      parsed.origin === origin
    );
  } catch {
    return false;
  }
}

export function validateGatewayUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) throw new Error("setup_invalid_request");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("setup_invalid_request");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    host.startsWith("169.254.") ||
    host.startsWith("fe80:") ||
    host === "metadata.google.internal" ||
    host.endsWith(".deskrpg-ssh.invalid")
  )
    throw new Error("setup_invalid_request");
  return url.toString().replace(/\/+$/, "");
}

const SAFE_CODES = new Set([
  "setup_forbidden",
  "setup_bad_origin",
  "setup_busy",
  "setup_not_found",
  "setup_invalid_request",
  "setup_failed",
  "setup_cancelled",
  "setup_interrupted",
  "gateway_unreachable",
  "gateway_not_hermes",
  "gateway_unauthorized",
  "plugin_unauthorized",
  "plugin_unknown",
  "profile_import_failed",
  "hermes_not_found",
  "hermes_version_unsupported",
  "plugin_install_failed",
  "plugin_enable_failed",
  "plugin_verify_failed",
  "gateway_restart_failed",
  "gateway_start_failed",
  "port_conflict",
  "multiplex_conflict",
  "listener_owner_required",
  "service_unavailable",
  "service_not_found",
  "candidate_not_found",
  "candidate_changed",
  "configuration_failed",
  "token_missing",
  "token_invalid",
  "ssh_unknown_host",
  "ssh_connection_failed",
  "ssh_host_key_failed",
  "ssh_unavailable",
  "ssh_timeout",
  "command_timeout",
  "command_failed",
  "output_limit",
  "unsupported_platform",
  "invalid_candidate",
  "host_operation_failed",
  "unsafe_host_path",
  "invalid_host_config",
  "managed_service_required",
  "service_identity_ambiguous",
  "service_identity_mismatch",
  "external_secret_provider",
  "api_key_invalid",
  "multiplex_override_present",
  "listener_ownership_unverified",
  "plugin_identity_ambiguous",
  "gateway_verification_failed",
  "profile_verification_failed",
  "invalid_host_operation",
  "host_busy",
]);
export function safeSetupError(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  return SAFE_CODES.has(code) ? code : "setup_failed";
}
