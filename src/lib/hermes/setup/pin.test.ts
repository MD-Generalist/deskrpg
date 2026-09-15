import test from "node:test";
import assert from "node:assert/strict";

import { HOST_HELPER } from "./host-helper";
import { PLUGIN_PIN, PLUGIN_PIN_SHORT, PLUGIN_VERSION } from "./pin";

test("호스트 스크립트의 고정 커밋과 화면이 읽는 상수가 같다", () => {
  // 두 곳이 어긋나면 화면은 옛 커밋을 안내하면서 실제로는 다른 것을 깐다.
  assert.ok(HOST_HELPER.includes(`PIN = '${PLUGIN_PIN}'`), "host-helper 의 PIN 이 다르다");
  assert.ok(
    HOST_HELPER.includes(`PLUGIN_VERSION = '${PLUGIN_VERSION}'`),
    "host-helper 의 PLUGIN_VERSION 이 다르다",
  );
});

test("짧은 표기는 고정 커밋의 앞 12자다", () => {
  assert.equal(PLUGIN_PIN_SHORT, PLUGIN_PIN.slice(0, 12));
  assert.match(PLUGIN_PIN, /^[0-9a-f]{40}$/);
});
