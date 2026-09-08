import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { planGatewayDelete } from "@/app/gateways/gateway-delete-plan";
import { backLinkTarget } from "@/app/gateways/return-target";
import { I18nProvider } from "@/lib/i18n";
import HermesProfileList from "./HermesProfileList";

/**
 * 이 화면은 **되돌릴 수 없는 것**을 묻는 자리다 — 프로필을 지우면 그 인격의 NPC
 * 자리와 태스크가 CASCADE 로 함께 사라진다. 문구가 수치를 잃어도, 삭제 뒤 알림이
 * 서버 필드 이름과 어긋나도 화면은 아무 일 없다는 얼굴을 한다(실제로 그랬다 —
 * `unboundNpcs` 를 읽는 코드가 `deletedNpcs` 를 보내는 서버를 만나 알림이
 * 조용히 사라져 있었다). 그 두 가지를 여기서 고정한다.
 */

type Route = { url: string; method: string };

function stubFetch(handler: (route: Route) => { ok?: boolean; status?: number; body: unknown }) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const { ok = true, status = 200, body } = handler({ url, method });
    return {
      ok,
      status,
      headers: new Map() as unknown as Headers,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }) as typeof fetch;
}

const OLIVER = {
  id: "p1",
  profileName: "oliver",
  displayName: null,
  lastValidationStatus: "valid",
  appearance: null,
};

/** 프로필 목록·플러그인 프로브·로컬 탐색까지, 마운트가 때리는 경로를 한 번에 답한다. */
function defaultRoutes() {
  return ({ url, method }: Route) => {
    if (url.endsWith("/api/gateways")) return { body: { gateways: [] } };
    if (url.includes("/local-discovery")) return { body: { available: false } };
    if (url.includes("/test")) return { body: {} };
    if (/\/profiles\/p1$/.test(url) && method === "GET") {
      return { body: { usage: { npcs: 2, channels: 2 } } };
    }
    if (/\/profiles\/p1$/.test(url) && method === "DELETE") {
      return { body: { ok: true, deletedNpcs: 2, channels: 2 } };
    }
    if (url.endsWith("/profiles")) return { body: { profiles: [OLIVER] } };
    return { body: {} };
  };
}

async function mount(node: React.ReactElement): Promise<{ root: Root; el: HTMLElement }> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(node);
  });
  return { root, el };
}

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  assert.ok(found, `"${text}" 버튼을 찾지 못했다`);
  return found as HTMLButtonElement;
}

function hasButton(el: HTMLElement, text: string): boolean {
  return [...el.querySelectorAll("button")].some((b) => b.textContent?.trim() === text);
}

test("삭제 확인은 usage 수치를 문구에 넣는다", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stubFetch(defaultRoutes());
  const confirms: string[] = [];
  const originalConfirm = window.confirm;
  window.confirm = ((m?: string) => {
    confirms.push(String(m));
    return false;
  }) as typeof window.confirm;

  try {
    const { root, el } = await mount(
      <I18nProvider initialLocale="ko">
        <HermesProfileList gatewayId="g" canRegister />
      </I18nProvider>,
    );

    await act(async () => {
      buttonByText(el, "삭제").click();
    });

    assert.equal(confirms.length, 1, "삭제 확인을 묻지 않았다");
    assert.match(
      confirms[0],
      /2개 채널/,
      "확인 문구에서 채널 수가 사라졌다 — 무엇이 사라지는지 모른 채 누르게 된다",
    );
    assert.match(confirms[0], /2개/, "NPC 자리 수가 문구에 없다");

    root.unmount();
    el.remove();
  } finally {
    globalThis.fetch = originalFetch;
    window.confirm = originalConfirm;
  }
});

