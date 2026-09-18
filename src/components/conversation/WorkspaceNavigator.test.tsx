import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/lib/i18n";
import type { RoomSummary } from "@/lib/chat-rooms-policy";
import WorkspaceNavigator, { type NavigatorNpc } from "./WorkspaceNavigator";

const rooms: RoomSummary[] = [
  {
    id: "office",
    kind: "office",
    name: "출판사",
    replyPolicy: "mention",
    createdBy: "owner",
    lastMessageAt: null,
    members: [],
  },
  {
    id: "design",
    kind: "group",
    name: "디자인 리뷰",
    replyPolicy: "members",
    createdBy: "owner",
    lastMessageAt: "2026-09-14T01:00:00Z",
    members: [{ kind: "npc", id: "sophie", name: "소피" }],
  },
];

const npcs: NavigatorNpc[] = [
  {
    id: "sophie",
    name: "소피",
    active: true,
    placed: true,
    motion: "waiting",
    calledByViewer: true,
    response: "thinking",
  },
  {
    id: "leo",
    name: "레오",
    active: false,
    placed: true,
    motion: "resting",
    calledByViewer: false,
  },
  {
    id: "mina",
    name: "미나",
    active: true,
    placed: false,
    motion: "unplaced",
    calledByViewer: false,
  },
];

async function mount(isOwner = true) {
  const selected: string[] = [];
  const actions: string[] = [];
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="ko">
        <WorkspaceNavigator
          workspaceName="출판사"
          rooms={rooms}
          currentRoomId="office"
          players={[{ id: "u2", name: "은채", online: true, self: false }]}
          npcs={npcs}
          isOwner={isOwner}
          onSelectRoom={(id) => selected.push(`room:${id}`)}
          onSelectNpc={(id) => selected.push(`npc:${id}`)}
          onSelectPlayer={(id) => selected.push(`player:${id}`)}
          onCompose={() => actions.push("compose")}
          onNpcAction={(id, action) => actions.push(`${id}:${action}`)}
        />
      </I18nProvider>,
    );
  });
  return { element, selected, actions };
}

function button(element: HTMLElement, name: string) {
  const found = [...element.querySelectorAll("button")].find((node) =>
    (node.getAttribute("aria-label") ?? node.textContent ?? "").includes(name),
  );
  assert.ok(found, `button containing ${name}`);
  return found as HTMLButtonElement;
}

test("rooms, online users and every NPC employment state remain discoverable", async () => {
  const { element, selected } = await mount();
  assert.match(element.textContent ?? "", /사무실 전체/);
  assert.match(element.textContent ?? "", /디자인 리뷰/);
  assert.match(element.textContent ?? "", /소피[\s\S]*대기/);
  assert.match(element.textContent ?? "", /레오[\s\S]*쉬는 중/);
  assert.match(element.textContent ?? "", /미나[\s\S]*서 있음/);

  await act(async () => button(element, "디자인 리뷰").click());
  await act(async () => button(element, "은채").click());
  await act(async () => button(element, "소피").click());
  assert.deepEqual(selected, ["room:design", "player:u2", "npc:sophie"]);
});

test("NPC overflow actions follow motion state and owner permissions", async () => {
  const owner = await mount(true);
  await act(async () => button(owner.element, "소피 관리").click());
  assert.ok(button(owner.element, "복귀"));
  assert.ok(button(owner.element, "자리 이동"));
  assert.ok(button(owner.element, "프로필 설정"));
  assert.ok(button(owner.element, "대화 초기화"));
  assert.ok(button(owner.element, "퇴근"));
  await act(async () => button(owner.element, "복귀").click());
  assert.deepEqual(owner.actions, ["sophie:return"]);

  const member = await mount(false);
  await act(async () => button(member.element, "소피 관리").click());
  assert.equal(
    [...member.element.querySelectorAll("button")].some((node) =>
      node.textContent?.includes("자리 이동"),
    ),
    false,
  );
  assert.ok(button(member.element, "대화 초기화"));
});
