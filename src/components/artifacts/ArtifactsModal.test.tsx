import "../../test-setup/dom";
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { waitFor } from "@testing-library/react";

import { I18nProvider } from "@/lib/i18n/context";

import ArtifactsModal, { type ArtifactsModalProps } from "./ArtifactsModal";
import { composeHtml } from "./viewers/HtmlViewer";

const LIST = "GET /api/channels/ch-1/artifacts?limit=50";

const summary = (overrides: Record<string, unknown> = {}) => ({
  id: "a1",
  kind: "document",
  title: "주간 보고",
  profile: "sophie",
  source_kind: "chat",
  session_id: "s-1",
  current_version: 1,
  filename: "report.md",
  mime: "text/markdown",
  size: 12,
  sha256: "abc",
  created_at: 1_790_000_000,
  updated_at: 1_790_000_000,
  ...overrides,
});

const version = (n: number, overrides: Record<string, unknown> = {}) => ({
  version: n,
  filename: "report.md",
  mime: "text/markdown",
  size: 12,
  sha256: "abc",
  created_by: "sophie",
  captured_via: "tool",
  created_at: 1_790_000_000,
  ...overrides,
});

type Reply = Record<string, unknown>;

/** `"METHOD path"` → 응답. `{text}` 는 본문 그대로, `{status, json}` 은 오류, 나머지는 JSON 200. */
function mockFetch(routes: Record<string, Reply>) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push(key);
    const reply = routes[key];
    if (!reply) {
      return new Response(JSON.stringify({ code: "not_found", message: key }), { status: 404 });
    }
    if (typeof reply.text === "string") {
      return new Response(reply.text, {
        status: typeof reply.status === "number" ? reply.status : 200,
        headers: (reply.headers as Record<string, string> | undefined) ?? {},
      });
    }
    if (typeof reply.status === "number" && "json" in reply) {
      return new Response(JSON.stringify(reply.json), { status: reply.status });
    }
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

const originalFetch = globalThis.fetch;
let container: HTMLElement;
let root: Root | null = null;

const baseProps: ArtifactsModalProps = {
  channelId: "ch-1",
  npcs: [{ profileName: "sophie", npcName: "소피", npcId: "n1" }],
  refreshTick: 0,
  lastEvent: null,
  onOpenSource: () => {},
  onClose: () => {},
};

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render(props: Partial<ArtifactsModalProps> = {}) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  const r = root;
  await act(async () =>
    r.render(
      <I18nProvider initialLocale="ko">
        <ArtifactsModal {...baseProps} debounceMs={0} {...props} />
      </I18nProvider>,
    ),
  );
  await flush();
}

/** 글자가 정확히 `text` 인 가장 안쪽 요소. */
function byText(text: string): HTMLElement {
  const all = Array.from(container.querySelectorAll<HTMLElement>("*"));
  const hit = all.filter(
    (el) =>
      el.textContent?.trim() === text &&
      !Array.from(el.children).some((c) => c.textContent?.trim() === text),
  );
  assert.ok(hit.length > 0, `text "${text}"`);
  return hit[0];
}

function queryText(text: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>("*")).find(
    (el) => el.textContent?.trim() === text,
  );
}

async function click(el: HTMLElement) {
  await act(async () => el.click());
  await flush();
}

test.afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
    root = null;
    container.remove();
  }
  globalThis.fetch = originalFetch;
});

test("열면 목록을 부르고, 항목을 누르면 Markdown 을 렌더한다", async () => {
  mockFetch({
    [LIST]: { artifacts: [summary({ id: "a1", title: "주간 보고" })], cursor: "", has_more: false },
    "GET /api/channels/ch-1/artifacts/a1": {
      artifact: summary({ id: "a1", title: "주간 보고" }),
      versions: [version(1)],
    },
    "GET /api/channels/ch-1/artifacts/a1/versions/1/content": { text: "# 제목\n본문" },
  });
  await render();
  await click(byText("주간 보고"));
  assert.ok(container.querySelector(".markdown-chat h1"));
});

