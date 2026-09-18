/**
 * `/api/gateways/[id]/plugin/profiles/[name]/*` 프록시가 업스트림 실패를 본문으로 옮기는 한 곳.
 *
 * 이 라우트 군의 관례는 **HTTP 200 + `{errorCode}` + ERROR_CODE_HEADER** 다(`catalog/route.ts`).
 * 0.9.0 에 생긴 라우트는 구버전 플러그인에서 404 가 나는데, 그건 "프로필이 없다" 가 아니라
 * "플러그인을 올려야 한다" 라서 코드를 바꿔 준다 — 화면이 텍스트 입력으로 폴백할 신호다.
 */
import { isMissingPluginRoute, PROFILE_PICKER_MIN_VERSION } from "./plugin-capability";
import { pluginUpgradeRequired, type PluginFailure } from "./plugin-errors";

export function proxyFailureBody(res: { status: number; failure: PluginFailure }): {
  body: Record<string, unknown>;
  errorCode: string;
} {
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
