import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapPluginFailure } from "./plugin-errors";
import { proxyFailureBody } from "./profile-proxy";

const failure = (code: string, message = "") => ({
  code,
  message,
  blocksEditor: false,
  showsShellCommand: null,
  details: {},
});

describe("프로필 프록시의 실패 본문", () => {
  it("라우트가 없는 404 는 업그레이드 안내로 바꾼다", () => {
    const got = proxyFailureBody({ status: 404, failure: failure("upstream_error", "Not Found") });
    assert.equal(got.errorCode, "plugin_upgrade_required");
    assert.deepEqual(got.body.details, { minVersion: "0.9.0", reason: "missing_route" });
  });
  it("플러그인이 말한 404 는 그대로 옮긴다", () => {
    const got = proxyFailureBody({ status: 404, failure: failure("profile_not_found", "noah") });
    assert.equal(got.errorCode, "profile_not_found");
    assert.equal(got.body.upstreamStatus, 404);
  });
  it("그 밖의 실패는 코드·문장·상태를 옮긴다", () => {
    const got = proxyFailureBody({
      status: 409,
      failure: failure("config_unreadable", "bad yaml"),
    });
    assert.deepEqual(got.body, {
      errorCode: "config_unreadable",
      error: "bad yaml",
      upstreamStatus: 409,
    });
  });
  it("Hermes 멀티플렉스의 '모르는 프로필' 404 는 업그레이드가 아니라 profile_not_found 다", () => {
    // gateway/platforms/api_server.py profile_prefix_middleware 가 내는 본문 그대로.
    const failed = mapPluginFailure({
      status: 404,
      body: { error: "Unknown or unconfigured profile" },
    })!;
    const got = proxyFailureBody({ status: 404, failure: failed });
    assert.equal(got.errorCode, "profile_not_found");
    assert.equal(got.body.errorCode, "profile_not_found");
    assert.equal(got.body.upstreamStatus, 404);
    assert.equal(got.body.details, undefined);
  });
});
