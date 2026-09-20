import "../../test-setup/dom";

import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n/context";

import MeetingOutcomeSection from "./MeetingOutcomeSection";

const outcome = {
  decisions: ["A안 채택"],
  followUps: [
    {
      title: "조사",
      summary: null,
      acceptance: null,
      assigneeNpcId: "npc-1",
      assigneeName: "소피",
      after: [],
    },
  ],
  project: { recommended: true, name: "가격 개편", reason: null },
};

type Call = { url: string; method: string; body: unknown };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(routes: Record<string, () => { status: number; body: unknown }>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const route = routes[`${method} ${url}`];
    assert.ok(route, `예상하지 않은 요청: ${method} ${url}`);
    const { status, body } = route();
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

async function mount(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () =>
    root.render(
      <I18nProvider initialLocale="ko">
        <MeetingOutcomeSection minutesId="m1" npcs={[{ id: "npc-1", name: "소피" }]} />
      </I18nProvider>,
    ),
  );
  await act(async () => {});
  return el;
}

test("권한과 등록 여부는 회의록 조회가 돌려준 값을 쓴다", async () => {
  stubFetch({
    "GET /api/meetings/m1": () => ({
      status: 200,
      body: { minutes: { outcome, summaryStatus: "ok" }, canManage: false },
    }),
  });
  const el = await mount();
  assert.equal(el.querySelectorAll("[data-outcome-item]").length, 1);
  assert.equal(el.querySelector("[data-outcome-register]"), null);
});

test("등록이 성공하면 버튼이 결과로 바뀐다", async () => {
  const calls = stubFetch({
    "GET /api/meetings/m1": () => ({
      status: 200,
      body: { minutes: { outcome, summaryStatus: "ok" }, canManage: true },
    }),
    "POST /api/meetings/m1/register": () => ({
      status: 200,
      body: {
        registered: { boardSlug: "b", tenant: "가격-개편", taskIds: ["t1"], by: "u", at: "now" },
      },
    }),
  });
  const el = await mount();
  await act(async () => (el.querySelector("[data-outcome-register]") as HTMLElement).click());
  await act(async () => {});
  assert.deepEqual(calls[1].body, {
    tenant: { slug: "가격-개편", name: "가격 개편" },
    items: [{ index: 0, title: "조사", npcId: "npc-1", after: [] }],
  });
  assert.ok(el.querySelector("[data-outcome-registered]"));
  assert.equal(el.querySelector("[data-outcome-register]"), null);
});

test("등록이 거절되면 등록된 코드의 문구를 보이고 버튼을 남긴다", async () => {
  stubFetch({
    "GET /api/meetings/m1": () => ({
      status: 200,
      body: { minutes: { outcome, summaryStatus: "ok" }, canManage: true },
    }),
    "POST /api/meetings/m1/register": () => ({
      status: 409,
      body: { errorCode: "already_registered" },
    }),
  });
  const el = await mount();
  await act(async () => (el.querySelector("[data-outcome-register]") as HTMLElement).click());
  await act(async () => {});
  assert.match(el.querySelector("[data-outcome-error]")?.textContent ?? "", /이미 등록된 회의/);
  assert.ok(el.querySelector("[data-outcome-register]"));
});

test("실패한 요약을 다시 시키면 새 결과로 패널이 바뀐다", async () => {
  stubFetch({
    "GET /api/meetings/m1": () => ({
      status: 200,
      body: { minutes: { outcome: null, summaryStatus: "failed" }, canManage: true },
    }),
    "POST /api/meetings/m1/summarize": () => ({
      status: 200,
      body: { summaryStatus: "ok", keyTopics: ["a"], conclusions: "b", outcome },
    }),
  });
  const el = await mount();
  await act(async () => (el.querySelector("[data-outcome-retry]") as HTMLElement).click());
  await act(async () => {});
  assert.equal(el.querySelector("[data-outcome-retry]"), null);
  assert.equal(el.querySelectorAll("[data-outcome-item]").length, 1);
});
