import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapPluginFailure } from "./plugin-errors";

describe("mapPluginFailure", () => {
  it("2xx 는 실패가 아니다", () => {
    assert.equal(mapPluginFailure({ status: 200, body: { body: "hi" } }), null);
  });

  it("unreadable 은 200 이어도 편집기를 막는다", () => {
    // 빈 편집기를 열면 사용자가 저장 버튼으로 남의 인격을 지운다.
    const got = mapPluginFailure({
      status: 200,
      body: { body: null, isDefaultTemplate: null, revision: null, unreadable: true },
    });
    assert.ok(got);
    assert.equal(got.code, "unreadable");
    assert.equal(got.blocksEditor, true);
  });

  it("409 identity_unreadable 은 쓰지 않았음을 말한다", () => {
    const got = mapPluginFailure({
      status: 409,
      body: { error: "identity_unreadable", reason: "SOUL.md 을 읽을 수 없다: UnicodeDecodeError" },
    });
    assert.ok(got);
    assert.equal(got.code, "identity_unreadable");
    assert.equal(got.blocksEditor, true);
    assert.match(got.message, /UnicodeDecodeError/);
  });

  it("409 config_unreadable 도 같은 규약이다", () => {
    const got = mapPluginFailure({
      status: 409,
      body: { error: "config_unreadable", reason: "기존 model 키가 매핑이 아니다" },
    });
    assert.ok(got);
    assert.equal(got.code, "config_unreadable");
    assert.equal(got.blocksEditor, true);
  });

  it("409 profile_has_service 는 셸 명령을 그대로 보여준다", () => {
    const got = mapPluginFailure({
      status: 409,
      body: {
        error: "profile_has_service",
        name: "noah",
        unit: "hermes-gateway-noah",
        reason:
          "프로필 'noah' 은 자기 서비스(hermes-gateway-noah)를 갖고 있어 여기서 지울 수 없습니다. 셸에서 정리하세요: hermes profile delete noah",
      },
    });
    assert.ok(got);
    assert.equal(got.code, "profile_has_service");
    assert.equal(got.showsShellCommand, "hermes profile delete noah");
  });

  it("409 revision_conflict 는 다시 읽으라는 뜻이다", () => {
    const got = mapPluginFailure({ status: 409, body: { error: "revision_conflict" } });
    assert.ok(got);
    assert.equal(got.code, "revision_conflict");
    assert.equal(got.blocksEditor, false);
  });

  it("409 already_exists 는 이름 충돌이다", () => {
    const got = mapPluginFailure({ status: 409, body: { error: "already_exists", name: "noah" } });
    assert.ok(got);
    assert.equal(got.code, "already_exists");
  });

  it("모르는 오류도 코드를 잃지 않는다", () => {
    const got = mapPluginFailure({ status: 500, body: {} });
    assert.ok(got);
    assert.equal(got.code, "plugin_error");
  });

  it("본문이 객체가 아니어도 던지지 않는다", () => {
    const got = mapPluginFailure({ status: 400, body: "bad request" });
    assert.ok(got);
    assert.equal(got.code, "plugin_error");
  });
});