test("HTML 은 sandbox=allow-scripts 이고 allow-same-origin 이 없다", async () => {
  const web = summary({
    id: "w1",
    kind: "web",
    title: "랜딩",
    filename: "index.html",
    mime: "text/html",
  });
  mockFetch({
    [LIST]: { artifacts: [web], cursor: "", has_more: false },
    "GET /api/channels/ch-1/artifacts/w1": {
      artifact: web,
      versions: [version(1, { filename: "index.html", mime: "text/html" })],
    },
    "GET /api/channels/ch-1/artifacts/w1/versions/1/content": { text: "<h1>hi</h1>" },
  });
  await render();
  await click(byText("랜딩"));
  const iframe = container.querySelector("iframe");
  assert.ok(iframe);
  assert.equal(iframe.getAttribute("sandbox"), "allow-scripts");
  assert.ok(iframe.getAttribute("srcdoc")!.includes("<html"));
});

test("composeHtml 은 문서 조각만 감싸고 완전한 문서는 그대로 둔다", () => {
  assert.match(composeHtml("<p>x</p>"), /^<!doctype html><html><head><meta charset="utf-8">/);
  const full = "<!DOCTYPE html><html><body>y</body></html>";
  assert.equal(composeHtml(full), full);
});

test("링크 뷰어는 javascript: 를 열기 버튼으로 만들지 않는다", async () => {
  const link = summary({
    id: "l1",
    kind: "link",
    title: "수상한 링크",
    filename: "link.url",
    mime: "text/uri-list",
  });
  mockFetch({
    [LIST]: { artifacts: [link], cursor: "", has_more: false },
    "GET /api/channels/ch-1/artifacts/l1": {
      artifact: link,
      versions: [version(1, { filename: "link.url", mime: "text/uri-list" })],
    },
    "GET /api/channels/ch-1/artifacts/l1/versions/1/content": { text: "javascript:alert(1)\n" },
  });
  await render();
  await click(byText("수상한 링크"));
  assert.equal(queryText("새 탭에서 열기"), undefined);
  assert.equal(container.querySelector('a[href^="javascript"]'), null);
  assert.ok(queryText("열 수 없는 주소입니다"));
});

test("링크 뷰어는 http(s) 를 noopener noreferrer 새 탭 링크로 연다", async () => {
  const link = summary({
    id: "l2",
    kind: "link",
    title: "문서 링크",
    filename: "link.url",
    mime: "text/uri-list",
  });
  mockFetch({
    [LIST]: { artifacts: [link], cursor: "", has_more: false },
    "GET /api/channels/ch-1/artifacts/l2": {
      artifact: link,
      versions: [version(1, { filename: "link.url", mime: "text/uri-list" })],
    },
    "GET /api/channels/ch-1/artifacts/l2/versions/1/content": { text: "https://example.com/a\n" },
  });
  await render();
  await click(byText("문서 링크"));
  const open = byText("새 탭에서 열기").closest("a");
  assert.ok(open);
  assert.equal(open.getAttribute("href"), "https://example.com/a");
  assert.equal(open.getAttribute("target"), "_blank");
  assert.equal(open.getAttribute("rel"), "noopener noreferrer");
});

test("삭제는 확인 뒤 DELETE 를 보내고 목록에서 뺀다", async () => {
  const calls = mockFetch({
    [LIST]: { artifacts: [summary()], cursor: "", has_more: false },
    "GET /api/channels/ch-1/artifacts/a1": { artifact: summary(), versions: [version(1)] },
    "GET /api/channels/ch-1/artifacts/a1/versions/1/content": { text: "본문" },
    "DELETE /api/channels/ch-1/artifacts/a1": { ok: true },
  });
  await render();
  await click(byText("주간 보고"));
  await click(byText("삭제"));
  assert.ok(!calls.some((c) => c.startsWith("DELETE")), "확인 전에는 보내지 않는다");
  assert.ok(queryText("이 결과물의 모든 버전을 삭제할까요?"));
  await click(byText("삭제"));
  assert.ok(calls.includes("DELETE /api/channels/ch-1/artifacts/a1"));
  assert.equal(queryText("주간 보고"), undefined);
});

