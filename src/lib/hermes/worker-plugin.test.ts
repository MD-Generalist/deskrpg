import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PluginInfo } from "./deskrpg-plugin-types";
import { parsePluginInfo } from "./plugin-capability";
import {
  applyWorkerPlugin,
  parseWorkerPluginReport,
  workerPluginWarning,
  WORKER_PLUGIN_CAPABILITY,
} from "./worker-plugin";

const gap = (profile: string, extra: Partial<Record<string, unknown>> = {}) => ({
  profile,
  link: "missing",
  enabled: false,
  disabled: false,
  ...extra,
});

function info(overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    plugin: "deskrpg",
    version: "0.12.0",
    capabilities: ["kanban", "cron", "events", WORKER_PLUGIN_CAPABILITY],
    timezone: null,
    kanban: { dispatcher_present: true, attachments: true },
    ...overrides,
  };
}

describe("parseWorkerPluginReport", () => {
  it("빠진 프로필 목록을 살린다", () => {
    assert.deepEqual(parseWorkerPluginReport({ missing: [gap("sophie")] }), {
      missing: [{ profile: "sophie", link: "missing", enabled: false, disabled: false }],
    });
  });

  it("옛 플러그인(필드 없음)은 undefined, 판정 실패(null)는 null — 둘을 섞지 않는다", () => {
    assert.equal(parseWorkerPluginReport(undefined), undefined);
    assert.equal(parseWorkerPluginReport(null), null);
  });

  it("모양이 틀린 항목은 버리고, 모양이 틀린 본문은 null", () => {
    assert.deepEqual(parseWorkerPluginReport({ missing: [gap("ok"), { profile: 3 }, "x"] }), {
      missing: [{ profile: "ok", link: "missing", enabled: false, disabled: false }],
    });
    assert.equal(parseWorkerPluginReport({ missing: "sophie" }), null);
    assert.equal(parseWorkerPluginReport("sophie"), null);
  });

  it("parsePluginInfo 가 worker_plugin 을 살리고, 캐시 왕복 뒤에도 남는다", () => {
    const body = { ...info(), worker_plugin: { missing: [gap("sophie")] } };
    const parsed = parsePluginInfo(body);
    assert.deepEqual(parsed?.worker_plugin, { missing: [gap("sophie")] });
    assert.deepEqual(parsePluginInfo(JSON.parse(JSON.stringify(parsed)))?.worker_plugin, {
      missing: [gap("sophie")],
    });
  });

  it("옛 플러그인 본문에서는 worker_plugin 키를 만들지 않는다", () => {
    const parsed = parsePluginInfo(info());
    assert.equal(parsed && "worker_plugin" in parsed, false);
  });
});

describe("workerPluginWarning", () => {
  it("고칠 수 있는 프로필이 있으면 경고를 낸다", () => {
    const w = workerPluginWarning(
      info({ worker_plugin: { missing: [gap("sophie"), gap("oliver")] } }),
    );
    assert.deepEqual(w, { fixable: ["sophie", "oliver"], disabledByOperator: [] });
  });

  it("운영자가 끈 프로필은 고칠 대상에서 빼고 따로 말한다", () => {
    const w = workerPluginWarning(
      info({ worker_plugin: { missing: [gap("sophie"), gap("mia", { disabled: true })] } }),
    );
    assert.deepEqual(w, { fixable: ["sophie"], disabledByOperator: ["mia"] });
  });

  it("고칠 것이 없으면 줄을 띄우지 않는다 — 끈 프로필만 있어도 마찬가지다", () => {
    assert.equal(workerPluginWarning(info({ worker_plugin: { missing: [] } })), null);
    assert.equal(
      workerPluginWarning(info({ worker_plugin: { missing: [gap("mia", { disabled: true })] } })),
      null,
    );
  });

  it("capability 가 없거나, 필드가 없거나, 판정 실패(null)면 띄우지 않는다", () => {
    assert.equal(workerPluginWarning(null), null);
    assert.equal(workerPluginWarning(info()), null);
    assert.equal(workerPluginWarning(info({ worker_plugin: null })), null);
    assert.equal(
      workerPluginWarning(
        info({ capabilities: ["kanban"], worker_plugin: { missing: [gap("sophie")] } }),
      ),
      null,
    );
  });
});

describe("applyWorkerPlugin", () => {
  it("플러그인에 적용을 요청한 뒤 **반드시** 캐시를 다시 채운다", async () => {
    const calls: string[] = [];
    const out = await applyWorkerPlugin({
      ensure: async () => {
        calls.push("ensure");
        return {
          ok: true,
          data: { results: [{ profile: "sophie", link: "created", enabled: "added" }] },
        };
      },
      refreshCache: async () => {
        calls.push("refresh");
      },
    });
    // 캐시는 최대 1시간 낡는다 — 다시 채우지 않으면 적용했는데도 경고가 남는다.
    assert.deepEqual(calls, ["ensure", "refresh"]);
    assert.deepEqual(out, {
      ok: true,
      results: [{ profile: "sophie", link: "created", enabled: "added" }],
    });
  });

  it("프로필별 실패는 그대로 싣는다", async () => {
    const out = await applyWorkerPlugin({
      ensure: async () => ({
        ok: true,
        data: { results: [{ profile: "oliver", error: "config_unreadable" }] },
      }),
      refreshCache: async () => {},
    });
    assert.deepEqual(out, {
      ok: true,
      results: [{ profile: "oliver", error: "config_unreadable" }],
    });
  });

  it("플러그인 호출이 실패하면 그 코드를 돌려주고, 그래도 캐시는 다시 채운다", async () => {
    // 일부 프로필이 이미 바뀌었을 수 있다 — 화면이 낡은 목록을 들고 있으면 안 된다.
    let refreshed = false;
    const out = await applyWorkerPlugin({
      ensure: async () => ({
        ok: false,
        status: 502,
        failure: { code: "plugin_unreachable", message: "x" },
      }),
      refreshCache: async () => {
        refreshed = true;
      },
    });
    assert.equal(refreshed, true);
    assert.deepEqual(out, { ok: false, errorCode: "plugin_unreachable" });
  });

  it("캐시 갱신이 실패해도 적용 결과는 잃지 않는다", async () => {
    const out = await applyWorkerPlugin({
      ensure: async () => ({ ok: true, data: { results: [] } }),
      refreshCache: async () => {
        throw new Error("probe down");
      },
    });
    assert.deepEqual(out, { ok: true, results: [] });
  });
});
