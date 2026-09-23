import test from "node:test";
import assert from "node:assert/strict";

import { SkillsApiError, createSkillsApi } from "./skills-api";

type FetchCall = { url: string; init?: RequestInit };

function fakeFetch(reply: { status: number; json?: unknown }) {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(reply.json ?? {}), { status: reply.status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

test("list 는 catch-all 의 빈 경로(…/skills/)를 GET 한다", async () => {
  const { calls, fetchImpl } = fakeFetch({
    status: 200,
    json: { skills: [], canManage: false, capabilityReady: true, sharedChannelCount: 0 },
  });
  await createSkillsApi("ch-1", "n-1", fetchImpl).list();
  assert.equal(calls[0].url, "/api/channels/ch-1/npcs/n-1/skills/");
  assert.equal(calls[0].init?.method, "GET");
});

test("스킬 이름은 한 세그먼트로 인코딩한다 — a/b → a%2Fb", async () => {
  const { calls, fetchImpl } = fakeFetch({ status: 200, json: { skill: {}, files: [] } });
  await createSkillsApi("ch-1", "n-1", fetchImpl).detail("a/b");
  assert.equal(calls[0].url, "/api/channels/ch-1/npcs/n-1/skills/a%2Fb");
});

test("409 skill_changed 는 SkillsApiError 로 코드를 그대로 던진다", async () => {
  const { fetchImpl } = fakeFetch({
    status: 409,
    json: { code: "skill_changed", message: "바뀜" },
  });
  await assert.rejects(
    createSkillsApi("ch-1", "n-1", fetchImpl).writeFile("weekly", "SKILL.md", "x", "h1"),
    (e: unknown) => e instanceof SkillsApiError && e.status === 409 && e.code === "skill_changed",
  );
});
