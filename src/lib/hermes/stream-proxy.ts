/**
 * 플러그인 바이트 응답을 브라우저로 흘린다. 본문은 `ReadableStream` 그대로 — 모으지 않는다.
 * 헤더는 허용 목록만 옮긴다(게이트웨이 앞단이 붙인 쿠키·내부 헤더가 새지 않게). Range(206/416)는
 * 상태와 `content-range` 를 그대로 둔다. 토큰은 요청 쪽에서만 쓰였고 여기엔 없다(하드 게이트 2).
 */
import { NextResponse } from "next/server";

import { cronError } from "@/lib/cron-access";
import type { RawPluginResponse } from "@/lib/hermes/plugin-client-types";

const PASS_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "content-disposition",
  "content-security-policy",
  "x-content-type-options",
  "last-modified",
  "etag",
] as const;

export function streamProxyResponse(upstream: Response): Response {
  const headers = new Headers();
  for (const name of PASS_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("cache-control", "private, no-store");
  return new Response(upstream.body, { status: upstream.status, headers });
}

/** `pluginFailureResponse` 와 같은 규약 — 상태는 플러그인 것, 닿지 못하면 503/504. */
export function rawFailureResponse(res: Extract<RawPluginResponse, { ok: false }>): NextResponse {
  const status = res.status > 0 ? res.status : res.failure.code === "timeout" ? 504 : 503;
  return cronError(status, res.failure.code, res.failure.message, res.failure.details);
}
