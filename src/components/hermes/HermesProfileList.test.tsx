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
 * 목록 화면은 이제 **이름·상태·상세 링크**만 갖는다. 되돌릴 수 없는 결정(삭제 확인 수치,
 * 삭제 뒤 알림, 소유자만 편집)은 직원 상세로 옮겨 `src/app/profiles/employee-detail-view.ts`
 * 의 순수 함수로 고정했다.
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
