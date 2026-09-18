import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyPluginProbe,
  classifyPluginProbeWithInfo,
  compareSemver,
  isMissingPluginRoute,
  meetsAutomationContract,
  parsePluginInfo,
  probeDeskrpgPlugin,
  probeDeskrpgPluginWithInfo,
  resolvePluginStatusFromCache,
  shouldReprobePlugin,
  supportsProfileClone,
  supportsProfileOauth,
  supportsProfilePicker,
  supportsProviderKeys,
} from "./plugin-capability";
import type { PluginInfo } from "./deskrpg-plugin-types";

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

  // M-1: 이 시그널·타이머 배선을 전부 제거해도 기존 테스트가 통과했다(격리 사본 실측).
  // fetchImpl 이 signal 의 abort 를 실제로 기다리게 해서 신호가 정말 전달되는지 물게 한다.
  it("timeoutMs 안에 응답이 없으면 신호를 중단시켜 unknown 을 돌려준다", async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      })) as unknown as typeof fetch;

    const got = await probeDeskrpgPlugin({
      baseUrl: "http://x",
      token: "t",
      fetchImpl,
      timeoutMs: 5,
    });
    assert.equal(got.status, "unknown");
  });
});

describe("shouldReprobePlugin", () => {
  const now = new Date("2026-09-01T00:00:00Z");

  it("한 번도 찌른 적 없으면 찌른다", () => {
    assert.equal(shouldReprobePlugin({ checkedAt: null, now }), true);
  });

  it("최근에 찔렀으면 다시 찌르지 않는다", () => {
    assert.equal(shouldReprobePlugin({ checkedAt: "2026-08-31T23:50:00Z", now }), false);
  });

  it("오래됐으면 다시 찌른다 — 플러그인은 나중에 설치될 수 있다", () => {
    assert.equal(shouldReprobePlugin({ checkedAt: "2026-08-30T00:00:00Z", now }), true);
  });

  it("깨진 타임스탬프는 찌른다 — 모르면 확인하는 쪽이 안전하다", () => {
    assert.equal(shouldReprobePlugin({ checkedAt: "not-a-date", now }), true);
  });

  // PG 판정 E: PostgreSQL 은 pluginCheckedAt 을 Date 객체로 돌려준다 — 문자열만 받으면
  // 스테이징에서 이 분기가 항상 "다시 찌른다"로 새서 캐시가 무력화된다.
  it("Date 객체로 들어와도 최근이면 다시 찌르지 않는다 (PG 방언)", () => {
    assert.equal(shouldReprobePlugin({ checkedAt: new Date("2026-08-31T23:50:00Z"), now }), false);
  });

  it("Date 객체로 들어와도 오래됐으면 다시 찌른다 (PG 방언)", () => {
    assert.equal(shouldReprobePlugin({ checkedAt: new Date("2026-08-30T00:00:00Z"), now }), true);
  });
});

// 최종 리뷰 I-1: shouldReprobePlugin 정의만 있고 소비자가 없어서 Task 4·9 산출물이
// 전부 죽어 있었다. HermesProfileList 가 "캐시를 쓸지 다시 찌를지" 를 결정하는 판정
// 로직을 순수 함수로 뽑아 여기서 고정한다 — 이 테스트가 그 결정을 지킨다.
describe("resolvePluginStatusFromCache", () => {
  const now = new Date("2026-09-01T00:00:00Z");

  it("캐시가 신선하고 값이 있으면 그 값을 쓰고 재프로브가 필요없다고 말한다", () => {
    const result = resolvePluginStatusFromCache({
      pluginStatus: "plugin_ready",
      pluginCheckedAt: "2026-08-31T23:50:00Z",
      now,
    });
    assert.deepEqual(result, { status: "plugin_ready", needsReprobe: false });
  });

  it("캐시가 오래됐으면 재프로브가 필요하다고 말한다", () => {
    const result = resolvePluginStatusFromCache({
      pluginStatus: "plugin_ready",
      pluginCheckedAt: "2026-08-30T00:00:00Z",
      now,
    });
    assert.deepEqual(result, { status: "unknown", needsReprobe: true });
  });

  it("캐시가 아예 없으면(checkedAt null) 재프로브가 필요하다", () => {
    const result = resolvePluginStatusFromCache({
      pluginStatus: null,
      pluginCheckedAt: null,
      now,
    });
    assert.deepEqual(result, { status: "unknown", needsReprobe: true });
  });

  it("checkedAt 은 신선한데 pluginStatus 가 알려진 값이 아니면 재프로브가 필요하다", () => {
    // DB 컬럼이 nullable 이라 이론상 pluginStatus 가 null 인데 checkedAt 만 있는
    // 상태가 있을 수 있다 — 값 없이 "신선하다" 고 우길 수 없다.
    const result = resolvePluginStatusFromCache({
      pluginStatus: null,
      pluginCheckedAt: "2026-08-31T23:50:00Z",
      now,
    });
    assert.deepEqual(result, { status: "unknown", needsReprobe: true });
  });

  it("PG 방언(Date 객체)도 그대로 받는다", () => {
    const result = resolvePluginStatusFromCache({
      pluginStatus: "plugin_absent",
      pluginCheckedAt: new Date("2026-08-31T23:50:00Z"),
      now,
    });
    assert.deepEqual(result, { status: "plugin_absent", needsReprobe: false });
  });
});

