import "../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n";
import type { RoomState } from "@/app/game/room-state";
import type { RoomSummary } from "@/lib/chat-rooms-policy";
import ChatPanel from "./ChatPanel";

function room(id: string, kind: RoomSummary["kind"], name: string): RoomSummary {
  return {
    id,
    kind,
    name,
    replyPolicy: kind === "office" ? "mention" : "members",
    createdBy: "u1",
    lastMessageAt: null,
    members: [],
  };
}

function listState(): RoomState {
  return {
    rooms: [room("office", "office", "사무실"), room("g1", "group", "기획팀")],
    viewerUserId: "u1",
    currentRoomId: "g1",
    view: "list",
    messages: {},
  };
}

// 필수 prop 만 채운 뼈대. 목록 뷰의 닫기 동작만 검증한다.
function panel(roomState: RoomState) {
  return (
    <I18nProvider>
      <ChatPanel
        dialogNpc={null}
        npcMessages={[]}
        isNpcStreaming={false}
        onSend={() => {}}
        onClose={() => {}}
        npcSelectList={null}
        onSelectNpc={() => {}}
        roomState={roomState}
        onRoomSend={() => {}}
        onRoomAction={() => {}}
        onRoomCreate={() => {}}
        onRoomInvite={() => {}}
        onRoomLeave={() => {}}
        onRoomRename={() => {}}
        onRoomDelete={() => {}}
        mentionCandidatesFor={() => []}
        onlinePlayers={[]}
      />
    </I18nProvider>
  );
}

async function mount(node: React.ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(node);
  });
  return el;
}

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(el.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").trim() === text,
  );
  assert.ok(btn, `button "${text}" 를 찾지 못했다`);
  return btn as HTMLButtonElement;
}

async function click(node: Element) {
  await act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const OPEN = "▶"; // ▶ 다시 열기
const BACK = "◀"; // ◀ 뒤로

test("방이 여러 개인 목록 뷰에서 ◀ 는 패널을 접는다 (I-2)", async () => {
  const el = await mount(panel(listState()));

  // 처음엔 닫혀 있고 다시 열기 버튼만 보인다.
  await click(buttonByText(el, OPEN));

  // 패널이 열리며 목록 헤더의 ◀ 가 나타난다.
  const back = buttonByText(el, BACK);
  await click(back);

  // 방이 2개여도 목록의 ◀ 는 패널을 닫아야 한다 — 다시 열기 버튼만 남는다.
  const reopen = Array.from(el.querySelectorAll("button")).filter(
    (b) => (b.textContent ?? "").trim() === OPEN,
  );
  assert.equal(reopen.length, 1, "패널이 접혀 다시 열기 버튼만 남아야 한다");
  assert.equal(
    Array.from(el.querySelectorAll("button")).some((b) => (b.textContent ?? "").trim() === BACK),
    false,
    "접힌 패널에는 ◀ 가 없어야 한다",
  );
});
