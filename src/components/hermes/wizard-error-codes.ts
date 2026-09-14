/**
 * 고용 마법사가 다루는 원격(플러그인) 에러코드 → i18n 키.
 *
 * `src/lib/i18n/error-codes.ts` 의 `ErrorCode`/`ERROR_MESSAGE_KEYS` 표와는 **별개**다.
 * 그 표의 커버리지 가드(`error-codes.test.ts`)는 라우트 소스에 리터럴로 박힌
 * `errorCode: "..."` 만 훑는데, 플러그인 프록시 라우트(profiles/identity/config)는
 * `res.failure.code` 를 그대로 실어 보내는 **동적** 값이라 그 가드에 잡히지 않는다.
 * 실제로 `profile_has_service` 같은 코드가 `getLocalizedMessage` 의 fallback 을 타
 * 코드 문자열 그대로 화면에 보였다(리뷰 판정 H). 이 파일이 그 구멍을 대신 막는다 —
 * 목록을 한 곳에 상수로 두고, 커버리지는 `wizard-error-codes.test.ts` 가 4개 로케일
 * 전체를 훑어 고정한다.
 *
 * 코드 출처: `plugin-errors.ts`(`mapPluginFailure`), `plugin-client.ts`(timeout·
 * unreachable·malformed_response), 프록시 라우트 자체의 `unauthorized`/`forbidden`/
 * `not_found`/`bad_request`/`invalid_profile_name`, `plugin-profile-access.ts`
 * (`no_profile`), `validation.ts`(`unsupported_config_key`).
 *
 * 수정 라운드 2: `upstream_error`(업스트림 `error` 가 평문 문장이라 코드로 못 쓸 때의
 * fallback)와 `gateway_auth_failed`(업스트림 401 의 `error` 가 객체일 때 그 안에서
 * 뽑아낸 진짜 코드)를 추가했다 — `plugin-errors.ts` 의 `extractCodeAndMessage` 참조.
 *
 * 수정 라운드 3 결함 8: 플러그인이 실제로 내는 코드는 `revision_conflict` 가 아니라
 * `revision_mismatch` 다(`deskrpg_plugin/identity.py:142`, team-lead 라이브 실측 —
 * 이 프로젝트의 스펙 문서가 코드명을 잘못 적었고 플러그인은 그 문서대로 구현됐다).
 * 플러그인을 고치면 이미 배포된 구버전이 붙은 게이트웨이가 깨지므로, **두 코드를 모두
 * 등록**하고 같은 i18n 키를 가리키게 한다 — 구버전·신버전 플러그인 모두 대응.
 *
 * 최종 리뷰 M-3: `key_missing_after_issue`/`key_store_forbidden` 은 플러그인이 아니라
 * `POST .../plugin/profiles` 라우트 자신의 후처리 실패(키 값 누락 · 저장 권한 없음)에서
 * 나온다 — 예전엔 여기만 한국어 문장을 하드코딩해 4로케일 규율을 깨고 있었다.
 */

export const WIZARD_ERROR_CODES = [
  "profile_has_service",
  "revision_conflict",
  // 결함 8: 플러그인이 실제로 내는 코드. `revision_conflict` 와 같은 i18n 키를 쓴다.
  "revision_mismatch",
  "already_exists",
  "timeout",
  "unreachable",
  "malformed_response",
  "plugin_error",
  "identity_unreadable",
  "config_unreadable",
  // `mapPluginFailure` 의 200+`unreadable:true` 분기가 내는 코드(리뷰 라운드 1 I-1) —
  // `identity_unreadable`/`config_unreadable`(409, 명명된 코드)과는 다른 경로다.
  "unreadable",
  "no_profile",
  "unsupported_config_key",
  "invalid_profile_name",
  "bad_request",
  "forbidden",
  "not_found",
  "unauthorized",
  "upstream_error",
  "gateway_auth_failed",
  "key_missing_after_issue",
  "key_store_forbidden",
  // T9/T10 자동화(크론·칸반) 라우트가 내는 코드 — `cron-access.ts`/`cron-routes.ts` 와
  // 칸반 라우트가 `{code, message}` 로 싣는다. 크론·칸반 화면이 이 표 하나를 같이 쓴다.
  "plugin_upgrade_required",
  "unknown_cursor",
  "cron_read_only",
  "gateway_not_bound",
  "assignee_not_in_channel",
  "settings_forbidden",
  "attachments_unsupported",
] as const;

export type WizardErrorCode = (typeof WIZARD_ERROR_CODES)[number];

/** 등록된 모든 코드 → 번역 키. `wizard-error-codes.test.ts` 가 이 표 전체를 훑는다. */
export const WIZARD_ERROR_MESSAGE_KEYS: Record<WizardErrorCode, string> = {
  profile_has_service: "hermes.wizard.error.profileHasService",
  revision_conflict: "hermes.wizard.error.revisionConflict",
  revision_mismatch: "hermes.wizard.error.revisionConflict",
  already_exists: "hermes.wizard.error.alreadyExists",
  timeout: "hermes.wizard.error.timeout",
  unreachable: "hermes.wizard.error.unreachable",
  malformed_response: "hermes.wizard.error.malformedResponse",
  plugin_error: "hermes.wizard.error.pluginError",
  identity_unreadable: "hermes.wizard.error.identityUnreadable",
  config_unreadable: "hermes.wizard.error.configUnreadable",
  unreadable: "hermes.wizard.error.unreadable",
  no_profile: "hermes.wizard.error.noProfile",
  unsupported_config_key: "hermes.wizard.error.unsupportedConfigKey",
  invalid_profile_name: "hermes.wizard.error.invalidProfileName",
  bad_request: "hermes.wizard.error.badRequest",
  forbidden: "hermes.wizard.error.forbidden",
  not_found: "hermes.wizard.error.notFound",
  unauthorized: "hermes.wizard.error.unauthorized",
  upstream_error: "hermes.wizard.error.upstreamError",
  gateway_auth_failed: "hermes.wizard.error.gatewayAuthFailed",
  key_missing_after_issue: "hermes.wizard.error.keyMissingAfterIssue",
  key_store_forbidden: "hermes.wizard.error.keyStoreForbidden",
  plugin_upgrade_required: "hermes.wizard.error.pluginUpgradeRequired",
  unknown_cursor: "hermes.wizard.error.unknownCursor",
  cron_read_only: "hermes.wizard.error.cronReadOnly",
  gateway_not_bound: "hermes.wizard.error.gatewayNotBound",
  assignee_not_in_channel: "hermes.wizard.error.assigneeNotInChannel",
  settings_forbidden: "hermes.wizard.error.settingsForbidden",
  attachments_unsupported: "hermes.wizard.error.attachmentsUnsupported",
};

const UNKNOWN_KEY = "hermes.wizard.error.unknown";

export function isWizardErrorCode(value: unknown): value is WizardErrorCode {
  return typeof value === "string" && value in WIZARD_ERROR_MESSAGE_KEYS;
}

/** `t()` 로 바로 넘길 번역 키. 등록되지 않은 코드는 generic fallback 키로 접는다. */
export function wizardErrorMessageKey(code: string | null | undefined): string {
  return isWizardErrorCode(code) ? WIZARD_ERROR_MESSAGE_KEYS[code] : UNKNOWN_KEY;
}

type Translator = (key: string, params?: Record<string, string | number>) => string;

/** 프록시 라우트 응답(`{errorCode}`)에서 바로 화면 문구를 뽑는다. */
export function getWizardErrorMessage(t: Translator, code: string | null | undefined): string {
  return t(wizardErrorMessageKey(code));
}
