/**
 * 승인을 요청한 주체. `approvals.requested_by` 한 컬럼에 두 종류가 들어간다.
 *
 * - 직원이 시작한 묶음(대화 중 카드 제안 등) → 프로필 이름 그대로.
 * - 사람이 시작한 묶음(회의 등록 등) → `user:<id>`.
 *
 * 접두가 모호하지 않은 이유: Hermes 프로필 이름은 `^[a-z0-9][a-z0-9_-]{0,63}$` 라
 * (`src/lib/hermes/setup/host.ts:132`) **콜론이 들어갈 수 없다.** 그래서 첫 콜론 하나로
 * 갈라도 프로필 이름을 사람으로 오독할 길이 없다.
 */
export type ApprovalRequester =
  { kind: "profile"; profileName: string } | { kind: "user"; userId: string };

const USER_PREFIX = "user:";

export function formatRequester(requester: ApprovalRequester): string {
  return requester.kind === "user" ? `${USER_PREFIX}${requester.userId}` : requester.profileName;
}

export function parseRequester(stored: string): ApprovalRequester {
  return stored.startsWith(USER_PREFIX)
    ? { kind: "user", userId: stored.slice(USER_PREFIX.length) }
    : { kind: "profile", profileName: stored };
}
