import "../test-setup/dom";
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "../lib/i18n/context";
import { CopyCommand } from "./CopyCommand";

async function mount(clipboard?: { writeText: (text: string) => Promise<void> }) {
  const original = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: clipboard,
    configurable: true,
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="ko">
        <CopyCommand command="deskrpg host-setup on --with-install" />
      </I18nProvider>,
    );
  });
  return {
    host,
    async cleanup() {
      await act(async () => root.unmount());
      host.remove();
      if (original) Object.defineProperty(globalThis.navigator, "clipboard", original);
    },
  };
}

test("명령은 언제나 화면에 그대로 보인다", async () => {
  const f = await mount(undefined);
  try {
    assert.match(f.host.textContent!, /deskrpg host-setup on --with-install/);
  } finally {
    await f.cleanup();
  }
});

test("클립보드를 쓸 수 없으면 복사 버튼을 두지 않는다", async () => {
  // 평문 HTTP 인스턴스에서는 클립보드가 막힌다 — 눌러도 아무 일 없는 버튼을 만들지 않는다.
  const f = await mount(undefined);
  try {
    assert.equal(f.host.querySelector("button"), null);
  } finally {
    await f.cleanup();
  }
});

test("복사를 누르면 명령 전체가 클립보드로 가고 알림이 바뀐다", async () => {
  const copied: string[] = [];
  const f = await mount({
    writeText: async (text: string) => {
      copied.push(text);
    },
  });
  try {
    const button = f.host.querySelector("button")!;
    assert.equal(button.textContent, "복사");
    await act(async () => button.click());
    assert.deepEqual(copied, ["deskrpg host-setup on --with-install"]);
    assert.equal(f.host.querySelector("button")!.textContent, "복사됨");
  } finally {
    await f.cleanup();
  }
});

test("클립보드가 거부해도 화면이 깨지지 않는다", async () => {
  const f = await mount({
    writeText: async () => {
      throw new Error("denied");
    },
  });
  try {
    await act(async () => f.host.querySelector("button")!.click());
    assert.equal(f.host.querySelector("button")!.textContent, "복사");
    assert.match(f.host.textContent!, /deskrpg host-setup/);
  } finally {
    await f.cleanup();
  }
});
