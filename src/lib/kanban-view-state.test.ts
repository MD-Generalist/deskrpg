import assert from "node:assert/strict";
import test from "node:test";

import type { KanbanTask, KanbanTaskStatus } from "@/lib/hermes/deskrpg-plugin-types";
import {
  applyFilter,
  cardProgress,
  filterRunsByVisibleTasks,
  hasActiveFilter,
  DEFAULT_VIEW_STATE,
  directChildCount,
  groupTasks,
  isWaitingOnParents,
  normalizeViewState,
  OTHER_STATUS_GROUP_KEY,
  promoteOrphans,
  segmentWidths,
  sortTasks,
  statusSegments,
  UNSET_GROUP_KEY,
} from "./kanban-view-state";

function task(id: string, over: Partial<KanbanTask> = {}): KanbanTask {
  return { id, title: id, status: "todo", ...over };
}

// ---------------------------------------------------------------------------
// 거르기
// ---------------------------------------------------------------------------

test("빈 필터는 아무것도 거르지 않는다 — 고르지 않은 것이 전부를 지우면 안 된다", () => {
  const tasks = [task("a"), task("b", { tenant: "web" })];
  assert.deepEqual(
    applyFilter(tasks, DEFAULT_VIEW_STATE.filter).map((t) => t.id),
    ["a", "b"],
  );
});

test("테넌트·담당·상태 필터는 교집합으로 걸린다", () => {
  const tasks = [
    task("a", { tenant: "web", assignee: "sophie", status: "todo" }),
    task("b", { tenant: "web", assignee: "oliver", status: "todo" }),
    task("c", { tenant: "api", assignee: "sophie", status: "done" }),
  ];
  const got = applyFilter(tasks, {
    ...DEFAULT_VIEW_STATE.filter,
    tenants: ["web"],
    assignees: ["sophie"],
  });
  assert.deepEqual(
    got.map((t) => t.id),
    ["a"],
  );
});

test("테넌트가 빈 카드는 빈 문자열로 취급돼 다른 테넌트 필터에 걸리지 않는다", () => {
  const tasks = [task("a"), task("b", { tenant: "web" })];
  const got = applyFilter(tasks, { ...DEFAULT_VIEW_STATE.filter, tenants: ["web"] });
  assert.deepEqual(
    got.map((t) => t.id),
    ["b"],
  );
});

test("경고만 보기는 count>0 인 카드만 남긴다", () => {
  const tasks = [
    task("a", { warnings: { count: 0 } }),
    task("b", { warnings: { count: 2, highest_severity: "high" } }),
    task("c"),
  ];
  const got = applyFilter(tasks, { ...DEFAULT_VIEW_STATE.filter, warningsOnly: true });
  assert.deepEqual(
    got.map((t) => t.id),
    ["b"],
  );
});

// ---------------------------------------------------------------------------
// 묶기
// ---------------------------------------------------------------------------

test("상태로 묶으면 KANBAN_TASK_STATUSES 순서를 따른다", () => {
  const tasks = [
    task("done1", { status: "done" }),
    task("todo1", { status: "todo" }),
    task("run1", { status: "running" }),
  ];
  assert.deepEqual(
    groupTasks(tasks, "status").map((g) => g.key),
    ["todo", "running", "done"],
  );
});

test("알 수 없는 상태값 카드는 버려지지 않고 기타 그룹으로 간다", () => {
  const tasks = [task("a", { status: "todo" }), task("x", { status: "weird" as KanbanTaskStatus })];
  const groups = groupTasks(tasks, "status");
  const other = groups.find((g) => g.key === OTHER_STATUS_GROUP_KEY);
  assert.ok(other, "기타 그룹이 없다 — 카드가 사라졌다");
  assert.deepEqual(
    other?.tasks.map((t) => t.id),
    ["x"],
  );
  assert.equal(groups.at(-1)?.key, OTHER_STATUS_GROUP_KEY, "기타 그룹은 마지막이다");
  const total = groups.reduce((n, g) => n + g.tasks.length, 0);
  assert.equal(total, tasks.length, "묶는 과정에서 카드 수가 줄었다");
});

