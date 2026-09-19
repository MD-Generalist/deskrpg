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

type ChannelStub = Record<string, unknown>;

function channel(overrides: ChannelStub): ChannelStub {
  return {
    id: "ch",
    name: "채널",
    description: null,
    ownerId: "u1",
    ownerNickname: "나",
    isPublic: true,
    isLocked: false,
    isMember: true,
    inviteCode: null,
    maxPlayers: 50,
    createdAt: "2026-09-18T00:00:00.000Z",
    environmentId: null,
    memberCount: 0,
    participants: [],
    ...overrides,
  };
}

let channelsBody: ChannelStub[] = [];

function stubFetch(me: unknown) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.endsWith("/api/characters/me")
      ? { character: me }
      : url.endsWith("/api/groups")
        ? { groups: [] }
        : { channels: channelsBody, currentUserId: "u1" };
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

const me = { id: "c1", name: "나", bio: null, appearance: {} };
const people = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ nickname: `사람${i + 1}`, appearance: null }));

test("채널 카드는 맵 썸네일·원형 아바타·'N명 참여' 를 그리고 '접속중' 을 쓰지 않는다", async () => {
  channelsBody = [
    channel({
      id: "tech",
      name: "기술팀",
      environmentId: "tech",
      memberCount: 2,
      participants: people(2),
    }),
  ];
  const { el, cleanup } = await render(me);
  try {
    const card = el.querySelector('[data-channel-id="tech"]')!;
    assert.ok(card, "카드가 있다");
    const img = card.querySelector("img[data-channel-thumbnail]");
    assert.ok(img, "썸네일 이미지가 있다");
    assert.match(
      decodeURIComponent(img.getAttribute("src") ?? ""),
      /environments\/thumbnails\/tech-/,
    );
    assert.equal(card.querySelectorAll("[data-participant-avatar]").length, 2);
    const text = card.textContent ?? "";
    assert.match(text, /2명 참여/);
    assert.doesNotMatch(text, /접속중/);
  } finally {
    await cleanup();
  }
});

test("미리보기보다 참여자가 많으면 +N 을, 환경을 모르면 썸네일 대신 빈 자리를 그린다", async () => {
  channelsBody = [
    channel({ id: "big", environmentId: null, memberCount: 7, participants: people(5) }),
  ];
  const { el, cleanup } = await render(me);
  try {
    const card = el.querySelector('[data-channel-id="big"]')!;
    assert.equal(card.querySelector("img[data-channel-thumbnail]"), null);
    assert.ok(card.querySelector("[data-channel-thumbnail-placeholder]"));
    assert.equal(card.querySelectorAll("[data-participant-avatar]").length, 5);
    assert.match(card.textContent ?? "", /\+2/);
    assert.match(card.textContent ?? "", /7명 참여/);
  } finally {
    await cleanup();
  }
});
