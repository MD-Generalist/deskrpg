import test from "node:test";
import assert from "node:assert/strict";

import { HermesAdapter } from "./hermes-adapter";

// 두 전송 경로가 각각 올바른 **필드 이름**으로 시스템 지시를 싣는지 고정한다.
// 이름이 틀리면 Hermes 는 조용히 무시한다 — 실패가 실패로 보이지 않는 자리라
// 테스트가 유일한 방어선이다.

function fakeClient(capture: { body?: Record<string, unknown>; path?: string }) {
  return {
    async getCapabilities() {
      return { features: {} };
    },
    async startRun(args: Record<string, unknown>) {
      capture.path = "/v1/runs";
      capture.body = args;
      return { runId: "run-1" };
    },
    async streamRunEvents() {
      return { text: "ok" };
    },
    async createSession() {
      return { sessionId: "sess-1" };
    },
    async streamSessionChat(args: Record<string, unknown>) {
      capture.path = "/api/sessions/chat/stream";
      capture.body = args;
      return { text: "ok", runId: "run-1", sessionId: "sess-1" };
    },
  };
}

// 생성자를 거치지 않고 프로토타입만 빌려 온다 — 이 테스트가 보려는 것은 execute() 가
// 어떤 필드 이름으로 싣는지 하나뿐이고, 실제 클라이언트/설정은 필요 없다.
function adapterWith(client: unknown): HermesAdapter {
  const a = Object.create(HermesAdapter.prototype) as Record<string, unknown>;
  a.client = client;
  a.sessionId = null;
  a.lastRunId = null;
  return a as unknown as HermesAdapter;
}

test("회의 경로(runs)는 instructions 로 싣는다", async () => {
  const cap: { body?: Record<string, unknown> } = {};
  const a = adapterWith(fakeClient(cap));
  await a.execute({
    sessionKey: "k",
    prompt: "p",
    multiParty: true,
    instructions: "<team-instructions>\nMEET\n</team-instructions>",
  });
  assert.equal(cap.body?.instructions, "<team-instructions>\nMEET\n</team-instructions>");
});

test("1:1 경로(session chat)는 systemMessage 로 싣는다", async () => {
  const cap: { body?: Record<string, unknown> } = {};
  const a = adapterWith(fakeClient(cap));
  await a.execute({ sessionKey: "k", prompt: "p", instructions: "SYS" });
  assert.equal(cap.body?.systemMessage, "SYS");
});

test("지시가 없으면 두 경로 다 필드를 undefined 로 둔다", async () => {
  const runCap: { body?: Record<string, unknown> } = {};
  await adapterWith(fakeClient(runCap)).execute({
    sessionKey: "k",
    prompt: "p",
    multiParty: true,
  });
  assert.equal(runCap.body?.instructions, undefined);

  const chatCap: { body?: Record<string, unknown> } = {};
  await adapterWith(fakeClient(chatCap)).execute({ sessionKey: "k", prompt: "p" });
  assert.equal(chatCap.body?.systemMessage, undefined);
});
