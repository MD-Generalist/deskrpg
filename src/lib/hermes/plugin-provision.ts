/**
 * 프로필 프로비저닝 — 플러그인이 발급한 키를 **서버에서만** 다룬다.
 *
 * `POST /deskrpg/profiles` 응답은 새 프로필의 `API_SERVER_KEY` 를 한 번만
 * 실어 보낸다(다시 조회할 방법이 없다). 그 값은 즉시 암호화 저장하고
 * 브라우저로 나가는 본문에서 지운다.
 *
 * 리뷰 판정 B: `registerHermesProfile` 은 게이트웨이 **소유자가 아니면**
 * `{ error: "forbidden" }` 을 돌려준다. 라우트는 `system_admin` 만 검사하므로
 * 소유자가 아닌 관리자가 부르면 프로필은 생겼는데 키 저장은 조용히 실패할 수
 * 있다 — 그 결과를 삼키지 않고 `keyStored` 로 화면까지 옮긴다.
 */

import type { CreateProfilePayload } from "./plugin-client";

export type SafeCreateResult = { name: string; keyIssued: boolean; keyError?: string };

/** 브라우저로 내보내도 되는 형태. `apiKey` 는 절대 포함하지 않는다. */
export function stripApiKey(payload: CreateProfilePayload): SafeCreateResult {
  const out: SafeCreateResult = { name: payload.name, keyIssued: payload.keyIssued };
  if (payload.keyError !== undefined) out.keyError = payload.keyError;
  return out;
}

/**
 * 발급된 키를 우리 DB 에 저장한 결과. `reason` 은 **에러코드**다 — 문장이 아니다.
 *
 * 최종 리뷰 M-3: 이 값이 그대로 `keyStoredError` 로 화면에 실려 렌더된다. 예전엔
 * 여기 한국어 문장을 직접 넣었는데, 이 브랜치의 나머지 전부(`errorCode` + 4로케일)와
 * 어긋나 en/ja/zh 사용자가 한국어를 봤다. 이제 `wizard-error-codes.ts` 에 등록된 코드
 * (`key_missing_after_issue`/`key_store_forbidden`)를 넣고, 화면이 그 사전으로 번역한다.
 */
export type KeyStorageResult = { ok: true } | { ok: false; reason: string };

export type ProvisionedProfile = SafeCreateResult & { keyStored: boolean; keyStoredError?: string };

/**
 * `stripApiKey` 의 결과에 저장 성공 여부를 얹는다.
 *
 * `stored` 가 `null` 이면 애초에 키가 발급되지 않은 것(`keyIssued: false`)이라
 * 저장을 시도하지 않았다는 뜻이다 — 이때는 `keyError` 가 이미 이유를 담고
 * 있으므로 `keyStoredError` 를 따로 채우지 않는다.
 */
export function attachKeyStorage(
  safe: SafeCreateResult,
  stored: KeyStorageResult | null,
): ProvisionedProfile {
  if (stored === null) return { ...safe, keyStored: false };
  if (stored.ok) return { ...safe, keyStored: true };
  return { ...safe, keyStored: false, keyStoredError: stored.reason };
}
