import { HOST_BOOTSTRAP, HOST_HELPER, HOST_INSTALLER } from "./host-helper";
import type {
  HostExecutor,
  PreparedHost,
  SetupCandidate,
  SetupInspection,
  SetupProvisionRequest,
} from "./types";

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
  "profile_name_invalid",
  "profile_exists",
  "profile_create_failed",
  "profile_key_failed",
  "profile_provision_forbidden",
  "hermes_already_installed",
  "hermes_install_failed",
  "hermes_installer_unavailable",
]);
/** 실패가 아닌 알림만 담는다. 오류 경로에는 절대 오르지 않는다. */
const HOST_WARNING_CODES = new Set(["profile_not_served", "model_provider_required"]);
const DIGEST = /^[a-f0-9]{64}$/;
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
const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RESERVED_PROFILE_NAMES = new Set(["hermes", "test", "tmp", "root", "sudo", "default"]);
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
  if (option !== undefined) {
    if (action === "set-timezone") {
      if (option.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-.]+)*$/.test(option))
        throw new Error("timezone_invalid");
    } else if (option.length > 1024 || /[\r\n\0]/.test(option))
      throw new Error("setup_invalid_request");
  }
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
    if (
      error instanceof Error &&
      ["timezone_invalid", "setup_invalid_request", "profile_name_invalid"].includes(error.message)
    )
      throw error;
    if (error instanceof Error && HOST_ERROR_CODES.has(error.message)) throw error;
    // SSH/execution layers may include stderr in an exception. Never propagate it.
    throw new Error("host_operation_failed");
  }
}
/**
 * 로컬 Hermes 설치. 게이트 판정은 호출자(service.ts)가 이미 끝냈다고 가정하지 않고,
 * 이 함수는 설치가 없다는 것과 결과 지문만 책임진다. 설치 출력은 어디에도 남지 않는다.
 */
export async function installHermesHost(
  execute: HostExecutor,
  signal?: AbortSignal,
): Promise<{ installerDigest: string }> {
  checkAbort(signal);
  try {
    const result = await execute("python3", ["-c", HOST_INSTALLER], {
      timeoutMs: 600_000,
      signal,
    });
    checkAbort(signal);
    if (result.code !== 0 || result.stdout.length > 65536) throw new Error("hermes_install_failed");
    const body = record(JSON.parse(result.stdout));
    if ("error" in body)
      throw new Error(
        typeof body.error === "string" && HOST_ERROR_CODES.has(body.error)
          ? body.error
          : "host_operation_failed",
      );
    const digest = string(body.installerDigest, 64);
    if (!DIGEST.test(digest)) throw new Error("hermes_install_failed");
    return { installerDigest: digest };
  } catch (error) {
    if (signal?.aborted) throw new Error("setup_cancelled");
    if (error instanceof Error && HOST_ERROR_CODES.has(error.message)) throw error;
    // 설치 로그·stderr 가 예외에 실려 있을 수 있다. 절대 그대로 흘리지 않는다.
    throw new Error("hermes_install_failed");
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
function assertProvisionRequest(provision: SetupProvisionRequest | undefined) {
  const created = provision?.createProfile;
  if (created !== undefined) {
    if (!PROFILE_NAME.test(created.name) || RESERVED_PROFILE_NAMES.has(created.name))
      throw new Error("profile_name_invalid");
    if (
      created.description !== undefined &&
      (created.description.length > 200 || /[\r\n\0]/.test(created.description))
    )
      throw new Error("profile_name_invalid");
  }
  const keys = [...new Set(provision?.provisionKeys ?? [])];
  if (keys.length > 10) throw new Error("setup_invalid_request");
  if (keys.some((name) => !PROFILE_NAME.test(name) || RESERVED_PROFILE_NAMES.has(name)))
    throw new Error("profile_name_invalid");
  return keys;
}
export async function prepareHost(
  execute: HostExecutor,
  initialCandidateId: string,
  onStep: (step: string) => void,
  signal?: AbortSignal,
  timezone?: string,
  provision?: SetupProvisionRequest,
): Promise<PreparedHost> {
  // 서비스를 등록하면 유닛 정의가 생기고 후보 id(정의의 해시)가 바뀐다. 이후 단계는 새 id 를 써야 한다.
  let candidateId = initialCandidateId;
  const stage = async (step: string, action: string, option?: string) => {
    checkAbort(signal);
    onStep(step);
    checkAbort(signal);
    return invoke(execute, action, candidateId, signal, option);
  };
  const requestedKeys = assertProvisionRequest(provision);
  const warnings: string[] = [];
  const state = inspection(await stage("inspecting", "inspect"));
  // 새 프로필은 플러그인·API 작업보다 앞에 만들어야 재시작 한 번으로 서빙된다.
  const provisionKeys = [...requestedKeys];
  if (provision?.createProfile) {
    const created = record(
      await stage(
        "creating_profile",
        "create-profile",
        JSON.stringify({
          name: provision.createProfile.name,
          ...(provision.createProfile.description
            ? { description: provision.createProfile.description }
            : {}),
        }),
      ),
    );
    const notServed =
      typeof created.warning === "string" && HOST_WARNING_CODES.has(created.warning);
    if (notServed) warnings.push(created.warning as string);
    // 허용 목록 밖이면 서빙되지 않으므로 키를 발급해도 검증할 수 없다.
    if (!notServed && !provisionKeys.includes(provision.createProfile.name))
      provisionKeys.push(provision.createProfile.name);
  }
  const provisioned: string[] = [];
  if (provisionKeys.length) {
    // 여러 프로필을 한 단계에서 처리한다 — 진행 기록에 프로필 이름은 남기지 않는다.
    checkAbort(signal);
    onStep("provisioning_keys");
    for (const name of provisionKeys) {
      checkAbort(signal);
      const result = record(await invoke(execute, "provision-key", candidateId, signal, name));
      if (result.provisioned === true) provisioned.push(name);
    }
  }
  // A unit must exist before anything tries to restart the gateway through it.
  if (state.changes.includes("installing_service")) {
    const installed = record(await stage("installing_service", "install-service"));
    if (typeof installed.candidateId === "string" && installed.candidateId.length === 64)
      candidateId = installed.candidateId;
  }
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
  const verified = await stage("verifying_gateway", "verify");
  for (const warning of Array.isArray(verified.warnings) ? verified.warnings : [])
    if (
      typeof warning === "string" &&
      HOST_WARNING_CODES.has(warning) &&
      !warnings.includes(warning)
    )
      warnings.push(warning);
  const body = record(verified.prepared);
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
  // 키를 발급했으면 그 키로 실제 서빙을 확인한다. verify 는 인증에 실패한 프로필을 그냥 뺀다.
  if (provisioned.some((name) => !profiles.some((profile) => profile.name === name)))
    throw new Error("profile_verify_failed");
  return { baseUrl, token, profiles, ...(warnings.length ? { warnings } : {}) };
}
