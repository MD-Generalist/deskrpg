import { NextResponse, type NextRequest } from "next/server";

import { getUserId } from "@/lib/internal-rpc";
import { buildLinkPreview } from "@/lib/link-preview/service";

export const runtime = "nodejs";

/**
 * 링크 미리보기. 로그인한 사용자만 — 이 라우트는 우리 서버가 남의 주소로 요청을 보내는
 * 도구라 열어 두면 열린 프록시가 된다. SSRF 가드·상한·캐시는 `link-preview/service.ts`.
 *
 * 미리보기가 없으면 204 다. 404·500 이 아니다 — 화면은 "카드 없음"을 정상으로 다루고
 * 지금의 밑줄 링크로 조용히 떨어진다.
 */
export async function GET(req: NextRequest) {
  if (!getUserId(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url_required" }, { status: 400 });

  const preview = await buildLinkPreview(url);
  if (!preview) return new NextResponse(null, { status: 204 });
  return NextResponse.json(preview, {
    headers: { "cache-control": "private, max-age=3600" },
  });
}
