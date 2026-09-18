import test from "node:test";
import assert from "node:assert/strict";

import { ArtifactsApiError, createArtifactsApi } from "./artifacts-api";

type FetchCall = { input: unknown; init?: RequestInit };

function fakeResponse(opts: {
  ok: boolean;
  status: number;
  statusText?: string;
  headers?: Record<string, string>;
  text?: string;
  json?: unknown;
}): Response {
  const headers = new Headers(opts.headers ?? {});
  return {
    ok: opts.ok,
    status: opts.status,
    statusText: opts.statusText ?? "",
    headers,
    text: async () => opts.text ?? "",
    json: async () => opts.json ?? {},
  } as unknown as Response;
}

test("fetchText: 206 총량이 maxBytes 보다 크면 truncated true", async () => {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ input, init });
    return fakeResponse({
      ok: true,
      status: 206,
      headers: { "content-range": "bytes 0-524287/2097152" },
      text: "x".repeat(524288),
    });
  }) as typeof fetch;

  const api = createArtifactsApi("ch1", fetchImpl);
  const result = await api.fetchText("art1", 1, 524288);

  assert.equal(result.truncated, true);
  assert.equal(calls.length, 1);
  const init = calls[0].init as RequestInit;
  const headers = init.headers as Record<string, string>;
  assert.equal(headers.range, "bytes=0-524287");
});

test("fetchText: 206 이지만 총량이 maxBytes 이하면 truncated false", async () => {
  const fetchImpl = (async () =>
    fakeResponse({
      ok: true,
      status: 206,
      headers: { "content-range": "bytes 0-99/100" },
      text: "x".repeat(100),
    })) as typeof fetch;

  const api = createArtifactsApi("ch1", fetchImpl);
  const result = await api.fetchText("art1", 1, 100);

  assert.equal(result.truncated, false);
});

test("fetchText: 200 전체 응답이면 truncated false", async () => {
  const fetchImpl = (async () =>
    fakeResponse({ ok: true, status: 200, text: "hello world" })) as typeof fetch;

  const api = createArtifactsApi("ch1", fetchImpl);
  const result = await api.fetchText("art1", 1, 1024);

  assert.equal(result.truncated, false);
  assert.equal(result.text, "hello world");
});

test("fetchText: range 헤더는 bytes=0-<maxBytes-1> 로 보낸다", async () => {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ input, init });
    return fakeResponse({ ok: true, status: 200, text: "abc" });
  }) as typeof fetch;

  const api = createArtifactsApi("ch1", fetchImpl);
  await api.fetchText("art1", 1, 512 * 1024);

  const init = calls[0].init as RequestInit;
  const headers = init.headers as Record<string, string>;
  assert.equal(headers.range, `bytes=0-${512 * 1024 - 1}`);
});

test("fetchText: 오류 본문 {code, message, minVersion} 을 ArtifactsApiError 에 싣는다", async () => {
  const fetchImpl = (async () =>
    fakeResponse({
      ok: false,
      status: 409,
      json: { code: "version_conflict", message: "버전이 낡았습니다", minVersion: "3" },
    })) as typeof fetch;

  const api = createArtifactsApi("ch1", fetchImpl);

  await assert.rejects(
    () => api.fetchText("art1", 1, 1024),
    (err: unknown) => {
      assert.ok(err instanceof ArtifactsApiError);
      assert.equal(err.status, 409);
      assert.equal(err.code, "version_conflict");
      assert.equal(err.message, "버전이 낡았습니다");
      assert.equal(err.minVersion, "3");
      return true;
    },
  );
});

test("remove: Promise<void> 를 반환한다 (ok:true 를 그대로 넘기지 않는다)", async () => {
  const fetchImpl = (async () =>
    fakeResponse({ ok: true, status: 200, json: { ok: true } })) as typeof fetch;

  const api = createArtifactsApi("ch1", fetchImpl);
  const result = await api.remove("art1");

  assert.equal(result, undefined);
});
