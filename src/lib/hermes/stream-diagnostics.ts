import { AsyncLocalStorage } from "node:async_hooks";

const context = new AsyncLocalStorage<string>();
export function withStreamDiagnosticRequest<T>(requestId: string, work: () => T): T {
  return context.run(requestId, work);
}

/** Explicit development opt-in. Never pass payloads, headers, prompts or credentials. */
export function streamDiagnostic(fields: {
  stage: "sse-read" | "sse-event" | "response-emit";
  requestId?: string;
  runId?: string | null;
  event?: string;
  bytes?: number;
  length?: number;
}) {
  if (process.env.NODE_ENV !== "development" || process.env.DESKRPG_STREAM_DIAGNOSTICS !== "1")
    return;
  // Construct an allowlist so even accidental runtime extra properties cannot leak.
  console.info(
    "[stream-diagnostic]",
    JSON.stringify({
      atMs: Date.now(),
      stage: fields.stage,
      requestId: fields.requestId ?? context.getStore(),
      runId: fields.runId ?? undefined,
      event: fields.event,
      bytes: fields.bytes,
      length: fields.length,
    }),
  );
}
