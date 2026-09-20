import "../../test-setup/dom";
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n/context";
import type { KanbanBoard } from "@/lib/hermes/deskrpg-plugin-types";

import NpcCardsTab, { type NpcCardsTabProps } from "./NpcCardsTab";

function render(ui: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(<I18nProvider initialLocale="ko">{ui}</I18nProvider>);
  });
  return {
    container: host,
    cleanup: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

const boardWithTwoMine: KanbanBoard = {
  columns: [
    {
      name: "todo",
      tasks: [
        { id: "a", title: "다른 사람 카드", status: "todo", assignee: "noah" },
        { id: "c", title: "진행 중인 내 카드", status: "todo", assignee: "sophie" },
      ],
    },
    {
      name: "running",
      tasks: [{ id: "b", title: "실행 중인 내 카드", status: "running", assignee: "sophie" }],
    },
  ],
  tenants: [],
  assignees: ["sophie", "noah"],
  latest_event_id: null,
  now: "2026-09-21T00:00:00Z",
};

const props: NpcCardsTabProps = {
  npcProfile: "sophie",
  board: null,
  error: null,
  onOpenCard: () => {},
};

test("담당 카드가 목록으로 보인다", () => {
  const { container, cleanup } = render(<NpcCardsTab {...props} board={boardWithTwoMine} />);
  try {
    assert.equal(container.querySelectorAll("[data-card-id]").length, 2);
  } finally {
    cleanup();
  }
});

test("카드를 누르면 그 id 로 onOpenCard 가 불린다", () => {
  const seen: string[] = [];
  const { container, cleanup } = render(
    <NpcCardsTab {...props} board={boardWithTwoMine} onOpenCard={(id) => seen.push(id)} />,
  );
  try {
    (container.querySelector("[data-card-id='c']") as HTMLElement).click();
    assert.deepEqual(seen, ["c"]);
  } finally {
    cleanup();
  }
});

test("담당 카드가 없으면 빈 상태 문구", () => {
  const emptyBoard: KanbanBoard = {
    columns: [],
    tenants: [],
    assignees: [],
    latest_event_id: null,
    now: "2026-09-21T00:00:00Z",
  };
  const { container, cleanup } = render(<NpcCardsTab {...props} board={emptyBoard} />);
  try {
    assert.equal(container.querySelectorAll("[data-card-id]").length, 0);
    assert.ok(container.querySelector("[data-testid='cards-empty']"));
  } finally {
    cleanup();
  }
});

test("게이트에 막히면 이유를 보인다 — 빈 목록으로 위장하지 않는다", () => {
  const { container, cleanup } = render(
    <NpcCardsTab {...props} board={null} error="plugin_required" />,
  );
  try {
    assert.ok(container.querySelector("[data-testid='cards-error']"));
    assert.equal(container.querySelector("[data-testid='cards-empty']"), null);
  } finally {
    cleanup();
  }
});

test("보드 미준비(board_unavailable)는 칸반이 쓰는 보드 미확보 문구를 재사용한다 — 알 수 없는 오류로 뭉개지 않는다", () => {
  const { container, cleanup } = render(
    <NpcCardsTab {...props} board={null} error="board_unavailable" />,
  );
  try {
    const notice = container.querySelector("[data-testid='cards-error']");
    assert.ok(notice);
    assert.equal(container.querySelector("[data-testid='cards-empty']"), null);
    // 칸반 보드 미확보 배너와 같은 제목 — wizard-error-codes 의 일반 "알 수 없는 오류" 폴백이 아니다.
    assert.match(notice!.textContent ?? "", /보드를 확보하지 못했습니다/);
    assert.doesNotMatch(notice!.textContent ?? "", /알 수 없는 오류/);
  } finally {
    cleanup();
  }
});

test("조회가 끝나기 전에는 빈 상태도 오류도 그리지 않는다 — 확정 안 된 것을 단정하지 않는다", () => {
  const { container, cleanup } = render(<NpcCardsTab {...props} board={null} error={null} />);
  try {
    assert.equal(container.querySelector("[data-testid='cards-empty']"), null);
    assert.equal(container.querySelector("[data-testid='cards-error']"), null);
    assert.ok(container.querySelector("[data-testid='cards-loading']"), "스켈레톤이 없다");
  } finally {
    cleanup();
  }
});

test("프로필을 모르면 담당 없는 카드를 이 직원 것으로 잡지 않는다 — 스켈레톤도 끝난다", () => {
  const board: KanbanBoard = {
    ...boardWithTwoMine,
    columns: [
      {
        name: "todo",
        tasks: [{ id: "u", title: "담당 없는 카드", status: "todo", assignee: "" }],
      },
    ],
  };
  const { container, cleanup } = render(
    <NpcCardsTab {...props} npcProfile="" board={board} error={null} />,
  );
  try {
    assert.equal(container.querySelectorAll("[data-card-id]").length, 0);
    // 보드가 도착했으면 로딩은 끝난 것이다 — 무한 스켈레톤이 아니라 확정된 상태를 보인다.
    assert.equal(container.querySelector("[data-testid='cards-loading']"), null);
    assert.ok(container.querySelector("[data-testid='cards-empty']"));
  } finally {
    cleanup();
  }
});

// `classifyGateFailure` 가 내는 kind 마다 전용 문구가 있어야 한다 — 하나씩 때우면 같은 결함이
// 다음 코드에서 되살아난다(`plugin_absent` 가 "알 수 없는 오류" 로 떨어졌던 일).
const GATE_CODES = [
  "gateway_not_bound",
  "plugin_absent",
  "plugin_unauthorized",
  "plugin_upgrade_required",
  "timeout",
  "unreachable",
  "plugin_unknown",
  "board_unavailable",
] as const;

test("게이트 코드마다 폴백이 아닌 전용 문구가 나온다 — 원시 코드를 노출하지 않는다", () => {
  const fallback = renderErrorText("some_code_that_does_not_exist");
  for (const code of GATE_CODES) {
    const text = renderErrorText(code);
    assert.notEqual(text, fallback, `${code} 가 폴백 문구와 같다`);
    // `board_unavailable` 은 칸반 보드와 같이 제목 아래 기술 정보(`failureLine`)를 덧붙인다 —
    // 그건 폴백이 아니라 의도된 상세다.
    if (code !== "board_unavailable") {
      assert.doesNotMatch(text, new RegExp(code), `${code} 원시 코드가 화면에 보인다`);
    }
  }
});

test("플러그인이 없으면 설치 안내가 나온다 — 알 수 없는 오류가 아니다", () => {
  const text = renderErrorText("plugin_absent");
  assert.doesNotMatch(text, /알 수 없는 오류/);
  assert.match(text, /hermes/i, "설치 명령이 보이지 않는다");
});

function renderErrorText(code: string): string {
  const { container, cleanup } = render(<NpcCardsTab {...props} board={null} error={code} />);
  try {
    const alert = container.querySelector("[data-testid='cards-error']");
    assert.ok(alert, `${code} 에 안내가 없다`);
    assert.equal(container.querySelector("[data-testid='cards-empty']"), null);
    assert.equal(container.querySelector("[data-testid='cards-loading']"), null);
    return alert.textContent ?? "";
  } finally {
    cleanup();
  }
}
