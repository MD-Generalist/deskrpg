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
          targetDate={null}
          links={[]}
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

test("결과를 뜻으로 칠한다 — '할 일이 있다' 는 실패색이 아니다", async () => {
  const { host } = await mount({
    runs: [
      run({ outcome: "completed" }),
      run({ outcome: "crashed" }),
      run({ outcome: "rate_limited" }),
    ],
  });
  const classes = [...host.querySelectorAll("svg rect")].map((r) => r.getAttribute("class"));
  assert.ok(classes.includes("fill-success"));
  assert.ok(classes.includes("fill-danger"));
  // 한도에 걸린 것은 고장이 아니라 사용자가 할 일이 있는 상태다. 빨강이면 그 할 일을 놓친다.
  // `warning` 토큰이 없어 `fill-warning` 은 아무 색도 내지 않는다 — 있는 토큰을 쓴다.
  assert.ok(classes.includes("fill-npc"), "조치 필요는 실패와 다른 색이어야 한다");
  assert.equal(
    classes.filter((c) => c === "fill-text-muted").length,
    0,
    "아는 결과가 '기타' 회색으로 빠졌습니다",
  );
});

test("모르는 결과도 범례에 그 이름이 그대로 나온다 — 회색으로 뭉개지 않는다", async () => {
  // 실측(스테이징 0.11.1): 실행 178건 중 177건이 `rate_limited` 였고 색 매핑에 없어 회색으로
  // 그려졌다. `outcome` 은 Hermes 코어가 소유한 열린 어휘라 값이 또 늘 수 있다 — 색을 못 골라도
  // 이름은 잃지 않아야 한다.
  const { host } = await mount({
    runs: [run({ outcome: "some_future_outcome" }), run({ outcome: "rate_limited" })],
  });
  const labels = [...host.querySelectorAll("[data-timeline-legend]")].map((n) =>
    n.getAttribute("data-timeline-legend"),
  );
  assert.ok(
    labels.includes("some_future_outcome"),
    `범례가 모르는 결과의 이름을 잃었습니다: ${labels.join(", ")}`,
  );
  assert.ok(labels.includes("rate_limited"));
  const shown = host.querySelector('[data-timeline-legend="some_future_outcome"]');
  assert.equal(shown?.textContent, "some_future_outcome", "범례가 값 대신 다른 글자를 씁니다");
});

test("하루를 넘는 창에서는 축 라벨이 서로 다르다 — 전부 같은 시각이 아니다", async () => {
  // 실측 결함의 모양: 주 단위 창의 눈금 일곱 개가 모두 "오전 09:00" 이었다.
  const from = Date.parse("2026-09-15T00:00:00.000Z");
  const started = Math.floor((from + 3600_000) / 1000);
  const { host } = await mount({
    window: { fromMs: from, toMs: from + 7 * 24 * 3600_000 },
    preset: "week",
    runs: [run({ started_at: started, ended_at: started + 60 })],
  });
  const labels = [...host.querySelectorAll("svg text")]
    .map((n) => n.textContent ?? "")
    .filter((text) => text.length > 0);
  assert.ok(labels.length >= 2, `축 라벨이 ${labels.length}개입니다`);
  assert.equal(
    new Set(labels).size,
    labels.length,
    `축 라벨이 서로 겹칩니다: ${labels.join(" | ")}`,
  );
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
  // 달력 주가 아니라 롤링 7일이다 — 문구도 그것을 말한다(2026-09-21 결정).
  const week = buttons.find((b) => b.textContent === "Last 7 days");
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

test("목표일이 없으면 세로선을 그리지 않고 미정이라고 쓴다", async () => {
  // 프로젝트를 만드는 화면이 아직 없어 값이 없는 것이 기본이다. 없는 기한을 그려 넣지 않는다.
  const { host } = await mount({ targetDate: null });
  assert.ok(host.textContent?.includes("No target date"));
  assert.equal(host.querySelector("line.stroke-danger"), null);
});

test("목표일이 창 안이면 세로선을 그린다", async () => {
  // 목표일은 **로컬 날짜**의 끝이다. 창은 절대 시각이므로, 그날을 덮는 창을 만들어야 한다 —
  // UTC 로 잡은 창은 타임존에 따라 그날 끝을 놓친다(이 테스트가 처음 그렇게 틀렸다).
  const dayStart = Date.parse("2026-09-21T00:00:00");
  const { host } = await mount({
    targetDate: "2026-09-21",
    window: { fromMs: dayStart, toMs: dayStart + 24 * 3600_000 },
    // 막대가 없으면 그림 자체를 그리지 않는다(빈 안내로 대체) — 비교 대상이 없는 기한선은
    // 아무것도 말하지 않는다. 그래서 창 안에 실행 하나를 둔다.
    runs: [
      run({
        started_at: Math.floor((dayStart + 3600_000) / 1000),
        ended_at: Math.floor((dayStart + 7200_000) / 1000),
      }),
    ],
  });
  const line = host.querySelector("line.stroke-danger");
  assert.ok(line, "창 안 목표일인데 선이 없다");
  assert.ok(host.textContent?.includes("Target"));
});

test("목표일이 창 밖이면 선 대신 남은 일수를 쓴다", async () => {
  // 선을 창 경계에 붙이면 목표일이 그 시각인 것처럼 보인다.
  const { host } = await mount({ targetDate: "2026-10-15" });
  assert.equal(host.querySelector("line.stroke-danger"), null);
  assert.ok(host.textContent?.includes("days left"));
});

test("지난 목표일은 지났다고 쓴다", async () => {
  const { host } = await mount({ targetDate: "2026-09-01" });
  assert.ok(host.textContent?.includes("overdue"));
});

test("양쪽 카드가 다 보이는 링크만 화살표가 된다", async () => {
  const parent = run({ task_id: "p", profile: "a" });
  const child = run({
    task_id: "c",
    profile: "b",
    started_at: Math.floor(Date.parse("2026-09-21T02:00:00.000Z") / 1000),
    ended_at: Math.floor(Date.parse("2026-09-21T02:10:00.000Z") / 1000),
  });
  const { host } = await mount({
    runs: [parent, child],
    links: [
      { parent_id: "p", child_id: "c" },
      { parent_id: "p", child_id: "ghost" },
    ],
  });
  const arrows = [...host.querySelectorAll("line")].filter((l) =>
    l.getAttribute("class")?.includes("stroke-text-dim"),
  );
  assert.equal(arrows.length, 1, "허공으로 들어가는 화살표를 만들면 없는 관계를 암시한다");
});

test("순서가 뒤집힌 링크는 점선으로 드러낸다", async () => {
  const parent = run({
    task_id: "p",
    profile: "a",
    started_at: Math.floor(Date.parse("2026-09-21T03:00:00.000Z") / 1000),
    ended_at: Math.floor(Date.parse("2026-09-21T04:00:00.000Z") / 1000),
  });
  const child = run({ task_id: "c", profile: "b" });
  const { host } = await mount({
    runs: [parent, child],
    links: [{ parent_id: "p", child_id: "c" }],
  });
  const dashed = [...host.querySelectorAll("line")].filter(
    (l) => l.getAttribute("stroke-dasharray") === "3 2",
  );
  assert.equal(dashed.length, 1);
});
