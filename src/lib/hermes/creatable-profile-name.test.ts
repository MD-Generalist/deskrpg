import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CREATABLE_PROFILE_NAME_RE,
  RESERVED_PROFILE_NAMES,
  isCreatableProfileName,
} from "./creatable-profile-name";

describe("isCreatableProfileName — Hermes 가 새 프로필 생성 시 실제로 요구하는 문법", () => {
  it("소문자·숫자·하이픈·언더스코어는 통과한다", () => {
    assert.equal(isCreatableProfileName("noah"), true);
    assert.equal(isCreatableProfileName("noah2"), true);
    assert.equal(isCreatableProfileName("noah-2"), true);
    assert.equal(isCreatableProfileName("noah_2"), true);
    assert.equal(isCreatableProfileName("n"), true);
  });

  it("대문자는 거부한다", () => {
    // 등록용 PROFILE_NAME_RE 는 대문자를 허용하지만, 생성은 Hermes 서버가
    // 실제로 거부한다(profiles.py:51 이 소문자만 받는다).
    assert.equal(isCreatableProfileName("Noah"), false);
    assert.equal(isCreatableProfileName("NOAH"), false);
  });

  it("마침표는 거부한다", () => {
    assert.equal(isCreatableProfileName("noah.dev"), false);
  });

  it("64자를 넘으면 거부한다", () => {
    assert.equal(isCreatableProfileName("n".repeat(64)), true);
    assert.equal(isCreatableProfileName("n".repeat(65)), false);
  });

  it("하이픈·언더스코어로 시작하면 거부한다", () => {
    assert.equal(isCreatableProfileName("-noah"), false);
    assert.equal(isCreatableProfileName("_noah"), false);
  });

  it("빈 문자열은 거부한다", () => {
    assert.equal(isCreatableProfileName(""), false);
  });

  it("예약어 5개를 거부한다", () => {
    for (const reserved of ["hermes", "test", "tmp", "root", "sudo"]) {
      assert.equal(isCreatableProfileName(reserved), false, reserved);
    }
  });

  it("default 도 거부한다 — 등록 대상이 아니라 생성 대상이 아니다", () => {
    assert.equal(isCreatableProfileName("default"), false);
  });
});

describe("CREATABLE_PROFILE_NAME_RE / RESERVED_PROFILE_NAMES — export 형태", () => {
  it("정규식 자체도 같은 문법을 지킨다", () => {
    assert.equal(CREATABLE_PROFILE_NAME_RE.test("noah-2"), true);
    assert.equal(CREATABLE_PROFILE_NAME_RE.test("Noah"), false);
  });

  it("예약어 집합에 5개가 그대로 있다", () => {
    assert.equal(RESERVED_PROFILE_NAMES.size, 5);
    assert.ok(RESERVED_PROFILE_NAMES.has("hermes"));
    assert.ok(RESERVED_PROFILE_NAMES.has("sudo"));
  });
});
