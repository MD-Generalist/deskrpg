import "../../test-setup/dom";
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n/context";
import type { ArtifactSummary, KanbanTaskDetail } from "@/lib/hermes/deskrpg-plugin-types";

import { ArtifactsApiError } from "../artifacts/artifacts-api";
import type { KanbanApi } from "./kanban-api";
import TaskDrawer, { type TaskDrawerArtifacts } from "./TaskDrawer";

const baseDetail: KanbanTaskDetail = {
  task: { id: "t1", title: "보고서 카드", status: "todo" },
  comments: [],
  events: [],
  attachments: null,
  links: { parents: [], children: [] },
  runs: [],
};

let detail: KanbanTaskDetail = baseDetail;

// 드로어가 첫 렌더에 부르는 것은 taskDetail 뿐이다 — 나머지는 이 테스트에서 닿지 않는다.
const api = {
  taskDetail: async () => detail,
  attachmentUrl: (id: string) => `/api/att/${id}`,
} as unknown as KanbanApi;

function withAttachments(files: { id: string; filename: string; size?: number }[]) {
  detail = { ...baseDetail, attachments: files as KanbanTaskDetail["attachments"] };
}

function summary(overrides: Partial<ArtifactSummary> = {}): ArtifactSummary {
  return {
    id: "a0",
    kind: "document",
    title: "제목",
    profile: "sophie",
    source_kind: "kanban",
    session_id: "s1",
    task_id: "t1",
    current_version: 1,
    filename: "report.md",
    mime: "text/markdown",
    size: 10,
    sha256: "x",
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

async function renderDrawer(props: {
  artifacts?: TaskDrawerArtifacts | null;
  taskId?: string;
  refreshTick?: number;
  attachmentsSupported?: boolean;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root: Root = createRoot(host);
  const render = async (next: typeof props) =>
    act(async () =>
      root.render(
        <I18nProvider initialLocale="ko">
          <TaskDrawer
            api={api}
            taskId={next.taskId ?? "t1"}
            npcs={[]}
            boardTasks={[]}
            attachmentsSupported={next.attachmentsSupported ?? false}
            creationWarning={null}
            refreshTick={next.refreshTick ?? 0}
            onChanged={() => {}}
            onEdit={() => {}}
            onDeleted={() => {}}
            onClose={() => {}}
            artifacts={next.artifacts}
          />
        </I18nProvider>,
      ),
    );
  await render(props);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return {
    host,
    render: async (next: typeof props) => {
      await render(next);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    },
    byText: (text: string) =>
      Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === text) ??
      null,
    hasText: (text: string) =>
      Array.from(host.querySelectorAll("*")).some(
        (el) => el.children.length === 0 && el.textContent?.trim() === text,
      ),
    /** 제목이 `title` 인 섹션 — 첨부 섹션과 결과물 섹션이 같은 파일을 그리므로 범위를 좁힌다. */
    section: (title: string) =>
      Array.from(host.querySelectorAll("section")).find(
        (el) => el.firstElementChild?.textContent?.trim() === title,
      ) ?? null,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

test("카드의 결과물을 나열하고 누르면 open 을 부른다", async () => {
  const opened: string[] = [];
  const listed: string[] = [];
  const artifacts: TaskDrawerArtifacts = {
    list: async (taskId) => {
      listed.push(taskId);
      return [summary({ id: "a1", title: "카드 보고서" })];
    },
    open: (id) => void opened.push(id),
  };
  const view = await renderDrawer({ artifacts });
  try {
    assert.ok(view.hasText("결과물"), "섹션 제목");
    assert.deepEqual(listed, ["t1"]);
    const button = view.byText("카드 보고서");
    assert.ok(button, "결과물 버튼");
    await act(async () => button.click());
    assert.deepEqual(opened, ["a1"]);
  } finally {
    await view.cleanup();
  }
});

test("artifacts 가 null 이면 섹션이 없다", async () => {
  const view = await renderDrawer({ artifacts: null });
  try {
    assert.equal(view.hasText("결과물"), false);
  } finally {
    await view.cleanup();
  }
});

test("결과물이 없으면 빈 안내를 그린다", async () => {
  const view = await renderDrawer({ artifacts: { list: async () => [], open: () => {} } });
  try {
    assert.ok(view.hasText("결과물"));
    assert.ok(view.hasText("이 카드에서 만든 결과물이 없습니다"));
  } finally {
    await view.cleanup();
  }
});

test("플러그인이 taskId 필터를 모르면(428) 섹션을 숨긴다", async () => {
  const view = await renderDrawer({
    artifacts: {
      list: async () => {
        throw new ArtifactsApiError(428, "plugin_upgrade_required", "upgrade", "0.8.4");
      },
      open: () => {},
    },
  });
  try {
    assert.equal(view.hasText("결과물"), false);
  } finally {
    await view.cleanup();
  }
});

test("refreshTick 이 오르면 결과물을 다시 읽는다", async () => {
  let calls = 0;
  const artifacts: TaskDrawerArtifacts = {
    list: async () => {
      calls += 1;
      return [summary({ id: `a${calls}`, title: `보고서 ${calls}` })];
    },
    open: () => {},
  };
  const view = await renderDrawer({ artifacts, refreshTick: 0 });
  try {
    assert.equal(calls, 1);
    await view.render({ artifacts, refreshTick: 1 });
    assert.equal(calls, 2);
    assert.ok(view.byText("보고서 2"));
  } finally {
    await view.cleanup();
  }
});

test("결과물이 없어도 첨부가 있으면 결과물 목록에 함께 나열한다", async () => {
  // 한 화면에서 첨부는 파일을 보여 주는데 결과물은 "없습니다" 라고 말하던 문제
  // (2026-09-20 실측: 첨부 deskrpg_도입검토.md 12,929 B · 결과물 없음).
  // 첨부는 인라인 base64 로 들어오므로(kanban_attach) 자동 승격 훅의 시야에
  // 구조적으로 들어올 수 없다 — 화면에서 함께 보여 주는 것이 유일한 연결 고리다.
  withAttachments([{ id: "f1", filename: "deskrpg_도입검토.md", size: 12929 }]);
  const view = await renderDrawer({
    artifacts: { list: async () => [], open: () => {} },
    attachmentsSupported: true,
  });
  try {
    assert.ok(view.hasText("결과물"), "섹션 제목");
    assert.equal(view.hasText("이 카드에서 만든 결과물이 없습니다"), false, "빈 안내는 없다");
    const section = view.section("결과물");
    assert.ok(section, "결과물 섹션");
    const link = Array.from(section.querySelectorAll("a")).find((a) =>
      a.textContent?.includes("deskrpg_도입검토.md"),
    );
    assert.ok(link, "첨부가 결과물 목록에 있다");
    assert.equal(link.getAttribute("href"), "/api/att/f1");
  } finally {
    detail = baseDetail;
    await view.cleanup();
  }
});

test("결과물과 첨부가 함께 있으면 둘 다 나열한다", async () => {
  withAttachments([{ id: "f1", filename: "첨부.md" }]);
  const view = await renderDrawer({
    artifacts: { list: async () => [summary({ id: "a1", title: "카드 보고서" })], open: () => {} },
    attachmentsSupported: true,
  });
  try {
    const section = view.section("결과물");
    assert.ok(section, "결과물 섹션");
    assert.ok(
      Array.from(section.querySelectorAll("button")).some(
        (b) => b.textContent?.trim() === "카드 보고서",
      ),
      "결과물",
    );
    assert.ok(
      Array.from(section.querySelectorAll("a")).some((a) => a.textContent?.includes("첨부.md")),
      "첨부",
    );
  } finally {
    detail = baseDetail;
    await view.cleanup();
  }
});

test("결과물도 첨부도 없으면 빈 안내를 그린다", async () => {
  withAttachments([]);
  const view = await renderDrawer({
    artifacts: { list: async () => [], open: () => {} },
    attachmentsSupported: true,
  });
  try {
    assert.ok(view.hasText("이 카드에서 만든 결과물이 없습니다"));
  } finally {
    detail = baseDetail;
    await view.cleanup();
  }
});

test("첨부 기능을 모르는 게이트웨이에서는 첨부를 결과물에 섞지 않는다", async () => {
  // attachmentsSupported=false 면 detail.attachments 를 신뢰할 수 없다(R12).
  withAttachments([{ id: "f1", filename: "첨부.md" }]);
  const view = await renderDrawer({
    artifacts: { list: async () => [], open: () => {} },
    attachmentsSupported: false,
  });
  try {
    const section = view.section("결과물");
    assert.ok(section, "결과물 섹션");
    assert.equal(
      Array.from(section.querySelectorAll("a")).some((a) => a.textContent?.includes("첨부.md")),
      false,
    );
    assert.ok(view.hasText("이 카드에서 만든 결과물이 없습니다"));
  } finally {
    detail = baseDetail;
    await view.cleanup();
  }
});