test("삭제 확인에서 취소하면 보내지 않는다", async () => {
  const calls = mockFetch({
    [LIST]: { artifacts: [summary()], cursor: "", has_more: false },
    "GET /api/channels/ch-1/artifacts/a1": { artifact: summary(), versions: [version(1)] },
    "GET /api/channels/ch-1/artifacts/a1/versions/1/content": { text: "본문" },
  });
  await render();
  await click(byText("주간 보고"));
  await click(byText("삭제"));
  await click(byText("취소"));
  assert.ok(!calls.some((c) => c.startsWith("DELETE")));
  assert.ok(byText("삭제"));
});

test("refreshTick 이 오르면 목록을 다시 부른다", async () => {
  const calls = mockFetch({ [LIST]: { artifacts: [], cursor: "", has_more: false } });
  await render();
  assert.equal(calls.filter((c) => c === LIST).length, 1);
  await render({ refreshTick: 1 });
  assert.equal(calls.filter((c) => c === LIST).length, 2);
});

test("taskId 로 열면 목록 요청에 taskId 가 붙는다", async () => {
  const calls = mockFetch({
    "GET /api/channels/ch-1/artifacts?taskId=t-9&limit=50": {
      artifacts: [],
      cursor: "",
      has_more: false,
    },
  });
  await render({ initialTaskId: "t-9" });
  assert.deepEqual(calls, ["GET /api/channels/ch-1/artifacts?taskId=t-9&limit=50"]);
});

test("artifact.deleted 사건은 그 항목을 빼고 선택을 푼다", async () => {
  mockFetch({
    [LIST]: { artifacts: [summary()], cursor: "", has_more: false },
    "GET /api/channels/ch-1/artifacts/a1": { artifact: summary(), versions: [version(1)] },
    "GET /api/channels/ch-1/artifacts/a1/versions/1/content": { text: "# 제목" },
  });
  await render({ initialArtifactId: "a1" });
  assert.ok(container.querySelector(".markdown-chat h1"));
  await render({ lastEvent: { kind: "artifact.deleted", artifactId: "a1" } });
  assert.equal(queryText("주간 보고"), undefined);
  assert.equal(container.querySelector(".markdown-chat"), null);
});

test("428 은 플러그인 업데이트 안내를 그린다", async () => {
  mockFetch({
    [LIST]: {
      status: 428,
      json: { code: "plugin_upgrade_required", message: "upgrade", minVersion: "0.8.0" },
    },
  });
  await render();
  assert.ok(queryText("플러그인을 0.8.0 이상으로 업데이트하세요"));
});

test("409 는 게이트웨이 연결 안내를 그린다", async () => {
  mockFetch({
    [LIST]: { status: 409, json: { code: "gateway_not_bound", message: "no gateway" } },
  });
  await render();
  assert.ok(container.querySelector('[data-gate="gateway"]'));
});

test("보존 한도로 정리된 버전은 고를 수 없다", async () => {
  const a = summary({ current_version: 2 });
  mockFetch({
    [LIST]: { artifacts: [a], cursor: "", has_more: false },
    "GET /api/channels/ch-1/artifacts/a1": {
      artifact: a,
      versions: [version(2), version(1, { pruned_at: 1_790_000_100 })],
    },
    "GET /api/channels/ch-1/artifacts/a1/versions/2/content": { text: "v2" },
  });
  await render();
  await click(byText("주간 보고"));
  const options = Array.from(container.querySelectorAll("option")).filter((o) =>
    o.textContent?.startsWith("v"),
  );
  const pruned = options.find((o) => o.value === "1");
  assert.ok(pruned);
  assert.equal(pruned.disabled, true);
  assert.match(pruned.textContent ?? "", /보존 한도로 정리됨/);
});

test("출처로 이동은 sourceTarget 을 넘긴다", async () => {
  const card = summary({ source_kind: "kanban", task_id: "t-7" });
  mockFetch({
    [LIST]: { artifacts: [card], cursor: "", has_more: false },
    "GET /api/channels/ch-1/artifacts/a1": { artifact: card, versions: [version(1)] },
    "GET /api/channels/ch-1/artifacts/a1/versions/1/content": { text: "x" },
  });
  const seen: unknown[] = [];
  await render({ onOpenSource: (target) => seen.push(target) });
  await click(byText("주간 보고"));
  await click(byText("출처로 이동"));
  assert.deepEqual(seen, [{ type: "kanban", taskId: "t-7" }]);
});

