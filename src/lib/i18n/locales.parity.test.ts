/**
 * 네 로케일의 키 집합이 같아야 한다. `t()` 는 없는 키를 en → 키 문자열 순으로 대신 쓰므로
 * 한 로케일에서 빠진 키는 조용히 다른 언어(또는 키 이름)로 화면에 나온다 — 여기서 잡는다.
 * UI 를 추가하는 작업은 이 테스트를 초록으로 유지해야 한다.
 */
import assert from "node:assert/strict";
import test from "node:test";

import en from "./locales/en";
import ja from "./locales/ja";
import ko from "./locales/ko";
import zh from "./locales/zh";

const LOCALES: Record<string, Record<string, string>> = { ko, en, ja, zh };

test("all four locale files share an identical key set", () => {
  const reference = Object.keys(LOCALES.en).sort();
  for (const [name, map] of Object.entries(LOCALES)) {
    const keys = Object.keys(map).sort();
    const missing = reference.filter((key) => !(key in map));
    const extra = keys.filter((key) => !(key in LOCALES.en));
    assert.deepEqual(
      { missing, extra },
      { missing: [], extra: [] },
      `${name} diverges from en — missing ${missing.length}, extra ${extra.length}`,
    );
  }
});

// 빈 문자열은 허용한다 — 일부러 비운 값이 있을 수 있다.
test("locale values are strings", () => {
  for (const [name, map] of Object.entries(LOCALES)) {
    for (const [key, value] of Object.entries(map)) {
      assert.equal(typeof value, "string", `${name}.${key} must be a string`);
    }
  }
});
