import { NextResponse, type NextRequest } from "next/server";

import { getUserId } from "@/lib/internal-rpc";
import { fetchGuarded } from "@/lib/link-preview/fetch";
import { normalizePreviewUrl } from "@/lib/link-preview/guard";

export const runtime = "nodejs";

/** og:image 는 2MB 까지만 받는다 — 미리보기 썸네일에 그 이상은 필요 없다. */
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * og:image 를 서버가 대신 받아 준다. 브라우저가 남의 CDN 을 직접 물면 사용자 IP·리퍼러가
 * 그 사이트로 새고, 도메인 허용 목록은 유지될 수 없다(사이트마다 CDN 이 다르다).
 * 가드는 페이지 조회와 똑같다 — 이미지 주소도 사용자가 준 주소다.
 */
export async function GET(req: NextRequest) {
  if (!getUserId(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const raw = req.nextUrl.searchParams.get("url");
  const target = raw ? normalizePreviewUrl(raw) : null;
  if (!target) return new NextResponse(null, { status: 204 });

  const fetched = await fetchGuarded(target, { accept: "image/", maxBytes: IMAGE_MAX_BYTES });
  if (!fetched) return new NextResponse(null, { status: 204 });

  return new NextResponse(new Uint8Array(fetched.bytes), {
    headers: {
      "content-type": fetched.contentType,
      "content-length": String(fetched.bytes.byteLength),
      "cache-control": "private, max-age=3600",
      // 남이 준 바이트다. 스크립트로 해석될 여지를 남기지 않는다.
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
    },
  });
}
