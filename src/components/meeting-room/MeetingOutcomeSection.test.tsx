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

function stubFetch(given: Record<string, () => { status: number; body: unknown }>): Call[] {
  const routes: typeof given = {
    "GET /api/channels/c1/automation/status": () => ({
      status: 200,
      body: { capabilities: ["kanban", "initial_status"] },
    }),
    ...given,
  };
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

async function mount(
  extra: Partial<React.ComponentProps<typeof MeetingOutcomeSection>> = {},
): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () =>
    root.render(
      <I18nProvider initialLocale="ko">
        <MeetingOutcomeSection
          minutesId="m1"
          channelId="c1"
          npcs={[{ id: "npc-1", name: "소피" }]}
          {...extra}
        />
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
  const posted = calls.find((call) => call.method === "POST");
  assert.deepEqual(posted?.body, {
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

test("칸반 관문이 {code} 모양으로 거절해도 HTTP 상태가 아니라 그 코드를 읽는다", async () => {
  stubFetch({
    "GET /api/meetings/m1": () => ({
      status: 200,
      body: { minutes: { outcome, summaryStatus: "ok" }, canManage: true },
    }),
    "POST /api/meetings/m1/register": () => ({
      status: 409,
      body: { code: "gateway_not_bound", message: "no gateway" },
    }),
  });
  const el = await mount();
  await act(async () => (el.querySelector("[data-outcome-register]") as HTMLElement).click());
  await act(async () => {});
  const shown = el.querySelector("[data-outcome-error]")?.textContent ?? "";
  assert.ok(shown.length > 0, "오류가 보여야 한다");
  assert.ok(!/HTTP 409/.test(shown), `상태 코드가 아니라 사유를 보여야 한다: ${shown}`);
  assert.ok(Boolean(el.querySelector("[data-outcome-register]")), "버튼은 남는다");
});

test("플러그인이 initial_status 를 광고하지 않으면 등록 버튼을 그리지 않는다", async () => {
  stubFetch({
    "GET /api/meetings/m1": () => ({
      status: 200,
      body: { minutes: { outcome, summaryStatus: "ok" }, canManage: true },
    }),
    "GET /api/channels/c1/automation/status": () => ({
      status: 200,
      body: { capabilities: ["kanban", "swarm"] },
    }),
  });
  const el = await mount();
  assert.equal(el.querySelector("[data-outcome-register]"), null);
  assert.ok(Boolean(el.querySelector("[data-outcome-upgrade]")), "갱신 안내가 보여야 한다");
});

test("자동화 상태를 못 읽으면 못 하는 것으로 본다 — 실패하는 버튼을 그리지 않는다", async () => {
  stubFetch({
    "GET /api/meetings/m1": () => ({
      status: 200,
      body: { minutes: { outcome, summaryStatus: "ok" }, canManage: true },
    }),
    "GET /api/channels/c1/automation/status": () => ({
      status: 409,
      body: { code: "gateway_not_bound" },
    }),
  });
  const el = await mount();
  assert.equal(el.querySelector("[data-outcome-register]"), null);
});

test("종료 화면은 등록할 후속 업무가 남았는지 듣고, '등록하지 않음' 을 누를 수 있다", async () => {
  stubFetch({
    "GET /api/meetings/m1": () => ({
      status: 200,
      body: { minutes: { outcome, summaryStatus: "ok" }, canManage: true },
    }),
  });
  const loaded: boolean[] = [];
  let declined = 0;
  const el = await mount({
    onOutcomeLoaded: (pending) => loaded.push(pending),
    onDeclined: () => declined++,
  });
  assert.deepEqual(loaded, [true]);
  await act(async () => (el.querySelector("[data-outcome-decline]") as HTMLElement).click());
  assert.equal(declined, 1);
});

test("후속 업무가 없거나 등록 권한이 없으면 남은 일이 없다고 알린다", async () => {
  for (const [body, why] of [
    [{ minutes: { outcome: { ...outcome, followUps: [] } }, canManage: true }, "0건"],
    [{ minutes: { outcome }, canManage: false }, "권한 없음"],
    [
      { minutes: { outcome: { ...outcome, registered: { taskIds: ["t"] } } }, canManage: true },
      "이미 등록",
    ],
  ] as const) {
    stubFetch({ "GET /api/meetings/m1": () => ({ status: 200, body }) });
    const loaded: boolean[] = [];
    await mount({ onOutcomeLoaded: (pending) => loaded.push(pending) });
    assert.deepEqual(loaded, [false], why);
  }
});

test("회의록 보관함처럼 콜백을 넘기지 않으면 '등록하지 않음' 버튼이 없다", async () => {
  stubFetch({
    "GET /api/meetings/m1": () => ({
      status: 200,
      body: { minutes: { outcome, summaryStatus: "ok" }, canManage: true },
    }),
  });
  const el = await mount();
  assert.ok(el.querySelector("[data-outcome-register]"));
  assert.equal(el.querySelector("[data-outcome-decline]"), null);
});
