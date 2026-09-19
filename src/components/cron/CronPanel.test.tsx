import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n";
import CronPanel, { type CronEventSource } from "./CronPanel";
import type { CronJobView } from "./cron-api";

const NPCS = [
  { npcId: "npc-a", npcName: "소피" },
  { npcId: "npc-b", npcName: "제인" },
];

function job(overrides: Partial<CronJobView> & { id: string; npcId: string }): CronJobView {
  const npc = NPCS.find((n) => n.npcId === overrides.npcId)!;
  return {
    name: `job ${overrides.id}`,
    prompt: "do the thing",
    schedule: { kind: "cron", expr: "0 9 * * *" },
    schedule_display: "0 9 * * *",
    repeat: true,
    enabled: true,
    state: "scheduled",
    next_run_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    last_run_at: null,
    last_status: null,
    last_error: null,
    deliver: "local",
    skills: [],
    model: null,
    provider: null,
    created_at: "2026-09-14T00:00:00Z",
    npcName: npc.npcName,
    origin: { channelId: "ch1", createdByUserId: "u1" },
    editable: true,
    ...overrides,
  };
}

type Call = { url: string; method: string };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** URL 별 응답을 정하는 가짜 fetch. 호출 기록을 남긴다. */
function router(routes: (url: string, method: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const handler = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    return routes(url, method);
  }) as typeof fetch;
  return { calls, handler };
}

class FakeSocket implements CronEventSource {
  handlers = new Map<string, Set<(payload: unknown) => void>>();
  on(event: string, handler: (payload: unknown) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return this;
  }
  off(event: string, handler: (payload: unknown) => void) {
    this.handlers.get(event)?.delete(handler);
    return this;
  }
  emit(event: string, payload: unknown) {
    for (const h of this.handlers.get(event) ?? []) h(payload);
  }
}

async function mount(
  node: React.ReactElement,
  fetchImpl: typeof fetch,
): Promise<{ host: HTMLElement; cleanup: () => Promise<void> }> {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<I18nProvider initialLocale="ko">{node}</I18nProvider>);
  });
  // 첫 조회의 fetch 가 끝나도록 한 틱 더 돈다.
  await act(async () => {
    await Promise.resolve();
  });
  return {
    host,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
      globalThis.fetch = original;
    },
  };
}

const byTestId = (host: HTMLElement, id: string) =>
  host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const allByTestId = (host: HTMLElement, id: string) =>
  Array.from(host.querySelectorAll(`[data-testid="${id}"]`)) as HTMLElement[];

async function click(node: Element | null) {
  assert.ok(node, "클릭할 요소가 없다");
  await act(async () => {
    (node as HTMLElement).click();
  });
}

test("시간대 라벨 — 응답 timezone 이 있으면 '기준', 없으면 미확인 (R18/E9)", async () => {
  const withTz = router(() => json(200, { jobs: [], timezone: "Asia/Seoul" }));
  const a = await mount(<CronPanel channelId="ch1" npcs={NPCS} />, withTz.handler);
  assert.equal(byTestId(a.host, "cron-tz")?.textContent, "Asia/Seoul 기준");
  await a.cleanup();

  const noTz = router(() => json(200, { jobs: [], timezone: null }));
  const b = await mount(<CronPanel channelId="ch1" npcs={NPCS} />, noTz.handler);
  assert.equal(byTestId(b.host, "cron-tz")?.textContent, "게이트웨이 시간대 미확인");
  await b.cleanup();
});

