import "../../test-setup/dom";
import assert from "node:assert/strict";
import test from "node:test";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n/context";
import type { KanbanTask, KanbanTaskStatus } from "@/lib/hermes/deskrpg-plugin-types";

import KanbanColumn from "./KanbanColumn";
import { restoreKanbanMoveFocus, type KanbanMoveEvent } from "./kanban-card-move";

const task = { id: "task-1", title: "Write release notes", status: "todo" } as KanbanTask;

async function mount(options: { disabled?: boolean } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const events: KanbanMoveEvent[] = [];
  let opened = 0;
  const column = (name: KanbanTaskStatus, tasks: KanbanTask[]) => (
    <KanbanColumn
      name={name}
      tasks={tasks}
      npcs={[]}
      now={0}
      selectedTaskId={null}
      moveDisabled={options.disabled}
      onMoveInteraction={(event) => events.push(event)}
      onOpen={() => opened++}
    />
  );
  await act(async () =>
    root.render(
      <I18nProvider initialLocale="en">
        <div className="overflow-x-auto">
          {column("todo", [task])}
          {column("ready", [])}
          {column("running", [])}
          <div hidden>{column("archived", [])}</div>
        </div>
      </I18nProvider>,
    ),
  );
  return {
    host,
    events,
    opened: () => opened,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

test("R2/R3: card body opens details while the dedicated handle starts keyboard movement", async () => {
  const f = await mount();
  try {
    const body = f.host.querySelector<HTMLButtonElement>('[data-card-detail="task-1"]');
    const handle = f.host.querySelector<HTMLButtonElement>('[data-card-move-handle="task-1"]');
    assert.ok(body);
    assert.ok(handle);
    assert.match(handle.getAttribute("aria-label") ?? "", /Write release notes/);

    await act(async () => body.click());
    assert.equal(f.opened(), 1);

    await act(async () =>
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })),
    );
    assert.equal(f.opened(), 1, "handle never opens card details");
    assert.deepEqual(f.events.at(-1), { type: "start", taskId: "task-1", source: "todo" });
  } finally {
    await f.cleanup();
  }
});

test("R1/R3: arrows select adjacent visible columns, Enter requests a move, and focus returns", async () => {
  const f = await mount();
  try {
    const handle = f.host.querySelector<HTMLButtonElement>('[data-card-move-handle="task-1"]')!;
    handle.focus();
    await act(async () =>
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })),
    );
    await act(async () =>
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    assert.equal(
      f.host.querySelector('[data-column="ready"]')?.getAttribute("data-move-target"),
      "true",
    );
    assert.deepEqual(f.events.at(-1), {
      type: "target",
      taskId: "task-1",
      source: "todo",
      target: "ready",
    });
    await act(async () =>
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    assert.deepEqual(f.events.at(-1), {
      type: "submit",
      taskId: "task-1",
      source: "todo",
      target: "ready",
    });
    assert.equal(document.activeElement, handle);
    assert.equal(
      f.host.querySelector('[data-column="ready"]')?.hasAttribute("data-move-target"),
      false,
    );
  } finally {
    await f.cleanup();
  }
});

test("R3/R5: Escape cancels movement without opening details or submitting", async () => {
  const f = await mount();
  try {
    const handle = f.host.querySelector<HTMLButtonElement>('[data-card-move-handle="task-1"]')!;
    await act(async () =>
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })),
    );
    await act(async () =>
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    await act(async () =>
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    assert.equal(
      f.events.some((event) => event.type === "submit"),
      false,
    );
    assert.equal(f.events.at(-1)?.type, "cancel");
    assert.equal(f.opened(), 0);
  } finally {
    await f.cleanup();
  }
});

test("R5: disabled movement cannot start", async () => {
  const f = await mount({ disabled: true });
  try {
    const handle = f.host.querySelector<HTMLButtonElement>('[data-card-move-handle="task-1"]')!;
    assert.equal(handle.disabled, true);
    await act(async () =>
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })),
    );
    assert.deepEqual(f.events, []);
  } finally {
    await f.cleanup();
  }
});

test("R3: Enter while idle does not grab the card", async () => {
  const f = await mount();
  try {
    const handle = f.host.querySelector<HTMLButtonElement>('[data-card-move-handle="task-1"]')!;
    await act(async () =>
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    assert.deepEqual(f.events, []);
    assert.equal(handle.getAttribute("aria-pressed"), "false");
  } finally {
    await f.cleanup();
  }
});

test("R3/R5: returning to the source column clears the target and Enter does not submit", async () => {
  const f = await mount();
  try {
    const handle = f.host.querySelector<HTMLButtonElement>('[data-card-move-handle="task-1"]')!;
    await act(async () =>
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })),
    );
    await act(async () =>
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    await act(async () =>
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
    );
    assert.equal(f.host.querySelector('[data-move-target="true"]'), null);
    await act(async () =>
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    assert.equal(
      f.events.some((event) => event.type === "submit"),
      false,
    );
    assert.equal(f.events.at(-1)?.type, "cancel");
  } finally {
    await f.cleanup();
  }
});

