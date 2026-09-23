import { NextResponse, type NextRequest } from "next/server";

import { safeSetupError, sameOriginMutation } from "@/lib/hermes/setup/policy";
import { setGatewayWorkerPropagation } from "@/lib/hermes/setup/service";
import { ERROR_CODE_HEADER } from "@/lib/i18n/error-codes";
import { getUserId } from "@/lib/internal-rpc";

export const runtime = "nodejs";

/**
 * 워커 전파(플러그인 0.16.0)를 켜거나 끈다 — 게이트웨이 화면의 "설정에서 켜기" 와 갱신 이어받기의 [끄기].
 *
 * 호스트 루트 config 의 `plugins.entries.deskrpg.worker_propagation` 을 호스트 헬퍼로 쓰고(되읽기 확인),
 * 켜면 이어서 기존 적용(`POST /deskrpg/worker-plugin`)을 부른 뒤 플러그인 정보 캐시를 다시 채운다.
 * 짧은 동작이라 잡이 아니라 즉시 응답이다. 게이트웨이를 재시작하지 않는다.
 *
 * 호스트에서 명령을 돌리므로 플러그인 갱신 라우트와 같은 문을 지난다: 소유자만, 같은 출처의 변경만,
 * 호스트 설정 정책. 명령을 돌릴 수 없는 호스트는 400 `plugin_update_unsupported_host` — 화면은 명령 복사로 떨어진다.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ errorCode: "unauthorized", error: "unauthorized" }, { status: 401 });
  }
  if (
    !sameOriginMutation(
      req.headers.get("origin"),
      req.headers.get("host"),
      req.headers.get("sec-fetch-site"),
    )
  ) {
    return NextResponse.json(
      { errorCode: "setup_bad_origin", error: "setup_bad_origin" },
      { status: 403 },
    );
  }

  let enabled: unknown;
  try {
    enabled = ((await req.json()) as { enabled?: unknown } | null)?.enabled;
  } catch {
    enabled = undefined;
  }
  if (typeof enabled !== "boolean") {
    return NextResponse.json(
      { errorCode: "setup_invalid_request", error: "setup_invalid_request" },
      { status: 400 },
    );
  }

  const { id } = await params;
  try {
    const result = await setGatewayWorkerPropagation(userId, id, enabled);
    // 적용 단계의 플러그인 실패는 worker-plugin 라우트와 같이 200 + errorCode — Cloudflare 가 5xx 본문을 갈아치운다.
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if ("errorCode" in result) headers[ERROR_CODE_HEADER] = result.errorCode;
    return NextResponse.json(result, { headers });
  } catch (error) {
    const code = safeSetupError(error);
    const status =
      code === "setup_forbidden" || code === "setup_bad_origin"
        ? 403
        : code === "setup_not_found"
          ? 404
          : code === "setup_busy"
            ? 409
            : 400;
    return NextResponse.json({ errorCode: code, error: code }, { status });
  }
}