// `buildPluginCacheUpdate` 의 방언별 테스트는 plugin-cache-update.test.ts 로 옮겼다 —
// 그 함수 자체가 plugin-cache-update.ts(서버 전용)로 옮겨졌기 때문이다. 이 파일의
// 헤더 주석 참조(HermesProfileList.tsx 가 이 파일을 직접 import 하므로 `@/db` 를
// 더는 담을 수 없다).

// ---------------------------------------------------------------------------
// 자동화 계약(v0.6.0+) — info 파싱과 계약 게이트
// ---------------------------------------------------------------------------

describe("parsePluginInfo", () => {
  it("계약 블록(capabilities·timezone·kanban)을 그대로 뽑는다", () => {
    const got = parsePluginInfo({
      plugin: "deskrpg",
      version: "0.6.0",
      capabilities: ["kanban", "cron", "events"],
      timezone: "Asia/Seoul",
      kanban: { dispatcher_present: true, attachments: false },
    });
    assert.deepEqual(got, {
      plugin: "deskrpg",
      version: "0.6.0",
      capabilities: ["kanban", "cron", "events"],
      timezone: "Asia/Seoul",
      kanban: { dispatcher_present: true, attachments: false },
      dashboard_url: null,
    });
  });

  it("구버전 info(capabilities 없음)도 빈 배열·기본값으로 접어 잃지 않는다", () => {
    const got = parsePluginInfo({ plugin: "deskrpg", version: "0.3.0" });
    assert.ok(got);
    assert.deepEqual(got.capabilities, []);
    assert.equal(got.timezone, null);
    assert.deepEqual(got.kanban, { dispatcher_present: false, attachments: false });
  });

  it("0.7.1 dashboard_url 은 http(s) 주소만 받는다 — 화면에서 링크로 쓰이므로 javascript: 같은 값은 버린다", () => {
    const base = { plugin: "deskrpg", version: "0.7.1" };
    assert.equal(
      parsePluginInfo({ ...base, dashboard_url: "https://deskrpg-hermes.srv1.hstgr.cloud" })
        ?.dashboard_url,
      "https://deskrpg-hermes.srv1.hstgr.cloud",
    );
    assert.equal(
      parsePluginInfo({ ...base, dashboard_url: "http://10.0.0.5:9119" })?.dashboard_url,
      "http://10.0.0.5:9119",
    );
    assert.equal(
      parsePluginInfo({ ...base, dashboard_url: "javascript:alert(1)" })?.dashboard_url,
      null,
    );
    assert.equal(parsePluginInfo({ ...base, dashboard_url: "not a url" })?.dashboard_url, null);
    assert.equal(parsePluginInfo({ ...base, dashboard_url: null })?.dashboard_url, null);
    assert.equal(parsePluginInfo(base)?.dashboard_url, null);
  });

  it("우리 플러그인이 아니거나 version 이 없으면 null", () => {
    assert.equal(parsePluginInfo({ hello: "world" }), null);
    assert.equal(parsePluginInfo({ plugin: "deskrpg" }), null);
    assert.equal(parsePluginInfo("ok"), null);
    assert.equal(parsePluginInfo(null), null);
  });

  it("classifyPluginProbeWithInfo 는 200 이면 info 를, 아니면 null 을 곁들인다", () => {
    const got = classifyPluginProbeWithInfo({
      status: 200,
      body: { plugin: "deskrpg", version: "0.6.1", capabilities: ["kanban"] },
    });
    assert.deepEqual(got.capability, { status: "plugin_ready", version: "0.6.1" });
    assert.deepEqual(got.info?.capabilities, ["kanban"]);
    assert.equal(classifyPluginProbeWithInfo({ status: 404, body: {} }).info, null);
  });

  it("probeDeskrpgPluginWithInfo 는 같은 경로를 찌르고 계약 블록까지 돌려준다", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          plugin: "deskrpg",
          version: "0.6.0",
          capabilities: ["kanban", "cron", "events"],
          timezone: "Asia/Seoul",
          kanban: { dispatcher_present: true, attachments: true },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    const got = await probeDeskrpgPluginWithInfo({ baseUrl: "http://gw", token: "t", fetchImpl });
    assert.equal(got.capability.status, "plugin_ready");
    assert.equal(got.info?.timezone, "Asia/Seoul");

    const dead = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const unreachable = await probeDeskrpgPluginWithInfo({
      baseUrl: "http://gw",
      token: "t",
      fetchImpl: dead,
    });
    assert.deepEqual(unreachable, {
      capability: { status: "unknown", version: null },
      info: null,
      failure: "unreachable",
    });
  });
});

