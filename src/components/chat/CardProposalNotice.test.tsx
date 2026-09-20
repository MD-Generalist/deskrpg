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

test("이미 처리된 제안(409)은 코드가 아니라 무엇을 할지 안내하고, 버튼은 남는다", async () => {
  for (const locale of LOCALES) {
    const { host, cleanup } = await render(
      <CardProposalNotice
        notice={base}
        onResolve={() => {}}
        pending={false}
        error="already_resolved"
      />,
      locale,
    );
    // 버튼이 사라지면 사용자가 손쓸 방법이 없어진다.
    assert.equal(host.querySelectorAll("button").length, 2);
    const line = host.querySelector("[data-testid='card-proposal-error']");
    assert.ok(line);
    // 코드를 그대로 노출하지 않고, 번역 키가 새어 나오지도 않는다.
    assert.doesNotMatch(line.textContent!, /already_resolved/);
    assert.doesNotMatch(line.textContent!, /notice\.cardProposal/);
    await cleanup();
  }
});

test("완료 조건은 라벨을 달아 본문과 구분해 보인다", async () => {
  const notice: Proposal = { ...base, body: "청구서를 모은다", acceptance: "표로 정리" };
  for (const locale of LOCALES) {
    const { host, cleanup } = await render(
      <CardProposalNotice notice={notice} onResolve={() => {}} pending={false} error={null} />,
      locale,
    );
    const line = host.querySelector("[data-testid='card-proposal-acceptance']");
    assert.ok(line, `${locale}: 완료 조건 줄이 없다`);
    assert.match(line.textContent!, /표로 정리/);
    // 본문과 같은 줄에 섞이지 않는다.
    assert.doesNotMatch(line.textContent!, /청구서를 모은다/);
    // 라벨이 제 언어로 붙는다 — 번역 키가 새지 않는다.
    assert.doesNotMatch(line.textContent!, /notice\.cardProposal/);
    assert.ok(line.textContent!.replace("표로 정리", "").trim().length > 0);
    await cleanup();
  }
});

test("처리할 수 없는 화면에서는 이유를 말한다 — 버튼만 비활성으로 두지 않는다", async () => {
  for (const locale of LOCALES) {
    const { host, cleanup } = await render(
      <CardProposalNotice
        notice={base}
        onResolve={() => {}}
        pending={false}
        unavailable
        error={null}
      />,
      locale,
    );
    const line = host.querySelector("[data-testid='card-proposal-unavailable']");
    assert.ok(line, `${locale}: 이유 줄이 없다 — 비활성 버튼만 남으면 로딩처럼 보인다`);
    assert.doesNotMatch(line.textContent!, /notice\.cardProposal/);
    assert.ok(line.textContent!.trim().length > 0);
    // 버튼은 사라지지 않고 비활성으로 남는다.
    const buttons = [...host.querySelectorAll("button")];
    assert.equal(buttons.length, 2);
    assert.ok(
      buttons.every((b) => (b as HTMLButtonElement).disabled),
      `${locale}: 처리 불가인데 버튼이 눌린다`,
    );
    await cleanup();
  }
});

test("pending 과 unavailable 은 다른 상태다 — 요청 중에는 이유 줄이 없다", async () => {
  const { host, cleanup } = await render(
    <CardProposalNotice notice={base} onResolve={() => {}} pending error={null} />,
  );
  assert.equal(host.querySelector("[data-testid='card-proposal-unavailable']"), null);
  assert.ok(
    [...host.querySelectorAll("button")].every((b) => (b as HTMLButtonElement).disabled),
    "요청 중에는 버튼이 비활성이어야 한다",
  );
  await cleanup();
});
