import "../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n";
import NpcRoster, { type RosterNpc } from "./NpcRoster";

/**
 * 출근부는 "맵에 있는 NPC" 가 아니라 **채널이 고용한 프로필 전부** 를 그린다.
 * 세 상태(자리 있음·자리 미정·쉬는 중)를 한 화면에서 구분하지 못하면, 출근했는데
 * 자리가 없어 맵에 안 보이는 NPC 가 사라진 것처럼 보인다.
 */
const roster: RosterNpc[] = [
  { id: "a", name: "소피", active: true, placed: true, profile: { ownerUserId: "me" } },
  { id: "b", name: "올리버", active: true, placed: false, profile: { ownerUserId: "me" } },
  { id: "c", name: "미아", active: false, placed: true, profile: { ownerUserId: "someone" } },
];

async function mount(node: React.ReactElement): Promise<{ root: Root; el: HTMLElement }> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(node);
  });
  return { root, el };
}

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  assert.ok(found, `"${text}" 버튼을 찾지 못했다`);
  return found as HTMLButtonElement;
}

test("세 상태를 구분해 그린다", async () => {
  const { el } = await mount(
    <I18nProvider initialLocale="ko">
      <NpcRoster
        npcs={roster}
        meetingNpcIds={new Set()}
        isOwner
        currentUserId="me"
        onToggle={() => {}}
        onPlace={() => {}}
        onHire={() => {}}
      />
    </I18nProvider>,
  );
  const text = el.textContent ?? "";
  assert.match(text, /자리 있음/);
  assert.match(text, /자리 미정/);
  assert.match(text, /쉬는 중/);
});

test("자리 미정을 누르면 onPlace, 회의 중이면 토글이 비활성이다", async () => {
  const placed: string[] = [];
  const { el } = await mount(
    <I18nProvider initialLocale="ko">
      <NpcRoster
        npcs={roster}
        meetingNpcIds={new Set(["a"])}
        isOwner
        currentUserId="me"
        onToggle={() => {}}
        onPlace={(id) => placed.push(id)}
        onHire={() => {}}
      />
    </I18nProvider>,
  );
  await act(async () => buttonByText(el, "자리 미정").click());
  assert.deepEqual(placed, ["b"]);
  const toggleA = el.querySelector('[data-testid="toggle-a"]') as HTMLButtonElement;
  assert.equal(toggleA.disabled, true);
  assert.match(toggleA.title, /회의/);
  const toggleB = el.querySelector('[data-testid="toggle-b"]') as HTMLButtonElement;
  assert.equal(toggleB.disabled, false);
});

test("남의 프로필은 소유자를 표시한다", async () => {
  const { el } = await mount(
    <I18nProvider initialLocale="ko">
      <NpcRoster
        npcs={roster}
        meetingNpcIds={new Set()}
        isOwner
        currentUserId="me"
        onToggle={() => {}}
        onPlace={() => {}}
        onHire={() => {}}
      />
    </I18nProvider>,
  );
  assert.match(el.textContent ?? "", /공유됨/);
});
