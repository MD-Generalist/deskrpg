import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatResponseTracker, SessionQueue } from "./chat-response-tracker";

test("receipt precedes content; terminal requests ignore late chunks and snapshots are copied", () => {
  const emitted: string[] = [];
  const tracker = new ChatResponseTracker((r) => emitted.push(r.status));
  tracker.accept({ requestId: "r", sourceMessageId: "m", npcId: "n", npcName: "Sophie" });
  tracker.update("r", { status: "thinking" });
  tracker.update("r", { status: "streaming", content: "hello" });
  assert.deepEqual(emitted, ["queued", "thinking", "streaming"]);
  tracker.update("r", { status: "complete", content: "hello!", messageId: "saved" });
  tracker.update("r", { status: "streaming", content: "late" });
  const snapshot = tracker.snapshot();
  assert.equal(snapshot[0].content, "hello!");
  snapshot[0].content = "mutated";
  assert.equal(tracker.snapshot()[0].content, "hello!");
});

test("tracker retains active requests while bounding terminal history", () => {
  const tracker = new ChatResponseTracker(() => {}, 2);
  tracker.accept({ requestId: "active", sourceMessageId: "m", npcId: "n", npcName: "S" });
  for (let i = 0; i < 5; i++) {
    tracker.accept({ requestId: String(i), sourceMessageId: "m", npcId: "n", npcName: "S" });
    tracker.update(String(i), { status: "complete" });
  }
  assert.equal(tracker.snapshot().length, 3);
  assert.ok(tracker.snapshot().some((r) => r.requestId === "active"));
});

test("session queue serializes same session, allows independent sessions and survives errors", async () => {
  const queue = new SessionQueue(2);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const order: string[] = [];
  const a = queue.run("a", async () => {
    order.push("a1");
    await gate;
    throw new Error("failure");
  });
  const b = queue.run("a", async () => {
    order.push("a2");
  });
  await assert.rejects(
    queue.run("a", async () => {}),
    /queue_full/,
  );
  await queue.run("b", async () => {
    order.push("b");
  });
  assert.deepEqual(order, ["a1", "b"]);
  release();
  await assert.rejects(a, /failure/);
  await b;
  assert.deepEqual(order, ["a1", "b", "a2"]);
  assert.equal(queue.size("a"), 0);
});
