import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_NPC_MOTION,
  RUN_SPEED_THRESHOLD,
  normalizeNpcMotionConfig,
  tilesPerSecond,
} from "./npc-motion-config";

test("기본값은 단테 결정 그대로다 — 호출·회의 호출은 평소 걸음의 2배", () => {
  assert.equal(DEFAULT_NPC_MOTION.summon, DEFAULT_NPC_MOTION.walk * 2);
  assert.equal(DEFAULT_NPC_MOTION.meetingSummon, DEFAULT_NPC_MOTION.walk * 2);
  assert.equal(DEFAULT_NPC_MOTION.walk, 150, "지금까지의 일반 이동 속도를 바꾸지 않는다");
  assert.equal(DEFAULT_NPC_MOTION.stroll, 55, "지금까지의 산책 속도를 바꾸지 않는다");
});

test("기본값에서 호출은 뛰고 평소 걸음은 걷는다", () => {
  assert.ok(DEFAULT_NPC_MOTION.summon >= RUN_SPEED_THRESHOLD);
  assert.ok(DEFAULT_NPC_MOTION.meetingSummon >= RUN_SPEED_THRESHOLD);
  assert.ok(DEFAULT_NPC_MOTION.walk < RUN_SPEED_THRESHOLD);
  assert.ok(DEFAULT_NPC_MOTION.stroll < RUN_SPEED_THRESHOLD);
});

test("비었거나 틀린 값은 항목별로 기본값에 떨어지고, 범위 밖은 자른다", () => {
  assert.deepEqual(normalizeNpcMotionConfig(null), DEFAULT_NPC_MOTION);
  assert.deepEqual(normalizeNpcMotionConfig("x"), DEFAULT_NPC_MOTION);
  const got = normalizeNpcMotionConfig({
    walk: 9999,
    stroll: -3,
    summon: "fast",
    meetingSummon: 212,
    extra: 1,
  });
  assert.equal(got.walk, 480);
  assert.equal(got.stroll, 20);
  assert.equal(got.summon, DEFAULT_NPC_MOTION.summon);
  assert.equal(got.meetingSummon, 210, "5 단위로 맞춘다");
  assert.equal("extra" in got, false, "모르는 키는 버린다");
});

test("칸/초 표시", () => {
  assert.equal(tilesPerSecond(150), 4.7);
  assert.equal(tilesPerSecond(300), 9.4);
});
