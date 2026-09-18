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
    assert.ok(configTab, "③ AI 모델 탭을 찾지 못했다");
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
    assert.ok(configTab, "③ AI 모델 탭을 찾지 못했다");
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

test("설정 단계가 이 직원의 대시보드 로그인으로 안내하고, 로그인 확인이 목록을 다시 받는다", async () => {
  // Hermes 는 NPC(프로필)마다 로그인한다. default 로 로그인해 둔 구독은 새 직원이 쓸 수 없어,
  // 안내가 없으면 사용자는 "인증 안 됨" 앞에서 멈추거나 대화 실패를 보고서야 안다
  // (2026-09-17 Hostinger VPS 실측: No Codex credentials stored).
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stubFetch(calls, {
    "/config": { model: null, provider: null, toolsets: null, reasoning_effort: null },
    "/catalog": {
      providers: [{ id: "openai-codex", name: "OpenAI Codex", authenticated: false }],
      models: {},
      reasoningEfforts: ["low"],
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
          dashboardUrl="https://dash.example.com"
          onDone={() => {}}
        />
      </I18nProvider>,
    );

    const configTab = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("③"));
    assert.ok(configTab, "③ AI 모델 탭을 찾지 못했다");
    await act(async () => {
      configTab.click();
    });

    const link = el.querySelector<HTMLAnchorElement>(
      'a[href="https://dash.example.com/env?profile=oliver"]',
    );
    assert.ok(link, "이 직원의 대시보드 로그인 링크가 없다");
    assert.equal(link.target, "_blank");
    assert.match(el.textContent ?? "", /직원마다/, "직원마다 따로 로그인한다는 설명이 없다");

    const before = calls.filter((c) => c.url.includes("/catalog")).length;
    await act(async () => {
      buttonByText(el, "로그인 확인").click();
    });
    const after = calls.filter((c) => c.url.includes("/catalog")).length;
    assert.equal(after, before + 1, "로그인 확인이 카탈로그를 다시 받지 않았다");

    root.unmount();
    el.remove();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("대시보드 주소가 없으면 링크 대신 프로필을 바꿔 로그인하라고 말한다", async () => {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stubFetch(calls, {
    "/config": { model: null, provider: null, toolsets: null, reasoning_effort: null },
    "/catalog": { providers: [], models: {}, reasoningEfforts: [] },
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
    const configTab = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("③"));
    assert.ok(configTab);
    await act(async () => {
      configTab.click();
    });
    assert.equal(el.querySelector('a[href*="/env?profile="]'), null);
    assert.match(el.textContent ?? "", /oliver/);
    assert.ok(buttonByText(el, "로그인 확인"));

    root.unmount();
    el.remove();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const PROFILE_ROUTES = (attendedChannels: number) => ({
  // 구체적인 경로를 먼저 둔다 — stubFetch 는 `includes` 로 첫 키를 고른다.
  "/identity": { isDefaultTemplate: true, body: "", revision: "r0" },
  "/config": { model: null, provider: null, toolsets: null, reasoning_effort: null },
  "/catalog": { providers: [], models: {}, reasoningEfforts: [] },
  "/plugin/profiles": { name: "mia", keyIssued: true, keyStored: true, attendedChannels },
});

function tabByNumber(el: HTMLElement, mark: string): HTMLButtonElement | undefined {
  return [...el.querySelectorAll("button")].find((b) => b.textContent?.startsWith(mark));
}

async function createProfile(el: HTMLElement) {
  const nameInput = [...el.querySelectorAll("input")].find((i) =>
    i.placeholder?.includes("새 프로필 이름"),
  );
  assert.ok(nameInput, "프로필 이름 입력칸을 찾지 못했다");
  await act(async () => {
    setInputValue(nameInput, "mia");
  });
  await act(async () => {
    buttonByText(el, "프로필 만들기").click();
  });
}

async function createAndOpenModel(el: HTMLElement) {
  await createProfile(el);
  const modelTab = tabByNumber(el, "③");
  assert.ok(modelTab, "③ 탭을 찾지 못했다");
  await act(async () => {
    modelTab.click();
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function wizardWith(
  routes: Record<string, unknown>,
  calls: FetchCall[],
  onProfileCreated?: (n: string) => void,
  onDone: (result?: { profileName: string }) => void = () => {},
) {
  globalThis.fetch = stubFetch(calls, routes) as typeof fetch;
  return (
    <I18nProvider initialLocale="ko">
      <NpcHireWizard
        gatewayId="gw-1"
        pluginStatus="plugin_ready"
        localDiscovery={false}
        existingProfiles={[]}
        onProfileCreated={onProfileCreated}
        onDone={onDone}
      />
    </I18nProvider>
  );
}

test("단계는 ① 프로필 ② 인격 ③ AI 모델 셋이고, ④ 배치의 링크 버튼은 없다", async () => {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  try {
    const { root, el } = await mount(wizardWith(PROFILE_ROUTES(1), calls));
    const tabs = [...el.querySelectorAll("button")]
      .map((b) => b.textContent ?? "")
      .filter((text) => /^[①②③④]/.test(text));
    assert.deepEqual(tabs, ["① 프로필", "② 인격", "③ AI 모델"]);
    await createAndOpenModel(el);
    const text = el.textContent ?? "";
    for (const gone of ["완성형 외형 선택하기", "채널로 이동", "마법사 닫기"]) {
      assert.equal(text.includes(gone), false, `"${gone}" 가 남아 있다`);
    }
    root.unmount();
    el.remove();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("프로필을 만들기 전에는 ②③ 이 잠기고 그 이유를 글자로 보여준다", async () => {
  // 2026-09-18 스테이징 실측: 새 프로필인데 ② 를 누르면 "인격 파일을 읽을 수 없어
  // 편집기를 열지 않습니다" 가 떴고, ③ 은 모델 목록 대신 자유 입력이었다.
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  try {
    const { root, el } = await mount(wizardWith(PROFILE_ROUTES(1), calls));
    assert.equal(tabByNumber(el, "②")?.disabled, true, "② 가 잠기지 않았다");
    assert.equal(tabByNumber(el, "③")?.disabled, true, "③ 이 잠기지 않았다");
    const text = el.textContent ?? "";
    assert.match(text, /먼저 ① 에서 프로필을 만드세요/);
    assert.equal(text.includes("인격 파일을 읽을 수 없어"), false);

    await createProfile(el);
    assert.equal(tabByNumber(el, "②")?.disabled, false, "프로필을 만든 뒤에도 ② 가 잠겨 있다");
    assert.equal(tabByNumber(el, "③")?.disabled, false, "프로필을 만든 뒤에도 ③ 이 잠겨 있다");
    root.unmount();
    el.remove();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("붙은 채널이 없으면 '출근했다'고 말하지 않는다", async () => {
  // 채널이 없는데 출근했다고 띄우면, 사용자는 있지도 않은 출근부에서 직원을 찾다 막힌다
  // (Hostinger VPS 실측 2026-09-17).
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  try {
    const { root, el } = await mount(wizardWith(PROFILE_ROUTES(0), calls));
    await createAndOpenModel(el);
    const text = el.textContent ?? "";
    assert.equal(/출근했습니다/.test(text), false, "출근하지 않았는데 출근했다고 말한다");
    assert.match(text, /채널에 연결하면/, "다음에 무엇을 해야 하는지 안내가 없다");
    root.unmount();
    el.remove();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("붙은 채널이 있으면 출근 결과를 한 줄로 알린다", async () => {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  try {
    const { root, el } = await mount(wizardWith(PROFILE_ROUTES(2), calls));
    await createAndOpenModel(el);
    assert.match(el.textContent ?? "", /채널 2곳에 출근했습니다/);
    root.unmount();
    el.remove();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("③ 의 완료가 마법사를 끝내며 그 직원 이름을 넘긴다", async () => {
  const calls: FetchCall[] = [];
  const done: Array<{ profileName: string } | undefined> = [];
  const originalFetch = globalThis.fetch;
  try {
    const { root, el } = await mount(
      wizardWith(PROFILE_ROUTES(1), calls, undefined, (r) => done.push(r)),
    );
    await createAndOpenModel(el);
    await act(async () => {
      buttonByText(el, "완료").click();
    });
    assert.deepEqual(done, [{ profileName: "mia" }]);
    root.unmount();
    el.remove();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("프로필을 만들면 곧바로 바깥 목록에 알린다", async () => {
  // 알리지 않으면 마법사를 닫기 전까지 아래 프로필 목록이 "등록된 프로필이 없습니다"
  // 로 남아, 방금 만든 직원이 없어진 것처럼 보인다.
  const calls: FetchCall[] = [];
  const created: string[] = [];
  const originalFetch = globalThis.fetch;
  try {
    const { root, el } = await mount(
      wizardWith(PROFILE_ROUTES(0), calls, (name) => created.push(name)),
    );
    await createProfile(el);
    assert.deepEqual(created, ["mia"]);
    root.unmount();
    el.remove();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