test("R2/R5: moving focus to another control cancels without stealing its focus back", async () => {
  const f = await mount();
  try {
    const handle = f.host.querySelector<HTMLButtonElement>('[data-card-move-handle="task-1"]')!;
    const body = f.host.querySelector<HTMLButtonElement>('[data-card-detail="task-1"]')!;
    handle.focus();
    await act(async () =>
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })),
    );
    await act(async () => body.focus());
    assert.deepEqual(f.events.at(-1), {
      type: "cancel",
      taskId: "task-1",
      source: "todo",
      reason: "focus-loss",
    });
    assert.equal(document.activeElement, body);
  } finally {
    await f.cleanup();
  }
});

function pointerEvent(type: string, values: Record<string, number>) {
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX: values.clientX,
    clientY: values.clientY,
  });
  Object.defineProperty(event, "pointerId", { value: values.pointerId ?? 1 });
  Object.defineProperty(event, "button", { value: values.button ?? 0 });
  return event;
}

test("R2: pointer movement activates after the threshold and drops on an empty visible column", async () => {
  const f = await mount();
  const original = document.elementFromPoint;
  try {
    const handle = f.host.querySelector<HTMLButtonElement>('[data-card-move-handle="task-1"]')!;
    const ready = f.host.querySelector<HTMLElement>('[data-column="ready"]')!;
    document.elementFromPoint = () => ready;
    await act(async () =>
      handle.dispatchEvent(pointerEvent("pointerdown", { clientX: 10, clientY: 10 })),
    );
    await act(async () =>
      handle.dispatchEvent(pointerEvent("pointermove", { clientX: 13, clientY: 10 })),
    );
    assert.equal(f.events.length, 0, "small movement remains a tap");
    await act(async () =>
      handle.dispatchEvent(pointerEvent("pointermove", { clientX: 20, clientY: 10 })),
    );
    assert.equal(f.events[0]?.type, "start");
    assert.equal(ready.dataset.moveTarget, "true");
    await act(async () =>
      handle.dispatchEvent(pointerEvent("pointerup", { clientX: 20, clientY: 10 })),
    );
    assert.equal(f.events.at(-1)?.type, "submit");
    assert.equal(f.opened(), 0);
  } finally {
    document.elementFromPoint = original;
    await f.cleanup();
  }
});

test("R2/R5: pointercancel cleans up without submitting", async () => {
  const f = await mount();
  const original = document.elementFromPoint;
  try {
    const handle = f.host.querySelector<HTMLButtonElement>('[data-card-move-handle="task-1"]')!;
    const ready = f.host.querySelector<HTMLElement>('[data-column="ready"]')!;
    document.elementFromPoint = () => ready;
    await act(async () =>
      handle.dispatchEvent(pointerEvent("pointerdown", { clientX: 10, clientY: 10 })),
    );
    await act(async () =>
      handle.dispatchEvent(pointerEvent("pointermove", { clientX: 20, clientY: 10 })),
    );
    await act(async () =>
      handle.dispatchEvent(pointerEvent("pointercancel", { clientX: 20, clientY: 10 })),
    );
    assert.equal(
      f.events.some((event) => event.type === "submit"),
      false,
    );
    assert.deepEqual(f.events.at(-1), {
      type: "cancel",
      taskId: "task-1",
      source: "todo",
      reason: "pointer-cancel",
    });
    assert.equal(ready.hasAttribute("data-move-target"), false);
  } finally {
    document.elementFromPoint = original;
    await f.cleanup();
  }
});

test("R3: focus restoration falls back to the source column when the card disappears", async () => {
  const column = document.createElement("section");
  column.tabIndex = -1;
  const handle = document.createElement("button");
  column.append(handle);
  document.body.append(column);
  try {
    restoreKanbanMoveFocus(handle, column);
    handle.remove();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    assert.equal(document.activeElement, column);
  } finally {
    column.remove();
  }
});

test("R2/R5: two boards isolate keyboard targets and target cleanup", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const firstRoot = createRef<HTMLDivElement>();
  const secondRoot = createRef<HTMLDivElement>();
  const events: KanbanMoveEvent[] = [];
  const renderBoard = (ref: typeof firstRoot, id: string, capture: boolean) => (
    <div ref={ref} data-board={id}>
      <KanbanColumn
        name="todo"
        tasks={[{ ...task, id: `${id}-task` }]}
        npcs={[]}
        now={0}
        selectedTaskId={null}
        onOpen={() => undefined}
        getMoveRoot={() => ref.current}
        onMoveInteraction={capture ? (event) => events.push(event) : undefined}
      />
      <KanbanColumn
        name="ready"
        tasks={[]}
        npcs={[]}
        now={0}
        selectedTaskId={null}
        onOpen={() => undefined}
        getMoveRoot={() => ref.current}
      />
    </div>
  );
  try {
    await act(async () =>
      root.render(
        <I18nProvider initialLocale="en">
          {renderBoard(firstRoot, "first", true)}
          {renderBoard(secondRoot, "second", false)}
        </I18nProvider>,
      ),
    );
    const handle = firstRoot.current!.querySelector<HTMLButtonElement>(
      '[data-card-move-handle="first-task"]',
    )!;
    await act(async () => {
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    assert.equal(
      firstRoot.current!.querySelector<HTMLElement>('[data-column="ready"]')?.dataset.moveTarget,
      "true",
    );
    assert.equal(secondRoot.current!.querySelector('[data-move-target="true"]'), null);
    await act(async () =>
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    assert.equal(firstRoot.current!.querySelector('[data-move-target="true"]'), null);
    assert.equal(events.at(-1)?.type, "cancel");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
