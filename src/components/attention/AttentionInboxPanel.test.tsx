import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n";
import type { AttentionRow } from "@/lib/attention-inbox";

import AttentionInboxPanel from "./AttentionInboxPanel";
import type { AttentionInbox } from "./attention-api";

const EMPTY_COUNTS = { awaiting_approval: 0, blocked: 0, review: 0, total: 0 };

function fakeApi(pages: AttentionInbox[]) {
  const decided: { approvalId: string; body: unknown }[] = [];
  let index = 0;
  return {
    decided,
    loads: () => index,
    client: {
      async load() {
        return pages[Math.min(index++, pages.length - 1)];
      },
      async decide(approvalId: string, body: unknown) {
        decided.push({ approvalId, body });
        return {};
      },
    } as never,
  };
}

async function render(node: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<I18nProvider initialLocale="ko">{node}</I18nProvider>);
  });
  return {
    host,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

const approvalRow: AttentionRow = {
  kind: "approval",
  id: "a1",
  title: "2건 수행할까요?",
  at: "2026-09-21T00:00:01.000Z",
  requestedBy: "sophie",
  count: 2,
};

test("답할 것이 없으면 빈 상태를 보인다", async () => {
  const api = fakeApi([{ rows: [], counts: EMPTY_COUNTS }]);
  const { host, cleanup } = await render(<AttentionInboxPanel channelId="c1" api={api.client} />);
  assert.ok(host.querySelector("[data-attention-empty]"));
  await cleanup();
});

test("승인 줄에는 결정 버튼 셋이 있고 요청자를 프로필로 그린다", async () => {
  const api = fakeApi([
    { rows: [approvalRow], counts: { ...EMPTY_COUNTS, awaiting_approval: 2, total: 2 } },
  ]);
  const { host, cleanup } = await render(<AttentionInboxPanel channelId="c1" api={api.client} />);
  const row = host.querySelector('[data-attention-row="approval"]');
  assert.ok(row, "승인 줄이 없다");
  assert.equal(row!.querySelectorAll("[data-decision]").length, 3);
  assert.ok((row!.textContent ?? "").includes("sophie"), "요청한 직원을 보여야 한다");
  await cleanup();
});

test("사람이 등록한 묶음은 직원 이름으로 그리지 않는다", async () => {
  // `user:<id>` 를 프로필처럼 그리면 하지 않은 말을 한 것이 된다.
  const api = fakeApi([
    {
      rows: [{ ...approvalRow, requestedBy: "user:7e0a0f1c-1111-4222-8333-444455556666" }],
      counts: EMPTY_COUNTS,
    },
  ]);
  const { host, cleanup } = await render(<AttentionInboxPanel channelId="c1" api={api.client} />);
  const text = host.textContent ?? "";
  assert.ok(!text.includes("user:"), "저장 형식이 그대로 노출되면 안 된다");
  assert.ok(text.includes("사람이 등록"));
  await cleanup();
});

test("승인을 누르면 그 결정이 라우트로 가고 목록을 다시 불러온다", async () => {
  const api = fakeApi([
    { rows: [approvalRow], counts: EMPTY_COUNTS },
    { rows: [], counts: EMPTY_COUNTS },
  ]);
  const { host, cleanup } = await render(<AttentionInboxPanel channelId="c1" api={api.client} />);
  const button = host.querySelector('[data-decision="approve"]') as HTMLButtonElement;
  await act(async () => button.click());
  assert.deepEqual(api.decided, [{ approvalId: "a1", body: { decision: "approve" } }]);
  // 낙관적 갱신을 쓰지 않는다 — 서버가 정본이라 다시 읽는다.
  assert.equal(api.loads(), 2);
  assert.ok(host.querySelector("[data-attention-empty]"), "결정한 줄이 사라져야 한다");
  await cleanup();
});

test("메모를 적으면 함께 보낸다", async () => {
  const api = fakeApi([{ rows: [approvalRow], counts: EMPTY_COUNTS }]);
  const { host, cleanup } = await render(<AttentionInboxPanel channelId="c1" api={api.client} />);
  const input = host.querySelector("input") as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, "범위가 넓습니다");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const button = host.querySelector('[data-decision="reject"]') as HTMLButtonElement;
  await act(async () => button.click());
  assert.deepEqual(api.decided[0].body, { decision: "reject", note: "범위가 넓습니다" });
  await cleanup();
});

test("승인이 아닌 줄에는 결정 버튼이 없고 열기만 있다", async () => {
  const api = fakeApi([
    {
      rows: [
        { kind: "blocked", id: "t1", title: "오류로 막힘", at: null, requestedBy: null, count: 1 },
        {
          kind: "cron_failed",
          id: "j1",
          title: "야간 집계",
          at: "2026-09-21T00:00:02.000Z",
          requestedBy: null,
          count: 1,
        },
      ],
      counts: EMPTY_COUNTS,
    },
  ]);
  const opened: string[] = [];
  const cronOpened: string[] = [];
  const { host, cleanup } = await render(
    <AttentionInboxPanel
      channelId="c1"
      api={api.client}
      onOpenCard={(id) => opened.push(id)}
      onOpenCronJob={(id) => cronOpened.push(id)}
    />,
  );
  assert.equal(host.querySelectorAll("[data-decision]").length, 0);
  await act(async () =>
    (host.querySelector('[data-attention-row="blocked"] button') as HTMLButtonElement).click(),
  );
  await act(async () =>
    (host.querySelector('[data-attention-row="cron_failed"] button') as HTMLButtonElement).click(),
  );
  assert.deepEqual(opened, ["t1"]);
  assert.deepEqual(cronOpened, ["j1"], "크론 실패는 카드가 아니라 이력으로 간다");
  await cleanup();
});

test("실패하면 이유를 보이고 다시 시도할 수 있다", async () => {
  let calls = 0;
  const client = {
    async load() {
      calls += 1;
      if (calls === 1) throw new Error("plugin_upgrade_required");
      return { rows: [], counts: EMPTY_COUNTS };
    },
    async decide() {
      return {};
    },
  } as never;
  const { host, cleanup } = await render(<AttentionInboxPanel channelId="c1" api={client} />);
  assert.ok(host.querySelector("[data-attention-error]"));
  assert.ok((host.textContent ?? "").includes("plugin_upgrade_required"), "이유를 접지 않는다");
  await act(async () =>
    (host.querySelector("[data-attention-error] button") as HTMLButtonElement).click(),
  );
  assert.ok(host.querySelector("[data-attention-empty]"));
  await cleanup();
});
