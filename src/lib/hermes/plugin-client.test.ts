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

  // I-1 / M-2: 200 인데 JSON 이 아니면(HTML 오류 페이지 등) {ok:true, data:null} 을 내보내
  // 호출부가 `res.data.body` 에서 던졌다. 형제 모듈 plugin-capability.ts 와 같은 기준으로
  // 접어야 한다 — 성공을 자칭하면서 null 을 실어 보내지 않는다.
  it("200 인데 JSON 이 아니면(HTML 등) 성공을 자칭하지 않는다", async () => {
    const fetchImpl = (async () =>
      new Response("<html>gateway error</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;
    const client = createPluginClient({ baseUrl: "http://gw:8642", defaultToken: "t", fetchImpl });
    const res = await client.getIdentity("noah", "pt");
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.failure.code, "malformed_response");
  });

  it("200 인데 JSON 배열처럼 객체가 아닌 값이 와도 성공을 자칭하지 않는다", async () => {
    const fetchImpl = (async () =>
      new Response("null", {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const client = createPluginClient({ baseUrl: "http://gw:8642", defaultToken: "t", fetchImpl });
    const res = await client.listProfiles();
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.failure.code, "malformed_response");
  });
});

describe("plugin client — 타임아웃 (I-3)", () => {
  it("게이트웨이가 응답 없이 소켓을 열어두면 timeoutMs 뒤 timeout 코드로 접는다", async () => {
    // fetchImpl 이 신호가 중단될 때까지 매달렸다가 AbortError 로 거부한다 — 실제
    // undici/fetch 가 signal 을 받았을 때의 동작을 흉내낸다.
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      })) as unknown as typeof fetch;

    const client = createPluginClient({
      baseUrl: "http://gw:8642",
      defaultToken: "t",
      fetchImpl,
      timeoutMs: 5,
    });
    const res = await client.listProfiles();
    assert.equal(res.ok, false);
    if (res.ok) return;
    // 재시도(unreachable)와 주소 확인(timeout)은 사용자가 할 일이 다르다.
    assert.equal(res.failure.code, "timeout");
  });

  it("타임아웃 전에 응답이 오면 정상 처리된다", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ profiles: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const client = createPluginClient({
      baseUrl: "http://gw:8642",
      defaultToken: "t",
      fetchImpl,
      timeoutMs: 5000,
    });
    const res = await client.listProfiles();
    assert.equal(res.ok, true);
  });
});

describe("plugin client — 직원 설정 피커(0.9.0)", () => {
  it("툴셋·스킬 목록은 프로필 경로와 프로필 토큰으로 부른다", async () => {
    const { calls, fetchImpl } = recorder([
      { status: 200, json: { platform: "api_server", toolsets: [] } },
      { status: 200, json: { skills: [] } },
    ]);
    const client = createPluginClient({
      baseUrl: "http://gw:8642",
      defaultToken: "default-key-1234567890",
      fetchImpl,
    });
    await client.getToolsets("no ah", "profile-key-1234567890");
    await client.getSkills("noah", "profile-key-1234567890");
    assert.equal(calls[0].url, "http://gw:8642/p/no%20ah/deskrpg/toolsets");
    assert.equal(calls[0].auth, "Bearer profile-key-1234567890");
    assert.equal(calls[1].url, "http://gw:8642/p/noah/deskrpg/skills");
  });

  it("cloneFrom 은 있을 때만 본문에 싣는다", async () => {
    const { calls, fetchImpl } = recorder([
      { status: 201, json: { name: "noah", keyIssued: false } },
    ]);
    const client = createPluginClient({
      baseUrl: "http://gw:8642",
      defaultToken: "default-key-1234567890",
      fetchImpl,
    });
    await client.createProfile("noah");
    await client.createProfile("noah", { cloneFrom: "default" });
    assert.deepEqual(JSON.parse(calls[0].body!), { name: "noah" });
    assert.deepEqual(JSON.parse(calls[1].body!), { name: "noah", cloneFrom: "default" });
  });

  it("cloneKeys 는 있을 때만 cloneFrom 과 함께 싣는다", async () => {
    const { calls, fetchImpl } = recorder([
      {
        status: 201,
        json: {
          name: "noah",
          keyIssued: false,
          cloned: { configKeys: ["model"], envKeys: ["OPENAI_API_KEY"], keyScope: "api_keys" },
        },
      },
    ]);
    const client = createPluginClient({
      baseUrl: "http://gw:8642",
      defaultToken: "default-key-1234567890",
      fetchImpl,
    });
    const res = await client.createProfile("noah", { cloneFrom: "default", cloneKeys: "api_keys" });
    assert.deepEqual(JSON.parse(calls[0].body!), {
      name: "noah",
      cloneFrom: "default",
      cloneKeys: "api_keys",
    });
    assert.equal(res.ok && res.data.cloned?.keyScope, "api_keys");
  });
});

describe("plugin client — 프로바이더 인증", () => {
  it("여섯 호출이 프로필 경로·토큰·메서드·본문으로 나간다", async () => {
    const { calls, fetchImpl } = recorder([{ status: 200, json: {} }]);
    const client = createPluginClient({
      baseUrl: "http://gw:8642",
      defaultToken: "default-key-1234567890",
      fetchImpl,
    });
    const t = "profile-key-1234567890";
    await client.startOAuth("noah", t, "openai-codex");
    await client.pollOAuth("noah", t, "openai-codex", "s/1");
    await client.cancelOAuth("noah", t, "s/1");
    await client.disconnectOAuth("noah", t, "openai-codex");
    await client.putProviderKey("noah", t, "openai", "sk-VALUE-123456");
    await client.deleteProviderKey("noah", t, "openai");
    assert.deepEqual(
      calls.map((c) => `${c.method} ${c.url.replace("http://gw:8642", "")}`),
      [
        "POST /p/noah/deskrpg/oauth/openai-codex/start",
        "GET /p/noah/deskrpg/oauth/openai-codex/sessions/s%2F1",
        "DELETE /p/noah/deskrpg/oauth/sessions/s%2F1",
        "DELETE /p/noah/deskrpg/oauth/openai-codex",
        "PUT /p/noah/deskrpg/provider-keys/openai",
        "DELETE /p/noah/deskrpg/provider-keys/openai",
      ],
    );
    assert.ok(calls.every((c) => c.auth === `Bearer ${t}`));
    assert.deepEqual(JSON.parse(calls[4].body!), { value: "sk-VALUE-123456" });
  });
});
