import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPluginClient } from "./plugin-client";

type Call = { url: string; method: string; auth: string | null; body: string | null };

function recorder(responses: Array<{ status: number; json: unknown }>) {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      auth: new Headers(init?.headers).get("authorization"),
      body: typeof init?.body === "string" ? init.body : null,
    });
    const spec = responses[Math.min(i++, responses.length - 1)];
    return new Response(JSON.stringify(spec.json), {
      status: spec.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("plugin client — 토큰 스코프", () => {
  it("프로필 목록·생성·삭제는 프리픽스 없이 default 토큰을 쓴다", async () => {
    const { calls, fetchImpl } = recorder([
      { status: 200, json: { profiles: [] } },
      { status: 201, json: { name: "noah", apiKey: "k".repeat(20), keyIssued: true } },
      { status: 200, json: { name: "noah", removed: { profileDir: true, wrapperScript: false } } },
    ]);
    const client = createPluginClient({
      baseUrl: "http://gw:8642",
      defaultToken: "default-key-1234567890",
      fetchImpl,
    });

    await client.listProfiles();
    await client.createProfile("noah");
    await client.deleteProfile("noah");

    assert.equal(calls[0].url, "http://gw:8642/deskrpg/profiles");
    assert.equal(calls[1].url, "http://gw:8642/deskrpg/profiles");
    assert.equal(calls[1].method, "POST");
    // confirm 가드는 플러그인의 요구사항이다 — 없으면 400 이 난다.
    assert.equal(calls[2].url, "http://gw:8642/deskrpg/profiles/noah?confirm=noah");
    assert.equal(calls[2].method, "DELETE");
    for (const call of calls) {
      assert.equal(call.auth, "Bearer default-key-1234567890");
    }
  });

  it("인격·설정은 프로필 프리픽스와 프로필 토큰을 쓴다", async () => {
    const { calls, fetchImpl } = recorder([
      { status: 200, json: { body: "hi", isDefaultTemplate: false, revision: "abc" } },
      { status: 200, json: { model: "gpt-5.6-sol" } },
    ]);
    const client = createPluginClient({
      baseUrl: "http://gw:8642",
      defaultToken: "default-key-1234567890",
      fetchImpl,
    });

    await client.getIdentity("noah", "profile-key-0987654321");
    await client.getConfig("noah", "profile-key-0987654321");

    assert.equal(calls[0].url, "http://gw:8642/p/noah/deskrpg/identity");
    assert.equal(calls[1].url, "http://gw:8642/p/noah/deskrpg/config");
    // default 토큰을 쓰면 fail-closed 인증에 막혀 401 이 난다.
    for (const call of calls) {
      assert.equal(call.auth, "Bearer profile-key-0987654321");
    }
  });

  it("프로필 이름을 URL 에 인코딩한다", async () => {
    const { calls, fetchImpl } = recorder([{ status: 200, json: {} }]);
    const client = createPluginClient({ baseUrl: "http://gw:8642", defaultToken: "t", fetchImpl });
    await client.getConfig("a b/c", "pt");
    assert.equal(calls[0].url, "http://gw:8642/p/a%20b%2Fc/deskrpg/config");
  });

  it("putIdentity 는 ifRevision 을 본문에 싣는다", async () => {
    const { calls, fetchImpl } = recorder([{ status: 200, json: { revision: "def" } }]);
    const client = createPluginClient({ baseUrl: "http://gw:8642", defaultToken: "t", fetchImpl });
    await client.putIdentity("noah", "pt", { body: "새 인격", ifRevision: "abc" });
    assert.deepEqual(JSON.parse(calls[0].body!), { body: "새 인격", ifRevision: "abc" });
  });
});

describe("plugin client — 실패", () => {
  it("409 는 던지지 않고 failure 로 돌아온다", async () => {
    const { fetchImpl } = recorder([
      { status: 409, json: { error: "revision_conflict", currentRevision: "zzz" } },
    ]);
    const client = createPluginClient({ baseUrl: "http://gw:8642", defaultToken: "t", fetchImpl });
    const res = await client.putIdentity("noah", "pt", { body: "x", ifRevision: "abc" });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.failure.code, "revision_conflict");
    assert.equal(res.status, 409);
  });

  it("200 + unreadable 도 실패로 돌아온다", async () => {
    const { fetchImpl } = recorder([
      {
        status: 200,
        json: { body: null, isDefaultTemplate: null, revision: null, unreadable: true },
      },
    ]);
    const client = createPluginClient({ baseUrl: "http://gw:8642", defaultToken: "t", fetchImpl });
    const res = await client.getIdentity("noah", "pt");
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.failure.blocksEditor, true);
  });

  it("네트워크 실패도 던지지 않는다", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const client = createPluginClient({ baseUrl: "http://gw:8642", defaultToken: "t", fetchImpl });
    const res = await client.listProfiles();
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.failure.code, "unreachable");
  });
});
