import "../../test-setup/dom";
import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n/context";
import type { KanbanTask, KanbanTaskStatus } from "@/lib/hermes/deskrpg-plugin-types";
import { groupTasks, type GroupBy } from "@/lib/kanban-view-state";

import KanbanListView from "./KanbanListView";

// `I18nProvider` 의 기본 로케일은 영어다 — 문구 단언은 en 로케일 값을 쓴다.

function task(id: string, over: Partial<KanbanTask> = {}): KanbanTask {
  return { id, title: id, status: "todo", ...over };
}

async function mount(options: {
  tasks: KanbanTask[];
  groupBy?: GroupBy;
  tenants?: string[];
  childrenOf?: Map<string, KanbanTask[]>;
  parentsOf?: Map<string, KanbanTask[]>;
  expanded?: Set<string>;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const groupBy = options.groupBy ?? "status";
  const groups = groupTasks(options.tasks, groupBy, { tenants: options.tenants });
  const expandCalls: string[] = [];
  await act(async () => {
    root.render(
      <I18nProvider>
        <KanbanListView
          groups={groups}
          groupBy={groupBy}
          npcs={[]}
          now={Date.parse("2026-09-21T00:00:00Z")}
          selectedTaskId={null}
          collapsedGroups={[]}
          onToggleGroup={() => {}}
          onOpen={() => {}}
          childrenOf={options.childrenOf ?? new Map()}
          parentsOf={options.parentsOf ?? new Map()}
          expanded={options.expanded ?? new Set()}
          loadingChildren={new Set()}
          onToggleExpand={(id) => expandCalls.push(id)}
        />
      </I18nProvider>,
    );
  });
  return { host, root, expandCalls };
}

/** 카드 행의 제목만. 그룹 헤더 버튼은 제외한다. */
function rowTitles(host: HTMLElement): string[] {
  return [...host.querySelectorAll("li > button[type=button]:not([aria-expanded])")].map(
    (el) => el.querySelector("span")?.textContent?.trim() ?? "",
  );
}

test("보드가 준 카드는 한 장도 빠지지 않고 목록에 나온다", async () => {
  const tasks = [
    task("a", { status: "todo" }),
    task("b", { status: "running" }),
    task("c", { status: "done" }),
  ];
  const { host } = await mount({ tasks });
  assert.deepEqual(rowTitles(host).sort(), ["a", "b", "c"]);
});

test("알 수 없는 상태 카드도 목록에서 사라지지 않는다", async () => {
  const tasks = [task("a"), task("weird", { status: "not-a-status" as KanbanTaskStatus })];
  const { host } = await mount({ tasks });
  assert.ok(rowTitles(host).includes("weird"), "알 수 없는 상태 카드가 사라졌다");
  assert.ok(
    host.textContent?.includes("Other status"),
    "기타 상태 그룹 제목이 없다 — 카드가 어디에 있는지 알 수 없다",
  );
});

test("메타 없는 테넌트도 슬러그 그대로 그룹으로 보인다", async () => {
  const tasks = [task("a", { tenant: "ghost-team" }), task("b", { tenant: "web" })];
  const { host } = await mount({ tasks, groupBy: "tenant", tenants: ["web"] });
  assert.ok(host.textContent?.includes("ghost-team"), "응답 목록에 없는 테넌트가 사라졌다");
  assert.deepEqual(rowTitles(host).sort(), ["a", "b"]);
});

test("테넌트가 빈 카드는 '서브프로젝트 없음' 그룹에 모인다", async () => {
  const tasks = [task("a"), task("b", { tenant: "web" })];
  const { host } = await mount({ tasks, groupBy: "tenant", tenants: ["web"] });
  assert.ok(host.textContent?.includes("No subproject"));
});

test("목록 행에는 이동 손잡이가 없다 (설계 D5)", async () => {
  const { host } = await mount({ tasks: [task("a")] });
  assert.equal(
    host.querySelector("[data-kanban-move-handle]"),
    null,
    "목록에서 끌기가 순서인지 상태인지 모호하다 — 손잡이를 두지 않는다",
  );
});

test("직계 자식이 있는 카드만 펼침 버튼을 갖고, 누르면 그 카드 id 로 요청한다", async () => {
  const tasks = [task("parent", { link_counts: { parents: 0, children: 2 } }), task("leaf")];
  const { host, expandCalls } = await mount({ tasks });
  const toggles = [...host.querySelectorAll("button[aria-expanded]")].filter((el) =>
    el.getAttribute("aria-label")?.includes("direct subtasks"),
  );
  assert.equal(toggles.length, 1, "자식 없는 카드에도 펼침 버튼이 생겼다");
  await act(async () => {
    (toggles[0] as HTMLElement).click();
  });
  assert.deepEqual(expandCalls, ["parent"]);
});

test("펼치면 자식이 부모 아래에 들여쓰여 나오고, 최상위에서는 빠진다", async () => {
  const parent = task("parent", { link_counts: { parents: 0, children: 1 } });
  const child = task("child");
  const { host } = await mount({
    tasks: [parent, child],
    childrenOf: new Map([["parent", [child]]]),
    expanded: new Set(["parent"]),
  });
  const titles = rowTitles(host);
  assert.deepEqual(titles, ["parent", "child"], "자식이 부모 바로 아래에 와야 한다");
  assert.equal(
    titles.filter((x) => x === "child").length,
    1,
    "같은 카드가 두 번 그려지면 개수가 맞지 않아 보인다",
  );
});

test("부모가 목록에 없는 자식은 최상위에 남는다 — 보관함을 접어도 사라지지 않는다", async () => {
  const child = task("child", { link_counts: { parents: 1, children: 0 } });
  const { host } = await mount({ tasks: [child] });
  assert.deepEqual(rowTitles(host), ["child"]);
});

test("미완 부모를 둔 todo 카드에 '부모 대기' 가 붙는다", async () => {
  const child = task("child", { status: "todo" });
  const { host } = await mount({
    tasks: [child],
    parentsOf: new Map([["child", [task("p", { status: "running" })]]]),
  });
  assert.ok(
    host.textContent?.includes("Waiting on parents"),
    "상태가 todo 인데 아무도 집지 않는 이유가 화면에 없다",
  );
});

test("부모가 끝났으면 '부모 대기' 를 붙이지 않는다", async () => {
  const child = task("child", { status: "todo" });
  const { host } = await mount({
    tasks: [child],
    parentsOf: new Map([["child", [task("p", { status: "done" })]]]),
  });
  assert.equal(host.textContent?.includes("Waiting on parents"), false);
});

test("조건에 맞는 카드가 없으면 안내를 그린다", async () => {
  const { host } = await mount({ tasks: [] });
  assert.ok(host.textContent?.includes("No cards match"));
});
