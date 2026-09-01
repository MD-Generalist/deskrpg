import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyPluginProbe, probeDeskrpgPlugin } from "./plugin-capability";

describe("classifyPluginProbe", () => {
  // 401 과 404 를 뭉치면 사용자가 할 일이 사라진다 — 전자는 키 교체,
  // 후자는 게이트웨이 머신에 플러그인 설치다.
  const cases: Array<[string, { status: number; body: unknown }, string, string | null]> = [
    [
      "200 이면 준비됨",
      { status: 200, body: { plugin: "deskrpg", version: "0.3.0" } },
      "plugin_ready",
      "0.3.0",
    ],
    [
      "200 인데 version 이 없으면 준비됐지만 버전은 모른다",
      { status: 200, body: { plugin: "deskrpg" } },
      "plugin_ready",
      null,
    ],
    ["401 은 키 문제", { status: 401, body: {} }, "plugin_unauthorized", null],
    ["403 도 키 문제로 본다", { status: 403, body: {} }, "plugin_unauthorized", null],
    ["404 는 플러그인 부재", { status: 404, body: {} }, "plugin_absent", null],
    ["500 은 모른다 — 기능을 켜지 않는다", { status: 500, body: {} }, "unknown", null],
    [
      "200 인데 본문이 우리 플러그인이 아니면 모른다",
      { status: 200, body: { hello: "world" } },
      "unknown",
      null,
    ],
    ["200 인데 본문이 객체가 아니면 모른다", { status: 200, body: "ok" }, "unknown", null],
  ];

  for (const [name, input, status, version] of cases) {
    it(name, () => {
      const got = classifyPluginProbe(input);
      assert.equal(got.status, status);
      assert.equal(got.version, version);
    });
  }
});

describe("probeDeskrpgPlugin", () => {
  it("게이트웨이 스코프 경로를 Bearer 토큰으로 부른다", async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push({
        url: String(url),
        auth: new Headers(init?.headers).get("authorization"),
      });
      return new Response(JSON.stringify({ plugin: "deskrpg", version: "0.3.0" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const got = await probeDeskrpgPlugin({
      baseUrl: "http://gw.example:8642/",
      token: "default-key-1234567890",
      fetchImpl,
    });

    assert.equal(got.status, "plugin_ready");
    assert.equal(got.version, "0.3.0");
    // 프리픽스가 붙으면 프로필 스코프가 되어 default 키로는 401 이 난다.
    assert.equal(seen[0].url, "http://gw.example:8642/deskrpg/info");
    assert.equal(seen[0].auth, "Bearer default-key-1234567890");
  });

  it("JSON 이 아니어도 던지지 않고 unknown 을 돌려준다", async () => {
    const fetchImpl = (async () =>
      new Response("<html>dashboard</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;

    const got = await probeDeskrpgPlugin({ baseUrl: "http://x", token: "t", fetchImpl });
    assert.equal(got.status, "unknown");
  });

  it("도달 실패는 unknown 이다 — 예외를 밖으로 던지지 않는다", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const got = await probeDeskrpgPlugin({ baseUrl: "http://x", token: "t", fetchImpl });
    assert.equal(got.status, "unknown");
  });
});
