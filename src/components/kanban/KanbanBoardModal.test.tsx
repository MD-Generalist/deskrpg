import "../../test-setup/dom";
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n/context";
import { KANBAN_TASK_STATUSES } from "@/lib/hermes/deskrpg-plugin-types";

import KanbanBoardModal from "./KanbanBoardModal";
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
  props: { refreshTick?: number; debounceMs?: number; onConnectGateway?: () => void } = {},
) {
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

    const toggle = f.host.querySelector<HTMLInputElement>('input[type="checkbox"]');
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
    assert.match(f.host.textContent ?? "", /채널 소유자에게/);
    assert.equal(f.host.querySelector("[data-blocker] button"), null);
  } finally {
    await f.cleanup();
  }
});