test("외형 편집은 소유자에게만 보인다", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stubFetch(defaultRoutes());

  try {
    const owner = await mount(
      <I18nProvider initialLocale="ko">
        <HermesProfileList gatewayId="g" canRegister />
      </I18nProvider>,
    );
    assert.equal(hasButton(owner.el, "외형"), true, "소유자에게 외형 버튼이 없다");
    owner.root.unmount();
    owner.el.remove();

    const guest = await mount(
      <I18nProvider initialLocale="ko">
        <HermesProfileList gatewayId="g" canRegister={false} />
      </I18nProvider>,
    );
    assert.equal(
      hasButton(guest.el, "외형"),
      false,
      "공유 사용자에게 외형 버튼이 보인다 — 남의 인격 생김새를 바꿀 수 있게 된다",
    );
    guest.root.unmount();
    guest.el.remove();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("삭제 뒤 알림은 서버의 deletedNpcs·channels 를 그대로 읽는다", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stubFetch(defaultRoutes());
  const originalConfirm = window.confirm;
  window.confirm = (() => true) as typeof window.confirm;

  try {
    const { root, el } = await mount(
      <I18nProvider initialLocale="ko">
        <HermesProfileList gatewayId="g" canRegister />
      </I18nProvider>,
    );

    await act(async () => {
      buttonByText(el, "삭제").click();
    });
    // 삭제는 usage 조회 → confirm → DELETE → 목록 재조회로 이어지는 여러 마이크로태스크다.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const text = el.textContent ?? "";
    assert.match(
      text,
      /NPC 자리 2개가 2개 채널에서/,
      "삭제 알림이 뜨지 않았다 — 서버 필드 이름이 어긋나면 이 알림은 조용히 사라진다",
    );

    root.unmount();
    el.remove();
  } finally {
    globalThis.fetch = originalFetch;
    window.confirm = originalConfirm;
  }
});

/**
 * `?returnTo=` 는 사용자가 준 값이다. 게이트웨이 화면이 그걸 그대로 링크에 박으면
 * `//evil.com` 한 줄로 열린 리다이렉트가 된다. page.tsx 를 통째로 렌더하려면
 * next/navigation 라우터를 흉내 내야 해서, 그 한 줄을 `backLinkTarget` 으로 뽑고
 * 여기서 고정한다 — page.tsx 는 이 함수만 부른다.
 */
test("돌아가기 링크는 적대적인 returnTo 를 통과시키지 않는다", () => {
  assert.equal(backLinkTarget("//evil.com"), "/channels");
  assert.equal(backLinkTarget("/\\evil.com"), "/channels");
  assert.equal(backLinkTarget("https://evil.com/x"), "/channels");
  assert.equal(backLinkTarget("/channels/abc"), "/channels/abc");
  assert.equal(backLinkTarget(null), null, "돌아갈 곳이 없으면 링크를 띄우지 않는다");
});

/**
 * 게이트웨이 삭제는 채널 바인딩이 하나라도 있으면 서버가 409 로 거절한다
 * (`api/gateways/[id]/route.ts:126-138`). 그런데도 "함께 사라집니다" 를 물으면
 * 사용자는 일어나지 않을 삭제에 동의하고, 아무 일도 없는 화면을 본다.
 *
 * page.tsx 를 통째로 렌더하려면 app router 컨텍스트(useSearchParams/useRouter)를
 * 흉내 내야 해서, 그 분기를 `planGatewayDelete` 로 뽑고 여기서 고정한다 —
 * `handleDelete` 는 이 판정만 보고 확인·DELETE 를 건너뛴다.
 */
test("채널에 나가 있으면 삭제 확인을 아예 띄우지 않는다", () => {
  const plan = planGatewayDelete({ profiles: 1, npcs: 2, channels: 2 });
  assert.equal(
    plan.blocked,
    true,
    "채널에 묶인 게이트웨이인데 확인을 띄운다 — 서버는 409 로 거절하므로 거짓 확인이 된다",
  );
});

test("채널에 아무도 없으면 프로필·NPC 수치를 담아 확인한다", () => {
  const plan = planGatewayDelete({ profiles: 1, npcs: 3, channels: 0 });
  assert.equal(plan.blocked, false);
  assert.equal(plan.blocked === false && plan.npcs, 3);
});
