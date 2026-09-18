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
import ChannelsPage from "./page";

// `/channels` 는 `useRouter` 를 쓴다 — 테스트에는 앱 라우터가 없으므로 빈 라우터를 심는다.
const router: AppRouterInstance = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
  bfcacheId: "test",
};

function stubFetch(me: unknown) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.endsWith("/api/characters/me")
      ? { character: me }
      : url.endsWith("/api/groups")
        ? { groups: [] }
        : {
            channels: [
              {
                id: "ch1",
                name: "우리 사무실",
                description: null,
                ownerId: "u1",
                ownerNickname: "나",
                isPublic: true,
                isLocked: false,
                isMember: true,
                inviteCode: null,
                maxPlayers: 10,
                playerCount: 0,
                createdAt: "2026-09-18T00:00:00.000Z",
              },
            ],
            currentUserId: "u1",
          };
    return {
      ok: true,
      status: 200,
      headers: new Map() as unknown as Headers,
      json: async () => body,
    } as unknown as Response;
  }) as typeof fetch;
}

async function render(me: unknown) {
  const original = globalThis.fetch;
  globalThis.fetch = stubFetch(me);
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  try {
    await act(async () =>
      root.render(
        <AppRouterContext.Provider value={router}>
          <I18nProvider initialLocale="ko">
            <ChannelsPage />
          </I18nProvider>
        </AppRouterContext.Provider>,
      ),
    );
    // 목록·캐릭터 조회가 끝나 로딩이 풀릴 때까지 기다린다.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  } finally {
    globalThis.fetch = original;
  }
  return {
    el,
    cleanup: async () => {
      await act(async () => root.unmount());
      el.remove();
    },
  };
}

test("캐릭터가 없으면 채널 목록 대신 내 캐릭터로 가는 안내 카드를 그린다", async () => {
  const { el, cleanup } = await render(null);
  try {
    const text = el.textContent ?? "";
    assert.match(text, /먼저 내 캐릭터를 만드세요/);
    assert.doesNotMatch(text, /우리 사무실/, "채널 목록은 가려진다");
    const link = [...el.querySelectorAll("a")].find((a) => a.textContent === "내 캐릭터 만들기");
    assert.ok(link, "내 캐릭터 링크가 있다");
    assert.equal(link.getAttribute("href"), "/characters");
  } finally {
    await cleanup();
  }
});

test("캐릭터가 있으면 안내 카드 없이 채널 목록을 그린다", async () => {
  const { el, cleanup } = await render({ id: "c1", name: "나", bio: null, appearance: {} });
  try {
    const text = el.textContent ?? "";
    assert.doesNotMatch(text, /먼저 내 캐릭터를 만드세요/);
    assert.match(text, /우리 사무실/);
  } finally {
    await cleanup();
  }
});
