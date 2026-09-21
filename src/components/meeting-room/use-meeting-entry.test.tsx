import "../../test-setup/dom";
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { EventBus } from "@/game/EventBus";
import { useMeetingEntry } from "./use-meeting-entry";

function EntryHarness() {
  const entry = useMeetingEntry(null, "channel");
  return (
    <div data-state={entry.state.status}>
      <button onClick={entry.request}>enter</button>
      <button onClick={entry.cancel}>cancel</button>
    </div>
  );
}

test("도보/방 안 진입은 도착과 서버확인 뒤 동일한 카메라 경로로 연결된다", async (context) => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  let requestCount = 0;
  const request = () => {
    requestCount++;
  };
  const camera = () => EventBus.emit("meeting:presentation-result", { ok: true });
  EventBus.on("meeting:request-entry", request);
  EventBus.on("meeting:presentation-enter", camera);
  context.after(async () => {
    await act(async () => root.unmount());
    EventBus.off("meeting:request-entry", request);
    EventBus.off("meeting:presentation-enter", camera);
    element.remove();
  });
  await act(async () => root.render(<EntryHarness />));
  const [enter, cancel] = element.querySelectorAll("button");
  await act(async () => {
    enter.click();
    enter.click();
  });
  assert.equal(requestCount, 1);
  assert.equal(element.firstElementChild?.getAttribute("data-state"), "walking");
  await act(async () => EventBus.emit("meeting:entry-state", { status: "arrived" }));
  assert.equal(element.firstElementChild?.getAttribute("data-state"), "joining");
  await act(async () => EventBus.emit("meeting:joined"));
  assert.equal(element.firstElementChild?.getAttribute("data-state"), "joined");
  await act(async () => cancel.click());
  EventBus.off("meeting:request-entry", request);
  const inside = () => EventBus.emit("meeting:entry-state", { status: "arrived" });
  EventBus.on("meeting:request-entry", inside);
  context.after(() => EventBus.off("meeting:request-entry", inside));
  await act(async () => EventBus.emit("meeting:entry-intent"));
  assert.equal(element.firstElementChild?.getAttribute("data-state"), "joining");
  await act(async () => EventBus.emit("meeting:join-failed", { reasonCode: "forbidden" }));
  assert.equal(element.firstElementChild?.getAttribute("data-state"), "failed");
  await act(async () => EventBus.emit("meeting:joined"));
  assert.equal(element.firstElementChild?.getAttribute("data-state"), "failed");
});

test("WebGL 렌더러가 없으면 성공을 가장하지 않고 참가 UI를 되돌린다", async () => {
  const element = document.createElement("div");
  const root = createRoot(element);
  await act(async () => root.render(<EntryHarness />));
  await act(async () => element.querySelector("button")!.click());
  await act(async () => EventBus.emit("meeting:entry-state", { status: "arrived" }));
  await act(async () => EventBus.emit("meeting:joined"));
  assert.equal(element.firstElementChild?.getAttribute("data-state"), "failed");
  await act(async () => root.unmount());
});

test("맵 위 '오피스로' 버튼의 exit-intent 는 참가 중인 회의 화면을 닫는다", async (context) => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  const camera = () => EventBus.emit("meeting:presentation-result", { ok: true });
  EventBus.on("meeting:presentation-enter", camera);
  context.after(async () => {
    await act(async () => root.unmount());
    EventBus.off("meeting:presentation-enter", camera);
    element.remove();
  });
  await act(async () => root.render(<EntryHarness />));
  await act(async () => element.querySelector("button")!.click());
  await act(async () => EventBus.emit("meeting:entry-state", { status: "arrived" }));
  await act(async () => EventBus.emit("meeting:joined"));
  assert.equal(element.firstElementChild?.getAttribute("data-state"), "joined");
  // 상단 네비에는 나가는 버튼이 없다 — 이 이벤트가 회의 화면을 떠나는 유일한 상단 밖 경로다.
  await act(async () => EventBus.emit("meeting:exit-intent"));
  assert.equal(element.firstElementChild?.getAttribute("data-state"), "idle");
});