describe("meetsAutomationContract", () => {
  const full = {
    plugin: "deskrpg" as const,
    version: "0.6.0",
    capabilities: ["kanban", "cron", "events"],
    timezone: "Asia/Seoul",
    kanban: { dispatcher_present: true, attachments: true },
  };

  it("0.6.0 + 세 capability 면 통과", () => {
    assert.deepEqual(meetsAutomationContract(full), { ok: true, minVersion: "0.6.0" });
  });

  it("상위 버전(0.10.0, 1.0.0)도 통과 — 문자열 비교가 아니라 semver 비교다", () => {
    assert.equal(meetsAutomationContract({ ...full, version: "0.10.0" }).ok, true);
    assert.equal(meetsAutomationContract({ ...full, version: "1.0.0" }).ok, true);
    assert.equal(meetsAutomationContract({ ...full, version: "0.6.0-rc.1" }).ok, true);
  });

  it("0.5.9 는 version_below_minimum", () => {
    const got = meetsAutomationContract({ ...full, version: "0.5.9" });
    assert.equal(got.ok, false);
    assert.equal(got.reason, "version_below_minimum");
    assert.equal(got.minVersion, "0.6.0");
  });

  it("capability 가 하나라도 빠지면 missing_capability 와 빠진 이름", () => {
    const got = meetsAutomationContract({ ...full, capabilities: ["kanban", "cron"] });
    assert.equal(got.ok, false);
    assert.equal(got.reason, "missing_capability");
    assert.deepEqual(got.missing, ["events"]);
  });

  it("버전이 파싱 불가면 invalid_version", () => {
    const got = meetsAutomationContract({ ...full, version: "dev" });
    assert.equal(got.ok, false);
    assert.equal(got.reason, "invalid_version");
  });

  it("info 가 null 이면(플러그인 부재·구버전) no_info", () => {
    const got = meetsAutomationContract(null);
    assert.equal(got.ok, false);
    assert.equal(got.reason, "no_info");
  });
});

describe("compareSemver", () => {
  it("숫자 단위로 비교하고 프리릴리스 꼬리는 무시한다", () => {
    assert.equal(compareSemver("0.6.0", "0.6.0"), 0);
    assert.equal(compareSemver("0.10.0", "0.9.9"), 1);
    assert.equal(compareSemver("0.6", "0.6.0"), 0);
    assert.equal(compareSemver("v1.2.3", "1.2.3"), 0);
    assert.equal(compareSemver("0.6.0-rc.1", "0.6.0"), 0);
    assert.equal(compareSemver("abc", "1.0.0"), null);
  });
});

describe("직원 설정 피커 게이트", () => {
  const info = (capabilities: string[]) =>
    ({ version: "0.9.0", capabilities }) as unknown as PluginInfo;
  it("두 capability 가 모두 있어야 피커를 쓴다", () => {
    assert.equal(supportsProfilePicker(info(["profile_toolsets", "profile_skills"])), true);
    assert.equal(supportsProfilePicker(info(["profile_toolsets"])), false);
    assert.equal(supportsProfilePicker(null), false);
  });
  it("복제는 profile_clone 하나로 판정한다", () => {
    assert.equal(supportsProfileClone(info(["profile_clone"])), true);
    assert.equal(supportsProfileClone(info([])), false);
  });
  it("404 인데 플러그인의 알려진 코드가 아니면 라우트가 없는 것이다", () => {
    assert.equal(isMissingPluginRoute({ status: 404, failure: { code: "upstream_error" } }), true);
    assert.equal(isMissingPluginRoute({ status: 404, failure: { code: "plugin_error" } }), true);
    assert.equal(
      isMissingPluginRoute({ status: 404, failure: { code: "profile_not_found" } }),
      false,
    );
    assert.equal(
      isMissingPluginRoute({ status: 404, failure: { code: "oauth_session_not_found" } }),
      false,
    );
    assert.equal(isMissingPluginRoute({ status: 500, failure: { code: "internal_error" } }), false);
  });
});

describe("프로바이더 인증 게이트", () => {
  const info = (capabilities: string[]) =>
    ({ version: "0.9.0", capabilities }) as unknown as PluginInfo;

  it("supportsProfileOauth 는 profile_oauth 하나로 판정한다", () => {
    assert.equal(supportsProfileOauth(info(["profile_oauth"])), true);
    assert.equal(supportsProfileOauth(info([])), false);
    assert.equal(supportsProfileOauth(null), false);
  });

  it("supportsProviderKeys 는 profile_provider_keys 하나로 판정한다", () => {
    assert.equal(supportsProviderKeys(info(["profile_provider_keys"])), true);
    assert.equal(supportsProviderKeys(info([])), false);
    assert.equal(supportsProviderKeys(null), false);
  });

  it("provider_not_found 도 플러그인이 자기 코드로 낸 404 다 — 라우트 부재가 아니다", () => {
    assert.equal(
      isMissingPluginRoute({ status: 404, failure: { code: "provider_not_found" } }),
      false,
    );
  });
});
