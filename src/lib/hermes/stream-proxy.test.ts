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

test("업스트림이 CSP·nosniff 를 안 보내도 강제로 붙인다", () => {
  const upstream = new Response("<script>alert(1)</script>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  const res = streamProxyResponse(upstream);
  assert.equal(res.headers.get("content-security-policy"), "sandbox");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

test("업스트림의 약한 CSP 를 sandbox 로 덮어쓴다", () => {
  const upstream = new Response("abc", {
    status: 200,
    headers: { "content-security-policy": "default-src *" },
  });
  const res = streamProxyResponse(upstream);
  assert.equal(res.headers.get("content-security-policy"), "sandbox");
});

test("forceAttachment 는 inline 을 attachment 로 바꾸고, 없으면 새로 붙인다", () => {
  const withInline = streamProxyResponse(
    new Response("abc", {
      status: 200,
      headers: { "content-disposition": 'inline; filename="a.html"' },
    }),
    { forceAttachment: true },
  );
  assert.equal(withInline.headers.get("content-disposition"), 'attachment; filename="a.html"');

  const withoutDisposition = streamProxyResponse(new Response("abc", { status: 200 }), {
    forceAttachment: true,
    filename: "note.txt",
  });
  assert.equal(
    withoutDisposition.headers.get("content-disposition"),
    "attachment; filename*=UTF-8''note.txt",
  );
});
