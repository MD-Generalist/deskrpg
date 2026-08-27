import test from "node:test";
import assert from "node:assert/strict";

import { allActivityKeys, describeActivity } from "./npc-activity";

test("아는 도구는 사람이 읽는 문구로 바뀐다", () => {
  assert.deepEqual(describeActivity("web"), { key: "npc.activity.searching" });
  assert.deepEqual(describeActivity("file"), { key: "npc.activity.readingFile" });
  assert.deepEqual(describeActivity("terminal"), { key: "npc.activity.runningCommand" });
});

test("_thinking 은 생각 중으로 보인다", () => {
  // 답이 두 번 보이게 만들던 바로 그 도구다. 이름만 쓰고 본문은 쓰지 않는다.
  assert.deepEqual(describeActivity("_thinking"), { key: "npc.activity.thinking" });
});

test("모르는 도구도 내부 이름을 노출하지 않는다", () => {
  const notice = describeActivity("some_internal_tool_v2");
  assert.deepEqual(notice, { key: "npc.activity.working" });
  assert.ok(!JSON.stringify(notice).includes("some_internal_tool_v2"));
});

test("이름이 없으면 표시하지 않는다", () => {
  assert.equal(describeActivity(""), null);
  assert.equal(describeActivity("   "), null);
});

test("표시 키 목록에 중복이 없다", () => {
  const keys = allActivityKeys();
  assert.equal(keys.length, new Set(keys).size);
});

test("모든 표시 키는 npc.activity 네임스페이스다", () => {
  for (const k of allActivityKeys()) assert.ok(k.startsWith("npc.activity."), k);
});

// --- 로케일 가드: 문구 없는 키가 화면에 키 이름으로 새는 것을 막는다 ---

import { readFileSync } from "node:fs";

const LOCALES = ["en", "ko", "ja", "zh"];

test("모든 활동 키가 네 로케일에 문구를 갖는다", () => {
  const missing: string[] = [];
  for (const loc of LOCALES) {
    const src = readFileSync(`src/lib/i18n/locales/${loc}.ts`, "utf8");
    for (const key of allActivityKeys()) {
      if (!src.includes(`"${key}"`)) missing.push(`${loc}:${key}`);
    }
  }
  assert.deepEqual(missing, []);
});
