import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";

import { I18nProvider } from "@/lib/i18n";
import GatewayOnboardingGuide from "./GatewayOnboardingGuide";

// 이 화면은 `quickStart` 에서 `useRouter` 를 쓴다 — 테스트에는 앱 라우터가 없으므로 빈 라우터를 심는다.
const router: AppRouterInstance = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
  bfcacheId: "test",
};

async function render() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(
      <AppRouterContext.Provider value={router}>
        <I18nProvider initialLocale="ko">
          <GatewayOnboardingGuide />
        </I18nProvider>
      </AppRouterContext.Provider>,
    );
  });
  return { el, root };
}

test("첫 화면에는 도입부와 동작 버튼만 펼쳐 둔다", async () => {
  const { el, root } = await render();
  const text = el.textContent ?? "";

  // 남는 것
  assert.match(text, /런타임을 내장하지 않습니다/);
  assert.match(text, /빠른 시작/);

  // 접히는 것 — 명령은 details 안에 있어 열기 전에는 보이지 않는다.
  const details = el.querySelector("details");
  assert.ok(details, "수동 설치 영역이 details 가 아니다");
  assert.equal(details!.hasAttribute("open"), false);

  await act(async () => root.unmount());
  el.remove();
});

test("소유자 키 경고는 안내 카드에서 빠진다", async () => {
  const { el, root } = await render();
  // 이 경고는 키를 넣는 자리(마법사)로 옮겼다 — 여기 남겨 두면 읽히지 않는다.
  assert.ok(!(el.textContent ?? "").includes("API_SERVER_KEY"));
  await act(async () => root.unmount());
  el.remove();
});
