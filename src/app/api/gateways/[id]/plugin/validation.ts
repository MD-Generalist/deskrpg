/**
 * 플러그인 프록시 라우트(profiles/identity/config)의 순수 검증 함수.
 *
 * `src/app/api/gateways/[id]/profiles/validation.ts` 의 관례를 따른다 — 검증을
 * 핸들러 밖으로 뽑아 라우트를 띄우지 않고도 고정할 수 있게 한다.
 */

import { isCreatableProfileName } from "@/lib/hermes/creatable-profile-name";
import type { CloneKeyScope } from "@/lib/hermes/plugin-client-types";

export type CreatableNameValidation =
  { ok: true; name: string } | { ok: false; errorCode: "invalid_profile_name" };

/**
 * **새로 만들** 프로필 이름만 검증한다. `isCreatableProfileName` 을 쓴다 —
 * `PROFILE_NAME_RE`(기존 프로필 등록용, 관대함)가 아니다. Hermes 는 생성 시
 * `^[a-z0-9][a-z0-9_-]{0,63}$` 와 예약어 거부를 실제로 강제한다(라이브 게이트웨이
 * 실측). 여기서 막지 않으면 원격이 400 을 내는데 그 이유가 화면에 닿지 않는다.
 */
export function validateCreatableProfileName(input: unknown): CreatableNameValidation {
  const name =
    typeof (input as { name?: unknown })?.name === "string"
      ? (input as { name: string }).name.trim()
      : "";
  if (!isCreatableProfileName(name)) {
    return { ok: false, errorCode: "invalid_profile_name" };
  }
  return { ok: true, name };
}

export type IdentityPutValidation =
  { ok: true; body: string; ifRevision: string } | { ok: false; errorCode: "bad_request" };

/** `ifRevision` 이 없으면 낙관적 잠금이 통째로 사라진다 — 여기서 막는다. */
export function validateIdentityPutBody(input: unknown): IdentityPutValidation {
  const record =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const body = record.body;
  const ifRevision = record.ifRevision;
  if (typeof body !== "string" || typeof ifRevision !== "string" || !ifRevision) {
    return { ok: false, errorCode: "bad_request" };
  }
  return { ok: true, body, ifRevision };
}

const ALLOWED_CONFIG_KEYS = new Set([
  "model",
  "provider",
  "toolsets",
  "reasoning_effort",
  "enabledToolsets",
  "disabledSkills",
]);

export type ConfigPutValidation =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; errorCode: "bad_request" }
  | { ok: false; errorCode: "unsupported_config_key"; unknownKeys: string[] };

/**
 * 플러그인이 허용하는 여섯 키(`model`/`provider`/`toolsets`/`reasoning_effort`/
 * `enabledToolsets`/`disabledSkills`)만 통과시킨다. 화면이
 * 실수로 다른 키를 보내면 원격이 400 을 내는데, 여기서 막으면 왜 막혔는지가
 * 분명해진다.
 */
export function validateConfigPatch(input: unknown): ConfigPutValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errorCode: "bad_request" };
  }
  const patch = input as Record<string, unknown>;
  const unknownKeys = Object.keys(patch).filter((k) => !ALLOWED_CONFIG_KEYS.has(k));
  if (unknownKeys.length > 0) {
    return { ok: false, errorCode: "unsupported_config_key", unknownKeys };
  }
  return { ok: true, patch };
}

export type CreateOptionsValidation =
  | { ok: true; cloneFrom?: "default"; cloneKeys?: CloneKeyScope }
  | { ok: false; errorCode: "bad_request" };

const CLONE_KEY_SCOPES: readonly CloneKeyScope[] = ["referenced", "api_keys"];

/**
 * 복제 원본은 지금 `default` 뿐이다 — 플러그인이 400 을 내기 전에 여기서 이유를 분명히 한다.
 * `cloneKeys`(키 복제 범위)는 `cloneFrom` 과 함께일 때만, `referenced`·`api_keys` 둘 중 하나.
 */
export function validateCreateOptions(input: unknown): CreateOptionsValidation {
  const record = (input ?? {}) as { cloneFrom?: unknown; cloneKeys?: unknown };
  const raw = record.cloneFrom;
  const keys = record.cloneKeys;
  const hasKeys = keys !== undefined && keys !== null;
  if (raw === undefined || raw === null) {
    return hasKeys ? { ok: false, errorCode: "bad_request" } : { ok: true };
  }
  if (raw !== "default") return { ok: false, errorCode: "bad_request" };
  if (!hasKeys) return { ok: true, cloneFrom: "default" };
  if (!CLONE_KEY_SCOPES.includes(keys as CloneKeyScope)) {
    return { ok: false, errorCode: "bad_request" };
  }
  return { ok: true, cloneFrom: "default", cloneKeys: keys as CloneKeyScope };
}
