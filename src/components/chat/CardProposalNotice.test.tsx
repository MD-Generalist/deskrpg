import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider, type Locale } from "@/lib/i18n";
import type { RoomNotice } from "@/lib/chat-rooms-policy";
import CardProposalNotice from "./CardProposalNotice";

// 버튼 유무는 `notice.resolved` 하나로 정해진다 — 오류는 버튼을 지우지 않는다.

type Proposal = Extract<RoomNotice, { kind: "card_proposal" }>;

const base: Proposal = {
  kind: "card_proposal",
  proposalId: "p1",
  title: "주간 보고 정리",
  summary: "금요일마다 모은다",
  npcId: "npc-1",
  npcName: "소피",
};

const LOCALES: Locale[] = ["ko", "en", "ja", "zh"];

async function render(
  node: React.ReactElement,
  locale: Locale = "ko",
): Promise<{ host: HTMLElement; cleanup: () => Promise<void> }> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<I18nProvider initialLocale={locale}>{node}</I18nProvider>);
  });
  return {
    host,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

test("해소 전에는 버튼 두 개 — 등록과 여기서 처리", async () => {
  const { host, cleanup } = await render(
    <CardProposalNotice notice={base} onResolve={() => {}} pending={false} error={null} />,
  );
  const buttons = host.querySelectorAll("button");
  assert.equal(buttons.length, 2);
  assert.match(host.textContent!, /주간 보고 정리/);
  assert.match(host.textContent!, /금요일마다 모은다/);
  await cleanup();
});

test("버튼이 선택을 그대로 올린다", async () => {
  const picked: string[] = [];
  const { host, cleanup } = await render(
    <CardProposalNotice
      notice={base}
      onResolve={(choice) => picked.push(choice)}
      pending={false}
      error={null}
    />,
  );
  const buttons = Array.from(host.querySelectorAll("button"));
  await act(async () => {
    buttons[0].click();
    buttons[1].click();
  });
  assert.deepEqual(picked, ["card", "inline"]);
  await cleanup();
});

test("pending 중에는 버튼이 비활성이지만 사라지지 않는다", async () => {
  const { host, cleanup } = await render(
    <CardProposalNotice notice={base} onResolve={() => {}} pending error={null} />,
  );
  const buttons = Array.from(host.querySelectorAll("button"));
  assert.equal(buttons.length, 2);
  assert.ok(buttons.every((b) => b.disabled));
  await cleanup();
});

test("해소 후에는 버튼이 없고 결과가 보인다", async () => {
  const notice: Proposal = {
    ...base,
    resolved: { choice: "card", by: "u1", at: "2026-09-21T00:00:00Z", taskId: "t1" },
  };
  const { host, cleanup } = await render(
    <CardProposalNotice notice={notice} onResolve={() => {}} pending={false} error={null} />,
  );
  assert.equal(host.querySelectorAll("button").length, 0);
  assert.match(host.textContent!, /t1/);
  await cleanup();
});

test("여기서 처리로 해소되면 taskId 없이도 결과가 보인다", async () => {
  const notice: Proposal = {
    ...base,
    resolved: { choice: "inline", by: "u1", at: "2026-09-21T00:00:00Z" },
  };
  const { host, cleanup } = await render(
    <CardProposalNotice notice={notice} onResolve={() => {}} pending={false} error={null} />,
  );
  assert.equal(host.querySelectorAll("button").length, 0);
  const line = host.querySelector("[data-testid='card-proposal-resolved']");
  assert.ok(line && line.textContent && line.textContent.trim().length > 0);
  await cleanup();
});

test("오류가 있으면 이유를 보이고 버튼을 남긴다", async () => {
  const { host, cleanup } = await render(
    <CardProposalNotice
      notice={base}
      onResolve={() => {}}
      pending={false}
      error="plugin_required"
    />,
  );
  assert.equal(host.querySelectorAll("button").length, 2);
  assert.match(host.textContent!, /plugin/i);
  await cleanup();
});

test("네 로케일 모두 제 언어로 버튼 문구가 나온다", async () => {
  const seen = new Set<string>();
  for (const locale of LOCALES) {
    const { host, cleanup } = await render(
      <CardProposalNotice notice={base} onResolve={() => {}} pending={false} error={null} />,
      locale,
    );
    const labels = Array.from(host.querySelectorAll("button"))
      .map((b) => b.textContent ?? "")
      .join("|");
    assert.doesNotMatch(labels, /notice\.cardProposal/);
    seen.add(labels);
    await cleanup();
  }
  assert.equal(seen.size, LOCALES.length);
});
