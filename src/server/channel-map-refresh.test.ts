import test from "node:test";
import assert from "node:assert/strict";
import { createChannelMapRefresh } from "./channel-map-refresh";
test("exclusive refresh pauses before persistence and resets before notifying both clients", async () => {
  const events: string[] = [];
  let unblock!: () => void;
  const controller = createChannelMapRefresh({
    pause: async (id) => {
      events.push("pause " + id);
    },
    reset: async (id) => {
      events.push("reset " + id);
      await new Promise<void>((r) => {
        unblock = r;
      });
    },
    ready: (id) => {
      events.push("ready " + id);
    },
  });
  const lease = await controller.begin("a");
  assert.ok(lease);
  assert.equal(controller.isPaused("a"), true);
  assert.equal(await controller.begin("a"), null);
  await assert.rejects(controller.finish("a", "wrong"), /lease/);
  const finished = controller.finish("a", lease!);
  await Promise.resolve();
  assert.equal(controller.isPaused("a"), true);
  assert.deepEqual(events, ["pause a", "reset a"]);
  unblock();
  await finished;
  assert.deepEqual(events, ["pause a", "reset a", "ready a"]);
  assert.equal(controller.isPaused("a"), false);
});
test("failed reset stays paused so no stale movement resumes", async () => {
  const controller = createChannelMapRefresh({
    pause: async () => {},
    reset: async () => {
      throw Error("failed");
    },
    ready: () => {
      throw Error("must not publish");
    },
  });
  const lease = await controller.begin("a");
  await assert.rejects(controller.finish("a", lease!));
  assert.equal(controller.isPaused("a"), true);
});

test("generation detects a complete migration during an in-flight join", async () => {
  const refresh = createChannelMapRefresh({
    pause: async () => {},
    reset: async () => {},
    ready: () => {},
  });
  const before = refresh.generation("a");
  const lease = await refresh.begin("a");
  await refresh.finish("a", lease!);
  assert.notEqual(refresh.generation("a"), before);
  assert.equal(refresh.generation("other"), 0);
});

test("concurrent finishes share one reset and cannot release a subsequent lease", async () => {
  let release!: () => void;
  let resets = 0;
  let notifications = 0;
  const refresh = createChannelMapRefresh({
    pause: async () => {},
    reset: async () => {
      resets++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    ready: () => {
      notifications++;
    },
  });
  const lease = await refresh.begin("a");
  const first = refresh.finish("a", lease!);
  const second = refresh.finish("a", lease!);
  await Promise.resolve();
  assert.equal(resets, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(notifications, 1);
  const next = await refresh.begin("a");
  assert.ok(next);
  await assert.rejects(refresh.finish("a", lease!), /lease/);
  assert.equal(refresh.isPaused("a"), true);
});
