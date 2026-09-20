import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n/context";
import type { KanbanTaskDetail } from "@/lib/hermes/deskrpg-plugin-types";

import { ArtifactsApiError } from "../artifacts/artifacts-api";
import type { KanbanApi } from "./kanban-api";
import KanbanBoardModal from "./KanbanBoardModal";
import TaskDrawer, { type TaskDrawerArtifacts } from "./TaskDrawer";

/**
 * 배선 테스트 — 판정 자체(classifyGateFailure/classifyBoardFailure)는 다른 파일이 이미
 * 덮는다. 여기서는 "화면이 그 판정을 살려서 체크리스트로 연다" 만 고정한다.
 */

const CHANNEL = "ch-1";

const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });

async function mountBoard(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return handler(url, init);
  }) as typeof fetch;
  const host = document.createElement("div");
  document.body.append(host);
  const root: Root = createRoot(host);
  await act(async () =>
    root.render(
      <I18nProvider initialLocale="ko">
        {/* onConnectGateway 를 준다 — gateway_not_bound 배너는 소유자에게만 버튼을 보여준다
            (비소유자에겐 버튼 자체가 없다, `KanbanBoardModal.test.tsx` 의
            "unbound gateway offers connection to owners and guidance to members" 참조). */}
        <KanbanBoardModal channelId={CHANNEL} onClose={() => {}} onConnectGateway={() => {}} />
      </I18nProvider>,
    ),
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return {
    host,
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

test("보드 차단 배너에서 체크리스트를 열면 원인이 살아 있다(gateway_not_bound)", async () => {
  const f = await mountBoard((url) => {
    if (url.includes("/automation/status")) {
      return json({ code: "gateway_not_bound", message: "게이트웨이 미연결" }, { status: 409 });
    }
    return json({ code: "not_found", message: "no route" }, { status: 404 });
  });
  try {
    const blocker = f.host.querySelector<HTMLElement>("[data-blocker]");
    assert.equal(blocker?.dataset.blocker, "gateway_not_bound");
    await f.click("무엇이 필요한가요?");
    assert.match(f.host.textContent ?? "", /게이트웨이 연결/);
  } finally {
    await f.cleanup();
  }
});

test("보드 차단 배너의 board_unavailable(503+plugin_absent) 도 체크리스트에서 원인이 복원된다", async () => {
  const f = await mountBoard((url) => {
    if (url.includes("/automation/status")) {
      return json({
        pluginStatus: "ready",
        pluginVersion: "0.6.0",
        capabilities: ["kanban"],
        timezone: "Asia/Seoul",
        boardSlug: "deskrpg-ch-1",
        dispatcherPresent: true,
        attachments: true,
        lastPolledAt: null,
        lastError: null,
        minVersion: "0.6.0",
        working: [],
      });
    }
    if (url.includes("/kanban/board")) {
      return json({ code: "plugin_absent", message: "플러그인 없음" }, { status: 503 });
    }
    return json({ code: "not_found", message: "no route" }, { status: 404 });
  });
  try {
    const blocker = f.host.querySelector<HTMLElement>("[data-blocker]");
    assert.equal(blocker?.dataset.blocker, "board_unavailable");
    await f.click("무엇이 필요한가요?");
    // 428 이 아닌 나머지는 이전에는 board_unavailable 로 뭉개져 한 줄 메시지만 보였다.
    // 체크리스트는 plugin_absent 단계(플러그인 설치)를 짚어야 한다.
    assert.match(f.host.textContent ?? "", /DeskRPG 플러그인 설치/);
  } finally {
    await f.cleanup();
  }
});

test("보드 차단 배너의 평범한 실패(403 not_a_member)는 체크리스트 버튼을 띄우지 않는다", async () => {
  const f = await mountBoard((url) => {
    if (url.includes("/automation/status")) {
      return json({
        pluginStatus: "ready",
        pluginVersion: "0.6.0",
        capabilities: ["kanban"],
        timezone: "Asia/Seoul",
        boardSlug: "deskrpg-ch-1",
        dispatcherPresent: true,
        attachments: true,
        lastPolledAt: null,
        lastError: null,
        minVersion: "0.6.0",
        working: [],
      });
    }
    if (url.includes("/kanban/board")) {
      return json({ code: "not_a_member", message: "채널 멤버가 아닙니다" }, { status: 403 });
    }
    return json({ code: "not_found", message: "no route" }, { status: 404 });
  });
  try {
    const blocker = f.host.querySelector<HTMLElement>("[data-blocker]");
    assert.equal(blocker?.dataset.blocker, "other");
    const checklistButton = Array.from(f.host.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "무엇이 필요한가요?",
    );
    assert.equal(checklistButton, undefined);
  } finally {
    await f.cleanup();
  }
});

// ---------------------------------------------------------------------------
// TaskDrawer 결과물 섹션
// ---------------------------------------------------------------------------

const detail: KanbanTaskDetail = {
  task: { id: "t1", title: "보고서 카드", status: "todo" },
  comments: [],
  events: [],
  attachments: null,
  links: { parents: [], children: [] },
  runs: [],
};

const drawerApi = { taskDetail: async () => detail } as unknown as KanbanApi;

async function mountDrawer(artifacts: TaskDrawerArtifacts) {
  const host = document.createElement("div");
  document.body.append(host);
  const root: Root = createRoot(host);
  await act(async () =>
    root.render(
      <I18nProvider initialLocale="ko">
        <TaskDrawer
          api={drawerApi}
          taskId="t1"
          npcs={[]}
          boardTasks={[]}
          attachmentsSupported={false}
          creationWarning={null}
          refreshTick={0}
          onChanged={() => {}}
          onEdit={() => {}}
          onDeleted={() => {}}
          onClose={() => {}}
          artifacts={artifacts}
        />
      </I18nProvider>,
    ),
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return {
    host,
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
    },
  };
}

test("결과물 섹션의 428 은 지금처럼 섹션을 숨긴다", async () => {
  const view = await mountDrawer({
    list: async () => {
      throw new ArtifactsApiError(428, "plugin_upgrade_required", "upgrade", "0.8.4");
    },
    open: () => {},
  });
  try {
    assert.equal(view.host.textContent?.includes("결과물"), false);
  } finally {
    await view.cleanup();
  }
});

test("결과물 섹션의 409(gateway_not_bound) 는 한 줄로 뭉개지지 않고 체크리스트를 연다", async () => {
  const view = await mountDrawer({
    list: async () => {
      throw new ArtifactsApiError(409, "gateway_not_bound", "게이트웨이 미연결");
    },
    open: () => {},
  });
  try {
    await view.click("무엇이 필요한가요?");
    assert.match(view.host.textContent ?? "", /게이트웨이 연결/);
  } finally {
    await view.cleanup();
  }
});

test("결과물 섹션의 평범한 실패(500 internal_error)는 체크리스트 버튼을 띄우지 않는다", async () => {
  const view = await mountDrawer({
    list: async () => {
      throw new ArtifactsApiError(500, "internal_error", "서버 오류");
    },
    open: () => {},
  });
  try {
    assert.match(view.host.textContent ?? "", /결과물/);
    const checklistButton = Array.from(view.host.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "무엇이 필요한가요?",
    );
    assert.equal(checklistButton, undefined);
  } finally {
    await view.cleanup();
  }
});
