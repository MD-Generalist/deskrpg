import "../../test-setup/dom";
import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n/context";
import type { KanbanTimelineRun } from "@/lib/hermes/deskrpg-plugin-types";

import KanbanTimeline from "./KanbanTimeline";

// `I18nProvider` 의 기본 로케일은 영어다 — 문구 단언은 en 값을 쓴다.

const FROM = Date.parse("2026-09-21T00:00:00.000Z");
const TO = Date.parse("2026-09-21T12:00:00.000Z");
const NOW = Date.parse("2026-09-21T10:00:00.000Z");

let seq = 0;
function run(over: Partial<KanbanTimelineRun> = {}): KanbanTimelineRun {
  seq += 1;
  return {
    id: `r${seq}`,
    status: "done",
    task_id: `t${seq}`,
    board: "default",
    profile: "sophie",
    task_title: `카드 ${seq}`,
    started_at: Math.floor(Date.parse("2026-09-21T01:00:00.000Z") / 1000),
    ended_at: Math.floor(Date.parse("2026-09-21T01:10:00.000Z") / 1000),
    outcome: "completed",
    ...over,
  } as KanbanTimelineRun;
}

async function mount(props: Partial<React.ComponentProps<typeof KanbanTimeline>> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const opened: string[] = [];
  const presets: string[] = [];
  await act(async () => {
    root.render(
      <I18nProvider>
        <KanbanTimeline
          runs={[run()]}
          window={{ fromMs: FROM, toMs: TO }}
          preset="today"
          onPresetChange={(p) => presets.push(p)}
          now={NOW}
          truncated={false}
          loading={false}
          error={null}
          onOpenTask={(id) => opened.push(id)}
          {...props}
        />
      </I18nProvider>,
    );
  });
  return { host, opened, presets };
}

test("SVG 옆에 같은 데이터의 표 대체본이 함께 나온다", async () => {
  // SVG 는 스크린리더에 통째로 안 읽히고 키보드로 훑을 수도 없다. 선택이 아니다.
  const { host } = await mount({ runs: [run(), run({ profile: "oliver" })] });
  assert.ok(host.querySelector("svg"), "그림이 없다");
  const details = host.querySelector("details");
  assert.ok(details, "표 대체본이 없다");
  const rows = details.querySelectorAll("tbody tr");
  assert.equal(rows.length, 2, "표가 막대와 같은 건수를 내야 한다");
});

test("표의 카드 이름을 누르면 그 카드를 연다", async () => {
  const { host, opened } = await mount({ runs: [run({ task_id: "task-42" })] });
  const button = host.querySelector("tbody button");
  assert.ok(button);
  await act(async () => {
    (button as HTMLElement).click();
  });
  assert.deepEqual(opened, ["task-42"]);
});

test("작업자마다 행이 생기고 이름이 그림에 적힌다", async () => {
  const { host } = await mount({
    runs: [run({ profile: "sophie" }), run({ profile: "oliver" })],
  });
  const text = host.querySelector("svg")?.textContent ?? "";
  assert.ok(text.includes("sophie"));
  assert.ok(text.includes("oliver"));
});

test("작업자를 모르는 실행도 행으로 나온다", async () => {
  const { host } = await mount({ runs: [run({ profile: undefined })] });
  assert.ok(host.textContent?.includes("Unknown worker"));
});

test("결과별로 다른 색 클래스를 쓴다 — 실패를 뭉개지 않는다", async () => {
  const { host } = await mount({
    runs: [run({ outcome: "completed" }), run({ outcome: "crashed" }), run({ outcome: "gave_up" })],
  });
  const classes = [...host.querySelectorAll("svg rect")].map((r) => r.getAttribute("class"));
  assert.ok(classes.includes("fill-success"));
  assert.ok(classes.includes("fill-danger"));
  assert.ok(classes.includes("fill-meeting"), "포기는 실패와 다른 색이어야 한다");
});

test("끝나지 않은 실행은 흐리게 그리고 표에 진행 중이라고 쓴다", async () => {
  const { host } = await mount({
    runs: [
      run({
        ended_at: undefined,
        outcome: undefined,
        started_at: Math.floor(Date.parse("2026-09-21T09:00:00.000Z") / 1000),
      }),
    ],
  });
  const rect = host.querySelector("svg rect");
  assert.ok(Number(rect?.getAttribute("opacity")) < 1, "여기까지 확실하다는 표시가 필요하다");
  assert.ok(host.querySelector("tbody")?.textContent?.includes("Still running"));
});

test("잘렸으면 화면이 말한다", async () => {
  const { host } = await mount({ truncated: true });
  assert.ok(host.textContent?.includes("showing the most recent"));
});

test("창에 걸치지 않아 버린 건수를 밝힌다", async () => {
  const { host } = await mount({
    runs: [run(), run({ started_at: 10, ended_at: 20 })],
  });
  assert.ok(host.textContent?.includes("outside this range"));
});

test("조회 실패는 빈 타임라인으로 덮지 않는다", async () => {
  // "일한 적 없음" 과 "물어볼 수 없음" 은 다르다.
  const { host } = await mount({ error: "게이트웨이 연결 실패", runs: [] });
  assert.ok(host.textContent?.includes("게이트웨이 연결 실패"));
  assert.equal(host.textContent?.includes("No runs recorded"), false);
});

test("기록이 없으면 그렇다고 말한다", async () => {
  const { host } = await mount({ runs: [] });
  assert.ok(host.textContent?.includes("No runs recorded"));
});

test("기간 버튼이 선택 상태를 드러내고 바꿈을 알린다", async () => {
  const { host, presets } = await mount({ preset: "today" });
  const buttons = [...host.querySelectorAll("button[aria-pressed]")];
  const today = buttons.find((b) => b.textContent === "Today");
  const week = buttons.find((b) => b.textContent === "This week");
  assert.equal(today?.getAttribute("aria-pressed"), "true");
  assert.ok(week);
  await act(async () => {
    (week as HTMLElement).click();
  });
  assert.deepEqual(presets, ["week"]);
});

test("아주 짧은 실행도 보이는 폭을 갖는다", async () => {
  // 1초짜리 실패가 눈에 안 보이면 없는 것과 같다.
  const start = Math.floor(Date.parse("2026-09-21T05:00:00.000Z") / 1000);
  const { host } = await mount({
    runs: [run({ started_at: start, ended_at: start, outcome: "crashed" })],
  });
  const width = Number(host.querySelector("svg rect")?.getAttribute("width"));
  assert.ok(width >= 2, `폭이 ${width} 로 사실상 보이지 않는다`);
});
