import "../../test-setup/dom";
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { EventBus } from "@/game/EventBus";
import { useMeetingAutoReturn, type AutoReturnState } from "./use-meeting-auto-return";

type Api = ReturnType<typeof useMeetingAutoReturn>;

async function mount(context: test.TestContext, active: boolean) {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let exits = 0;
  const onExit = () => {
    exits++;
  };
  EventBus.on("meeting:exit-intent", onExit);
  const element = document.createElement("div");
  const root = createRoot(element);
  const api: { current: Api | null } = { current: null };
  const sink = (value: Api) => {
    api.current = value;
  };
  function Harness({ on }: { on: boolean }) {
    sink(useMeetingAutoReturn(on, 3));
    return null;
  }
  await act(async () => root.render(<Harness on={active} />));
  context.after(async () => {
    await act(async () => root.unmount());
    EventBus.off("meeting:exit-intent", onExit);
  });
  return {
    api: () => api.current!,
    state: (): AutoReturnState => api.current!.state,
    exits: () => exits,
    tick: async (ms: number) => {
      for (let i = 0; i < ms / 1000; i++) await act(async () => context.mock.timers.tick(1000));
    },
    setActive: (on: boolean) => act(async () => root.render(<Harness on={on} />)),
  };
}

test("등록을 마치면 세고 난 뒤 exit-intent 로 오피스에 돌아간다", async (context) => {
  const h = await mount(context, true);
  await act(async () => h.api().start());
  assert.deepEqual(h.state(), { status: "counting", remaining: 3 });
  await h.tick(2000);
  assert.deepEqual(h.state(), { status: "counting", remaining: 1 });
  assert.equal(h.exits(), 0, "다 세기 전에는 나가지 않는다");
  await h.tick(1000);
  assert.equal(h.exits(), 1);
  assert.equal(h.state().status, "returned");
  await h.tick(5000);
  assert.equal(h.exits(), 1, "한 번만 나간다");
});

test("'머무르기' 는 자동 복귀를 취소한다", async (context) => {
  const h = await mount(context, true);
  await act(async () => h.api().start());
  await h.tick(1000);
  await act(async () => h.api().stay());
  await h.tick(10_000);
  assert.equal(h.exits(), 0);
  assert.equal(h.state().status, "stayed");
});

test("후속 업무가 없는 회의는 안내만 하고 나가지 않는다", async (context) => {
  const h = await mount(context, true);
  await act(async () => h.api().hint());
  await h.tick(10_000);
  assert.equal(h.exits(), 0);
  assert.equal(h.state().status, "hint");
});

test("회의 진행 중(종료 화면이 아닐 때)에는 절대 발동하지 않는다", async (context) => {
  const h = await mount(context, false);
  await act(async () => h.api().start());
  await h.tick(10_000);
  assert.equal(h.exits(), 0, "진행 중에 시작 신호가 와도 무시한다");
  assert.equal(h.state().status, "idle");

  // 세는 도중 새 회의가 시작되면(종료 화면이 사라지면) 세던 것을 버린다.
  await h.setActive(true);
  await act(async () => h.api().start());
  await h.tick(1000);
  await h.setActive(false);
  await h.tick(10_000);
  assert.equal(h.exits(), 0);
  assert.equal(h.state().status, "idle");
});
