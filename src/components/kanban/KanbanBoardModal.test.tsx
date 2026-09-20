import "../../test-setup/dom";
import assert from "node:assert/strict";
import test from "node:test";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n/context";
import { KANBAN_TASK_STATUSES } from "@/lib/hermes/deskrpg-plugin-types";

import ArtifactsModal from "../artifacts/ArtifactsModal";
import KanbanBoardModal from "./KanbanBoardModal";
import type { TaskDrawerArtifacts } from "./TaskDrawer";
import { PLUGIN_INSTALL_COMMAND } from "./kanban-view-model";

const CHANNEL = "ch-1";

const status = (overrides: Record<string, unknown> = {}) => ({
  pluginStatus: "ready",
  pluginVersion: "0.6.0",
  capabilities: ["kanban", "cron", "events"],
  timezone: "Asia/Seoul",
  boardSlug: "deskrpg-ch-1",
  dispatcherPresent: true,
  attachments: true,
  lastPolledAt: null,
  lastError: null,
  minVersion: "0.6.0",
  working: [],
  ...overrides,
});

const npcs = [
  { npcId: "n1", npcName: "소피", profileName: "sophie", active: true },
  { npcId: "n2", npcName: "잠든 NPC", profileName: "sleepy", active: false },
];

const board = (overrides: Record<string, unknown> = {}) => ({
  columns: [
    { name: "done", tasks: [{ id: "t-done", title: "끝난 카드", status: "done" }] },
    {
      name: "todo",
      tasks: [{ id: "t-todo", title: "할 카드", status: "todo", assignee: "sophie" }],
    },
    { name: "archived", tasks: [{ id: "t-arch", title: "보관 카드", status: "archived" }] },
  ],
  tenants: [],
  assignees: ["sophie"],
  latest_event_id: null,
  now: "2026-09-14T00:00:00Z",
  npcs,
  ...overrides,
});

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });

async function mount(
  handler: Handler,
  props: {
    channelId?: string;
    refreshTick?: number;
    debounceMs?: number;
    onConnectGateway?: () => void;
    initialTaskId?: string | null;
    focusRequest?: { taskId: string; seq: number } | null;
    covered?: boolean;
    artifacts?: TaskDrawerArtifacts | null;
    artifactsRefreshTick?: number;
  } = {},
) {
  // 보기 방식·필터는 채널별 localStorage 에 남는다. 한 테스트가 켠 "보관함 보기" 가 다음
  // 테스트의 조회 URL 을 바꾸지 않도록 마운트마다 비운다.
  try {
    globalThis.localStorage?.clear();
  } catch {
    // 저장소가 없는 환경이면 지울 것도 없다.
  }
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return handler(url, init);
  }) as typeof fetch;
  const host = document.createElement("div");
  document.body.append(host);
  const root: Root = createRoot(host);
  let closed = false;
  const render = async (next: typeof props = props) =>
    act(async () =>
      root.render(
        <I18nProvider initialLocale="ko">
          <KanbanBoardModal channelId={CHANNEL} onClose={() => (closed = true)} {...next} />
        </I18nProvider>,
      ),
    );
  await render();
  // 상태 → 보드 두 번의 fetch 가 끝나도록 마이크로태스크를 비운다.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return {
    host,
    calls,
    render,
    isClosed: () => closed,
    click: async (label: string) => {
      const button = Array.from(host.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === label,
      );
      assert.ok(button, `button "${label}"`);
      await act(async () => button.click());
    },
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
      globalThis.fetch = original;
    },
  };
}

const happy: Handler = (url) => {
  if (url.includes("/automation/status")) return json(status());
  if (url.includes("/kanban/board")) return json(board());
  return json({ code: "not_found", message: "no route" }, { status: 404 });
};

function key(el: Element, value: string) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }));
}

async function submitKeyboardMove(host: HTMLElement, taskId = "t-todo") {
  const handle = host.querySelector<HTMLButtonElement>(`[data-card-move-handle="${taskId}"]`);
  assert.ok(handle, `move handle for ${taskId}`);
  await act(async () => {
    handle.focus();
    key(handle, " ");
    key(handle, "ArrowRight");
    key(handle, "Enter");
  });
  return handle;
}

const detail = (task: Record<string, unknown>) => ({
  task,
  comments: [],
  events: [],
  attachments: [],
  links: { parents: [], children: [] },
  runs: [],
});

