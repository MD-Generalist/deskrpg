import assert from "node:assert/strict";
import { test } from "node:test";
import { assignedCards } from "./npc-assigned-cards";

const board = {
  columns: [
    {
      name: "todo",
      tasks: [
        {
          id: "a",
          title: "A",
          status: "todo",
          assignee: "noah",
          created_at: "2026-09-01T00:00:00Z",
        },
        {
          id: "b",
          title: "B",
          status: "todo",
          assignee: "sophie",
          created_at: "2026-09-02T00:00:00Z",
        },
      ],
    },
    {
      name: "in_progress",
      tasks: [
        {
          id: "c",
          title: "C",
          status: "in_progress",
          assignee: "noah",
          created_at: "2026-08-01T00:00:00Z",
        },
      ],
    },
    {
      name: "done",
      tasks: [
        {
          id: "d",
          title: "D",
          status: "done",
          assignee: "noah",
          created_at: "2026-09-03T00:00:00Z",
        },
      ],
    },
  ],
} as never;

test("담당이 아닌 카드는 빠진다", () => {
  assert.deepEqual(
    assignedCards(board, "noah").map((t) => t.id),
    ["c", "a", "d"],
  );
  assert.deepEqual(
    assignedCards(board, "sophie").map((t) => t.id),
    ["b"],
  );
});

test("진행 중이 맨 앞, 완료가 맨 뒤", () => {
  const ids = assignedCards(board, "noah").map((t) => t.id);
  assert.equal(ids[0], "c");
  assert.equal(ids[ids.length - 1], "d");
});

test("created_at 이 없으면 같은 묶음 안에서 뒤로 간다", () => {
  const b = {
    columns: [
      {
        name: "todo",
        tasks: [
          { id: "x", title: "X", status: "todo", assignee: "noah" },
          {
            id: "y",
            title: "Y",
            status: "todo",
            assignee: "noah",
            created_at: "2026-09-01T00:00:00Z",
          },
        ],
      },
    ],
  } as never;
  assert.deepEqual(
    assignedCards(b, "noah").map((t) => t.id),
    ["y", "x"],
  );
});

test("담당이 없는 카드는 어떤 직원에게도 안 보인다", () => {
  const b = {
    columns: [{ name: "todo", tasks: [{ id: "z", title: "Z", status: "todo" }] }],
  } as never;
  assert.deepEqual(assignedCards(b, "noah"), []);
});
