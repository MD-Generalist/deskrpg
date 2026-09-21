import test from "node:test";
import assert from "node:assert/strict";
import {
  clampFrameDelta,
  HIDDEN_MAX_CATCH_UP_MS,
  hiddenStepDeltas,
  MAX_FRAME_DELTA_MS,
  TickLoop,
} from "./tick-loop";

test("첫 프레임은 경과 0, 그 뒤는 실제 경과를 쓴다", () => {
  assert.equal(clampFrameDelta(1000, null), 0);
  assert.equal(clampFrameDelta(1016.7, 1000), 16.700000000000045);
});

test("가려진 탭에서 돌아온 긴 공백은 상한으로 잘린다", () => {
  assert.equal(clampFrameDelta(60_000, 1000), MAX_FRAME_DELTA_MS);
  assert.equal(clampFrameDelta(1300, 1000, 100), 100);
});

test("시계가 거꾸로 가도 음수 경과는 내지 않는다", () => {
  assert.equal(clampFrameDelta(900, 1000), 0);
});

test("가려진 틱은 긴 경과를 상한 크기 스텝으로 나눠 모두 반영한다", () => {
  assert.deepEqual(hiddenStepDeltas(2000, 1000), [200, 200, 200, 200, 200]);
  assert.deepEqual(hiddenStepDeltas(1250, 1000), [200, 50]);
  assert.deepEqual(hiddenStepDeltas(1000, null), [], "첫 틱은 경과가 없다");
});

test("오래 잠든 탭이 깨어나도 따라잡는 경과는 상한까지다", () => {
  const steps = hiddenStepDeltas(600_000, 0);
  assert.equal(
    steps.reduce((sum, d) => sum + d, 0),
    HIDDEN_MAX_CATCH_UP_MS,
  );
});

test("탭이 가려지면 rAF 대신 타이머로 틱을 이어 간다", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = {
    document: g.document,
    requestAnimationFrame: g.requestAnimationFrame,
    cancelAnimationFrame: g.cancelAnimationFrame,
    setInterval: g.setInterval,
    clearInterval: g.clearInterval,
    performance: g.performance,
  };
  let visibility = "visible";
  let listener: (() => void) | null = null;
  let frames = 0;
  const timer: { tick: (() => void) | null } = { tick: null };
  let clock = 0;
  g.document = {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (_: string, fn: () => void) => (listener = fn),
    removeEventListener: () => (listener = null),
  };
  g.requestAnimationFrame = () => ++frames;
  g.cancelAnimationFrame = () => {};
  g.setInterval = (fn: () => void) => ((timer.tick = fn), 1);
  g.clearInterval = () => (timer.tick = null);
  Object.defineProperty(globalThis, "performance", {
    value: { now: () => clock },
    configurable: true,
  });
  try {
    const deltas: number[] = [];
    const loop = new TickLoop((_now, delta) => deltas.push(delta));
    loop.start();
    assert.equal(frames, 1, "보이는 동안은 rAF");
    visibility = "hidden";
    listener!();
    assert.ok(timer.tick, "가려지면 타이머로 넘어간다");
    clock = 1000;
    timer.tick!(); // 첫 틱: 기준 시각만 잡는다
    clock = 2000; // 브라우저가 1초 간격으로 늦췄다
    timer.tick!();
    assert.equal(
      deltas.reduce((sum, d) => sum + d, 0),
      1000,
      "1초 간격이어도 1초를 모두 걷는다",
    );
    loop.stop();
    assert.equal(timer.tick, null);
    assert.equal(listener, null);
  } finally {
    Object.defineProperty(globalThis, "performance", {
      value: saved.performance,
      configurable: true,
    });
    for (const [k, v] of Object.entries(saved)) if (k !== "performance") g[k] = v;
  }
});
