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
  channelId: "ch-1",
  npcId: "n1",
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
