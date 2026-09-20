import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n/context";

import ChatBubble from "./ChatBubble";

async function mount(node: React.ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  // NPC 말풍선은 마크다운을 그리고, 그 렌더러가 내려받기 라벨을 번역한다(`chat.download`).
  await act(async () => root.render(<I18nProvider initialLocale="ko">{node}</I18nProvider>));
  return el;
}

test("상대 말풍선은 아바타를 왼쪽에 둔다 — 외형을 몰라도 자리는 있다", async () => {
  const el = await mount(
    <ChatBubble sender="npc" name="noah" avatar={null}>
      안녕하세요
    </ChatBubble>,
  );
  const avatar = el.querySelector("[data-chat-avatar]");
  assert.ok(avatar, "아바타가 없다");
  assert.equal(avatar.getAttribute("data-chat-avatar"), "shown");
  const bubble = el.querySelector("[data-chat-bubble]")!;
  assert.ok(
    avatar.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING,
    "아바타가 말풍선 앞(왼쪽)에 와야 한다",
  );
});

test("같은 발화자의 연속 말풍선은 아바타 대신 같은 폭의 빈 자리를 둔다", async () => {
  const el = await mount(
    <ChatBubble sender="npc" name="noah" avatar={null} continued>
      이어서 말합니다
    </ChatBubble>,
  );
  const slot = el.querySelector("[data-chat-avatar]");
  assert.ok(slot, "정렬용 자리가 없다");
  assert.equal(slot.getAttribute("data-chat-avatar"), "spacer");
  assert.equal(slot.querySelector("img, span"), null, "빈 자리에는 아무것도 그리지 않는다");
  assert.equal(el.textContent?.includes("noah"), false, "연속 말풍선은 이름도 되풀이하지 않는다");
});

test("내 말풍선에는 아바타가 없다", async () => {
  const el = await mount(
    <ChatBubble sender="player" avatar={null}>
      내가 보낸 말
    </ChatBubble>,
  );
  assert.equal(el.querySelector("[data-chat-avatar]"), null);
});

test("avatar 를 넘기지 않으면 예전과 같다 — 아바타 자리도 없다", async () => {
  const el = await mount(
    <ChatBubble sender="npc" name="noah">
      예전 호출부
    </ChatBubble>,
  );
  assert.equal(el.querySelector("[data-chat-avatar]"), null);
  assert.ok(el.textContent?.includes("noah"));
});
