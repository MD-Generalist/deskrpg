import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectProfileToken } from "./plugin-profile-access";

describe("selectProfileToken", () => {
  it("등록된 프로필의 토큰을 복호화해서 준다", () => {
    const got = selectProfileToken({
      rows: [{ profileName: "noah", tokenEncrypted: "enc-noah" }],
      profileName: "noah",
      decrypt: (v) => `dec(${v})`,
    });
    assert.deepEqual(got, { ok: true, profileToken: "dec(enc-noah)" });
  });

  it("등록되지 않은 프로필이면 no_profile 이다", () => {
    // 여기서 default 키로 폴백하면 안 된다 — 프로필 스코프 경로에 default 키를
    // 보내면 Hermes 가 401 을 내고, 사용자는 '토큰이 틀렸다'는 잘못된 진단을 받는다.
    const got = selectProfileToken({
      rows: [{ profileName: "sophie", tokenEncrypted: "enc-sophie" }],
      profileName: "noah",
      decrypt: (v) => `dec(${v})`,
    });
    assert.deepEqual(got, { ok: false, reason: "no_profile" });
  });

  it("복호화가 실패하면 no_profile 이다 — 던지지 않는다", () => {
    const got = selectProfileToken({
      rows: [{ profileName: "noah", tokenEncrypted: "corrupt" }],
      profileName: "noah",
      decrypt: () => {
        throw new Error("Invalid gateway token payload");
      },
    });
    assert.deepEqual(got, { ok: false, reason: "no_profile" });
  });
});
