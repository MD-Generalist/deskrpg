/**
 * 플러그인 바이트 응답을 브라우저로 흘린다. 본문은 `ReadableStream` 그대로 — 모으지 않는다.
 * 헤더는 허용 목록만 옮긴다(게이트웨이 앞단이 붙인 쿠키·내부 헤더가 새지 않게). Range(206/416)는
 * 상태와 `content-range` 를 그대로 둔다. 토큰은 요청 쪽에서만 쓰였고 여기엔 없다(하드 게이트 2).
 *
 * `content-security-policy: sandbox` 와 `x-content-type-options: nosniff` 는 업스트림이 무엇을
 * 보내든 항상 강제한다 — 사용자가 올린 HTML/SVG 를 DeskRPG 원점에서 쿠키를 쥔 채 인라인 렌더링하지
 * 못하게 막는 마지막 방어선이다(업스트림 신뢰 금지).
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
  "last-modified",
  "etag",
] as const;

export interface StreamProxyOptions {
  /** 항상 다운로드시킨다(칸반 첨부처럼 임의 사용자 업로드일 때) — inline 을 절대 허용하지 않는다. */
  forceAttachment?: boolean;
  /** 업스트림이 filename 파라미터를 안 줬을 때 attachment 에 쓸 이름(RFC 6266 인코딩). */
  filename?: string;
}

/** 기존 disposition 의 filename 파라미터는 보존하면서 타입만 attachment 로 바꾼다. */
function forceAttachmentDisposition(existing: string | null, filename: string | undefined): string {
  if (existing !== null) {
    const semiIdx = existing.indexOf(";");
    if (semiIdx !== -1) return `attachment${existing.slice(semiIdx)}`;
  }
  if (filename) return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
  return "attachment";
}

export function streamProxyResponse(upstream: Response, opts?: StreamProxyOptions): Response {
  const headers = new Headers();
  for (const name of PASS_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("content-security-policy", "sandbox");
  headers.set("x-content-type-options", "nosniff");
  headers.set("cache-control", "private, no-store");
  if (opts?.forceAttachment) {
    headers.set(
      "content-disposition",
      forceAttachmentDisposition(upstream.headers.get("content-disposition"), opts.filename),
    );
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

/** `pluginFailureResponse` 와 같은 규약 — 상태는 플러그인 것, 닿지 못하면 503/504. */
export function rawFailureResponse(res: Extract<RawPluginResponse, { ok: false }>): NextResponse {
  const status = res.status > 0 ? res.status : res.failure.code === "timeout" ? 504 : 503;
  return cronError(status, res.failure.code, res.failure.message, res.failure.details);
}
