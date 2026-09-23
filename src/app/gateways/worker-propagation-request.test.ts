import assert from "node:assert/strict";
import test from "node:test";

import { enableWorkerPropagationRequest } from "./worker-propagation-request";

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers });
  }) as typeof fetch;
  return { calls, impl };
}

test("{enabled:true} 를 POST 하고, 켜고 적용까지 됐으면 결과를 싣는다", async () => {
  const results = [{ profile: "sophie", link: "created", enabled: "added" }];
  const { calls, impl } = fakeFetch(200, { propagation: "enabled", results });
  assert.deepEqual(await enableWorkerPropagationRequest("gw 1", impl), { ok: true, results });
  assert.equal(calls[0].url, "/api/gateways/gw%201/plugin/worker-propagation");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[0].init?.body, JSON.stringify({ enabled: true }));
});

test("켰지만 적용이 실패하면(200 + 헤더 코드) applyErrorCode", async () => {
  const { impl } = fakeFetch(
    200,
    { propagation: "enabled" },
    { "X-DeskRPG-Error-Code": "plugin_unreachable" },
  );
  assert.deepEqual(await enableWorkerPropagationRequest("gw", impl), {
    ok: true,
    applyErrorCode: "plugin_unreachable",
  });
});

test("호스트 단계 실패(4xx)는 코드를 그대로, 본문이 없으면 http_상태", async () => {
  const unsupported = fakeFetch(400, { errorCode: "plugin_update_unsupported_host" });
  assert.deepEqual(await enableWorkerPropagationRequest("gw", unsupported.impl), {
    ok: false,
    errorCode: "plugin_update_unsupported_host",
  });
  const bare = fakeFetch(409, {});
  assert.deepEqual(await enableWorkerPropagationRequest("gw", bare.impl), {
    ok: false,
    errorCode: "http_409",
  });
});

test("200 인데 켜졌다고 말하지 않으면 켜진 것으로 보지 않는다", async () => {
  const { impl } = fakeFetch(200, { propagation: "disabled" });
  assert.deepEqual(await enableWorkerPropagationRequest("gw", impl), {
    ok: false,
    errorCode: "propagation_not_enabled",
  });
});
