import test from "node:test";
import assert from "node:assert/strict";
import { captureWhenReady } from "./ready-capture";

function deferred() {
  let resolve!: (loaded: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("thumbnail waits for its asset before capturing and disposes afterward", async () => {
  const asset = deferred();
  const events: string[] = [];
  const result = captureWhenReady(
    asset.promise,
    new AbortController().signal,
    () => {
      events.push("capture");
      return "new-model.png";
    },
    () => {
      events.push("dispose");
    },
  );
  await Promise.resolve();
  assert.deepEqual(events, []);
  asset.resolve(true);
  assert.equal(await result, "new-model.png");
  assert.deepEqual(events, ["capture", "dispose"]);
});

test("unmount releases pending model immediately and late completion never captures", async () => {
  const asset = deferred();
  const controller = new AbortController();
  let captures = 0;
  let disposals = 0;
  const result = captureWhenReady(
    asset.promise,
    controller.signal,
    () => ++captures,
    () => {
      disposals++;
    },
  );
  controller.abort();
  assert.equal(disposals, 1);
  asset.resolve(true);
  assert.equal(await result, undefined);
  assert.equal(captures, 0);
  assert.equal(disposals, 1);
});

test("failed assets never produce a cacheable fallback screenshot", async () => {
  let captures = 0;
  let disposals = 0;
  const result = await captureWhenReady(
    Promise.resolve(false),
    new AbortController().signal,
    () => ++captures,
    () => {
      disposals++;
    },
  );
  assert.equal(result, undefined);
  assert.equal(captures, 0);
  assert.equal(disposals, 1);
});
