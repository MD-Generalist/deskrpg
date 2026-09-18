/**
 * `ProviderAuthPanel` 의 순수 모델 — OAuth 디바이스 로그인 상태기계, 폴링 간격, 링크 검증.
 *
 * 화면과 떨어뜨려 두는 이유: 폴링 응답이 취소·언마운트 뒤에 늦게 도착해도 상태가 되살아나지
 * 않아야 한다. 그 규칙(대기 중이 아닐 때 온 poll·started 는 무시)을 여기서 고정한다.
 */
import type { OAuthPollPayload } from "@/lib/hermes/plugin-client-types";

export type OAuthState =
  | { kind: "idle" }
  | { kind: "starting" }
  | {
      kind: "waiting";
      sessionId: string;
      userCode: string;
      verificationUrl: string;
      expiresAt: number; // epoch ms
    }
  | { kind: "done" }
  | { kind: "failed"; errorCode: string };

export type OAuthEvent =
  | { type: "start" }
  | {
      type: "started";
      sessionId: string;
      userCode: string;
      verificationUrl: string;
      expiresIn: number; // 초
      now: number; // epoch ms
    }
  | { type: "poll"; status: OAuthPollPayload["status"]; error: string | null }
  | { type: "cancel" }
  | { type: "fail"; errorCode: string };

/** 폴 상태 → 패널 자체 오류 코드. 코드는 `error-codes.ts` 에 등록돼 현지화된다. */
const POLL_FAILURE_CODES: Partial<Record<OAuthPollPayload["status"], string>> = {
  denied: "oauth_denied",
  expired: "oauth_expired",
  error: "oauth_error",
};

export function oauthReducer(state: OAuthState, event: OAuthEvent): OAuthState {
  switch (event.type) {
    case "start":
      return { kind: "starting" };
    case "started":
      if (state.kind !== "starting") return state;
      return {
        kind: "waiting",
        sessionId: event.sessionId,
        userCode: event.userCode,
        verificationUrl: event.verificationUrl,
        expiresAt: event.now + event.expiresIn * 1000,
      };
    case "poll": {
      if (state.kind !== "waiting") return state;
      if (event.status === "approved") return { kind: "done" };
      const errorCode = POLL_FAILURE_CODES[event.status];
      return errorCode ? { kind: "failed", errorCode } : state;
    }
    case "cancel":
      return { kind: "idle" };
    case "fail":
      if (state.kind !== "starting" && state.kind !== "waiting") return state;
      return { kind: "failed", errorCode: event.errorCode };
  }
}

const DEFAULT_POLL_MS = 2500;
const MIN_POLL_MS = 2000;

/** 플러그인이 준 폴링 간격(초) → 대기 ms. 없거나 숫자가 아니면 2.5초, 최소 2초. */
export function pollDelayMs(pollInterval: number | undefined | null): number {
  if (typeof pollInterval !== "number" || !Number.isFinite(pollInterval)) return DEFAULT_POLL_MS;
  return Math.max(MIN_POLL_MS, pollInterval * 1000);
}

/** 사용자가 여는 링크는 http(s) 만 — `javascript:` 같은 스킴을 href 에 싣지 않는다. */
export function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
