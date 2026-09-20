import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n/context";
import type { MeetingOutcome } from "@/lib/meeting-outcome";
import type { OutcomeRegistration } from "@/lib/meeting-outcome-draft";

import MeetingOutcomePanel, { type MeetingOutcomePanelProps } from "./MeetingOutcomePanel";

const outcome: MeetingOutcome = {
  decisions: ["A안 채택"],
  followUps: [
    {
      title: "경쟁사 가격 조사",
      summary: "세 곳을 본다",
      acceptance: null,
      assigneeNpcId: "npc-1",
      assigneeName: "소피",
      after: [],
    },
    {
      title: "초안 작성",
      summary: null,
      acceptance: null,
      assigneeNpcId: null,
      assigneeName: "리나",
      after: [0],
    },
  ],
  project: { recommended: true, name: "가격 개편", reason: "세 단계로 이어진다" },
};

const npcs = [
  { id: "npc-1", name: "소피" },
  { id: "npc-2", name: "노아" },
];

async function mount(props: Partial<MeetingOutcomePanelProps>): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () =>
    root.render(
      <I18nProvider initialLocale="ko">
        <MeetingOutcomePanel
          outcome={outcome}
          summaryStatus="ok"
          npcs={npcs}
          canRegister
          registerSupported
          registered={null}
          onRegister={async () => {}}
          onRetrySummary={async () => {}}
          {...props}
        />
      </I18nProvider>,
    ),
  );
  return el;
}

test("결정과 후속 업무를 그리고, 권고가 있으면 프로젝트로 묶기를 권한다", async () => {
  const el = await mount({});
  assert.match(el.textContent ?? "", /A안 채택/);
  assert.equal(el.querySelectorAll("[data-outcome-item]").length, 2);
  assert.ok(el.querySelector("[data-outcome-recommended]"));
  assert.equal(
    (el.querySelector("[data-outcome-subproject]") as HTMLInputElement).value,
    "가격 개편",
  );
});

test("후속 업무가 없으면 등록 제안을 그리지 않는다", async () => {
  const el = await mount({ outcome: { ...outcome, followUps: [] } });
  assert.equal(el.querySelector("[data-outcome-register]"), null);
  assert.equal(el.querySelector("[data-outcome-item]"), null);
  // 결정은 여전히 보인다.
  assert.match(el.textContent ?? "", /A안 채택/);
});

test("참석자로 풀리지 않은 담당은 미지정으로 두되 모델이 쓴 이름을 보여 준다", async () => {
  const el = await mount({});
  const second = el.querySelectorAll("[data-outcome-item]")[1];
  assert.equal((second.querySelector("select") as HTMLSelectElement).value, "");
  assert.match(second.textContent ?? "", /리나/);
});

test("등록을 누르면 선택한 항목만 넘긴다", async () => {
  let sent: OutcomeRegistration | null = null;
  const el = await mount({
    onRegister: async (body) => {
      sent = body;
    },
  });
  const firstCheckbox = el.querySelector(
    "[data-outcome-item] input[type=checkbox]",
  ) as HTMLInputElement;
  await act(async () => firstCheckbox.click());
  await act(async () => (el.querySelector("[data-outcome-register]") as HTMLElement).click());
  assert.deepEqual(sent, {
    tenant: { slug: "가격-개편", name: "가격 개편" },
    // 0번이 빠졌으니 1번의 after 도 비워진다.
    items: [{ index: 1, title: "초안 작성", npcId: null, after: [] }],
  });
});

test("아무것도 선택하지 않으면 등록 버튼이 잠긴다", async () => {
  const el = await mount({});
  for (const box of el.querySelectorAll("[data-outcome-item] input[type=checkbox]"))
    await act(async () => (box as HTMLInputElement).click());
  assert.equal((el.querySelector("[data-outcome-register]") as HTMLButtonElement).disabled, true);
});

test("등록 실패는 화면에 남고 버튼은 그대로 있다", async () => {
  const el = await mount({
    onRegister: async () => {
      throw new Error("board_ensure_failed");
    },
  });
  await act(async () => (el.querySelector("[data-outcome-register]") as HTMLElement).click());
  assert.match(el.querySelector("[data-outcome-error]")?.textContent ?? "", /board_ensure_failed/);
  assert.ok(el.querySelector("[data-outcome-register]"));
});

test("이미 등록된 회의는 버튼 대신 결과를 그린다", async () => {
  const el = await mount({
    registered: { boardSlug: "b", tenant: "가격-개편", taskIds: ["t1", "t2"] },
  });
  assert.equal(el.querySelector("[data-outcome-register]"), null);
  assert.match(el.querySelector("[data-outcome-registered]")?.textContent ?? "", /2/);
});

test("요약이 실패했으면 그 사실을 말하고 다시 시도하게 한다", async () => {
  let retried = 0;
  const el = await mount({
    outcome: null,
    summaryStatus: "failed",
    onRetrySummary: async () => {
      retried++;
    },
  });
  const retry = el.querySelector("[data-outcome-retry]") as HTMLElement;
  assert.ok(retry, "다시 시도 버튼이 없다");
  await act(async () => retry.click());
  assert.equal(retried, 1);
});

test("등록 권한이 없으면 초안은 보이되 등록 버튼은 없다", async () => {
  const el = await mount({ canRegister: false });
  assert.equal(el.querySelectorAll("[data-outcome-item]").length, 2);
  assert.equal(el.querySelector("[data-outcome-register]"), null);
});

test("플러그인이 승인 대기 카드를 못 만들면 버튼 대신 갱신 안내를 그리고 초안은 잠근다", async () => {
  const el = await mount({ registerSupported: false });
  assert.equal(el.querySelector("[data-outcome-register]"), null);
  assert.match(el.querySelector("[data-outcome-upgrade]")?.textContent ?? "", /0\.11\.0/);
  assert.equal(el.querySelectorAll("[data-outcome-item]").length, 2);
  const firstCheckbox = el.querySelector("[data-outcome-item] input[type=checkbox]");
  assert.equal((firstCheckbox as HTMLInputElement).disabled, true);
});
