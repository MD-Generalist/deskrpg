import assert from "node:assert/strict";
import { test } from "node:test";

import type { KanbanBoard, KanbanTask } from "@/lib/hermes/deskrpg-plugin-types";

import { assignedCards } from "./npc-assigned-cards";

/**
 * 픽스처는 **타입이 살아 있어야 한다.** 예전 픽스처는 `as never` 로 존재하지 않는
 * `status: "in_progress"` 를 넣었고, 그래서 실제 어휘(`KANBAN_TASK_STATUSES`)를 보지 않는
 * 정렬 결함이 테스트를 통과했다. `KanbanTask` 로 받으면 없는 상태는 컴파일에서 막힌다.
 */
function task(
  id: string,
  status: KanbanTask["status"],
  assignee: string | undefined,
  createdAt?: string,
): KanbanTask {
  return { id, title: id.toUpperCase(), status, assignee, created_at: createdAt };
}

function board(tasks: KanbanTask[]): KanbanBoard {
  return {
    columns: [{ name: "all", tasks }],
    tenants: [],
    assignees: [],
    latest_event_id: null,
    now: "2026-09-21T00:00:00Z",
  };
}

const mixed = board([
  task("a", "todo", "noah", "2026-09-01T00:00:00Z"),
  task("b", "todo", "sophie", "2026-09-02T00:00:00Z"),
  task("c", "running", "noah", "2026-08-01T00:00:00Z"),
  task("d", "done", "noah", "2026-09-03T00:00:00Z"),
]);

test("담당이 아닌 카드는 빠진다", () => {
  assert.deepEqual(
    assignedCards(mixed, "noah").map((t) => t.id),
    ["c", "a", "d"],
  );
  assert.deepEqual(
    assignedCards(mixed, "sophie").map((t) => t.id),
    ["b"],
  );
});

test("진행 중(running)이 맨 앞, 완료가 맨 뒤", () => {
  const ids = assignedCards(mixed, "noah").map((t) => t.id);
  assert.equal(ids[0], "c");
  assert.equal(ids[ids.length - 1], "d");
});

test("보관(archived)은 완료보다 뒤에 온다", () => {
  const b = board([
    task("arch", "archived", "noah", "2026-09-05T00:00:00Z"),
    task("done", "done", "noah", "2026-09-01T00:00:00Z"),
    task("run", "running", "noah", "2026-09-02T00:00:00Z"),
  ]);
  assert.deepEqual(
    assignedCards(b, "noah").map((t) => t.id),
    ["run", "done", "arch"],
  );
});

test("blocked·review 는 대기 묶음에 함께 둔다 — 앞으로 끌어올리지 않는다", () => {
  const b = board([
    task("blocked", "blocked", "noah", "2026-09-01T00:00:00Z"),
    task("running", "running", "noah", "2026-09-01T00:00:00Z"),
    task("review", "review", "noah", "2026-09-02T00:00:00Z"),
  ]);
  // running 이 먼저고, 나머지는 같은 묶음 안에서 최신순이다.
  assert.deepEqual(
    assignedCards(b, "noah").map((t) => t.id),
    ["running", "review", "blocked"],
  );
});

test("created_at 이 없으면 같은 묶음 안에서 뒤로 간다", () => {
  const b = board([task("x", "todo", "noah"), task("y", "todo", "noah", "2026-09-01T00:00:00Z")]);
  assert.deepEqual(
    assignedCards(b, "noah").map((t) => t.id),
    ["y", "x"],
  );
});

test("담당이 없는 카드는 어떤 직원에게도 안 보인다", () => {
  assert.deepEqual(assignedCards(board([task("z", "todo", undefined)]), "noah"), []);
});

test("시각이 epoch 초로 와도 최신순이다 — 문자열 비교를 하면 자릿수가 다른 값에서 뒤집힌다", () => {
  // 실제 플러그인은 칸반 시각을 epoch 초(숫자)로 준다. 999 < 1000 이지만 "999" > "1000" 이다.
  const board = {
    columns: [
      {
        name: "todo",
        tasks: [
          { id: "old", title: "OLD", status: "todo", assignee: "sophie", created_at: 999 },
          { id: "new", title: "NEW", status: "todo", assignee: "sophie", created_at: 1000 },
        ],
      },
    ],
  } as unknown as Parameters<typeof assignedCards>[0];
  assert.deepEqual(
    assignedCards(board, "sophie").map((t) => t.id),
    ["new", "old"],
  );
});
