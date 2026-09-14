import { streamDiagnostic } from "@/lib/hermes/stream-diagnostics";
import type { ChatResponse } from "@/lib/chat-response";

const terminal = (status: ChatResponse["status"]) =>
  status === "complete" || status === "failed" || status === "cancelled";

/** Bounded recent receipts plus all active responses. Snapshots never expose mutable records. */
export class ChatResponseTracker {
  private readonly responses = new Map<string, ChatResponse>();
  private readonly controllers = new Map<string, AbortController>();
  constructor(
    private readonly emit: (response: ChatResponse) => void,
    private readonly historyLimit = 100,
  ) {}

  accept(input: Pick<ChatResponse, "requestId" | "sourceMessageId" | "npcId" | "npcName">): void {
    if (this.responses.has(input.requestId)) return;
    const response: ChatResponse = {
      ...input,
      status: "queued",
      content: "",
      updatedAt: Date.now(),
    };
    this.controllers.set(response.requestId, new AbortController());
    this.responses.set(response.requestId, response);
    streamDiagnostic({
      stage: "response-emit",
      requestId: response.requestId,
      event: response.status,
      length: response.content.length,
    });
    this.emit({ ...response });
  }

  update(
    requestId: string,
    patch: Partial<Pick<ChatResponse, "status" | "content" | "messageId" | "error">>,
  ): void {
    const previous = this.responses.get(requestId);
    if (!previous || terminal(previous.status)) return;
    const response = {
      ...previous,
      ...patch,
      updatedAt: Math.max(Date.now(), previous.updatedAt + 1),
    };
    this.responses.set(requestId, response);
    if (response.status === "cancelled") this.controllers.get(requestId)?.abort();
    streamDiagnostic({
      stage: "response-emit",
      requestId: response.requestId,
      event: response.status,
      length: response.content.length,
    });
    this.emit({ ...response });
    const completed = [...this.responses.values()].filter((r) => terminal(r.status));
    for (const old of completed.slice(0, Math.max(0, completed.length - this.historyLimit))) {
      this.responses.delete(old.requestId);
      this.controllers.delete(old.requestId);
    }
  }

  signal(requestId: string): AbortSignal | undefined {
    return this.controllers.get(requestId)?.signal;
  }
  isActive(requestId: string): boolean {
    const response = this.responses.get(requestId);
    return !!response && !terminal(response.status);
  }

  snapshot(): ChatResponse[] {
    return [...this.responses.values()].map((r) => ({ ...r }));
  }
  cancelAll(): void {
    for (const r of this.responses.values()) this.update(r.requestId, { status: "cancelled" });
  }
}

export { SessionQueue } from "@/lib/conversation/request-queue";
