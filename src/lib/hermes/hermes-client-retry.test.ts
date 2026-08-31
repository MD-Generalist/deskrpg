import test from "node:test";
import assert from "node:assert/strict";

import { HermesClient, HermesError } from "./hermes-client";

function clientWith(responses: Array<{ status: number; retryAfter?: string }>) {
  let i = 0;
  const calls: number[] = [];
  const fetchImpl = (async () => {
    const spec = responses[Math.min(i, responses.length - 1)];
    i += 1;
    calls.push(spec.status);
    const headers = new Headers();
    if (spec.retryAfter) headers.set("Retry-After", spec.retryAfter);
    return new Response(spec.status === 200 ? "{}" : "too many", {
      status: spec.status,
      headers,
    });
  }) as unknown as typeof fetch;
  return {
    calls,
    client: new HermesClient({
      baseUrl: "http://gw",
      profileName: "sophie",
      token: "t",
      fetchImpl,
      // 테스트가 실제로 기다리지 않게 한다.
      sleepImpl: async () => {},
    }),
  };
}

test("429 를 받으면 다시 걸고, 성공하면 그 결과를 돌려준다", async () => {
  const { client, calls } = clientWith([{ status: 429, retryAfter: "0" }, { status: 200 }]);
  await client.getCapabilities();
  assert.deepEqual(calls, [429, 200]);
});

test("계속 429 면 결국 던진다 — 조용히 성공한 척하지 않는다", async () => {
  const { client, calls } = clientWith([{ status: 429, retryAfter: "0" }]);
  await assert.rejects(
    () => client.getCapabilities(),
    (err: unknown) => err instanceof HermesError && err.status === 429,
  );
  // 최초 1회 + 재시도 2회.
  assert.equal(calls.length, 3);
});

test("429 가 아닌 실패는 재시도하지 않는다", async () => {
  const { client, calls } = clientWith([{ status: 401 }]);
  await assert.rejects(() => client.getCapabilities());
  assert.equal(calls.length, 1);
});