test("R4: move PATCHes status once, keeps counts unchanged while pending, then reloads server truth", async () => {
  let patchResolve!: (response: Response) => void;
  const patch = new Promise<Response>((resolve) => (patchResolve = resolve));
  let boardReads = 0;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const f = await mount((url, init) => {
    requests.push({ url, init });
    if (url.includes("/automation/status")) return json(status());
    if (url.includes("/kanban/board")) {
      boardReads += 1;
      return json(
        boardReads === 1
          ? board()
          : board({
              columns: [
                { name: "done", tasks: [] },
                { name: "todo", tasks: [] },
                {
                  name: "scheduled",
                  tasks: [{ id: "t-todo", title: "할 카드", status: "scheduled" }],
                },
              ],
            }),
      );
    }
    if (url.endsWith("/kanban/tasks/t-todo") && init?.method === "PATCH") return patch;
    return json({ code: "not_found", message: "no route" }, { status: 404 });
  });
  try {
    await submitKeyboardMove(f.host);
    assert.equal(requests.filter((request) => request.init?.method === "PATCH").length, 1);
    const write = requests.find((request) => request.init?.method === "PATCH");
    assert.equal(write?.url, "/api/channels/ch-1/kanban/tasks/t-todo");
    assert.deepEqual(JSON.parse(String(write?.init?.body)), { status: "scheduled" });
    assert.match(
      f.host.querySelector('[data-move-status="pending"]')?.textContent ?? "",
      /할 카드/,
    );
    assert.match(f.host.querySelector('[data-move-status="pending"]')?.textContent ?? "", /예약됨/);
    assert.ok(f.host.querySelector('[data-column="todo"]')?.textContent?.includes("할 카드"));
    assert.equal(
      f.host.querySelector('[data-column="scheduled"]')?.textContent?.includes("할 카드"),
      false,
    );

    await act(async () =>
      patchResolve(json({ task: { id: "t-todo", title: "할 카드", status: "scheduled" } })),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    assert.equal(boardReads, 2);
    assert.ok(f.host.querySelector('[data-column="scheduled"]')?.textContent?.includes("할 카드"));
    assert.equal(
      f.host.querySelector('[data-move-status="success"]')?.getAttribute("role"),
      "status",
    );
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    assert.equal(
      document.activeElement,
      f.host.querySelector('[data-card-move-handle="t-todo"]'),
      "focus follows the authoritative card into its new column",
    );
  } finally {
    await f.cleanup();
  }
});

test("R3/R4: authoritative deletion restores focus to the board fallback", async () => {
  let reads = 0;
  const f = await mount((url, init) => {
    if (url.includes("/automation/status")) return json(status());
    if (url.includes("/kanban/board")) {
      reads += 1;
      return json(reads === 1 ? board() : board({ columns: [{ name: "todo", tasks: [] }] }));
    }
    if (url.endsWith("/kanban/tasks/t-todo") && init?.method === "PATCH") {
      return json({ task: { id: "t-todo", title: "할 카드", status: "scheduled" } });
    }
    return json({ code: "not_found", message: "no route" }, { status: 404 });
  });
  try {
    await submitKeyboardMove(f.host);
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    assert.equal(document.activeElement, f.host.querySelector("[data-kanban-board-root]"));
  } finally {
    await f.cleanup();
  }
});

test("R4/R5: channel change hides stale cards and cannot submit until the new board loads", async () => {
  let releaseStatus!: (response: Response) => void;
  const delayedStatus = new Promise<Response>((resolve) => (releaseStatus = resolve));
  let patches = 0;
  const f = await mount((url, init) => {
    if (url.includes("/channels/ch-2/automation/status")) return delayedStatus;
    if (url.includes("/automation/status")) return json(status());
    if (url.includes("/kanban/board")) return json(board());
    if (init?.method === "PATCH") patches += 1;
    return json({ task: { id: "t-todo", title: "할 카드", status: "scheduled" } });
  });
  try {
    const staleHandle = f.host.querySelector<HTMLButtonElement>('[data-card-move-handle="t-todo"]');
    assert.ok(staleHandle);
    await f.render({ channelId: "ch-2" });
    await act(async () => {
      key(staleHandle, " ");
      key(staleHandle, "ArrowRight");
      key(staleHandle, "Enter");
    });
    assert.equal(f.host.querySelector('[data-task-id="t-todo"]'), null);
    assert.equal(patches, 0);
    await act(async () => releaseStatus(json(status())));
  } finally {
    await f.cleanup();
  }
});

test("R4/R5: only one pre-submit card can be active", async () => {
  let patches = 0;
  const f = await mount((url, init) => {
    if (url.includes("/automation/status")) return json(status());
    if (url.includes("/kanban/board"))
      return json(
        board({
          columns: [
            {
              name: "todo",
              tasks: [
                { id: "t-todo", title: "첫 카드", status: "todo" },
                { id: "t-other", title: "둘째 카드", status: "todo" },
              ],
            },
          ],
        }),
      );
    if (init?.method === "PATCH") patches += 1;
    return json({ task: {} });
  });
  try {
    const first = f.host.querySelector<HTMLButtonElement>('[data-card-move-handle="t-todo"]')!;
    const second = f.host.querySelector<HTMLButtonElement>('[data-card-move-handle="t-other"]')!;
    await act(async () => key(first, " "));
    assert.equal(first.disabled, false, "active handle remains enabled");
    assert.equal(second.disabled, true, "other handles are disabled");
    await act(async () => {
      key(second, " ");
      key(second, "ArrowRight");
      key(second, "Enter");
    });
    assert.equal(patches, 0);
  } finally {
    await f.cleanup();
  }
});

test("R4/R5: duplicate submit is ignored and PATCH success plus GET failure retries only the read", async () => {
  let patchResolve!: (response: Response) => void;
  const patch = new Promise<Response>((resolve) => (patchResolve = resolve));
  let boardReads = 0;
  let patchCount = 0;
  const f = await mount((url, init) => {
    if (url.includes("/automation/status")) return json(status());
    if (url.includes("/kanban/board")) {
      boardReads += 1;
      if (boardReads === 2)
        return json({ code: "upstream", message: "read failed" }, { status: 503 });
      return json(board());
    }
    if (url.endsWith("/kanban/tasks/t-todo") && init?.method === "PATCH") {
      patchCount += 1;
      return patch;
    }
    return json({ code: "not_found", message: "no route" }, { status: 404 });
  });
  try {
    await submitKeyboardMove(f.host);
    await submitKeyboardMove(f.host);
    assert.equal(patchCount, 1);
    assert.equal(
      f.host.querySelector<HTMLButtonElement>('[data-card-move-handle="t-todo"]')?.disabled,
      true,
    );
    await act(async () =>
      patchResolve(json({ task: { id: "t-todo", title: "할 카드", status: "scheduled" } })),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    assert.match(
      f.host.querySelector('[data-move-status="unconfirmed"]')?.textContent ?? "",
      /저장.*최신 상태.*확인하지 못/,
    );
    await f.click("다시 확인");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    assert.equal(patchCount, 1, "read retry must not repeat PATCH");
    assert.equal(boardReads, 3);
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    assert.equal(document.activeElement, f.host.querySelector('[data-card-move-handle="t-todo"]'));
  } finally {
    await f.cleanup();
  }
});

test("R4: a superseded post-PATCH reload reconciles with the newer applied server truth", async () => {
  let releaseOldRead!: (response: Response) => void;
  const oldRead = new Promise<Response>((resolve) => (releaseOldRead = resolve));
  let oldReadStarted!: () => void;
  const started = new Promise<void>((resolve) => (oldReadStarted = resolve));
  let boardReads = 0;
  let patches = 0;
  const movedBoard = board({
    columns: [
      { name: "todo", tasks: [] },
      { name: "scheduled", tasks: [{ id: "t-todo", title: "할 카드", status: "scheduled" }] },
    ],
  });
  const f = await mount((url, init) => {
    if (url.includes("/automation/status")) return json(status());
    if (url.includes("/kanban/board")) {
      boardReads += 1;
      if (boardReads === 2) {
        oldReadStarted();
        return oldRead;
      }
      return json(boardReads === 1 ? board() : movedBoard);
    }
    if (url.endsWith("/kanban/tasks/t-todo") && init?.method === "PATCH") {
      patches += 1;
      return json({ task: { id: "t-todo", title: "할 카드", status: "scheduled" } });
    }
    return json({ code: "not_found", message: "no route" }, { status: 404 });
  });
  try {
    await submitKeyboardMove(f.host);
    await started;
    await act(async () =>
      f.host.querySelector<HTMLButtonElement>('button[aria-label="새로고침"]')?.click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    assert.ok(f.host.querySelector('[data-column="scheduled"]')?.textContent?.includes("할 카드"));
    await act(async () => releaseOldRead(json(board())));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    assert.equal(patches, 1);
    assert.equal(f.host.querySelector('[data-move-status="unconfirmed"]'), null);
    assert.match(f.host.querySelector('[data-move-status="success"]')?.textContent ?? "", /예약됨/);
  } finally {
    await f.cleanup();
  }
});

test("R5: successful read retry focuses the board fallback when the moved card disappeared", async () => {
  let boardReads = 0;
  const f = await mount((url, init) => {
    if (url.includes("/automation/status")) return json(status());
    if (url.includes("/kanban/board")) {
      boardReads += 1;
      if (boardReads === 2)
        return json({ code: "upstream", message: "read failed" }, { status: 503 });
      return json(boardReads === 1 ? board() : board({ columns: [{ name: "todo", tasks: [] }] }));
    }
    if (url.endsWith("/kanban/tasks/t-todo") && init?.method === "PATCH") {
      return json({ task: { id: "t-todo", title: "할 카드", status: "scheduled" } });
    }
    return json({ code: "not_found", message: "no route" }, { status: 404 });
  });
  try {
    await submitKeyboardMove(f.host);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    assert.ok(f.host.querySelector('[data-move-status="unconfirmed"]'));
    await f.click("다시 확인");
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    assert.equal(document.activeElement, f.host.querySelector("[data-kanban-board-root]"));
  } finally {
    await f.cleanup();
  }
});

test("R1/R5: stale source and server failure cancel/fail without false success", async () => {
  let current = board();
  let patchCount = 0;
  const f = await mount((url, init) => {
    if (url.includes("/automation/status")) return json(status());
    if (url.includes("/kanban/board")) return json(current);
    if (url.endsWith("/kanban/tasks/t-todo") && init?.method === "PATCH") {
      patchCount += 1;
      return json({ code: "forbidden", message: "권한 없음" }, { status: 403 });
    }
    return json({ code: "not_found", message: "no route" }, { status: 404 });
  });
  try {
    const handle = f.host.querySelector<HTMLButtonElement>('[data-card-move-handle="t-todo"]');
    assert.ok(handle);
    await act(async () => {
      key(handle, " ");
      key(handle, "ArrowRight");
    });
    current = board({
      columns: [
        { name: "done", tasks: [] },
        { name: "scheduled", tasks: [{ id: "t-todo", title: "할 카드", status: "scheduled" }] },
      ],
    });
    await act(async () =>
      f.host.querySelector<HTMLButtonElement>('button[aria-label="새로고침"]')?.click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    await act(async () => key(handle, "Enter"));
    assert.equal(patchCount, 0, "changed source cancels before write");

    current = board();
    await act(async () =>
      f.host.querySelector<HTMLButtonElement>('button[aria-label="새로고침"]')?.click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    await submitKeyboardMove(f.host);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    assert.equal(patchCount, 1);
    assert.match(
      f.host.querySelector('[data-move-status="error"]')?.textContent ?? "",
      /권한 없음/,
    );
    assert.equal(f.host.querySelector('[data-move-status="success"]'), null);
  } finally {
    await f.cleanup();
  }
});

test("R3/R5: Escape while the swarm dialog is open does not close the board modal", async () => {
  const f = await mount((url) => {
    if (url.includes("/automation/status"))
      return json(status({ capabilities: ["kanban", "swarm"] }));
    if (url.includes("/kanban/board")) return json(board());
    return json({ code: "not_found", message: "no route" }, { status: 404 });
  });
  try {
    await f.click("스웜");
    assert.ok(f.host.querySelector('[aria-labelledby="swarm-dialog-title"]'));
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    assert.equal(f.isClosed(), false);
  } finally {
    await f.cleanup();
  }
});

test("R4: completion refreshes detail only when the moved card is currently selected", async () => {
  let patchResolve!: (response: Response) => void;
  const patch = new Promise<Response>((resolve) => (patchResolve = resolve));
  let boardReads = 0;
  const detailReads = new Map<string, number>();
  const f = await mount(
    (url, init) => {
      if (url.includes("/automation/status")) return json(status());
      if (url.includes("/kanban/board")) {
        boardReads += 1;
        return json(board());
      }
      if (url.endsWith("/kanban/tasks/t-todo") && init?.method === "PATCH") return patch;
      const taskId = url.match(/\/kanban\/tasks\/(t-[^/?]+)$/)?.[1];
      if (taskId) {
        detailReads.set(taskId, (detailReads.get(taskId) ?? 0) + 1);
        return json(
          detail({
            id: taskId,
            title: taskId === "t-todo" ? "할 카드" : "끝난 카드",
            status: taskId === "t-todo" ? "todo" : "done",
          }),
        );
      }
      return json({ code: "not_found", message: "no route" }, { status: 404 });
    },
    { initialTaskId: "t-todo" },
  );
  try {
    await submitKeyboardMove(f.host);
    await act(async () =>
      f.host.querySelector<HTMLButtonElement>('[data-card-detail="t-done"]')?.click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    assert.equal(detailReads.get("t-done"), 1);

    await act(async () =>
      patchResolve(json({ task: { id: "t-todo", title: "할 카드", status: "scheduled" } })),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    assert.equal(boardReads, 2);
    assert.equal(detailReads.get("t-done"), 1, "unrelated current drawer is not refreshed");
  } finally {
    await f.cleanup();
  }
});

test("R4: a moved card selected while pending receives the completion detail refresh", async () => {
  let patchResolve!: (response: Response) => void;
  const patch = new Promise<Response>((resolve) => (patchResolve = resolve));
  let detailReads = 0;
  const f = await mount((url, init) => {
    if (url.includes("/automation/status")) return json(status());
    if (url.includes("/kanban/board")) return json(board());
    if (url.endsWith("/kanban/tasks/t-todo") && init?.method === "PATCH") return patch;
    if (url.endsWith("/kanban/tasks/t-todo")) {
      detailReads += 1;
      return json(detail({ id: "t-todo", title: "할 카드", status: "todo" }));
    }
    return json({ code: "not_found", message: "no route" }, { status: 404 });
  });
  try {
    await submitKeyboardMove(f.host);
    await act(async () =>
      f.host.querySelector<HTMLButtonElement>('[data-card-detail="t-todo"]')?.click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    assert.equal(detailReads, 1);
    await act(async () =>
      patchResolve(json({ task: { id: "t-todo", title: "할 카드", status: "scheduled" } })),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    assert.equal(detailReads, 2);
  } finally {
    await f.cleanup();
  }
});

test("R4: success reports authoritative status and does not claim target when the card disappeared", async () => {
  for (const authoritative of ["ready", "missing"] as const) {
    let boardReads = 0;
    const f = await mount((url, init) => {
      if (url.includes("/automation/status")) return json(status());
      if (url.includes("/kanban/board")) {
        boardReads += 1;
        if (boardReads === 1) return json(board());
        return json(
          board({
            columns:
              authoritative === "ready"
                ? [{ name: "ready", tasks: [{ id: "t-todo", title: "할 카드", status: "ready" }] }]
                : [{ name: "todo", tasks: [] }],
          }),
        );
      }
      if (url.endsWith("/kanban/tasks/t-todo") && init?.method === "PATCH") {
        return json({ task: { id: "t-todo", title: "할 카드", status: "scheduled" } });
      }
      return json({ code: "not_found", message: "no route" }, { status: 404 });
    });
    try {
      await submitKeyboardMove(f.host);
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      const message = f.host.querySelector('[data-move-status="success"]')?.textContent ?? "";
      if (authoritative === "ready") assert.match(message, /준비됨/);
      else {
        assert.match(message, /최신 보드/);
        assert.doesNotMatch(message, /예약됨/);
      }
    } finally {
      await f.cleanup();
    }
  }
});

test("R6: columns render in the fixed order and archived only after the toggle", async () => {
  const f = await mount(happy);
  try {
    const names = () =>
      Array.from(f.host.querySelectorAll<HTMLElement>("[data-column]")).map(
        (el) => el.dataset.column,
      );
    assert.deepEqual(
      names(),
      KANBAN_TASK_STATUSES.filter((n) => n !== "archived"),
    );
    assert.ok(
      f.calls.some((c) => c.endsWith("/kanban/board")),
      "board fetched without archive",
    );
    assert.equal(f.host.textContent?.includes("보관 카드"), false);

    // 툴바에 체크박스가 여럿이라(경고만·보관함) 첫 번째를 집으면 엉뚱한 것을 누른다.
    const toggle = f.host.querySelector<HTMLInputElement>("input[data-kanban-archive-toggle]");
    assert.ok(toggle);
    await act(async () => {
      toggle.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.deepEqual(names(), [...KANBAN_TASK_STATUSES]);
    assert.ok(
      f.calls.some((c) => c.endsWith("/kanban/board?include_archived=true")),
      "archived toggle refetches with include_archived=true",
    );
    assert.ok(f.host.textContent?.includes("보관 카드"));
  } finally {
    await f.cleanup();
  }
});

test("R31: 428 renders the upgrade notice with the install command and minVersion", async () => {
  const f = await mount((url) => {
    if (url.includes("/automation/status")) return json(status({ minVersion: "0.6.0" }));
    return json(
      { code: "plugin_upgrade_required", message: "too old", minVersion: "0.6.0" },
      { status: 428 },
    );
  });
  try {
    const blocker = f.host.querySelector<HTMLElement>("[data-blocker]");
    assert.equal(blocker?.dataset.blocker, "upgrade_required");
    assert.match(blocker?.textContent ?? "", /플러그인 업데이트 필요/);
    assert.match(blocker?.textContent ?? "", /0\.6\.0/);
    assert.ok(blocker?.textContent?.includes(PLUGIN_INSTALL_COMMAND));
    assert.equal(f.host.querySelector("[data-column]"), null, "no columns behind a blocker");
  } finally {
    await f.cleanup();
  }
});

test("R31: 409 gateway_not_bound from status renders the gateway notice", async () => {
  const f = await mount(() =>
    json({ code: "gateway_not_bound", message: "Channel has no gateway bound" }, { status: 409 }),
  );
  try {
    assert.equal(
      f.host.querySelector<HTMLElement>("[data-blocker]")?.dataset.blocker,
      "gateway_not_bound",
    );
    assert.match(f.host.textContent ?? "", /게이트웨이 연결 필요/);
  } finally {
    await f.cleanup();
  }
});

test("E6: 503 renders the reason and a retry button that refetches", async () => {
  let boardCalls = 0;
  const f = await mount((url) => {
    if (url.includes("/automation/status")) return json(status());
    boardCalls += 1;
    return json({ code: "board_create_failed", message: "disk full" }, { status: 503 });
  });
  try {
    const blocker = f.host.querySelector<HTMLElement>("[data-blocker]");
    assert.equal(blocker?.dataset.blocker, "board_unavailable");
    assert.match(blocker?.textContent ?? "", /disk full/);
    await f.click("재시도");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.equal(boardCalls, 2);
  } finally {
    await f.cleanup();
  }
});

test("R9/E6: dispatcherPresent=false and lastError show as banners above the board", async () => {
  const f = await mount((url) => {
    if (url.includes("/automation/status")) {
      return json(status({ dispatcherPresent: false, lastError: "poll timeout" }));
    }
    return json(board());
  });
  try {
    const banners = Array.from(f.host.querySelectorAll<HTMLElement>("[data-banner]")).map(
      (el) => el.dataset.banner,
    );
    assert.deepEqual(banners, ["dispatcher", "lastError"]);
    assert.match(f.host.textContent ?? "", /디스패처가 없어/);
    assert.match(f.host.textContent ?? "", /poll timeout/);
    // 열은 그대로 그려진다 — 배너는 막지 않는다.
    assert.ok(f.host.querySelector("[data-column]"));
  } finally {
    await f.cleanup();
  }
});

test("R7: the create form lists only active NPCs as assignee options", async () => {
  const f = await mount(happy);
  try {
    await f.click("새 카드");
    const select = f.host.querySelector<HTMLSelectElement>("#kanban-assignee");
    assert.ok(select);
    const options = Array.from(select.options).map((o) => [o.value, o.textContent]);
    assert.deepEqual(options, [
      ["", "(미배정)"],
      ["n1", "소피"],
    ]);
    // 선행 카드 후보는 같은 보드의 카드 전부.
    const parents = Array.from(
      f.host.querySelectorAll<HTMLInputElement>('form input[type="checkbox"]'),
    );
    assert.ok(parents.length >= 2);
  } finally {
    await f.cleanup();
  }
});

test("R8/R9: create posts to the server, shows the 400 message verbatim, and surfaces warning", async () => {
  let attempt = 0;
  const f = await mount((url, init) => {
    if (url.includes("/automation/status")) return json(status());
    if (url.endsWith("/kanban/board")) return json(board());
    if (url.endsWith("/kanban/tasks") && init?.method === "POST") {
      attempt += 1;
      if (attempt === 1) {
        return json(
          { code: "assignee_not_in_channel", message: "Assignee must be an NPC" },
          { status: 400 },
        );
      }
      return json(
        {
          task: { id: "t-new", title: "새 카드", status: "todo" },
          warning: "dispatcher missing",
        },
        { status: 201 },
      );
    }
    if (url.endsWith("/kanban/tasks/t-new")) {
      return json({
        task: { id: "t-new", title: "새 카드", status: "todo" },
        comments: [],
        events: [],
        attachments: [],
        links: { parents: [], children: [] },
        runs: [],
      });
    }
    return json({ code: "not_found", message: "no route" }, { status: 404 });
  });
  try {
    await f.click("새 카드");
    const title = f.host.querySelector<HTMLInputElement>("#kanban-title");
    assert.ok(title);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(title, "새 카드");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await f.click("만들기");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const alert = f.host.querySelector('[role="alert"]');
    assert.match(alert?.textContent ?? "", /assignee_not_in_channel: Assignee must be an NPC/);

    await f.click("만들기");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // 성공하면 폼이 닫히고 경고가 보드 상단과 드로어에 뜬다.
    assert.equal(f.host.querySelector("#kanban-title"), null);
    assert.equal(
      f.host
        .querySelector<HTMLElement>('[data-banner="board"]')
        ?.textContent?.includes("dispatcher missing"),
      true,
    );
    assert.ok(
      f.calls.some((c) => c === "GET /api/channels/ch-1/kanban/tasks/t-new"),
      "drawer opened",
    );
    assert.ok(
      f.calls.filter((c) => c.endsWith("/kanban/board")).length >= 2,
      "board refetched after create (R26)",
    );
  } finally {
    await f.cleanup();
  }
});

test("R26: a kanban:event tick refetches the board after the debounce", async () => {
  // 디바운스 창을 넉넉히 둔다 — 1ms 면 전체 스위트 부하에서 두 render 사이에 타이머가 먼저 터져
  // 두 번 fetch 되는 일이 실제로 있었다(간헐 실패). 창 안에 두 tick 이 확실히 들어가게 50ms.
  const f = await mount(happy, { refreshTick: 0, debounceMs: 50 });
  try {
    const before = f.calls.filter((c) => c.endsWith("/kanban/board")).length;
    await f.render({ refreshTick: 1, debounceMs: 50 });
    await f.render({ refreshTick: 2, debounceMs: 50 });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    const after = f.calls.filter((c) => c.endsWith("/kanban/board")).length;
    assert.equal(after, before + 1, "two ticks inside the debounce window collapse into one fetch");
  } finally {
    await f.cleanup();
  }
});

test("R26: two open clients independently refetch after the same kanban:event tick", async () => {
  const original = globalThis.fetch;
  let boardFetches = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/automation/status")) return json(status());
    if (url.includes("/kanban/board")) {
      boardFetches++;
      return json(board());
    }
    return json({ code: "not_found", message: "no route" }, { status: 404 });
  }) as typeof fetch;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (refreshTick: number) =>
    act(async () =>
      root.render(
        <I18nProvider initialLocale="ko">
          <KanbanBoardModal
            channelId={CHANNEL}
            onClose={() => undefined}
            refreshTick={refreshTick}
            debounceMs={50}
          />
          <KanbanBoardModal
            channelId={CHANNEL}
            onClose={() => undefined}
            refreshTick={refreshTick}
            debounceMs={50}
          />
        </I18nProvider>,
      ),
    );
  try {
    await render(0);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const before = boardFetches;
    await render(1);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 150)));
    assert.equal(boardFetches, before + 2, "each client performs its own authoritative refetch");
    assert.equal(host.querySelectorAll('[data-task-id="t-todo"]').length, 2);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    globalThis.fetch = original;
  }
});

test("unbound gateway offers connection to owners and guidance to members", async () => {
  let connects = 0;
  const f = await mount(() => json({ code: "gateway_not_bound" }, { status: 409 }), {
    onConnectGateway: () => {
      connects++;
    },
  });
  try {
    await f.click("게이트웨이 연결하기");
    assert.equal(connects, 1);
    assert.ok(!f.host.querySelector("[data-blocker]")?.textContent?.includes("재시도"));
    await f.render({});
    assert.match(f.host.textContent ?? "", /오피스 소유자에게/);
    assert.equal(f.host.querySelector("[data-blocker] button"), null);
  } finally {
    await f.cleanup();
  }
});

const findButton = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);

test("스웜: capabilities 에 swarm 이 없으면 버튼이 렌더되지 않는다", async () => {
  const f = await mount((url) => {
    if (url.includes("/automation/status")) return json(status());
    if (url.includes("/kanban/board")) return json(board());
    return json({ code: "not_found", message: "no route" }, { status: 404 });
  });
  try {
    assert.equal(findButton(f.host, "스웜"), undefined, "swarm capability 없이는 버튼 없음");
  } finally {
    await f.cleanup();
  }
});

test("스웜: 다이얼로그가 제출하는 idempotencyKey 는 두 번 제출해도 같다", async () => {
  const swarmBodies: Array<{ idempotencyKey: string }> = [];
  let swarmAttempts = 0;
  const f = await mount((url, init) => {
    if (url.includes("/automation/status")) return json(status({ capabilities: ["swarm"] }));
    if (url.includes("/kanban/board")) return json(board());
    if (url.endsWith("/swarm") && init?.method === "POST") {
      swarmAttempts += 1;
      const body = JSON.parse(String(init.body)) as { idempotencyKey: string };
      swarmBodies.push(body);
      // 첫 시도는 실패시켜 다이얼로그를 열린 채로 두고, 재시도가 같은 키를 쓰는지 본다.
      if (swarmAttempts === 1) {
        return json({ code: "unavailable", message: "잠깐 실패" }, { status: 503 });
      }
      return json({
        root_id: "t-root",
        worker_ids: ["t-w1"],
        verifier_id: "t-v",
        synthesizer_id: "t-s",
      });
    }
    return json({ code: "not_found", message: "no route" }, { status: 404 });
  });
  try {
    await f.click("스웜");
    const dialog = f.host.querySelector<HTMLElement>('[aria-labelledby="swarm-dialog-title"]');
    assert.ok(dialog, "스웜 다이얼로그가 열린다");

    const setValue = (el: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };

    const goalInput = f.host.querySelector<HTMLInputElement>("#swarm-goal");
    assert.ok(goalInput);
    await act(async () => setValue(goalInput, "테스트 목표"));

    const workerInput = f.host.querySelector<HTMLInputElement>('input[aria-label="맡길 일"]');
    assert.ok(workerInput);
    await act(async () => setValue(workerInput, "워커 작업"));

    const submitButton = () => findButton(f.host, "스웜 시작");
    assert.ok(submitButton());
    await act(async () => submitButton()?.click());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 첫 시도는 503 으로 실패했으니 다이얼로그가 여전히 열려 있다.
    const dialogAfterFailure = f.host.querySelector<HTMLElement>(
      '[aria-labelledby="swarm-dialog-title"]',
    );
    assert.ok(dialogAfterFailure);
    // 실패 메시지는 다이얼로그 안에서 보여야 한다 — boardWarning 배너는 이 오버레이 밑에 깔려
    // 사용자에게 보이지 않는다.
    const alert = dialogAfterFailure.querySelector<HTMLElement>('[role="alert"]');
    assert.ok(alert, "다이얼로그 안에 오류 배너가 있다");
    assert.ok(alert.textContent?.includes("잠깐 실패"), "서버 실패 메시지가 그대로 보인다");

    await act(async () => submitButton()?.click());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    assert.equal(swarmBodies.length, 2);
    assert.equal(swarmBodies[0].idempotencyKey, swarmBodies[1].idempotencyKey);
  } finally {
    await f.cleanup();
  }
});

test("스웜: 428 plugin_upgrade_required 는 다이얼로그 안에 kanban.swarm.unsupported 로 보인다", async () => {
  // capability 캐시가 낡아 버튼은 보이지만, 서버는 428 을 낸다 — 이 경로가 죽은 i18n 키
  // kanban.swarm.unsupported 의 제자리다.
  const f = await mount((url, init) => {
    if (url.includes("/automation/status")) return json(status({ capabilities: ["swarm"] }));
    if (url.includes("/kanban/board")) return json(board());
    if (url.endsWith("/swarm") && init?.method === "POST") {
      return json(
        { code: "plugin_upgrade_required", message: "too old", minVersion: "0.9.0" },
        { status: 428 },
      );
    }
    return json({ code: "not_found", message: "no route" }, { status: 404 });
  });
  try {
    await f.click("스웜");
    const dialog = f.host.querySelector<HTMLElement>('[aria-labelledby="swarm-dialog-title"]');
    assert.ok(dialog);

    const setValue = (el: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const goalInput = f.host.querySelector<HTMLInputElement>("#swarm-goal");
    assert.ok(goalInput);
    await act(async () => setValue(goalInput, "테스트 목표"));
    const workerInput = f.host.querySelector<HTMLInputElement>('input[aria-label="맡길 일"]');
    assert.ok(workerInput);
    await act(async () => setValue(workerInput, "워커 작업"));

    const submitButton = () => findButton(f.host, "스웜 시작");
    await act(async () => submitButton()?.click());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const stillOpen = f.host.querySelector<HTMLElement>('[aria-labelledby="swarm-dialog-title"]');
    assert.ok(stillOpen, "실패해도 다이얼로그는 열린 채로 남는다");
    const alert = stillOpen.querySelector<HTMLElement>('[role="alert"]');
    assert.ok(alert);
    assert.equal(alert.textContent, "이 게이트웨이의 플러그인은 스웜을 지원하지 않습니다.");
  } finally {
    await f.cleanup();
  }
});

test("스웜 루트 카드에서 블랙보드 JSON 이 코멘트로 보이지 않는다", async () => {
  const f = await mount(
    (url) => {
      if (url.includes("/automation/status")) return json(status());
      if (url.endsWith("/kanban/board")) return json(board());
      if (url.endsWith("/kanban/tasks/t-root")) {
        return json({
          task: { id: "t-root", title: "스웜 루트", status: "done" },
          comments: [
            {
              id: "bb",
              author: "swarm-orchestrator",
              body: '[swarm:blackboard] {"key":"topology","value":{"goal":"목표"}}',
              created_at: "2026-09-16T00:00:00Z",
            },
            { id: "c1", author: "nova", body: "시작합니다", created_at: "2026-09-16T00:01:00Z" },
          ],
          events: [],
          attachments: [],
          links: { parents: [], children: [] },
          runs: [],
        });
      }
      return json({ code: "not_found", message: "no route" }, { status: 404 });
    },
    { initialTaskId: "t-root" },
  );
  try {
    assert.equal(f.host.textContent?.includes("[swarm:blackboard]"), false);
    assert.equal(f.host.textContent?.includes("시작합니다"), true);
    assert.equal(f.host.textContent?.includes("topology"), true); // 표에는 있다
  } finally {
    await f.cleanup();
  }
});

const detailHandler =
  (detailReads: Map<string, number>): Handler =>
  (url) => {
    if (url.includes("/automation/status")) return json(status());
    if (url.includes("/kanban/board")) return json(board());
    const taskId = url.match(/\/kanban\/tasks\/(t-[^/?]+)$/)?.[1];
    if (taskId) {
      detailReads.set(taskId, (detailReads.get(taskId) ?? 0) + 1);
      return json(detail({ id: taskId, title: `카드 ${taskId}`, status: "todo" }));
    }
    if (url.includes("/artifacts")) return json({ artifacts: [], cursor: null, has_more: false });
    return json({ code: "not_found", message: "no route" }, { status: 404 });
  };

test("출처로 이동: 이미 열린 보드에서도 focusRequest 가 오면 그 카드의 상세로 바꾼다", async () => {
  const detailReads = new Map<string, number>();
  const first = { taskId: "t-todo", seq: 1 };
  const f = await mount(detailHandler(detailReads), {
    initialTaskId: "t-todo",
    focusRequest: first,
  });
  try {
    assert.equal(detailReads.get("t-todo"), 1);
    await f.render({ initialTaskId: "t-done", focusRequest: { taskId: "t-done", seq: 2 } });
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    assert.equal(detailReads.get("t-done"), 1, "새 카드의 상세를 연다");

    // 다른 카드를 직접 연 뒤 같은 카드로 다시 요청해도(seq 가 오름) 그 카드로 돌아온다.
    await act(async () =>
      f.host.querySelector<HTMLButtonElement>('[data-card-detail="t-todo"]')?.click(),
    );
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    assert.equal(detailReads.get("t-todo"), 2);
    await f.render({ initialTaskId: "t-done", focusRequest: { taskId: "t-done", seq: 3 } });
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    assert.equal(detailReads.get("t-done"), 2);
  } finally {
    await f.cleanup();
  }
});

test("결과물: 보드는 artifacts 를 카드 드로어에 그대로 넘긴다", async () => {
  const listed: string[] = [];
  const artifacts: TaskDrawerArtifacts = {
    list: async (taskId) => {
      listed.push(taskId);
      return [];
    },
    open: () => {},
  };
  const f = await mount(detailHandler(new Map()), { initialTaskId: "t-todo", artifacts });
  try {
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    assert.deepEqual(listed, ["t-todo"]);
    assert.ok(f.host.textContent?.includes("이 카드에서 만든 결과물이 없습니다"));
  } finally {
    await f.cleanup();
  }
});

test("결과물: 결과물 사건 신호가 연달아 와도 드로어는 디바운스 후 한 번만 다시 읽는다", async () => {
  let listCalls = 0;
  const artifacts: TaskDrawerArtifacts = {
    list: async () => {
      listCalls += 1;
      return [];
    },
    open: () => {},
  };
  const f = await mount(detailHandler(new Map()), {
    initialTaskId: "t-todo",
    artifacts,
    artifactsRefreshTick: 0,
  });
  try {
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    assert.equal(listCalls, 1);
    await f.render({ initialTaskId: "t-todo", artifacts, artifactsRefreshTick: 1 });
    await f.render({ initialTaskId: "t-todo", artifacts, artifactsRefreshTick: 2 });
    await f.render({ initialTaskId: "t-todo", artifacts, artifactsRefreshTick: 3 });
    assert.equal(listCalls, 1, "디바운스 전에는 다시 읽지 않는다");
    await act(async () => new Promise((r) => setTimeout(r, 350)));
    assert.equal(listCalls, 2, "연달은 사건은 한 번으로 접힌다");
  } finally {
    await f.cleanup();
  }
});

test("결과물 모달이 보드를 덮고 있으면(covered) Escape 로 보드를 닫지 않는다", async () => {
  const f = await mount(happy, { covered: true });
  try {
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    assert.equal(f.isClosed(), false);
    await f.render({ covered: false });
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    assert.equal(f.isClosed(), true);
  } finally {
    await f.cleanup();
  }
});

test("보드 위 결과물 모달: Escape 한 번은 결과물 모달만 닫고, 다음 Escape 가 보드를 닫는다", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return detailHandler(new Map())(url, init);
  }) as typeof fetch;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Harness() {
    const [kanban, setKanban] = useState(true);
    const [artifactsOpen, setArtifactsOpen] = useState(true);
    return (
      <I18nProvider initialLocale="ko">
        {kanban && (
          <KanbanBoardModal
            channelId={CHANNEL}
            covered={artifactsOpen}
            onClose={() => setKanban(false)}
          />
        )}
        {artifactsOpen && (
          <ArtifactsModal
            channelId={CHANNEL}
            npcs={[]}
            refreshTick={0}
            lastEvent={null}
            onOpenSource={() => {}}
            onClose={() => setArtifactsOpen(false)}
          />
        )}
      </I18nProvider>
    );
  }
  const shown = (id: string) => host.querySelector(`[aria-labelledby="${id}"]`) !== null;
  try {
    await act(async () => root.render(<Harness />));
    assert.ok(shown("kanban-modal-title") && shown("artifacts-modal-title"));
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    assert.equal(shown("artifacts-modal-title"), false, "결과물 모달이 닫힌다");
    assert.equal(shown("kanban-modal-title"), true, "보드는 남는다");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    assert.equal(shown("kanban-modal-title"), false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    globalThis.fetch = original;
  }
});
