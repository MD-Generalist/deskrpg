import assert from "node:assert/strict";
import test from "node:test";

import { readLocaleCookie } from "./server";

test("핸드셰이크 쿠키에서 화면 언어를 꺼낸다", () => {
  assert.equal(readLocaleCookie("token=abc; deskrpg-locale=ko"), "ko");
  assert.equal(readLocaleCookie("deskrpg-locale=ja-JP;token=x"), "ja");
});

test("쿠키가 없거나 비면 추측하지 않고 null", () => {
  assert.equal(readLocaleCookie(undefined), null);
  assert.equal(readLocaleCookie("token=abc"), null);
  assert.equal(readLocaleCookie("deskrpg-locale="), null);
  assert.equal(readLocaleCookie("xdeskrpg-locale=ko"), null);
});
