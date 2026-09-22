import assert from "node:assert/strict";
import { test } from "node:test";

test("채널 큐는 기다리는 폴링과 인계를 순서대로 실행하고 중첩 호출은 허용한다", async () => {
  const { withChannelAutomationLock: locked } = await import("./channel-automation-lock");
  const order: string[] = [];
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = locked("one", async () => {
    order.push("poll");
    await locked("one", async () => {
      order.push("nested");
    });
    await barrier;
    order.push("saved");
  });
  await new Promise((resolve) => setImmediate(resolve));
  const next = locked("one", async () => {
    order.push("handoff");
  });
  await locked("other", async () => {
    order.push("other");
  });
  assert.deepEqual(order, ["poll", "nested", "other"]);
  release();
  await Promise.all([first, next]);
  assert.deepEqual(order, ["poll", "nested", "other", "saved", "handoff"]);
});

test("해제된 비동기 컨텍스트는 다음 소유자의 잠금을 우회하지 않는다", async () => {
  const { withChannelAutomationLock: locked } = await import("./channel-automation-lock");
  let delayed!: Promise<void>;
  let trigger!: () => void;
  let release!: () => void;
  const order: string[] = [];
  const triggerPromise = new Promise<void>((resolve) => {
    trigger = resolve;
  });
  await locked("lease", async () => {
    delayed = triggerPromise.then(() =>
      locked("lease", async () => {
        order.push("delayed");
      }),
    );
  });
  const busy = locked("lease", async () => {
    order.push("busy");
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    order.push("released");
  });
  await new Promise((resolve) => setImmediate(resolve));
  trigger();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["busy"]);
  release();
  await Promise.all([busy, delayed]);
  assert.deepEqual(order, ["busy", "released", "delayed"]);
});
