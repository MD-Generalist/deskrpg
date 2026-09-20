import "../../test-setup/dom";
import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n/context";
import type { KanbanTimelineRun } from "@/lib/hermes/deskrpg-plugin-types";
import { computeOperationalMetrics, MIN_RATE_SAMPLES } from "@/lib/kanban-metrics";

import KanbanMetricsPanel from "./KanbanMetricsPanel";

// `I18nProvider` 의 기본 로케일은 영어다.

const WIN = { fromMs: 1_000_000, toMs: 2_000_000 };

let seq = 0;
function run(over: Partial<KanbanTimelineRun> = {}): KanbanTimelineRun {
  seq += 1;
  return {
    id: `r${seq}`,
    status: "done",
    task_id: `t${seq}`,
    board: "default",
    started_at: 1_100,
    ended_at: 1_110,
    outcome: "completed",
    ...over,
  } as KanbanTimelineRun;
}

async function mount(
  runs: KanbanTimelineRun[],
  cards: { id: string; status: string }[] = [],
  pending: ReadonlySet<string> = new Set(),
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const metrics = computeOperationalMetrics(runs, cards, pending, WIN);
  await act(async () => {
    root.render(
      <I18nProvider>
        <KanbanMetricsPanel metrics={metrics} />
      </I18nProvider>,
    );
  });
  return host;
}

test("표본이 문턱 미만이면 비율 대신 건수를 보인다", async () => {
  // 2건 중 1건을 "50%" 로 쓰면 없는 경향을 읽게 된다.
  const host = await mount([run({ outcome: "completed" }), run({ outcome: "crashed" })]);
  assert.ok(host.textContent?.includes("1 of 2"));
  assert.equal(host.textContent?.includes("50%"), false);
});

test("표본이 충분하면 비율을 수치로 보인다", async () => {
  const runs = Array.from({ length: MIN_RATE_SAMPLES }, () => run({ outcome: "completed" }));
  const host = await mount(runs);
  assert.ok(host.textContent?.includes("100%"));
});

test("끝난 실행이 없으면 성공률은 자료 없음이다 — 0% 가 아니다", async () => {
  const host = await mount([run({ ended_at: undefined, outcome: undefined })]);
  assert.ok(host.textContent?.includes("No data"));
  assert.equal(host.textContent?.includes("0%"), false);
});

test("중앙값에 표본 수가 늘 붙는다", async () => {
  const host = await mount([run()]);
  assert.ok(host.textContent?.includes("1 samples"), "표본 수 없이 중앙값만 보이면 추세로 읽힌다");
});

test("손이 필요한 카드가 있으면 종류별로 밝히고 강조한다", async () => {
  const cards = [
    { id: "a", status: "review" },
    { id: "b", status: "blocked" },
    { id: "c", status: "blocked" },
  ];
  const host = await mount([], cards, new Set(["b"]));
  const text = host.textContent ?? "";
  assert.ok(text.includes("awaiting approval"));
  assert.ok(text.includes("in review"));
  assert.ok(text.includes("blocked"));
  // 지금 행동을 부르는 칸이라 눈에 띄어야 한다.
  assert.ok(host.querySelector(".border-danger"), "강조 표시가 없다");
});

test("손이 필요한 카드가 없으면 강조하지 않는다", async () => {
  const host = await mount([run()], [{ id: "a", status: "running" }]);
  assert.equal(host.querySelector(".border-danger"), null);
});

test("결과 분포를 종류별로 나열한다", async () => {
  const host = await mount([
    run({ outcome: "crashed" }),
    run({ outcome: "gave_up" }),
    run({ outcome: "completed" }),
  ]);
  const text = host.textContent ?? "";
  for (const outcome of ["crashed", "gave_up", "completed"]) {
    assert.ok(text.includes(outcome), `${outcome} 이 분포에 없다`);
  }
});

test("진행 중 실행이 없으면 그 칸을 두지 않는다", async () => {
  const host = await mount([run()]);
  assert.equal(host.textContent?.includes("Still running"), false);
});