test("테넌트가 빈 카드는 '없음' 그룹이고 항상 마지막이다", () => {
  const tasks = [task("a"), task("b", { tenant: "web" })];
  const groups = groupTasks(tasks, "tenant", { tenants: ["web"] });
  assert.deepEqual(
    groups.map((g) => g.key),
    ["web", UNSET_GROUP_KEY],
  );
});

test("보드 응답 목록에 없는 테넌트도 그룹으로 나온다 — 메타 없는 서브프로젝트가 사라지면 안 된다", () => {
  const tasks = [task("a", { tenant: "ghost" }), task("b", { tenant: "web" })];
  const groups = groupTasks(tasks, "tenant", { tenants: ["web"] });
  assert.deepEqual(
    groups.map((g) => g.key),
    ["web", "ghost"],
  );
  assert.equal(groups[1]?.value, "ghost", "슬러그가 값으로 그대로 남아야 화면이 표시할 수 있다");
});

test("묶기가 none 이면 그룹 하나, 카드가 없으면 그룹도 없다", () => {
  assert.equal(groupTasks([task("a")], "none").length, 1);
  assert.deepEqual(groupTasks([], "none"), []);
  assert.deepEqual(groupTasks([], "status"), []);
});

test("빈 그룹은 만들지 않는다 — 빈 열은 보드 뷰의 일이다", () => {
  const groups = groupTasks([task("a", { status: "todo" })], "status");
  assert.deepEqual(
    groups.map((g) => g.key),
    ["todo"],
  );
});

// ---------------------------------------------------------------------------
// 정렬
// ---------------------------------------------------------------------------

