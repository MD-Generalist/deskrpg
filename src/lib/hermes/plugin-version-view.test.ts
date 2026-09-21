import { test } from "node:test";
import assert from "node:assert/strict";

import { PLUGIN_VERSION } from "@/lib/hermes/setup/pin";

import { describePluginVersion } from "./plugin-version-view";

test("설치본이 핀과 같으면 최신이다", () => {
  // 핀 리터럴을 여기 베껴 두면 플러그인을 올릴 때마다 이 테스트가 깨진다 — 상수를 그대로 쓴다.
  const got = describePluginVersion({ installed: PLUGIN_VERSION, pluginStatus: "plugin_ready" });
  assert.equal(got.state, "current");
  assert.equal(got.installed, PLUGIN_VERSION);
  assert.equal(got.pinned, PLUGIN_VERSION);
});

test("설치본이 핀보다 낮으면 뒤처짐이다 — 문자열 비교로는 못 가린다", () => {
  // "0.9.0" > "0.10.2" 가 참인 문자열 비교를 쓰면 이 줄이 통과하지 못한다.
  assert.equal(
    describePluginVersion({ installed: "0.9.0", pluginStatus: "plugin_ready" }).state,
    "outdated",
  );
  assert.equal(
    describePluginVersion({ installed: "0.10.0", pluginStatus: "plugin_ready" }).state,
    "outdated",
  );
});

test("설치본이 핀보다 높으면 앞선 것이다 — 뒤처졌다고 말하지 않는다", () => {
  assert.equal(
    describePluginVersion({ installed: "99.0.0", pluginStatus: "plugin_ready" }).state,
    "ahead",
  );
});

test("버전을 모르면 모른다고 한다 — 없는 값을 최신으로 속이지 않는다", () => {
  for (const installed of [null, "", "알 수 없음"]) {
    assert.equal(
      describePluginVersion({ installed, pluginStatus: "plugin_ready" }).state,
      "unknown",
      String(installed),
    );
  }
});

test("플러그인이 준비 상태가 아니면 버전 비교를 하지 않는다", () => {
  // 404·401 로 막힌 게이트웨이에 "뒤처짐" 이라고 말하면 고칠 곳을 잘못 짚게 한다.
  for (const status of ["plugin_absent", "plugin_unauthorized", "unknown", null]) {
    assert.equal(
      describePluginVersion({ installed: "0.10.0", pluginStatus: status }).state,
      "unknown",
      String(status),
    );
  }
});
