import "../test-setup/dom";
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Socket } from "socket.io-client";
import { I18nProvider } from "@/lib/i18n";
import TaskBoard from "./TaskBoard";

test("task assignment uses profile roster activity, including unplaced Hermes NPCs, without legacy agents", async () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  const emitted: [string, unknown][] = [];
  const socket = {
    on() {},
    off() {},
    emit(event: string, payload: unknown) {
      emitted.push([event, payload]);
    },
  } as unknown as Socket;
  const npcs = [
    { id: "hermes-placed", name: "Noah profile", active: true, placed: true, hasAgent: false },
    { id: "hermes-unplaced", name: "Mina profile", active: true, placed: false, hasAgent: false },
    { id: "sleeping", name: "Jun profile", active: false, placed: true, hasAgent: true },
  ];
  try {
    await act(async () =>
      root.render(
        <I18nProvider initialLocale="en">
          <TaskBoard
            channelId="office"
            isOpen
            onClose={() => {}}
            socket={socket}
            tasks={[
              {
                id: "existing-backlog",
                title: "Keep existing task",
                summary: null,
                status: "backlog",
              },
            ]}
            npcs={npcs}
          />
        </I18nProvider>,
      ),
    );
    const button = (text: string) => {
      const found = [...el.querySelectorAll("button")].find((node) =>
        node.textContent?.includes(text),
      );
      assert.ok(found, text);
      return found;
    };
    await act(async () => button("Assign").click());
    assert.equal(button("Noah profile").disabled, false);
    assert.equal(button("Mina profile").disabled, false);
    assert.equal(button("Jun profile").disabled, true);
    await act(async () => button("Mina profile").click());
    const assignButtons = [...el.querySelectorAll("button")].filter(
      (node) => node.textContent?.trim() === "Assign",
    );
    await act(async () => assignButtons.at(-1)!.click());
    assert.deepEqual(emitted, [
      [
        "task:move",
        {
          taskId: "existing-backlog",
          toStatus: "in_progress",
          npcId: "hermes-unplaced",
        },
      ],
    ]);
    assert.ok(el.textContent?.includes("Keep existing task"));
    await act(async () =>
      root.render(
        <I18nProvider initialLocale="en">
          <TaskBoard
            channelId="office"
            isOpen
            onClose={() => {}}
            socket={socket}
            tasks={[
              {
                id: "existing-backlog",
                title: "Keep existing task",
                summary: null,
                status: "in_progress",
                npcId: "hermes-unplaced",
                npcName: "Stale legacy name",
              },
            ]}
            npcs={npcs}
          />
        </I18nProvider>,
      ),
    );
    assert.ok(
      el.textContent?.includes("Mina profile"),
      "assigned card resolves the canonical profile name",
    );
    assert.equal(el.textContent?.includes("Stale legacy name"), false);
  } finally {
    await act(async () => root.unmount());
    el.remove();
  }
});

test("status menu moves assigned tasks and requires a profile before moving unassigned work", async () => {
  localStorage.clear();
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  const emitted: [string, unknown][] = [];
  const socket = {
    on() {},
    off() {},
    emit(event: string, payload: unknown) {
      emitted.push([event, payload]);
    },
  } as unknown as Socket;
  try {
    await act(async () =>
      root.render(
        <I18nProvider initialLocale="en">
          <TaskBoard
            channelId="office"
            isOpen
            onClose={() => {}}
            socket={socket}
            tasks={[
              {
                id: "assigned",
                title: "Assigned",
                summary: null,
                status: "in_progress",
                npcId: "profile",
              },
              { id: "unassigned", title: "Unassigned", summary: null, status: "backlog" },
            ]}
            npcs={[{ id: "profile", name: "Mina", active: true }]}
          />
        </I18nProvider>,
      ),
    );
    const menu = (title: string) => {
      const select = el.querySelector<HTMLSelectElement>(
        `select[aria-label="Change status for ${title}"]`,
      );
      assert.ok(select);
      assert.equal(
        select.closest('[draggable="true"]'),
        null,
        "native selection must not start card dragging",
      );
      return select;
    };
    await act(async () => {
      const select = menu("Assigned");
      select.value = "done";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.deepEqual(emitted, [["task:move", { taskId: "assigned", toStatus: "complete" }]]);
    await act(async () => {
      const select = menu("Unassigned");
      select.value = "pending";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.equal(emitted.length, 1, "unassigned work cannot bypass the profile picker");
    const mina = [...el.querySelectorAll("button")].find(
      (b) => b.textContent?.includes("Mina") && !b.disabled,
    );
    assert.ok(mina);
    // The final matching profile button belongs to the assignment modal, not the roster filter.
    const choices = [...el.querySelectorAll("button")].filter((b) =>
      b.textContent?.includes("Mina"),
    );
    await act(async () => choices.at(-1)!.click());
    const confirm = [...el.querySelectorAll("button")]
      .filter((b) => b.textContent?.trim() === "Assign")
      .at(-1);
    assert.ok(confirm);
    await act(async () => confirm.click());
    assert.deepEqual(emitted.at(-1), [
      "task:move",
      { taskId: "unassigned", toStatus: "pending", npcId: "profile" },
    ]);
  } finally {
    await act(async () => root.unmount());
    el.remove();
    localStorage.clear();
  }
});

test("status change reveals the moved card only after server props confirm it", async () => {
  localStorage.clear();
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  const original = HTMLElement.prototype.scrollIntoView;
  const revealed: string[] = [];
  HTMLElement.prototype.scrollIntoView = function () {
    revealed.push(this.textContent ?? "");
  };
  const socket = { on() {}, off() {}, emit() {} } as unknown as Socket;
  const render = async (status: string) =>
    act(async () =>
      root.render(
        <I18nProvider initialLocale="en">
          <TaskBoard
            channelId="office"
            isOpen
            onClose={() => {}}
            socket={socket}
            tasks={[
              { id: "moving", title: "Reveal this task", summary: null, status, npcId: "npc" },
            ]}
          />
        </I18nProvider>,
      ),
    );
  try {
    await render("stalled");
    const select = el.querySelector("select")!;
    await act(async () => {
      select.value = "done";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.equal(revealed.length, 0, "request alone does not scroll");
    await render("stalled");
    assert.equal(revealed.length, 0, "unrelated update does not scroll");
    await render("complete");
    assert.equal(revealed.length, 1);
    assert.ok(revealed[0].includes("Reveal this task"));
    await render("complete");
    assert.equal(revealed.length, 1, "subsequent updates do not repeat scrolling");
  } finally {
    await act(async () => root.unmount());
    el.remove();
    if (original) HTMLElement.prototype.scrollIntoView = original;
    else delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
    localStorage.clear();
  }
});
