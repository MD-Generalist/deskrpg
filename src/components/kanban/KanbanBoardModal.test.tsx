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
  capabilities: ["kanban", "cron", "events", "kanban_review_policy_v1"],
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
    initialCreateDraft?: { title: string; body: string; assigneeNpcId: string };
    focusRequest?: { taskId: string; seq: number } | null;
    covered?: boolean;
    artifacts?: TaskDrawerArtifacts | null;
    artifactsRefreshTick?: number;
    /** 헤더 선택기가 읽는 프로젝트 목록. 주지 않으면 빈 목록으로 답한다. */
    projects?: unknown[];
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
    // 프로젝트 목록은 헤더 선택기만 쓰는 곁가지다. 각 테스트의 handler 가 이것까지 다루게 하면
    // "보드를 몇 번 불렀나" 같은 셈이 조용히 틀어진다 — 여기서 빈 목록으로 답하고 만다.
    // 보드가 여럿인 화면을 보려면 그 테스트가 handler 에서 이 경로를 직접 가로채면 된다.
    if (/\/projects(\?|$)/.test(url)) return json({ projects: props.projects ?? [] });
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
  const originalRaf = globalThis.requestAnimationFrame;
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

    // 다음 페인트 콜백이 React의 서버 응답 렌더보다 먼저 실행되는 순서를 고정한다.
    globalThis.requestAnimationFrame = (callback) => {
      callback(performance.now());
      return 0;
    };
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
      document.activeElement === f.host.querySelector('[data-card-move-handle="t-todo"]'),
      true,
      "focus follows the authoritative card into its new column",
    );
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
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
    await act(async () => {
      const assignee = f.host.querySelector<HTMLSelectElement>("#kanban-assignee")!;
      assignee.value = "n1";
      assignee.dispatchEvent(new Event("change", { bubbles: true }));
      const criteria = f.host.querySelector<HTMLTextAreaElement>("#kanban-completion-criteria")!;
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(
        criteria,
        "검증한 결과",
      );
      criteria.dispatchEvent(new Event("input", { bubbles: true }));
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

test("서브프로젝트 필터는 보드와 목록 양쪽에 같게 걸린다", async () => {
  const tenantBoard = board({
    columns: [
      {
        name: "todo",
        tasks: [
          { id: "t-web", title: "웹 카드", status: "todo", tenant: "web" },
          { id: "t-api", title: "API 카드", status: "todo", tenant: "api" },
        ],
      },
    ],
    tenants: ["web", "api"],
  });
  const f = await mount((url) => {
    if (url.includes("/automation/status")) return json(status());
    if (url.includes("/kanban/board")) return json(tenantBoard);
    return json({ code: "not_found", message: "no route" }, { status: 404 });
  });
  try {
    assert.ok(f.host.textContent?.includes("웹 카드"));
    assert.ok(f.host.textContent?.includes("API 카드"));

    // 툴바의 서브프로젝트 선택에서 web 만 남긴다.
    const tenantSelect = Array.from(f.host.querySelectorAll<HTMLSelectElement>("select")).find(
      (el) => el.getAttribute("aria-label") === "서브프로젝트",
    );
    assert.ok(tenantSelect, "서브프로젝트 필터가 없다");
    await act(async () => {
      tenantSelect.value = "web";
      tenantSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    assert.ok(f.host.textContent?.includes("웹 카드"), "고른 서브프로젝트 카드가 사라졌다");
    assert.equal(
      f.host.textContent?.includes("API 카드"),
      false,
      "보드 뷰에서 필터가 아무 일도 하지 않는다 — 화면은 필터가 걸렸다고 말한다",
    );
    const todoColumn = f.host.querySelector<HTMLElement>('[data-column="todo"]');
    assert.ok(todoColumn);
    assert.ok(
      /(^|\D)1(\D|$)/.test(todoColumn.textContent ?? ""),
      `열 머리 개수가 거른 뒤 수가 아니다: ${todoColumn.textContent?.slice(0, 40)}`,
    );

    // 같은 필터로 목록 뷰로 바꾸면 같은 카드 집합이어야 한다.
    const listButton = Array.from(f.host.querySelectorAll<HTMLButtonElement>("button")).find(
      (el) => el.getAttribute("aria-label") === "목록",
    );
    assert.ok(listButton);
    await act(async () => {
      listButton.click();
    });
    assert.ok(f.host.textContent?.includes("웹 카드"));
    assert.equal(
      f.host.textContent?.includes("API 카드"),
      false,
      "두 표현이 다른 카드를 보이면 같은 데이터라고 할 수 없다",
    );
  } finally {
    await f.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 프로젝트(= 보드) 선택기 — 설계 2026-09-21 project-registry
// ---------------------------------------------------------------------------

const MAIN_PROJECT = {
  id: "p1",
  boardSlug: "deskrpg-main",
  name: "기본 프로젝트",
  status: "planned",
  isEventCarrier: true,
};
const SIDE_PROJECT = {
  id: "p2",
  boardSlug: "deskrpg-side",
  name: "둘째 프로젝트",
  status: "in_progress",
  isEventCarrier: false,
};

function plain(url: string) {
  return url.includes("/automation/status") ? json(status()) : json(board());
}

test("보드가 하나뿐이면 선택기를 그리지 않는다", async () => {
  const f = await mount(plain, { projects: [MAIN_PROJECT] });
  try {
    // 노드를 그대로 단언하지 않는다 — 실패 메시지가 DOM 트리를 직렬화하다 프로세스가 죽는다.
    assert.equal(
      f.host.querySelector("[data-project-picker]") === null,
      true,
      "고를 것이 없는데 선택기가 떴습니다",
    );
  } finally {
    await f.cleanup();
  }
});

test("보드가 둘이면 선택기가 뜨고, 고른 보드가 ?board= 로 나간다", async () => {
  const f = await mount(plain, { projects: [MAIN_PROJECT, SIDE_PROJECT] });
  try {
    const select = f.host.querySelector<HTMLSelectElement>("[data-project-picker]");
    assert.ok(select, "선택기가 없습니다");
    assert.deepEqual(
      [...select.options].map((o) => o.value),
      ["deskrpg-main", "deskrpg-side"],
    );
    assert.equal(select.value, "deskrpg-main", "기본은 사건 수신 보드입니다");

    await act(async () => {
      select.value = "deskrpg-side";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const boardCalls = f.calls.filter((c) => c.includes("/kanban/board"));
    assert.ok(
      boardCalls.some((c) => c.includes("board=deskrpg-side")),
      `고른 보드가 요청에 실리지 않았습니다: ${boardCalls.join(" | ")}`,
    );
  } finally {
    await f.cleanup();
  }
});

test("기본 보드를 보고 있으면 ?board= 를 붙이지 않는다 — 옛 요청과 같은 모양이다", async () => {
  const f = await mount(plain, { projects: [MAIN_PROJECT, SIDE_PROJECT] });
  try {
    const boardCalls = f.calls.filter((c) => c.includes("/kanban/board"));
    assert.ok(boardCalls.length > 0);
    assert.ok(
      boardCalls.every((c) => !c.includes("board=")),
      `기본 보드인데 board= 가 붙었습니다: ${boardCalls.join(" | ")}`,
    );
  } finally {
    await f.cleanup();
  }
});

test("타임라인은 capability 가 있을 때만 켜지고, 열면 실행 기록을 조회한다", async () => {
  const f = await mount((url) => {
    if (url.includes("/automation/status"))
      return json(status({ capabilities: ["kanban", "cron", "events", "kanban_views"] }));
    if (url.includes("/kanban/runs"))
      return json({
        runs: [],
        board: "deskrpg-ch-1",
        window: { from: 0, to: 1 },
        truncated: false,
      });
    if (url.includes("/kanban/board")) return json(board());
    return json({ code: "not_found", message: "no route" }, { status: 404 });
  });
  try {
    const button = Array.from(f.host.querySelectorAll<HTMLButtonElement>("button")).find(
      (el) => el.getAttribute("aria-label") === "타임라인",
    );
    assert.ok(button, "capability 가 있는데 타임라인 버튼이 없다");
    await act(async () => {
      button.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.ok(
      f.calls.some((c) => c.includes("/kanban/runs")),
      "타임라인을 열었는데 실행 기록을 조회하지 않았다",
    );
  } finally {
    await f.cleanup();
  }
});

test("capability 가 없으면 타임라인 버튼을 두지 않는다", async () => {
  // 눌러도 안 되는 버튼은 고장으로 읽힌다. 칸반 자체는 계속 돌아야 한다.
  const f = await mount(happy);
  try {
    const button = Array.from(f.host.querySelectorAll<HTMLButtonElement>("button")).find(
      (el) => el.getAttribute("aria-label") === "타임라인",
    );
    assert.equal(button, undefined);
    assert.equal(
      f.calls.some((c) => c.includes("/kanban/runs")),
      false,
    );
    // 보드는 멀쩡히 그려진다.
    assert.ok(f.host.querySelector('[data-column="todo"]'));
  } finally {
    await f.cleanup();
  }
});

test("타임라인이 목표일과 의존 화살표를 실제로 그린다 — 모달에서 값이 흘러야 한다", async () => {
  // 조각은 각각 초록인데 조각 사이의 배선이 끊겨 목표일도 화살표도 화면에 없던 결함을 고정한다.
  // 노드가 아니라 **값**으로 단언한다 — 선이 있는지가 아니라 그 선이 그 날짜인지를 본다.
  // 타임라인은 "오늘" 창을 그린다 — 날짜를 박아 두면 그 날이 지나는 순간 실패한다(2026-09-22 실측).
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayStart = today.getTime();
  const pad = (n: number) => String(n).padStart(2, "0");
  const targetDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const runStart = Math.floor((dayStart + 3600_000) / 1000);
  const timelineBoard = board({
    columns: [
      {
        name: "running",
        tasks: [
          { id: "parent", title: "부모", status: "done" },
          { id: "child", title: "자식", status: "running" },
        ],
      },
    ],
  });
  const f = await mount(
    (url) => {
      if (url.includes("/automation/status"))
        return json(
          status({
            capabilities: ["kanban", "cron", "events", "kanban_views"],
            boardSlug: "deskrpg-main",
          }),
        );
      if (url.includes("/kanban/runs"))
        return json({
          runs: [
            {
              id: "r1",
              status: "done",
              task_id: "parent",
              board: "deskrpg-main",
              profile: "sophie",
              task_title: "부모",
              started_at: runStart,
              ended_at: runStart + 600,
              outcome: "completed",
            },
            {
              id: "r2",
              status: "done",
              task_id: "child",
              board: "deskrpg-main",
              profile: "oliver",
              task_title: "자식",
              started_at: runStart + 1200,
              ended_at: runStart + 1800,
              outcome: "completed",
            },
          ],
          board: "deskrpg-main",
          window: { from: 0, to: 9_999_999_999 },
          truncated: false,
        });
      if (url.includes("/kanban/links"))
        return json({
          links: [{ parent_id: "parent", child_id: "child" }],
          board: "deskrpg-main",
        });
      if (url.includes("/kanban/board")) return json(timelineBoard);
      return json({ code: "not_found", message: "no route" }, { status: 404 });
    },
    {
      projects: [{ ...MAIN_PROJECT, boardSlug: "deskrpg-main", targetDate }],
    },
  );
  try {
    const timelineButton = Array.from(f.host.querySelectorAll<HTMLButtonElement>("button")).find(
      (el) => el.getAttribute("aria-label") === "타임라인",
    );
    assert.ok(timelineButton, "타임라인 버튼이 없다");
    await act(async () => {
      timelineButton.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const target = f.host.querySelector("[data-timeline-target]");
    assert.ok(target, "모달이 목표일을 계산했는데 화면에 세로선이 없다");
    assert.ok(
      (target.getAttribute("data-timeline-target") ?? "").startsWith(targetDate),
      `목표일 선이 다른 날짜다: ${target.getAttribute("data-timeline-target")}`,
    );

    const edge = f.host.querySelector("[data-timeline-edge]");
    assert.ok(edge, "링크를 받아왔는데 화살표가 없다");
    assert.equal(edge.getAttribute("data-timeline-edge"), "parent->child");
  } finally {
    await f.cleanup();
  }
});

test("서브프로젝트 필터는 타임라인에도 먹는다", async () => {
  // 필터가 보드·목록에만 먹으면 조용한 실패다 — 보드 뷰에서 같은 결함을 한 번 겪었다.
  const runStart = Math.floor(Date.now() / 1000) - 600;
  const f = await mount((url) => {
    if (url.includes("/automation/status"))
      return json(status({ capabilities: ["kanban", "cron", "events", "kanban_views"] }));
    if (url.includes("/kanban/runs"))
      return json({
        runs: [
          {
            id: "r-web",
            status: "done",
            task_id: "t-web",
            board: "deskrpg-ch-1",
            profile: "sophie",
            task_title: "웹 카드",
            started_at: runStart,
            ended_at: runStart + 60,
            outcome: "completed",
          },
          {
            id: "r-api",
            status: "done",
            task_id: "t-api",
            board: "deskrpg-ch-1",
            profile: "oliver",
            task_title: "API 카드",
            started_at: runStart,
            ended_at: runStart + 60,
            outcome: "completed",
          },
        ],
        board: "deskrpg-ch-1",
        window: { from: 0, to: 9_999_999_999 },
        truncated: false,
      });
    if (url.includes("/kanban/links")) return json({ links: [], board: "deskrpg-ch-1" });
    if (url.includes("/kanban/board"))
      return json(
        board({
          columns: [
            {
              name: "done",
              tasks: [
                { id: "t-web", title: "웹 카드", status: "done", tenant: "web" },
                { id: "t-api", title: "API 카드", status: "done", tenant: "api" },
              ],
            },
          ],
          tenants: ["web", "api"],
        }),
      );
    return json({ code: "not_found", message: "no route" }, { status: 404 });
  });
  try {
    const timelineButton = Array.from(f.host.querySelectorAll<HTMLButtonElement>("button")).find(
      (el) => el.getAttribute("aria-label") === "타임라인",
    );
    assert.ok(timelineButton);
    await act(async () => {
      timelineButton.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.ok(f.host.textContent?.includes("sophie"), "타임라인에 막대가 없다");
    assert.ok(f.host.textContent?.includes("oliver"));

    const tenantSelect = Array.from(f.host.querySelectorAll<HTMLSelectElement>("select")).find(
      (el) => el.getAttribute("aria-label") === "서브프로젝트",
    );
    assert.ok(tenantSelect, "타임라인 뷰에 서브프로젝트 필터가 보이는데 잡히지 않는다");
    await act(async () => {
      tenantSelect.value = "web";
      tenantSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    assert.ok(f.host.textContent?.includes("sophie"), "고른 서브프로젝트의 작업자가 사라졌다");
    assert.equal(
      f.host.textContent?.includes("oliver"),
      false,
      "타임라인에서 필터가 아무 일도 하지 않는다 — 화면은 필터가 걸렸다고 말한다",
    );
  } finally {
    await f.cleanup();
  }
});

test("대화 초안은 확인 폼만 열고 취소하면 카드를 등록하지 않는다", async () => {
  const f = await mount((url) => json(url.includes("/automation/status") ? status() : board()), {
    initialCreateDraft: { title: "주간 안내", body: "원래 요청\n수정한 초안", assigneeNpcId: "n1" },
  });
  try {
    const title = f.host.querySelector<HTMLInputElement>("#kanban-title");
    assert.equal(title?.value, "주간 안내");
    assert.equal(
      f.host.querySelector<HTMLTextAreaElement>("#kanban-body")?.value,
      "원래 요청\n수정한 초안",
    );
    assert.equal(f.host.querySelector<HTMLSelectElement>("#kanban-assignee")?.value, "n1");
    assert.equal(
      f.calls.some((call) => call.startsWith("POST")),
      false,
    );
    await f.click("취소");
    assert.equal(f.host.querySelector("#kanban-title"), null);
    assert.equal(
      f.calls.some((call) => call.startsWith("POST")),
      false,
    );
  } finally {
    await f.cleanup();
  }
});

test("검토 카드 결과는 옛 result보다 최신 Hermes summary를 보여 준다", async () => {
  const f = await mount(
    (url) => {
      if (url.includes("/automation/status")) return json(status());
      if (url.includes("/kanban/board")) return json(board());
      return json(
        detail({
          id: "t-todo",
          title: "할 카드",
          status: "review",
          result: "지난 결과",
          latest_summary: "수정 결과 금요일 오후 5시",
        }),
      );
    },
    { initialTaskId: "t-todo" },
  );
  try {
    const result = Array.from(
      f.host.querySelectorAll('aside[aria-label="카드 상세"] section'),
    ).find((node) => node.firstElementChild?.textContent === "결과");
    assert.match(result?.textContent ?? "", /수정 결과 금요일 오후 5시/);
    assert.doesNotMatch(result?.textContent ?? "", /지난 결과/);
  } finally {
    await f.cleanup();
  }
});

for (const sample of [
  { status: "review", result: null, latest_summary: "검토 결과", expected: "검토 결과" },
  { status: "done", result: "승인된 결과", latest_summary: "실행 요약", expected: "승인된 결과" },
  { status: "done", result: null, latest_summary: "완료 결과", expected: "완료 결과" },
  { status: "ready", result: null, latest_summary: "사용자의 수정 요청", expected: "결과 없음" },
] as const) {
  test(`카드 결과 표시 ${sample.status}: ${sample.expected}`, async () => {
    const f = await mount(
      (url) => {
        if (url.includes("/automation/status")) return json(status());
        if (url.includes("/kanban/board")) return json(board());
        return json(
          detail({
            id: "t-todo",
            title: "할 카드",
            status: sample.status,
            result: sample.result,
            latest_summary: sample.latest_summary,
          }),
        );
      },
      { initialTaskId: "t-todo" },
    );
    try {
      const result = Array.from(
        f.host.querySelectorAll('aside[aria-label="카드 상세"] section'),
      ).find((node) => node.firstElementChild?.textContent === "결과");
      assert.equal(result?.textContent, `결과${sample.expected}`);
    } finally {
      await f.cleanup();
    }
  });
}

test("혼합 승인: 옛 스웜 capability는 신규 생성 버튼을 켜지 않는다", async () => {
  const f = await mount((url) =>
    url.includes("/automation/status")
      ? json(status({ capabilities: ["kanban", "swarm"] }))
      : json(board()),
  );
  try {
    assert.equal(
      [...f.host.querySelectorAll("button")].some((b) => b.textContent?.trim() === "스웜"),
      false,
    );
  } finally {
    await f.cleanup();
  }
});

test("보호 카드의 사람 판단 화면은 AI 검토 의견 대신 승인 대상 결과를 보여 준다", async () => {
  const f = await mount(
    (url) => {
      if (url.includes("/automation/status")) return json(status());
      if (url.includes("/kanban/board")) return json(board());
      return json(
        detail({
          id: "t-todo",
          title: "할 카드",
          status: "review",
          started_at: 123,
          result: "제출한 실제 결과",
          latest_summary: "AI의 수정 요청",
          review: {
            policy: { version: 1, mode: "agent", reviewer_profile: "noah" },
            policy_revision: 1,
            submission: { id: "s1", run_id: 1, hash: "hash", policy_revision: 1 },
            review_round: 3,
            state: "human_required",
            reason: "review_round_limit",
            approval: null,
          },
        }),
      );
    },
    { initialTaskId: "t-todo" },
  );
  try {
    const result = [...f.host.querySelectorAll('aside[aria-label="카드 상세"] section')].find(
      (node) => node.firstElementChild?.textContent === "결과",
    );
    assert.match(result?.textContent ?? "", /제출한 실제 결과/);
    assert.doesNotMatch(result?.textContent ?? "", /AI의 수정 요청/);
    const reassign = f.host.querySelector<HTMLSelectElement>('select[aria-label="재배정"]');
    assert.ok(!reassign || reassign.disabled);
  } finally {
    await f.cleanup();
  }
});
