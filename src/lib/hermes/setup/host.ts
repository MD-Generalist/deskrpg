import { HOST_BOOTSTRAP, HOST_HELPER } from "./host-helper";
import type { HostExecutor, PreparedHost, SetupCandidate, SetupInspection } from "./types";

export const HOST_ERROR_CODES = new Set([
  "ssh_unknown_host",
  "ssh_host_key_failed",
  "ssh_connection_failed",
  "command_timeout",
  "output_limit",
  "host_busy",
  "invalid_candidate",
  "candidate_changed",
  "hermes_not_found",
  "host_operation_failed",
  "setup_cancelled",
  "unsafe_host_path",
  "invalid_host_config",
  "managed_service_required",
  "service_identity_ambiguous",
  "service_identity_mismatch",
  "listener_owner_required",
  "external_secret_provider",
  "api_key_invalid",
  "multiplex_override_present",
  "multiplex_conflict",
  "port_conflict",
  "listener_ownership_unverified",
  "plugin_identity_ambiguous",
  "plugin_install_failed",
  "plugin_update_failed",
  "plugin_security_review_required",
  "plugin_source_unavailable",
  "hermes_version_unsupported",
  "service_install_failed",
  "timezone_invalid",
  "timezone_write_failed",
  "gateway_restart_failed",
  "gateway_verification_failed",
  "profile_verification_failed",
  "invalid_host_operation",
]);
const WARNING_CODES = new Set([
  ...HOST_ERROR_CODES,
  "gateway_unreachable",
  "api_key_missing",
  "plugin_unauthorized",
  "plugin_pending_restart",
  "plugin_disabled",
  "plugin_absent",
  "gateway_identity_unverified",
  "hermes_version_unknown",
]);
const STEP_CODES = new Set([
  "installing_service",
  "installing_plugin",
  "enabling_plugin",
  "updating_plugin",
  "configuring_api",
  "setting_timezone",
  "restarting_gateway",
  "verifying_gateway",
]);
const ID = /^[a-f0-9]{64}$/;
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("host_operation_failed");
  return value as RecordValue;
}
function string(value: unknown, max = 256): string {
  if (typeof value !== "string" || value.length > max || /[\r\n\0]/.test(value))
    throw new Error("host_operation_failed");
  return value;
}
function publicCandidate(value: unknown): SetupCandidate {
  const item = record(value);
  const id = string(item.id);
  if (
    !ID.test(id) ||
    !Number.isInteger(item.port) ||
    Number(item.port) < 1024 ||
    Number(item.port) > 65535
  )
    throw new Error("host_operation_failed");
  for (const key of ["pluginInstalled", "pluginEnabled", "hasToken"])
    if (typeof item[key] !== "boolean") throw new Error("host_operation_failed");
  // Explicit allowlist projection: never forward helper records wholesale to HTTP callers.
  return {
    id,
    label: string(item.label),
    version: string(item.version),
    service: string(item.service),
    port: Number(item.port),
    pluginInstalled: item.pluginInstalled as boolean,
    pluginEnabled: item.pluginEnabled as boolean,
    // An unreadable version reaches the UI as null, never as a guess.
    pluginVersion: typeof item.pluginVersion === "string" ? string(item.pluginVersion, 64) : null,
    timezone: typeof item.timezone === "string" ? string(item.timezone, 64) : null,
    hasToken: item.hasToken as boolean,
    ...(typeof item.warning === "string" && WARNING_CODES.has(item.warning)
      ? { warning: item.warning }
      : {}),
  };
}
function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("setup_cancelled");
}
async function invoke(
  execute: HostExecutor,
  action: string,
  candidateId?: string,
  signal?: AbortSignal,
  option?: string,
): Promise<RecordValue> {
  checkAbort(signal);
  if (candidateId !== undefined && !ID.test(candidateId)) throw new Error("invalid_candidate");
  // The helper re-validates `option`; it is JSON-encoded into the script, never shell-interpolated.
  if (
    option !== undefined &&
    (option.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-.]+)*$/.test(option))
  )
    throw new Error("timezone_invalid");
  const timeout =
    action === "install" || action === "install-service" ? 170 : action === "verify" ? 110 : 45;
  try {
    const result = await execute("python3", ["-c", HOST_BOOTSTRAP], {
      input: JSON.stringify({
        action,
        timeout,
        script:
          HOST_HELPER +
          "\nentry(" +
          JSON.stringify(action) +
          ", " +
          (candidateId ? JSON.stringify(candidateId) : "None") +
          ", " +
          (option === undefined ? "None" : JSON.stringify(option)) +
          ")\n",
      }),
      timeoutMs: (timeout + 5) * 1000,
      signal,
    });
    checkAbort(signal);
    if (result.code !== 0 || result.stdout.length > 262144)
      throw new Error("host_operation_failed");
    const body = record(JSON.parse(result.stdout));
    if ("error" in body)
      throw new Error(
        typeof body.error === "string" && HOST_ERROR_CODES.has(body.error)
          ? body.error
          : "host_operation_failed",
      );
    return body;
  } catch (error) {
    if (signal?.aborted) throw new Error("setup_cancelled");
    if (error instanceof Error && error.message === "timezone_invalid") throw error;
    if (error instanceof Error && HOST_ERROR_CODES.has(error.message)) throw error;
    // SSH/execution layers may include stderr in an exception. Never propagate it.
    throw new Error("host_operation_failed");
  }
}
export async function discoverHost(execute: HostExecutor): Promise<SetupCandidate[]> {
  const body = await invoke(execute, "discover");
  if (!Array.isArray(body.candidates) || body.candidates.length > 256)
    throw new Error("host_operation_failed");
  return body.candidates.map(publicCandidate);
}
function inspection(body: RecordValue): SetupInspection {
  if (
    !["plugin_ready", "plugin_absent", "plugin_unauthorized", "unknown"].includes(
      String(body.pluginStatus),
    ) ||
    !Array.isArray(body.changes)
  )
    throw new Error("host_operation_failed");
  const profiles = Array.isArray(body.profiles)
    ? body.profiles.map((value) => {
        const profile = record(value);
        const name = string(profile.name, 64);
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name) || typeof profile.hasToken !== "boolean")
          throw new Error("host_operation_failed");
        if (profile.canProvision !== undefined && typeof profile.canProvision !== "boolean")
          throw new Error("host_operation_failed");
        return {
          name,
          hasToken: profile.hasToken,
          ...(profile.canProvision === true ? { canProvision: true } : {}),
        };
      })
    : [];
  return {
    candidate: publicCandidate(body.candidate),
    pluginStatus: body.pluginStatus as SetupInspection["pluginStatus"],
    changes: body.changes.filter(
      (value): value is string => typeof value === "string" && STEP_CODES.has(value),
    ),
    profiles,
  };
}
export async function inspectHost(
  execute: HostExecutor,
  candidateId: string,
): Promise<SetupInspection> {
  return inspection(await invoke(execute, "inspect", candidateId));
}
export async function prepareHost(
  execute: HostExecutor,
  candidateId: string,
  onStep: (step: string) => void,
  signal?: AbortSignal,
  timezone?: string,
): Promise<PreparedHost> {
  const stage = async (step: string, action: string, option?: string) => {
    checkAbort(signal);
    onStep(step);
    checkAbort(signal);
    return invoke(execute, action, candidateId, signal, option);
  };
  const state = inspection(await stage("inspecting", "inspect"));
  // A unit must exist before anything tries to restart the gateway through it.
  if (state.changes.includes("installing_service"))
    await stage("installing_service", "install-service");
  if (state.changes.includes("updating_plugin")) await stage("updating_plugin", "install");
  else if (!state.candidate.pluginInstalled || !state.candidate.pluginEnabled)
    await stage(
      state.candidate.pluginInstalled ? "enabling_plugin" : "installing_plugin",
      "install",
    );
  const configuring =
    state.pluginStatus !== "plugin_ready" || state.changes.includes("configuring_api");
  // Never overwrite a timezone the operator already set.
  const settingTimezone = Boolean(timezone) && !state.candidate.timezone;
  if (configuring) await stage("configuring_api", "configure");
  if (settingTimezone) await stage("setting_timezone", "set-timezone", timezone);
  if (configuring || settingTimezone) await stage("restarting_gateway", "restart");
  const body = record((await stage("verifying_gateway", "verify")).prepared);
  const baseUrl = string(body.baseUrl);
  if (
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl) ||
    Number(new URL(baseUrl).port) !== state.candidate.port
  )
    throw new Error("host_operation_failed");
  const token = string(body.token, 8192);
  if (token.length < 16 || !Array.isArray(body.profiles) || body.profiles.length > 256)
    throw new Error("host_operation_failed");
  const profiles = body.profiles.map((value) => {
    const profile = record(value);
    const name = string(profile.name, 64);
    const profileToken = string(profile.token, 8192);
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name) || profileToken.length < 16)
      throw new Error("profile_verification_failed");
    return { name, token: profileToken };
  });
  return { baseUrl, token, profiles };
}
