import type { SetupModelState } from "./types";

const OFF = new Set(["0", "false", "no", "off"]);
/** 운영자가 끈 스위치인가. 비어 있으면 켜짐이다 — 이 스위치들은 거절용이다. */
function switchedOff(value: string | undefined) {
  return OFF.has((value ?? "").trim().toLowerCase());
}

/**
 * 호스트(로컬·SSH)에서 명령을 실행하는 설정 마법사를 열어도 되는가.
 *
 * 2026-09-19 단테 결정: `system_admin` 이면 환경변수 없이 연다. 호스트 설정은 서버 프로세스 권한으로
 * 명령을 실행하므로 여전히 관리자만이다 — 게이트웨이 레코드 소유자는 "이 머신의 주인" 이 아니다.
 * 운영자는 `DESKRPG_HOST_SETUP_ENABLED=0` 으로 끌 수 있다(예전에는 `1` 로 켜야 했다).
 */
export function hostSetupAllowed(env: Record<string, string | undefined>, role?: string) {
  return role === "system_admin" && !switchedOff(env.DESKRPG_HOST_SETUP_ENABLED);
}

/**
 * Hermes 설치 — DeskRPG 가 호스트에서 외부 설치 스크립트를 실행하는 유일한 경로다.
 * 호스트 게이트에 더해 `DESKRPG_HERMES_INSTALL_ENABLED=0` 으로 따로 끌 수 있다. 로컬과 SSH 에서 연다
 * (SSH 는 관리자가 등록하고 지문을 확인한 호스트에만 닿는다).
 */
export function hermesInstallAllowed(
  env: Record<string, string | undefined>,
  role?: string,
  mode?: string,
) {
  return (
    hostSetupAllowed(env, role) &&
    !switchedOff(env.DESKRPG_HERMES_INSTALL_ENABLED) &&
    (mode === "local" || mode === "ssh")
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
  const host = url.hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.+$/, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    host.startsWith("169.254.") ||
    /^fe[89ab][0-9a-f]:/.test(host) ||
    host.startsWith("::ffff:") ||
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
  "plugin_update_failed",
  // 갱신 전용 — 주소는 닿지만 그 호스트에서 명령을 돌릴 수 없다(컨테이너에서 본 호스트 주소 등).
  "plugin_update_unsupported_host",
  "plugin_update_candidate_not_found",
  "plugin_verify_failed",
  "service_install_failed",
  "timezone_invalid",
  "timezone_write_failed",
  "port_write_failed",
  "plugin_security_review_required",
  "plugin_source_unavailable",
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
  "ssh_auth_failed",
  "ssh_key_not_found",
  "ssh_system_unavailable",
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
  "profile_name_invalid",
  "profile_exists",
  "profile_create_failed",
  "profile_key_failed",
  "profile_provision_forbidden",
  "profile_verify_failed",
  "hermes_already_installed",
  "hermes_install_forbidden",
  "hermes_install_failed",
  "curl_missing",
  "system_packages_missing",
  "git_missing",
  "python_bootstrap_failed",
  "hermes_installer_unavailable",
  "resume_unavailable",
]);
/** 실패가 아닌 알림. 잡의 `warnings` 로만 나가고 오류 경로에는 절대 오르지 않는다. */
export const SETUP_WARNING_CODES = new Set([
  "profile_not_served",
  "model_provider_required",
  "linger_required",
  // Windows 스케줄 작업은 로그아웃 뒤 계속 도는 것이 아니라 다음 로그온에 뜬다.
  "logon_required",
]);
const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** 호스트와 같은 규칙. 예약어에는 `default` 가 포함된다 — 소유자 키는 configure 가 다룬다. */
export const RESERVED_PROFILE_NAMES = new Set(["hermes", "test", "tmp", "root", "sudo", "default"]);
export function validateProfileName(value: unknown): string {
  if (typeof value !== "string") throw new Error("profile_name_invalid");
  const trimmed = value.trim();
  if (!PROFILE_NAME.test(trimmed) || RESERVED_PROFILE_NAMES.has(trimmed))
    throw new Error("profile_name_invalid");
  return trimmed;
}
export function validateProfileDescription(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error("profile_name_invalid");
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 200 || /[\r\n\0]/.test(trimmed)) throw new Error("profile_name_invalid");
  return trimmed;
}
/**
 * 마법사가 대안 포트를 고르는 범위. 호스트도 같은 범위를 쓴다.
 * 수락된 값은 화면이 명시적 동의를 받은 뒤에만 올라온다.
 */
export const SETUP_PORT_SUGGEST_MIN = 8642;
export const SETUP_PORT_SUGGEST_MAX = 8699;
/** `set-port` 가 받는 값. 제안 범위보다 넓게 허용하되 예약 포트와 범위 밖은 거부한다. */
export function validateSetupPort(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1024 || value > 65535)
    throw new Error("setup_invalid_request");
  return value;
}
const TIMEZONE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+\-.]+)*$/;
/** IANA 이름 모양만 통과시킨다. 실제 존재 여부는 호스트가 판정한다. */
export function validateTimezone(value: unknown): string {
  if (typeof value !== "string") throw new Error("timezone_invalid");
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64 || !TIMEZONE.test(trimmed))
    throw new Error("timezone_invalid");
  // 모양 검사만으로는 `Asia/../Seoul` 이 통과한다. Python 의 zoneinfo 는 그런 이름을 거부하므로
  // 위험하진 않지만, 운영자의 config.yaml 에 해석 불가능한 값을 남기게 된다 — 여기서 자른다.
  if (trimmed.split("/").some((segment) => segment === "." || segment === ".."))
    throw new Error("timezone_invalid");
  return trimmed;
}
/**
 * 잡에 남길 경고 목록을 만든다.
 *
 * 방금 설치한 Hermes 에는 모델 자격 증명이 있을 수 없다. 원래는 모델 목록이 비었는지로
 * 판정하려 했는데, 제공자가 하나도 없어도 `/v1/models` 가 200 과 모델 하나를 돌려준다(실측:
 * MiniPC 신규 계정). 그래서 "설치를 했다" 는 사실 자체를 신호로 쓴다.
 */
export function collectSetupWarnings(
  hostWarnings: string[] | undefined,
  installedHermes: boolean,
  modelState?: SetupModelState,
) {
  const warnings = [...new Set(hostWarnings ?? [])];
  // 확인이 가능하면 확인이 이긴다. `ready` 는 "방금 설치했다" 는 추정을 덮는다.
  if (modelState === "ready")
    return warnings.filter((warning) => warning !== "model_provider_required");
  const required = modelState === "missing" || installedHermes;
  if (required && !warnings.includes("model_provider_required"))
    warnings.push("model_provider_required");
  return warnings;
}
export function safeSetupError(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  return SAFE_CODES.has(code) ? code : "setup_failed";
}