test("같은 키를 가진 카드의 상대 순서는 방향을 뒤집어도 유지된다(안정 정렬)", () => {
  const tasks = [
    task("a", { created_at: "2026-09-01T00:00:00Z" }),
    task("b", { created_at: "2026-09-01T00:00:00Z" }),
    task("c", { created_at: "2026-09-01T00:00:00Z" }),
  ];
  assert.deepEqual(
    sortTasks(tasks, "created", "asc").map((t) => t.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    sortTasks(tasks, "created", "desc").map((t) => t.id),
    ["a", "b", "c"],
  );
});

test("날짜가 없는 카드는 방향과 무관하게 뒤로 간다", () => {
  const tasks = [
    task("none"),
    task("old", { created_at: "2026-01-01T00:00:00Z" }),
    task("new", { created_at: "2026-09-01T00:00:00Z" }),
  ];
  assert.equal(sortTasks(tasks, "created", "asc").at(-1)?.id, "none");
  assert.equal(sortTasks(tasks, "created", "desc").at(-1)?.id, "none");
});

test("숫자 우선순위는 숫자로 비교한다 — 문자열 비교면 10 이 2보다 앞선다", () => {
  const tasks = [task("p10", { priority: "10" }), task("p2", { priority: "2" })];
  assert.deepEqual(
    sortTasks(tasks, "priority", "asc").map((t) => t.id),
    ["p2", "p10"],
  );
});

test("상태 정렬은 열 순서를 쓰고 모르는 상태는 맨 뒤다", () => {
  const tasks = [
    task("x", { status: "weird" as KanbanTaskStatus }),
    task("d", { status: "done" }),
    task("t", { status: "todo" }),
  ];
  assert.deepEqual(
    sortTasks(tasks, "status", "asc").map((t) => t.id),
    ["t", "d", "x"],
  );
});

// ---------------------------------------------------------------------------
// 진행률
// ---------------------------------------------------------------------------

test("progress 가 없거나 total 이 0이면 바를 그리지 않는다(null)", () => {
  assert.equal(cardProgress(task("a")), null);
  assert.equal(cardProgress(task("b", { progress: { done: 0, total: 0 } })), null);
});

test("done 이 total 을 넘어도 넘치지 않게 접는다", () => {
  assert.deepEqual(cardProgress(task("a", { progress: { done: 9, total: 3 } })), {
    done: 3,
    total: 3,
  });
});

test("묶음 진행률의 분모에서 archived 가 빠진다", () => {
  const tasks = [
    task("a", { status: "done" }),
    task("b", { status: "todo" }),
    task("z", { status: "archived" }),
  ];
  const { segments, counted } = statusSegments(tasks);
  assert.equal(counted, 2, "보관한 일을 미완으로 세면 100% 에 영영 닿지 않는다");
  assert.equal(
    segments.some((s) => s.status === "archived"),
    false,
  );
});

test("세그먼트는 상태 순서대로 나오고 0인 상태는 빠진다", () => {
  const tasks = [task("a", { status: "done" }), task("b", { status: "todo" })];
  assert.deepEqual(
    statusSegments(tasks).segments.map((s) => s.status),
    ["todo", "done"],
  );
});

test("셀 카드가 없으면 폭 계산이 빈 배열 — 0% 바를 그리지 않는다", () => {
  const { segments, counted } = statusSegments([task("z", { status: "archived" })]);
  assert.equal(counted, 0);
  assert.deepEqual(segmentWidths(segments, counted), []);
});

test("세그먼트 폭의 합은 100 이다", () => {
  const tasks = [
    task("a", { status: "done" }),
    task("b", { status: "todo" }),
    task("c", { status: "todo" }),
  ];
  const { segments, counted } = statusSegments(tasks);
  const total = segmentWidths(segments, counted).reduce((n, s) => n + s.percent, 0);
  assert.ok(Math.abs(total - 100) < 1e-9, `합이 100 이 아니다: ${total}`);
});

// ---------------------------------------------------------------------------
// 트리
// ---------------------------------------------------------------------------

test("직계 자식 수는 보드 응답의 link_counts 를 그대로 쓴다", () => {
  assert.equal(directChildCount(task("a", { link_counts: { parents: 1, children: 3 } })), 3);
  assert.equal(directChildCount(task("b")), 0);
});

test("부모가 보이는 목록에 없으면 자식이 루트로 올라온다 — 카드가 사라지지 않는다", () => {
  const tasks = [task("child")];
  const parentOf = new Map([["child", "archived-parent"]]);
  const { roots, childrenOf } = promoteOrphans(tasks, parentOf);
  assert.deepEqual(
    roots.map((t) => t.id),
    ["child"],
  );
  assert.equal(childrenOf.size, 0);
});

test("부모가 목록에 있으면 자식은 그 아래로 붙는다", () => {
  const tasks = [task("parent"), task("child")];
  const parentOf = new Map([["child", "parent"]]);
  const { roots, childrenOf } = promoteOrphans(tasks, parentOf);
  assert.deepEqual(
    roots.map((t) => t.id),
    ["parent"],
  );
  assert.deepEqual(
    childrenOf.get("parent")?.map((t) => t.id),
    ["child"],
  );
});

test("부모 대기는 todo 이고 미완 부모가 있을 때만 참이다", () => {
  const child = task("c", { status: "todo" });
  assert.equal(isWaitingOnParents(child, [task("p", { status: "running" })]), true);
  assert.equal(isWaitingOnParents(child, [task("p", { status: "done" })]), false);
  assert.equal(isWaitingOnParents(child, [task("p", { status: "archived" })]), false);
  assert.equal(isWaitingOnParents(child, []), false);
  assert.equal(
    isWaitingOnParents(task("c", { status: "running" }), [task("p", { status: "todo" })]),
    false,
    "이미 돌고 있는 카드는 부모 대기가 아니다",
  );
});

// ---------------------------------------------------------------------------
// 저장된 뷰 상태
// ---------------------------------------------------------------------------

test("낡거나 망가진 저장값을 기본값으로 접는다", () => {
  assert.deepEqual(normalizeViewState(null), DEFAULT_VIEW_STATE);
  assert.deepEqual(normalizeViewState("nonsense"), DEFAULT_VIEW_STATE);
  assert.deepEqual(normalizeViewState({ viewMode: "gantt", groupBy: "moon" }), DEFAULT_VIEW_STATE);
});

test("알 수 없는 상태 필터값은 버린다 — 열지 못할 필터가 카드를 다 지우면 안 된다", () => {
  const got = normalizeViewState({ filter: { statuses: ["todo", "weird"] } });
  assert.deepEqual(got.filter.statuses, ["todo"]);
});

test("저장된 값이 살아 있으면 그대로 읽는다", () => {
  const got = normalizeViewState({
    viewMode: "list",
    groupBy: "tenant",
    sortField: "title",
    sortDir: "asc",
    filter: { tenants: ["web"], includeArchived: true },
    collapsedGroups: ["web"],
  });
  assert.equal(got.viewMode, "list");
  assert.equal(got.groupBy, "tenant");
  assert.equal(got.sortField, "title");
  assert.equal(got.sortDir, "asc");
  assert.deepEqual(got.filter.tenants, ["web"]);
  assert.equal(got.filter.includeArchived, true);
  assert.deepEqual(got.collapsedGroups, ["web"]);
});

test("만든 날짜 정렬은 플러그인이 보내는 epoch 초에서도 동작한다", () => {
  // 정수 시각을 못 읽으면 전부 "값 없음" 으로 몰려 정렬이 조용히 입력 순서가 된다.
  const tasks = [task("new", { created_at: 1758412800 }), task("old", { created_at: 1750000000 })];
  assert.deepEqual(
    sortTasks(tasks, "created", "asc").map((t) => t.id),
    ["old", "new"],
  );
  assert.deepEqual(
    sortTasks(tasks, "created", "desc").map((t) => t.id),
    ["new", "old"],
  );
});

test("epoch 초와 ISO 가 섞여 있어도 한 줄로 정렬된다", () => {
  const tasks = [
    task("iso-new", { created_at: "2025-09-21T00:00:00.000Z" }),
    task("epoch-old", { created_at: 1750000000 }),
  ];
  assert.deepEqual(
    sortTasks(tasks, "created", "asc").map((t) => t.id),
    ["epoch-old", "iso-new"],
  );
});

test("필터가 없으면 실행 기록을 거르지 않는다 — 카드가 지워진 실행이 사라지면 안 된다", () => {
  const runs = [{ task_id: "gone" }, { task_id: "a" }];
  assert.equal(hasActiveFilter(DEFAULT_VIEW_STATE.filter), false);
  assert.deepEqual(filterRunsByVisibleTasks(runs, null), runs);
});

test("필터가 걸리면 보이는 카드의 실행만 남는다", () => {
  const runs = [{ task_id: "web" }, { task_id: "api" }];
  assert.deepEqual(filterRunsByVisibleTasks(runs, new Set(["web"])), [{ task_id: "web" }]);
});

test("보관함 보기만 켠 것은 거르는 필터가 아니다", () => {
  // 그건 서버 조회 범위이고, 응답에 없는 것을 한 번 더 거를 이유가 없다.
  assert.equal(hasActiveFilter({ ...DEFAULT_VIEW_STATE.filter, includeArchived: true }), false);
});

test("테넌트·담당·상태·경고 필터는 모두 활성으로 센다", () => {
  const base = DEFAULT_VIEW_STATE.filter;
  assert.equal(hasActiveFilter({ ...base, tenants: ["web"] }), true);
  assert.equal(hasActiveFilter({ ...base, assignees: ["sophie"] }), true);
  assert.equal(hasActiveFilter({ ...base, statuses: ["todo"] }), true);
  assert.equal(hasActiveFilter({ ...base, warningsOnly: true }), true);
});
