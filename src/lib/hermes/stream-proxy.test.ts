import test from "node:test";
import assert from "node:assert/strict";

import { streamProxyResponse } from "./stream-proxy";

test("허용 헤더만 옮기고 상태를 그대로 둔다", () => {
  const upstream = new Response("abc", {
    status: 206,
    headers: {
      "content-type": "text/plain",
      "content-range": "bytes 0-2/10",
      "accept-ranges": "bytes",
      "content-security-policy": "sandbox",
      "x-content-type-options": "nosniff",
      "set-cookie": "leak=1",
      "x-internal": "no",
    },
  });
  const res = streamProxyResponse(upstream);
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 0-2/10");
  assert.equal(res.headers.get("content-security-policy"), "sandbox");
  assert.equal(res.headers.get("set-cookie"), null);
  assert.equal(res.headers.get("x-internal"), null);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
});

test("본문을 모으지 않고 흘린다 — 끝나지 않는 스트림의 첫 조각을 바로 읽는다", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("first"));
      // close 하지 않는다 — 버퍼링하면 여기서 영원히 기다린다.
    },
  });
  const res = streamProxyResponse(new Response(body, { status: 200 }));
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  assert.equal(new TextDecoder().decode(value), "first");
  await reader.cancel();
});
