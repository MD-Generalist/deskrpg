import assert from "node:assert/strict";
import test from "node:test";

import { readGrowthState, writeGrowthFlag } from "./growth-storage";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

test("저장한 확인 버전과 Star 누름을 다시 읽는다", () => {
  const s = memoryStorage();
  assert.deepEqual(readGrowthState(s), { ok: true, seenVersion: null, starClicked: false });
  writeGrowthFlag(s, "seenVersion", "2026.922.0");
  writeGrowthFlag(s, "starClicked", "1");
  assert.deepEqual(readGrowthState(s), { ok: true, seenVersion: "2026.922.0", starClicked: true });
});

test("저장소를 읽을 수 없으면 ok 가 false 다", () => {
  const broken = {
    getItem() {
      throw new Error("SecurityError");
    },
  } as unknown as Storage;
  assert.equal(readGrowthState(broken).ok, false);
  assert.equal(readGrowthState(null).ok, false);
  assert.doesNotThrow(() => writeGrowthFlag(broken, "starClicked", "1"));
});
