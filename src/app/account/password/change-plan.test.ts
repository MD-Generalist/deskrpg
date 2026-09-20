import test from "node:test";
import assert from "node:assert/strict";

import { planPasswordChange } from "./change-plan";

test("빈 칸이 있으면 서버에 보내지 않는다", () => {
  assert.deepEqual(
    planPasswordChange({ current: "", next: "new-password", confirm: "new-password" }),
    {
      ok: false,
      errorCode: "current_new_password_required",
    },
  );
});

test("확인 값이 다르면 서버에 보내지 않는다", () => {
  assert.deepEqual(
    planPasswordChange({ current: "old-password", next: "new-password", confirm: "new-passwerd" }),
    { ok: false, errorCode: "password_mismatch" },
  );
});

test("8자 미만이면 서버에 보내지 않는다", () => {
  assert.deepEqual(
    planPasswordChange({ current: "old-password", next: "short", confirm: "short" }),
    {
      ok: false,
      errorCode: "password_length_invalid",
    },
  );
});

test("현재 비밀번호와 같으면 서버에 보내지 않는다", () => {
  assert.deepEqual(
    planPasswordChange({ current: "old-password", next: "old-password", confirm: "old-password" }),
    { ok: false, errorCode: "password_unchanged" },
  );
});

test("모두 통과하면 보낼 본문을 돌려준다", () => {
  assert.deepEqual(
    planPasswordChange({ current: "old-password", next: "new-password", confirm: "new-password" }),
    { ok: true, body: { currentPassword: "old-password", newPassword: "new-password" } },
  );
});
