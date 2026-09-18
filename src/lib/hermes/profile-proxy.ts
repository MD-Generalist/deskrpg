/**
 * `/api/gateways/[id]/plugin/profiles/[name]/*` 프록시가 업스트림 실패를 본문으로 옮기는 한 곳.
 *
 * 이 라우트 군의 관례는 **HTTP 200 + `{errorCode}` + ERROR_CODE_HEADER** 다(`catalog/route.ts`).
 * 0.9.0 에 생긴 라우트는 구버전 플러그인에서 404 가 나는데, 그건 "프로필이 없다" 가 아니라
 * "플러그인을 올려야 한다" 라서 코드를 바꿔 준다 — 화면이 텍스트 입력으로 폴백할 신호다.
 */
import { isMissingPluginRoute, PROFILE_PICKER_MIN_VERSION } from "./plugin-capability";
import { pluginUpgradeRequired, type PluginFailure } from "./plugin-errors";

/**
 * Hermes 멀티플렉스 미들웨어가 모르는 `/p/{profile}` 에 내는 404 본문(gateway/platforms/api_server.py
 * `profile_prefix_middleware`, 0.21.3 ~1513행: `{"error":"Unknown or unconfigured profile"}`).
 * 플러그인 라우트에 닿기도 전의 응답이라 코드가 없고, `mapPluginFailure` 가 `upstream_error` + 문장으로
 * 접는다 — 문장으로 알아본다. 이걸 "라우트 없음" 으로 읽으면 프로필이 없는데 "플러그인을 올리라" 고 한다.
 */
const HERMES_UNKNOWN_PROFILE_RE = /^unknown or unconfigured profile$/i;

function isHermesUnknownProfile(res: { status: number; failure: PluginFailure }): boolean {
  return (
    res.status === 404 &&
    res.failure.code === "upstream_error" &&
    HERMES_UNKNOWN_PROFILE_RE.test(res.failure.message.trim())
  );
}

export function proxyFailureBody(res: { status: number; failure: PluginFailure }): {
  body: Record<string, unknown>;
  errorCode: string;
} {
  if (isHermesUnknownProfile(res)) {
    return {
      errorCode: "profile_not_found",
      body: {
        errorCode: "profile_not_found",
        error: res.failure.message,
        upstreamStatus: res.status,
      },
    };
  }
  if (isMissingPluginRoute(res)) {
    const upgrade = pluginUpgradeRequired({
      ok: false,
      minVersion: PROFILE_PICKER_MIN_VERSION,
      reason: "missing_route",
    });
    return {
      errorCode: upgrade.code,
      body: {
        errorCode: upgrade.code,
        error: "",
        upstreamStatus: res.status,
        details: upgrade.details,
      },
    };
  }
  return {
    errorCode: res.failure.code,
    body: { errorCode: res.failure.code, error: res.failure.message, upstreamStatus: res.status },
  };
}
