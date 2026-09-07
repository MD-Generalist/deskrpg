import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n";
import NpcHireWizard from "./NpcHireWizard";

/**
 * 이 파일이 존재하는 이유: `handleSaveConfig` 가 오래된 클로저를 붙잡아
 * `reasoning_effort` 를 PUT 본문에서 떨어뜨렸는데도, 화면은 "저장했습니다" 를 띄웠고
 * `npm run test` 959개는 전부 초록이었다. 컴포넌트를 렌더하는 테스트가 하나도
 * 없었기 때문이다(스테이징에서야 잡혔다).
 *
 * `exhaustive-deps` 규칙이 그 **부류**를 막으므로, 여기서는 규칙이 볼 수 없는 것만
 * 확인한다 — 저장 버튼이 실제로 무엇을 보내는가.
 */

type FetchCall = { url: string; method: string; body: unknown };

function stubFetch(calls: FetchCall[], routes: Record<string, unknown>) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const payload = key ? routes[key] : {};
    return {
      ok: true,
      status: 200,
      headers: new Map() as unknown as Headers,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as unknown as Response;
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

test("설정 저장이 선택한 reasoning_effort 를 PUT 본문에 싣는다", async () => {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stubFetch(calls, {
    "/config": { model: "gpt-5", provider: "openai-codex", toolsets: null, reasoning_effort: null },
    "/catalog": {
      providers: [{ id: "openai-codex", name: "OpenAI Codex", authenticated: true }],
      models: { "openai-codex": ["gpt-5"] },
      reasoningEfforts: ["low", "medium", "high"],
    },
    "/identity": { isDefaultTemplate: true, soul: "" },
  }) as typeof fetch;

  try {
    const { root, el } = await mount(
      <I18nProvider initialLocale="ko">
        <NpcHireWizard
          gatewayId="gw-1"
          pluginStatus="plugin_ready"
          localDiscovery={false}
          existingProfiles={["oliver"]}
          initialProfile="oliver"
          onDone={() => {}}
        />
      </I18nProvider>,
    );

    // ③ 설정 단계로 이동
    const configTab = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("③"));
    assert.ok(configTab, "③ 설정 탭을 찾지 못했다");
    await act(async () => {
      configTab.click();
    });

    const effortSelect = [...el.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.value === "high"),
    );
    assert.ok(effortSelect, "추론 강도 셀렉트가 렌더되지 않았다 — 카탈로그 배선이 끊겼다");

    await act(async () => {
      effortSelect.value = "high";
      effortSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    calls.length = 0;
    await act(async () => {
      buttonByText(el, "저장").click();
    });

    const put = calls.find((c) => c.method === "PUT" && c.url.includes("/config"));
    assert.ok(put, "설정 PUT 이 나가지 않았다");
    assert.equal(
      (put.body as Record<string, unknown>).reasoning_effort,
      "high",
      "고른 effort 가 본문에서 사라졌다 — 오래된 클로저가 다시 생겼다",
    );

    root.unmount();
    el.remove();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("카탈로그를 못 받으면 드롭다운 대신 직접 입력으로 떨어진다", async () => {
  // 강등이 없으면 게이트웨이가 목록을 못 줄 때 화면에서 모델을 **아예 지정할 수 없다**.
  // 순수 함수 테스트로는 볼 수 없는 배선이라 여기서 고정한다.
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: undefined });
    if (url.includes("/catalog")) {
      return {
        ok: false,
        status: 502,
        headers: new Map() as unknown as Headers,
        json: async () => ({ errorCode: "upstream_error" }),
        text: async () => '{"errorCode":"upstream_error"}',
      } as unknown as Response;
    }
    const payload = url.includes("/config")
      ? { model: "gpt-5", provider: "openai-codex", toolsets: null, reasoning_effort: null }
      : { isDefaultTemplate: true, soul: "" };
    return {
      ok: true,
      status: 200,
      headers: new Map() as unknown as Headers,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as unknown as Response;
  }) as typeof fetch;

  try {
    const { root, el } = await mount(
      <I18nProvider initialLocale="ko">
        <NpcHireWizard
          gatewayId="gw-1"
          pluginStatus="plugin_ready"
          localDiscovery={false}
          existingProfiles={["oliver"]}
          initialProfile="oliver"
          onDone={() => {}}
        />
      </I18nProvider>,
    );

    const configTab = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("③"));
    assert.ok(configTab, "③ 설정 탭을 찾지 못했다");
    await act(async () => {
      configTab.click();
    });

    assert.ok(
      calls.some((c) => c.url.includes("/catalog")),
      "카탈로그를 요청하지도 않았다",
    );
    assert.equal(
      el.querySelectorAll("select").length,
      0,
      "카탈로그가 실패했는데 드롭다운이 남아 있다 — 고를 수 없는 빈 목록이 된다",
    );
    assert.ok(
      el.querySelectorAll('input[type="text"]').length >= 2,
      "직접 입력으로 떨어지지 않았다 — 모델을 지정할 방법이 사라진다",
    );

    root.unmount();
    el.remove();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
