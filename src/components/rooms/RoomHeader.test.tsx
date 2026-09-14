import "../../test-setup/dom";
import assert from "node:assert/strict";
import test from "node:test";
import { act, useReducer, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/lib/i18n";
import { initialRoomState, reduceRoomState } from "@/app/game/room-state";
import type { RoomSummary } from "@/lib/chat-rooms-policy";
import RoomHeader from "./RoomHeader";
import RoomList from "./RoomList";
const office: RoomSummary = {
  id: "office",
  kind: "office",
  name: "office",
  replyPolicy: "mention",
  createdBy: "user",
  lastMessageAt: null,
  members: [],
};
function SingleRoom() {
  const [state, dispatch] = useReducer(
    reduceRoomState,
    reduceRoomState(initialRoomState, { type: "list", rooms: [office], preferRoomId: null }),
  );
  const [closed, setClosed] = useState(false);
  if (closed) return <span>closed</span>;
  if (state.view === "compose") return <span>creating room</span>;
  if (state.view === "list")
    return (
      <RoomList
        rooms={state.rooms}
        currentRoomId={state.currentRoomId}
        onOpen={(roomId) => dispatch({ type: "open", roomId })}
        onNew={() => dispatch({ type: "compose", presetNpcIds: [] })}
      />
    );
  return (
    <RoomHeader
      room={office}
      canManage
      onBack={() => dispatch({ type: "showList" })}
      onClose={() => setClosed(true)}
      onInvite={() => {}}
      onRename={() => {}}
      onLeave={() => {}}
      onDelete={() => {}}
    />
  );
}
test("a single office room exposes creation through its list and retains a separate close action", async () => {
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () =>
      root.render(
        <I18nProvider initialLocale="ko">
          <SingleRoom />
        </I18nProvider>,
      ),
    );
    await act(async () =>
      element.querySelector<HTMLButtonElement>('button[aria-label="방"]')!.click(),
    );
    const create = [...element.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("새 방"),
    );
    assert.ok(create, "single-room list must expose new room");
    await act(async () => create.click());
    assert.match(element.textContent ?? "", /creating room/);
    await act(async () =>
      root.render(
        <I18nProvider initialLocale="ko">
          <SingleRoom key="close" />
        </I18nProvider>,
      ),
    );
    await act(async () =>
      element.querySelector<HTMLButtonElement>('button[aria-label="닫기"]')!.click(),
    );
    assert.equal(element.textContent, "closed");
  } finally {
    await act(async () => root.unmount());
    element.remove();
  }
});
