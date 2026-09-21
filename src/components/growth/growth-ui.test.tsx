import "../../test-setup/dom";
import test from "node:test";
import assert from "node:assert/strict";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "../../lib/i18n/context";
import { GrowthStarButton } from "./GrowthStarButton";
import { UpdateNoticeModal } from "./UpdateNoticeModal";

async function mount(node: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<I18nProvider initialLocale="ko">{node}</I18nProvider>));
  return {
    host,
    async cleanup() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

test("Star 버튼은 수를 줄여 보이고, 수를 모르면 숫자 없이 레포로 연결한다", async () => {
  const withCount = await mount(
    <GrowthStarButton stars={1234} clicked={false} onClick={() => {}} />,
  );
  assert.equal(
    withCount.host.querySelector("[data-testid=growth-star-count]")?.textContent,
    "1.2k",
  );
  assert.equal(
    withCount.host.querySelector("a")?.getAttribute("href"),
    "https://github.com/dandacompany/deskrpg",
  );
  await withCount.cleanup();

  const noCount = await mount(<GrowthStarButton stars={null} clicked={false} onClick={() => {}} />);
  assert.equal(noCount.host.querySelector("[data-testid=growth-star-count]"), null);
  await noCount.cleanup();
});

test("Star 버튼을 누르면 onClick 이 불리고, 누른 뒤에는 강조 색을 쓰지 않는다", async () => {
  let clicks = 0;
  const m = await mount(<GrowthStarButton stars={3} clicked={false} onClick={() => clicks++} />);
  const a = m.host.querySelector("a")!;
  a.addEventListener("click", (e) => e.preventDefault());
  await act(async () => a.click());
  assert.equal(clicks, 1);
  await m.cleanup();

  const quiet = await mount(<GrowthStarButton stars={3} clicked onClick={() => {}} />);
  assert.doesNotMatch(quiet.host.querySelector("a")!.className, /bg-primary/);
  await quiet.cleanup();
});

test("업데이트 안내는 열리는 순간 확인 처리하고 해당 릴리스 노트로 연결한다", async () => {
  let seen = 0;
  const m = await mount(
    <UpdateNoticeModal
      version="2026.921.3"
      latestVersion="2026.922.0"
      onSeen={() => seen++}
      onClose={() => {}}
    />,
  );
  assert.equal(seen, 1);
  assert.ok(m.host.textContent?.includes("v2026.922.0"));
  const link = [...m.host.querySelectorAll("a")].find((a) => a.href.includes("/releases/tag/"));
  assert.equal(
    link?.getAttribute("href"),
    "https://github.com/dandacompany/deskrpg/releases/tag/2026.922.0",
  );
  await m.cleanup();
});

/** 실제 브라우저처럼 body 에서 올라가는 취소 가능한 Esc 하나. jsdom 의 리스너 순서에 기대지 않는다. */
function pressEscape(consumedAbove = false) {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  if (consumedAbove) event.preventDefault();
  act(() => {
    document.body.dispatchEvent(event);
  });
  return event;
}

test("업데이트 안내는 Esc 로 닫히고 그 Esc 를 소비한다, 위 레이어가 소비한 Esc 는 무시한다", async () => {
  let closed = 0;
  const m = await mount(
    <UpdateNoticeModal
      version="2026.921.3"
      latestVersion="2026.922.0"
      onSeen={() => {}}
      onClose={() => closed++}
    />,
  );
  pressEscape(true);
  assert.equal(closed, 0);
  const event = pressEscape();
  assert.equal(closed, 1);
  assert.equal(event.defaultPrevented, true);
  await m.cleanup();
});
