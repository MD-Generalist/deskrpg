import assert from "node:assert/strict";
import test from "node:test";

import { createSseParser, type SseEvent } from "../../src/lib/hermes/sse";
import { startMockHermes } from "./mock-hermes";

const headers = {
  Authorization: "Bearer readme-capture-sophie-token",
  "Content-Type": "application/json",
};

async function startServer(t: test.TestContext) {
  const server = await startMockHermes({ host: "127.0.0.1", port: 0 });
  t.after(() => server.close());
  return server;
}

async function createSession(baseUrl: string, title: string) {
  const response = await fetch(`${baseUrl}/p/sophie/api/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title }),
  });
  assert.equal(response.status, 200);
  return response.json() as Promise<{ session: { id: string } }>;
}

async function startRun(baseUrl: string, profile: "sophie" | "noah") {
  const response = await fetch(`${baseUrl}/p/${profile}/v1/runs`, {
    method: "POST",
    headers: {
      ...headers,
      Authorization: `Bearer readme-capture-${profile}-token`,
    },
    body: JSON.stringify({ input: "회의 발언을 준비해 주세요" }),
  });
  assert.equal(response.status, 202);
  return response.json() as Promise<{ run_id: string }>;
}

async function streamEvents(baseUrl: string, profile: "sophie" | "noah", runId: string) {
  const stream = await fetch(`${baseUrl}/p/${profile}/v1/runs/${runId}/events`, {
    headers: {
      ...headers,
      Authorization: `Bearer readme-capture-${profile}-token`,
    },
  }).then((response) => response.text());
  return createSseParser().push(stream);
}

test("serves profile capabilities and deterministic session chat SSE", { timeout: 5_000 }, async (t) => {
  const server = await startServer(t);
  const caps = await fetch(`${server.baseUrl}/p/sophie/v1/capabilities`, { headers });
  assert.equal(caps.status, 200);

  const session = await createSession(server.baseUrl, "readme");
  const stream = await fetch(
    `${server.baseUrl}/p/sophie/api/sessions/${session.session.id}/chat/stream`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ message: "좋은 아침이에요" }),
    },
  ).then((response) => response.text());
  const events = createSseParser().push(stream);

  assert.ok(events.some((event) => event.event === "assistant.delta"));
  assert.equal(events.at(-1)?.event, "run.completed");
  assert.deepEqual(
    events.filter((event) => event.event === "assistant.delta").map((event) => event.data.delta),
    ["좋은 ", "아침이에요. ", "오늘 일정부터 함께 확인할게요."],
  );
});

test("rejects requests without a bearer fixed capture token", async (t) => {
  const server = await startServer(t);
  const missing = await fetch(`${server.baseUrl}/p/sophie/v1/capabilities`);
  const malformed = await fetch(`${server.baseUrl}/p/sophie/v1/capabilities`, {
    headers: { Authorization: "NotAuthreadme-capture-sophie-token" },
  });

  assert.equal(missing.status, 401);
  assert.equal(malformed.status, 401);
});

test("creates unique nested session ids", async (t) => {
  const server = await startServer(t);
  const first = await createSession(server.baseUrl, "first");
  const second = await createSession(server.baseUrl, "second");

  assert.match(first.session.id, /^session-/);
  assert.match(second.session.id, /^session-/);
  assert.notEqual(first.session.id, second.session.id);
});

test("rejects inherited object keys as unknown profiles", async (t) => {
  const server = await startServer(t);
  const response = await fetch(`${server.baseUrl}/p/toString/v1/capabilities`, { headers });
  assert.equal(response.status, 404);
});

test("streams deterministic profile meeting lines with the run SSE dialect", { timeout: 10_000 }, async (t) => {
  const server = await startServer(t);
  const firstSophieRun = await startRun(server.baseUrl, "sophie");
  const secondSophieRun = await startRun(server.baseUrl, "sophie");
  const noahRun = await startRun(server.baseUrl, "noah");

  assert.match(firstSophieRun.run_id, /^run-/);
  assert.notEqual(firstSophieRun.run_id, secondSophieRun.run_id);

  const [firstSophieEvents, secondSophieEvents, noahEvents] = await Promise.all([
    streamEvents(server.baseUrl, "sophie", firstSophieRun.run_id),
    streamEvents(server.baseUrl, "sophie", secondSophieRun.run_id),
    streamEvents(server.baseUrl, "noah", noahRun.run_id),
  ]);
  const text = (events: SseEvent[]) =>
    events
      .filter((event) => event.event === "message.delta")
      .map((event) => event.data.delta)
      .join("");

  assert.equal(text(firstSophieEvents), "SPEAK: 오전에는 릴리스 점검부터 진행하겠습니다.");
  assert.equal(text(secondSophieEvents), "SPEAK: 오전에는 릴리스 점검부터 진행하겠습니다.");
  assert.equal(text(noahEvents), "SPEAK: 저는 사용자 피드백을 정리해 공유하겠습니다.");
  assert.equal(firstSophieEvents.at(-1)?.event, "run.completed");
});

test("rejects non-loopback listen hosts", async () => {
  await assert.rejects(() => startMockHermes({ host: "0.0.0.0", port: 0 }), /loopback/i);
});