test("편집 → 저장은 addVersion 을 부르고 새 버전으로 넘어간다", async () => {
  const a = summary({ current_version: 1 });
  const calls = mockFetch({
    [LIST]: { artifacts: [a], cursor: "", has_more: false },
    "GET /api/channels/ch-1/artifacts/a1": { artifact: a, versions: [version(1)] },
    "GET /api/channels/ch-1/artifacts/a1/versions/1/content": { text: "# 제목\n본문" },
    "POST /api/channels/ch-1/artifacts/a1/versions": {
      version: version(2, { captured_via: "edit", note: "고침" }),
    },
  });
  await render();
  await click(byText("주간 보고"));
  await click(byText("편집"));
  assert.ok(container.querySelector('[data-testid="artifact-editor"]'), "에디터가 떠야 한다");

  // 저장 뒤 재조회 응답을 이 시점에 등록한다 — 새 버전을 골라 그 본문을 다시 부른다.
  const updated = summary({ current_version: 2 });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push(key);
    if (key === "GET /api/channels/ch-1/artifacts/a1") {
      return new Response(
        JSON.stringify({ artifact: updated, versions: [version(2), version(1)] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (key === "GET /api/channels/ch-1/artifacts/a1/versions/2/content") {
      return new Response(JSON.stringify({ text: "# 제목 수정\n본문" }), { status: 200 });
    }
    if (key === "POST /api/channels/ch-1/artifacts/a1/versions") {
      return new Response(
        JSON.stringify({ version: version(2, { captured_via: "edit", note: "고침" }) }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ code: "not_found", message: key }), { status: 404 });
  }) as typeof fetch;

  const cmHost = container.querySelector<HTMLElement & { cmView?: unknown }>(
    '[data-testid="artifact-editor"]',
  );
  const view = await waitFor(() => {
    if (!cmHost?.cmView) throw new Error("cmView not attached yet");
    return cmHost.cmView as { state: { doc: { length: number } }; dispatch(tr: unknown): void };
  });
  await act(async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "# 제목 수정\n본문" } });
  });
  await flush();

  await click(byText("새 버전으로 저장"));
  assert.ok(calls.includes("POST /api/channels/ch-1/artifacts/a1/versions"));
  assert.ok(
    container.querySelector('[data-testid="artifact-editor"]') === null,
    "저장 뒤 편집 모드를 닫는다",
  );
  assert.ok(queryText("새 버전으로 저장했습니다"));
});

/** 목록 → a1 열기 → 편집 → CodeMirror 본문을 `text` 로 바꾼다. 바꾼 view 를 돌려준다. */
async function openAndEdit(text: string) {
  await click(byText("주간 보고"));
  await click(byText("편집"));
  const cmHost = container.querySelector<HTMLElement & { cmView?: unknown }>(
    '[data-testid="artifact-editor"]',
  );
  const view = await waitFor(() => {
    if (!cmHost?.cmView) throw new Error("cmView not attached yet");
    return cmHost.cmView as {
      state: { doc: { length: number; toString(): string } };
      dispatch(tr: unknown): void;
    };
  });
  await act(async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  });
  await flush();
  return view;
}

function editableRoutes() {
  const a = summary({ current_version: 1 });
  return {
    [LIST]: { artifacts: [a], cursor: "", has_more: false },
    "GET /api/channels/ch-1/artifacts/a1": {
      artifact: a,
      versions: [version(1)],
      modifiable: true,
    },
    "GET /api/channels/ch-1/artifacts/a1/versions/1/content": { text: "# 제목\n본문" },
  };
}

test("F1: 512 KB 에서 잘린 미리보기는 편집 버튼이 없다", async () => {
  const a = summary({ size: 2_000_000 });
  mockFetch({
    [LIST]: { artifacts: [a], cursor: "", has_more: false },
    "GET /api/channels/ch-1/artifacts/a1": {
      artifact: a,
      versions: [version(1)],
      modifiable: true,
    },
    "GET /api/channels/ch-1/artifacts/a1/versions/1/content": {
      text: "# 앞부분",
      status: 206,
      headers: { "content-range": "bytes 0-524287/2000000" },
    },
  });
  await render();
  await click(byText("주간 보고"));
  assert.ok(queryText("512 KB 까지만 표시했습니다 — 다운로드해서 보세요"), "잘림 안내");
  assert.equal(queryText("편집") === undefined, true, "잘린 본문은 편집할 수 없다");
  assert.ok(queryText("잘린 미리보기라 편집할 수 없습니다"));
});