test("목록 행 — 상태 점·이름·주기·NPC 이름·카운트다운, NPC 필터와 검색 (R15)", async () => {
  const jobs = [
    job({ id: "j1", npcId: "npc-a", name: "아침 브리핑" }),
    job({ id: "j2", npcId: "npc-b", name: "주간 리포트", state: "paused", prompt: "weekly" }),
  ];
  const r = router(() => json(200, { jobs, timezone: "Asia/Seoul" }));
  const { host, cleanup } = await mount(<CronPanel channelId="ch1" npcs={NPCS} />, r.handler);
  try {
    let rows = allByTestId(host, "cron-row");
    assert.equal(rows.length, 2);
    assert.match(rows[0].textContent ?? "", /아침 브리핑/);
    assert.match(rows[0].textContent ?? "", /소피/);
    assert.match(rows[0].textContent ?? "", /0 9 \* \* \*/);
    assert.equal(byTestId(rows[0], "cron-state-dot")?.dataset.state, "scheduled");
    assert.ok(byTestId(rows[0], "cron-state-dot")?.className.includes("bg-emerald-400"));
    // 5분 뒤 → 상대 시간 카운트다운
    assert.match(byTestId(rows[0], "cron-countdown")?.textContent ?? "", /5분/);
    // 멈춘 작업은 카운트다운 대신 상태 문구
    assert.equal(byTestId(rows[1], "cron-countdown")?.textContent, "멈춤");
    assert.equal(byTestId(rows[1], "cron-state-dot")?.dataset.state, "paused");

    // NPC 필터
    const filter = byTestId(host, "cron-filter-npc") as HTMLSelectElement;
    await act(async () => {
      filter.value = "npc-b";
      filter.dispatchEvent(new Event("change", { bubbles: true }));
    });
    rows = allByTestId(host, "cron-row");
    assert.equal(rows.length, 1);
    assert.match(rows[0].textContent ?? "", /주간 리포트/);

    // 검색(프롬프트도 본다)
    await act(async () => {
      filter.value = "";
      filter.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const search = byTestId(host, "cron-search") as HTMLInputElement;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(search, "weekly");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    rows = allByTestId(host, "cron-row");
    assert.equal(rows.length, 1);
    assert.match(rows[0].textContent ?? "", /주간 리포트/);

    // 목록 조회는 필터에 상관없이 채널 라우트 한 번
    assert.deepEqual(
      r.calls.map((c) => c.url),
      ["/api/channels/ch1/cron/jobs"],
    );
  } finally {
    await cleanup();
  }
});

test("단일 NPC 모드 — npcId 로 조회하고 NPC 필터가 없다", async () => {
  const r = router(() => json(200, { jobs: [job({ id: "j1", npcId: "npc-a" })], timezone: null }));
  const { host, cleanup } = await mount(
    <CronPanel channelId="ch1" npcs={NPCS} npc={NPCS[0]} />,
    r.handler,
  );
  try {
    assert.equal(r.calls[0].url, "/api/channels/ch1/cron/jobs?npcId=npc-a");
    assert.equal(byTestId(host, "cron-filter-npc"), null);
    assert.equal(allByTestId(host, "cron-row").length, 1);
  } finally {
    await cleanup();
  }
});

test("editable=false 면 조작 버튼이 전부 비활성이고 이유가 보인다 (R16)", async () => {
  const jobs = [
    job({
      id: "other",
      npcId: "npc-a",
      editable: false,
      origin: { channelId: "ch9", createdByUserId: null },
    }),
    job({ id: "ext", npcId: "npc-a", editable: false, origin: null }),
  ];
  const r = router(() => json(200, { jobs, timezone: "Asia/Seoul" }));
  const { host, cleanup } = await mount(<CronPanel channelId="ch1" npcs={NPCS} />, r.handler);
  try {
    await click(allByTestId(host, "cron-row")[0].querySelector("button"));
    for (const id of [
      "cron-action-edit",
      "cron-action-pause",
      "cron-action-run",
      "cron-action-delete",
    ]) {
      const btn = byTestId(host, id) as HTMLButtonElement;
      assert.equal(btn.disabled, true, id);
      assert.match(btn.title, /다른 오피스/);
    }
    assert.match(byTestId(host, "cron-readonly-reason")?.textContent ?? "", /다른 오피스에서 만든/);

    // 비활성 버튼을 눌러도 요청이 나가지 않는다.
    await click(byTestId(host, "cron-action-run"));
    assert.equal(r.calls.filter((c) => c.method === "POST").length, 0);

    await click(allByTestId(host, "cron-row")[1].querySelector("button"));
    assert.match(byTestId(host, "cron-readonly-reason")?.textContent ?? "", /DeskRPG 밖/);
  } finally {
    await cleanup();
  }
});

test("428 plugin_upgrade_required → 업데이트 안내와 설치 명령 (R31)", async () => {
  const r = router(() =>
    json(428, { code: "plugin_upgrade_required", message: "old", minVersion: "0.6.0" }),
  );
  const { host, cleanup } = await mount(<CronPanel channelId="ch1" npcs={NPCS} />, r.handler);
  try {
    const notice = byTestId(host, "cron-error-upgrade");
    assert.ok(notice);
    assert.match(notice.textContent ?? "", /플러그인 업데이트 필요/);
    assert.match(notice.textContent ?? "", /0\.6\.0/);
    assert.match(
      notice.textContent ?? "",
      /hermes plugins install https:\/\/github\.com\/dandacompany\/deskrpg-hermes-plugin && hermes plugins enable deskrpg/,
    );
    assert.equal(byTestId(host, "cron-error-gateway"), null);
  } finally {
    await cleanup();
  }
});

test("409 gateway_not_bound → 게이트웨이 연결 안내, 다른 오류는 코드·메시지 그대로 (R32)", async () => {
  const a = router(() => json(409, { code: "gateway_not_bound", message: "no gw" }));
  const first = await mount(<CronPanel channelId="ch1" npcs={NPCS} />, a.handler);
  assert.match(byTestId(first.host, "cron-error-gateway")?.textContent ?? "", /게이트웨이/);
  await first.cleanup();

  const b = router(() => json(502, { code: "unreachable", message: "boom boom" }));
  const second = await mount(<CronPanel channelId="ch1" npcs={NPCS} />, b.handler);
  assert.match(
    byTestId(second.host, "cron-error-other")?.textContent ?? "",
    /unreachable: boom boom/,
  );
  await second.cleanup();
});

test("지금 실행 — 202 를 받으면 토스트만, 재조회는 하지 않는다 (R19)", async () => {
  const jobs = [job({ id: "j1", npcId: "npc-a", name: "브리핑" })];
  const toasts: string[] = [];
  const r = router((url) => {
    if (url.endsWith("/run")) return json(202, { accepted: true });
    return json(200, { jobs, timezone: "Asia/Seoul" });
  });
  const { host, cleanup } = await mount(
    <CronPanel channelId="ch1" npcs={NPCS} onToast={(m) => toasts.push(m)} />,
    r.handler,
  );
  try {
    await click(allByTestId(host, "cron-row")[0].querySelector("button"));
    await click(byTestId(host, "cron-action-run"));
    assert.equal(toasts.length, 1);
    assert.match(toasts[0], /브리핑/);
    assert.deepEqual(
      r.calls.map((c) => `${c.method} ${c.url}`),
      ["GET /api/channels/ch1/cron/jobs", "POST /api/channels/ch1/cron/jobs/j1/run"],
    );
  } finally {
    await cleanup();
  }
});

test("멈춤은 성공 뒤 재조회하고, cron:event 소켓 사건도 재조회한다 (R26)", async () => {
  const jobs = [job({ id: "j1", npcId: "npc-a" })];
  const r = router((url) => {
    if (url.endsWith("/pause")) return json(200, { job: jobs[0] });
    return json(200, { jobs, timezone: "Asia/Seoul" });
  });
  const socket = new FakeSocket();
  const { host, cleanup } = await mount(
    <CronPanel channelId="ch1" npcs={NPCS} socket={socket} />,
    r.handler,
  );
  try {
    assert.equal(socket.handlers.get("cron:event")?.size, 1);
    await click(allByTestId(host, "cron-row")[0].querySelector("button"));
    await click(byTestId(host, "cron-action-pause"));
    assert.deepEqual(
      r.calls.map((c) => `${c.method} ${c.url}`),
      [
        "GET /api/channels/ch1/cron/jobs",
        "POST /api/channels/ch1/cron/jobs/j1/pause",
        "GET /api/channels/ch1/cron/jobs",
      ],
    );

    await act(async () => {
      socket.emit("cron:event", { channelId: "ch1", event: { kind: "cron.run.finished" } });
    });
    assert.equal(r.calls.filter((c) => c.method === "GET").length, 3);

    // 다른 채널의 사건은 무시한다.
    await act(async () => {
      socket.emit("cron:event", { channelId: "other", event: {} });
    });
    assert.equal(r.calls.filter((c) => c.method === "GET").length, 3);
  } finally {
    await cleanup();
  }
  assert.equal(socket.handlers.get("cron:event")?.size, 0, "언마운트 시 구독 해제");
});

test("실행 이력 탭은 /runs 를 부른다", async () => {
  const jobs = [job({ id: "j1", npcId: "npc-a" })];
  const r = router((url) => {
    if (url.includes("/runs"))
      return json(200, {
        runs: [
          {
            id: "r1",
            started_at: "2026-09-14T00:00:00Z",
            ended_at: null,
            status: "ok",
            summary: "잘 됐어요",
            result_text: "",
          },
        ],
        limit: 20,
      });
    return json(200, { jobs, timezone: "Asia/Seoul" });
  });
  const { host, cleanup } = await mount(<CronPanel channelId="ch1" npcs={NPCS} />, r.handler);
  try {
    await click(allByTestId(host, "cron-row")[0].querySelector("button"));
    await click(byTestId(host, "cron-tab-runs"));
    await act(async () => {
      await Promise.resolve();
    });
    assert.ok(
      r.calls.some((c) => c.url === "/api/channels/ch1/cron/jobs/j1/runs?npcId=npc-a&limit=20"),
    );
    const runs = allByTestId(host, "cron-run");
    assert.equal(runs.length, 1);
    assert.match(runs[0].textContent ?? "", /잘 됐어요/);
  } finally {
    await cleanup();
  }
});

test("일부 NPC 조회 실패(errors)는 목록을 살린 채 경고로 보인다", async () => {
  const r = router(() =>
    json(200, {
      jobs: [job({ id: "j1", npcId: "npc-a" })],
      timezone: "Asia/Seoul",
      errors: [{ npcId: "npc-b", code: "timeout", message: "slow" }],
    }),
  );
  const { host, cleanup } = await mount(<CronPanel channelId="ch1" npcs={NPCS} />, r.handler);
  try {
    assert.equal(allByTestId(host, "cron-row").length, 1);
    const partial = byTestId(host, "cron-partial-errors");
    assert.match(partial?.textContent ?? "", /1개 NPC/);
    assert.match(partial?.textContent ?? "", /제인 — timeout: slow/);
  } finally {
    await cleanup();
  }
});
