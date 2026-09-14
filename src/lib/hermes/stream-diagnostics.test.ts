import { test } from "node:test";
import assert from "node:assert/strict";
import { HermesClient } from "./hermes-client";
import { ChatResponseTracker } from "../../server/chat-response-tracker";
import { streamDiagnostic, withStreamDiagnosticRequest } from "./stream-diagnostics";

test("opt-in diagnostics correlate live SSE and response emits without content or credentials", async (t) => {
  const env: Record<string, string | undefined> = process.env;
  const originalNodeEnv = env.NODE_ENV;
  const originalOptIn = env.DESKRPG_STREAM_DIAGNOSTICS;
  t.after(() => {
    for (const [key, value] of [
      ["NODE_ENV", originalNodeEnv],
      ["DESKRPG_STREAM_DIAGNOSTICS", originalOptIn],
    ]) {
      if (value === undefined) delete env[key!];
      else env[key!] = value;
    }
  });
  env.NODE_ENV = "development";
  env.DESKRPG_STREAM_DIAGNOSTICS = "1";
  const logs: string[] = [];
  t.mock.method(console, "info", (...args: unknown[]) => logs.push(args.join(" ")));
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const tracker = new ChatResponseTracker(() => {});
  tracker.accept({
    requestId: "request-test",
    sourceMessageId: "source",
    npcId: "npc",
    npcName: "PRIVATE-NAME",
  });
  const client = new HermesClient({
    baseUrl: "http://unused",
    profileName: null,
    token: "PRIVATE-TOKEN",
    fetchImpl: async () => new Response(body),
  });
  let first!: () => void;
  const firstSeen = new Promise<void>((resolve) => {
    first = resolve;
  });
  const run = withStreamDiagnosticRequest("request-test", () =>
    client.streamRunEvents("run-test", (event) => {
      if (event.event === "message.delta") {
        tracker.update("request-test", {
          status: "streaming",
          content: event.data.delta as string,
        });
        first();
      }
    }),
  );
  const encode = (event: string, data: object) =>
    new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  controller.enqueue(encode("message.delta", { run_id: "run-test", delta: "PRIVATE-BODY" }));
  await firstSeen;
  // This assertion runs while the stream is still open, before its terminal frame.
  assert.ok(logs.some((line) => line.includes('"stage":"sse-read"')));
  assert.ok(
    logs.some(
      (line) => line.includes('"stage":"sse-event"') && line.includes('"runId":"run-test"'),
    ),
  );
  assert.ok(
    logs.some((line) => line.includes('"stage":"response-emit"') && line.includes('"length":12')),
  );
  assert.ok(logs.every((line) => line.includes('"requestId":"request-test"')));
  controller.enqueue(encode("run.completed", { run_id: "run-test" }));
  await run;
  assert.ok(!logs.join("\n").includes("PRIVATE-"));
  const count = logs.length;
  env.NODE_ENV = "production";
  streamDiagnostic({ stage: "sse-read", bytes: 10 });
  env.NODE_ENV = "development";
  env.DESKRPG_STREAM_DIAGNOSTICS = "0";
  streamDiagnostic({ stage: "sse-read", bytes: 10 });
  assert.equal(logs.length, count);
});