test("F3: modifiable 이 false 면 편집·삭제를 숨기고 읽기 전용 안내를 보인다", async () => {
  const card = summary({ source_kind: "kanban", task_id: "t-9", board: "deskrpg-other" });
  mockFetch({
    [LIST]: { artifacts: [card], cursor: "", has_more: false },
    "GET /api/channels/ch-1/artifacts/a1": {
      artifact: card,
      versions: [version(1)],
      modifiable: false,
      sourceInChannel: false,
    },
    "GET /api/channels/ch-1/artifacts/a1/versions/1/content": { text: "# 제목" },
  });
  const seen: unknown[] = [];
  await render({ onOpenSource: (target) => seen.push(target) });
  await click(byText("주간 보고"));
  assert.ok(container.querySelector(".markdown-chat h1"), "읽기는 된다");
  assert.equal(queryText("편집") === undefined, true);
  assert.equal(queryText("삭제") === undefined, true);
  assert.ok(queryText("다른 채널에서 만든 결과물 — 읽기 전용"));
  const go = byText("출처로 이동").closest("button")!;
  assert.equal(go.disabled, true, "다른 채널 보드의 카드로는 이동하지 않는다");
  await click(go);
  assert.deepEqual(seen, []);
});

test("F2: 편집 중 같은 결과물의 새 버전 사건이 와도 편집기와 본문을 지키고 안내만 한다", async () => {
  const calls = mockFetch(editableRoutes());
  await render();
  const view = await openAndEdit("# 내가 고친 본문");
  const detailCalls = () => calls.filter((c) => c === "GET /api/channels/ch-1/artifacts/a1").length;
  const before = detailCalls();
  await render({ refreshTick: 1, lastEvent: { kind: "artifact.versioned", artifactId: "a1" } });
  assert.ok(container.querySelector('[data-testid="artifact-editor"]'), "편집기가 그대로다");
  assert.equal(view.state.doc.toString(), "# 내가 고친 본문");
  assert.ok(queryText("새 버전이 저장됐습니다 — 저장하면 그 위에 새 버전이 됩니다"));
  assert.equal(detailCalls(), before, "편집 중에는 다시 읽지 않는다");

  // 편집을 버리고 닫으면 그때 다시 읽는다.
  await click(byText("취소"));
  await click(byText("확인"));
  assert.equal(container.querySelector('[data-testid="artifact-editor"]') === null, true);
  assert.ok(detailCalls() > before, "편집이 끝나면 새 버전을 읽는다");
});

test("F2: 저장 안 한 변경이 있으면 Escape·배경·닫기 버튼이 모달을 닫지 않고 확인을 띄운다", async () => {
  mockFetch(editableRoutes());
  let closed = 0;
  await render({ onClose: () => (closed += 1) });
  await openAndEdit("# 고친 본문");

  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  await flush();
  assert.equal(closed, 0, "Escape 가 편집을 버리고 닫으면 안 된다");
  assert.ok(queryText("저장되지 않은 변경 사항이 있습니다. 계속할까요?"));
  await click(byText("뒤로"));

  const backdrop = container.querySelector<HTMLElement>(".fixed.inset-0")!;
  await click(backdrop);
  assert.equal(closed, 0, "배경 클릭도 확인을 거친다");
  assert.ok(queryText("저장되지 않은 변경 사항이 있습니다. 계속할까요?"));
  await click(byText("뒤로"));

  // 뷰어의 X(닫기) — 편집 중에도 확인을 거친다.
  const closeButtons = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button[aria-label="닫기"]'),
  );
  await click(closeButtons[closeButtons.length - 1]);
  assert.ok(container.querySelector('[data-testid="artifact-editor"]'), "뷰어를 닫지 않는다");
  assert.ok(queryText("저장되지 않은 변경 사항이 있습니다. 계속할까요?"));

  // 확인하면 그제서야 닫힌다.
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  await flush();
  await click(byText("확인"));
  assert.equal(closed, 1);
});
