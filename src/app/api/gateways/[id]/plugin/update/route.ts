import { NextResponse, type NextRequest } from "next/server";

import { safeSetupError, sameOriginMutation } from "@/lib/hermes/setup/policy";
import { startPluginUpdate } from "@/lib/hermes/setup/service";
import { getUserId } from "@/lib/internal-rpc";

export const runtime = "nodejs";

/**
 * 이미 등록된 게이트웨이의 플러그인을 고정 버전으로 올린다(소유자 전용).
 *
 * 마법사와 같은 호스트 파이프라인을 타지만 갱신 단계만 돌리고, 게이트웨이의 이름·주소·토큰은
 * 건드리지 않는다. 오래 걸리는 작업이라 잡 id 를 즉시 돌려주고 진행은 `/api/gateways/setup`
 * 의 잡 조회로 본다 — 마법사가 쓰는 그 화면을 그대로 쓴다.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ errorCode: "unauthorized", error: "unauthorized" }, { status: 401 });
  }
  // 호스트에서 명령을 돌리는 동작이다 — 다른 사이트가 링크 한 번으로 걸 수 없게 한다.
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

  const { id } = await params;
  try {
    const job = await startPluginUpdate(userId, id);
    return NextResponse.json({ jobId: job.id }, { headers: { "Cache-Control": "no-store" } });
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
