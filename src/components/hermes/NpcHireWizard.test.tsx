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
    const configTab = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("④"));
    assert.ok(configTab, "③ AI 모델 탭을 찾지 못했다");
    await act(async () => {
      configTab.click();
    });
    assert.equal(
      [...el.querySelectorAll("a")].some((anchor) => anchor.textContent?.includes("오피스 만들기")),
      false,
      "기존 직원은 출근 채널 수가 알려지지 않았으므로 오피스 생성 안내를 보이지 않는다",
    );

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

    const configTab = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("④"));
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

    const configTab = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("④"));
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
    const configTab = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("④"));
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
  "/toolsets": {
    platform: "api_server",
    toolsets: [
      { name: "web", label: "Web", description: "검색", enabled: true, configured: true },
      { name: "tts", label: "TTS", description: "음성", enabled: false, configured: true },
    ],
  },
  "/skills": { skills: [] },
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
  const modelTab = tabByNumber(el, "④");
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
  cloneDefaultProfile = false,
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
        cloneDefaultProfile={cloneDefaultProfile}
        onDone={onDone}
      />
    </I18nProvider>
  );
}

test("단계는 ① 프로필 ② 인격 ③ 외형 ④ AI 모델이고, 옛 배치 단계의 링크 버튼은 없다", async () => {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  try {
    const { root, el } = await mount(wizardWith(PROFILE_ROUTES(1), calls));
    const tabs = [...el.querySelectorAll("button")]
      .map((b) => b.textContent ?? "")
      .filter((text) => /^[①②③④]/.test(text));
    assert.deepEqual(tabs, ["① 프로필", "② 인격", "③ 외형", "④ AI 모델"]);
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

test("새 직원의 출근 오피스가 없을 때만 연결된 오피스 생성 링크를 보인다", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const count of [0, 1]) {
      const { root, el } = await mount(wizardWith(PROFILE_ROUTES(count), []));
      await createAndOpenModel(el);
      const link = [...el.querySelectorAll("a")].find((anchor) =>
        anchor.textContent?.includes("오피스 만들기"),
      );
      if (count === 0) {
        assert.equal(link?.getAttribute("href"), "/channels/create?gatewayId=gw-1");
      } else {
        assert.equal(link, undefined);
      }
      assert.ok(buttonByText(el, "완료"));
      await act(async () => root.unmount());
      el.remove();
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("프로필을 만들기 전에는 ②③④ 가 잠기고, 이유는 '다음' 버튼 툴팁으로만 붙는다", async () => {
  // 2026-09-18 스테이징 실측: 새 프로필인데 ② 를 누르면 "인격 파일을 읽을 수 없어
  // 편집기를 열지 않습니다" 가 떴고, ③ 은 모델 목록 대신 자유 입력이었다.
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  try {
    const { root, el } = await mount(wizardWith(PROFILE_ROUTES(1), calls));
    assert.equal(tabByNumber(el, "②")?.disabled, true, "② 가 잠기지 않았다");
    assert.equal(tabByNumber(el, "③")?.disabled, true, "③ 이 잠기지 않았다");
    assert.equal(tabByNumber(el, "④")?.disabled, true, "④ 가 잠기지 않았다");
    const text = el.textContent ?? "";
    // 튜토리얼처럼 늘어놓지 않는다 — 이유는 잠긴 "다음" 버튼의 툴팁에만 있다(2026-09-20).
    assert.equal(text.includes("먼저 ① 에서 프로필을 만드세요"), false);
    assert.equal(text.includes("인격 파일을 읽을 수 없어"), false);
    const next = el.querySelector<HTMLButtonElement>('[data-step-nav="next"]');
    assert.equal(next?.disabled, true, "잠긴 다음 단계인데 '다음' 이 눌린다");
    assert.match(next?.title ?? "", /먼저 ① 에서 프로필을 만드세요/);
    assert.equal(
      el.querySelector<HTMLButtonElement>('[data-step-nav="back"]')?.disabled,
      true,
      "첫 단계인데 '이전' 이 눌린다",
    );

    await createProfile(el);
    assert.equal(tabByNumber(el, "②")?.disabled, false, "프로필을 만든 뒤에도 ② 가 잠겨 있다");
    assert.equal(tabByNumber(el, "④")?.disabled, false, "프로필을 만든 뒤에도 ③ 이 잠겨 있다");
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
    assert.match(text, /오피스에 연결하면/, "다음에 무엇을 해야 하는지 안내가 없다");
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
    assert.match(el.textContent ?? "", /오피스 2곳에 출근했습니다/);
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

test("방금 만든 프로필의 ② 는 곧바로 빈 편집기를 연다 — 덮어쓸지 묻지 않는다", async () => {
  // 2026-09-18 로컬 실측: 새 프로필(SOUL.md = Hermes 기본 템플릿, isDefaultTemplate:true)인데
  // ② 가 "이미 작성된 인격이 있습니다. 어떻게 할까요?" 를 물었다. ① 의 서빙 확인이 받은 인격
  // 응답을 저장만 하고 편집 모드를 정하지 않아, ② 가 다시 읽지도 판정하지도 않았다.
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  try {
    const { root, el } = await mount(wizardWith(PROFILE_ROUTES(1), calls));
    await createProfile(el);
    await act(async () => {
      tabByNumber(el, "②")!.click();
    });
    const text = el.textContent ?? "";
    assert.equal(
      text.includes("이미 작성된 인격이 있습니다"),
      false,
      "새 프로필인데 덮어쓸지 묻는다",
    );
    assert.ok(el.querySelector("textarea"), "인격 편집기가 열리지 않았다");
    root.unmount();
    el.remove();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("플러그인이 복제를 지원할 때만 새 프로필을 기본 프로필에서 복제해 달라고 한다", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const clone of [true, false]) {
      const calls: FetchCall[] = [];
      const { root, el } = await mount(
        wizardWith(PROFILE_ROUTES(1), calls, undefined, () => {}, clone),
      );
      await createProfile(el);
      const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/plugin/profiles"));
      assert.ok(post, "프로필 생성 요청이 없다");
      assert.deepEqual(
        post.body,
        clone ? { name: "mia", cloneFrom: "default" } : { name: "mia" },
        clone ? "복제를 요청하지 않았다" : "구버전 플러그인에 모르는 필드를 보냈다",
      );
      root.unmount();
      el.remove();
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("툴셋 체크리스트에서 고른 것만 저장하고, 대화에 안 쓰이는 최상위 toolsets 는 보내지 않는다", async () => {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  try {
    const { root, el } = await mount(wizardWith(PROFILE_ROUTES(1), calls));
    await createAndOpenModel(el);
    await act(async () => {
      await Promise.resolve();
    });

    // 안 건드리고 저장하면 서버의 현재 상태를 다시 쓰지 않는다.
    await act(async () => {
      buttonByText(el, "저장").click();
    });
    let put = calls.filter((c) => c.method === "PUT" && c.url.endsWith("/config")).at(-1);
    assert.ok(put, "저장 요청이 없다");
    assert.equal("enabledToolsets" in (put.body as object), false);
    assert.equal("toolsets" in (put.body as object), false);

    const tts = el.querySelector<HTMLInputElement>('input[data-toolset="tts"]');
    assert.ok(tts, "툴셋 체크리스트가 보이지 않는다");
    await act(async () => {
      tts.click();
    });
    await act(async () => {
      buttonByText(el, "저장").click();
    });
    put = calls.filter((c) => c.method === "PUT" && c.url.endsWith("/config")).at(-1);
    assert.deepEqual((put!.body as { enabledToolsets?: string[] }).enabledToolsets?.sort(), [
      "tts",
      "web",
    ]);
    assert.equal("toolsets" in (put!.body as object), false);
    root.unmount();
    el.remove();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("구버전 플러그인이면 체크리스트 대신 예전 쉼표 입력으로 떨어진다", async () => {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  try {
    const routes = {
      ...PROFILE_ROUTES(1),
      "/toolsets": { errorCode: "plugin_upgrade_required" },
      "/skills": { errorCode: "plugin_upgrade_required" },
    };
    // 스프레드는 키 순서를 유지하므로 "/plugin/profiles" 가 여전히 마지막이다.
    const { root, el } = await mount(wizardWith(routes, calls));
    await createAndOpenModel(el);
    await act(async () => {
      await Promise.resolve();
    });
    const text = [...el.querySelectorAll("input")].find((i) => i.placeholder === "툴셋");
    assert.ok(text, "텍스트 입력으로 떨어지지 않았다 — 툴셋을 지정할 방법이 사라진다");
    root.unmount();
    el.remove();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("'모든 API 키도 함께 복사' 를 켜면 cloneKeys:api_keys 를, 끄면 싣지 않는다", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const all of [true, false]) {
      const calls: FetchCall[] = [];
      const { root, el } = await mount(
        wizardWith(PROFILE_ROUTES(1), calls, undefined, () => {}, true),
      );
      const box = [...el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((b) =>
        b.parentElement?.textContent?.includes("모든 API 키도 함께 복사"),
      );
      assert.ok(box, "키 복사 범위 체크박스가 없다");
      if (all) {
        await act(async () => {
          box.click();
        });
      }
      await createProfile(el);
      const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/plugin/profiles"));
      assert.deepEqual(
        post?.body,
        all
          ? { name: "mia", cloneFrom: "default", cloneKeys: "api_keys" }
          : { name: "mia", cloneFrom: "default" },
      );
      root.unmount();
      el.remove();
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("복제를 지원하지 않는 게이트웨이에는 키 복사 체크박스를 보이지 않는다", async () => {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  try {
    const { root, el } = await mount(wizardWith(PROFILE_ROUTES(1), calls));
    assert.equal((el.textContent ?? "").includes("모든 API 키도 함께 복사"), false);
    root.unmount();
    el.remove();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const AUTH_CATALOG = {
  providers: [
    {
      id: "openai",
      name: "OpenAI",
      authenticated: false,
      authType: "api_key",
      envVars: ["OPENAI_API_KEY"],
    },
  ],
  models: {},
  reasoningEfforts: [],
};

async function openModelFor(canManageProviderAuth: boolean) {
  const calls: FetchCall[] = [];
  globalThis.fetch = stubFetch(calls, {
    "/config": { model: null, provider: null, toolsets: null, reasoning_effort: null },
    "/catalog": AUTH_CATALOG,
    "/identity": { isDefaultTemplate: true, body: "", revision: "r0" },
  }) as typeof fetch;
  const mounted = await mount(
    <I18nProvider initialLocale="ko">
      <NpcHireWizard
        gatewayId="gw-1"
        pluginStatus="plugin_ready"
        localDiscovery={false}
        existingProfiles={["oliver"]}
        initialProfile="oliver"
        canManageProviderAuth={canManageProviderAuth}
        onDone={() => {}}
      />
    </I18nProvider>,
  );
  await act(async () => {
    tabByNumber(mounted.el, "④")!.click();
  });
  const select = mounted.el.querySelector("select")!;
  return { ...mounted, select };
}

test("소유자는 인증 안 된 프로바이더를 골라 그 자리에서 키를 넣을 수 있다", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const { root, el, select } = await openModelFor(true);
    const option = [...select.options].find((o) => o.value === "openai");
    assert.equal(option?.disabled, false, "인증 안 된 프로바이더를 고를 수 없다");
    await act(async () => {
      select.value = "openai";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.ok(el.querySelector('input[type="password"]'), "키 입력 패널이 나오지 않았다");
    // 앱 안에서 인증할 수 있으면 대시보드로 가라는 옛 안내는 겹치므로 숨긴다.
    assert.equal((el.textContent ?? "").includes("직원마다"), false);
    root.unmount();
    el.remove();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("공유 사용자에게는 키 입력 대신 소유자가 설정해야 한다고 말한다", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const { root, el, select } = await openModelFor(false);
    const option = [...select.options].find((o) => o.value === "openai");
    assert.equal(option?.disabled, true, "누를 수 없는 인증을 고르게 한다");
    assert.equal(el.querySelector('input[type="password"]'), null);
    root.unmount();
    el.remove();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("인증 전 프로바이더는 모델을 비활성으로 두고, 로그인 뒤 목록이 오면 드롭다운으로 고른다", async () => {
  // 2026-09-19 스테이징: Codex 가 인증 전이라 카탈로그에 모델 목록이 없었고, 모델 칸이 자유
  // 입력으로 떨어져 "gpt-6-astra S" 같은 오타를 그대로 받았다.
  const originalFetch = globalThis.fetch;
  let authenticated = false;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: undefined });
    const payload = url.includes("/catalog")
      ? {
          providers: [
            {
              id: "openai-codex",
              name: "OpenAI Codex",
              authenticated,
              // authType 을 빼 구버전 안내의 "로그인 확인" 으로 다시 받게 한다 — 패널의 로그인
              // 완료도 같은 loadCatalog 를 부른다.
            },
          ],
          models: authenticated ? { "openai-codex": ["gpt-6", "gpt-6-mini"] } : {},
          reasoningEfforts: [],
        }
      : url.includes("/config")
        ? { model: "gpt-6-astra", provider: "openai-codex", toolsets: null }
        : { isDefaultTemplate: true, body: "", revision: "r0" };
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
          canManageProviderAuth
          onDone={() => {}}
        />
      </I18nProvider>,
    );
    await act(async () => {
      tabByNumber(el, "④")!.click();
    });
    const modelField = () => el.querySelectorAll("select")[1] as HTMLSelectElement | undefined;
    assert.equal(
      [...el.querySelectorAll("input")].some((i) => i.placeholder === "모델"),
      false,
      "인증 전인데 모델을 자유 입력으로 받는다",
    );
    assert.equal(modelField()?.disabled, true, "인증 전 모델 칸이 비활성이 아니다");
    assert.equal(modelField()?.value, "gpt-6-astra", "저장된 모델 값을 잃었다");

    authenticated = true;
    await act(async () => {
      buttonByText(el, "로그인 확인").click();
    });
    const after = modelField();
    assert.equal(after?.disabled, false);
    assert.deepEqual(
      [...(after?.options ?? [])].map((o) => o.value),
      ["", "gpt-6-astra", "gpt-6", "gpt-6-mini"],
      "저장된 모델이 목록에 없으면 앞에 남겨 두어야 한다",
    );
    root.unmount();
    el.remove();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("③ 외형은 이 직원의 현재 외형으로 편집기를 열고, 저장하면 그 프로필 행을 고친다", async () => {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  try {
    const routes = {
      "/gateways/gw-1/profiles/p-mia": { ok: true },
      "/gateways/gw-1/profiles": {
        profiles: [
          { id: "p-other", profileName: "noah", appearance: null },
          {
            id: "p-mia",
            profileName: "mia",
            appearance: { officeLookId: "office-jun", bodyType: "male" },
          },
        ],
      },
      ...PROFILE_ROUTES(1),
    };
    const { root, el } = await mount(wizardWith(routes, calls));
    await createProfile(el);
    await act(async () => {
      tabByNumber(el, "③")!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const save = [...el.querySelectorAll("button")].find((b) => /저장/.test(b.textContent ?? ""));
    assert.ok(save, "외형 편집기의 저장 버튼이 없다");
    await act(async () => {
      save.click();
    });
    const patch = calls.find((c) => c.method === "PATCH");
    assert.ok(patch?.url.endsWith("/gateways/gw-1/profiles/p-mia"), "다른 직원 행을 고쳤다");
    assert.deepEqual(patch?.body, {
      appearance: { officeLookId: "office-jun", bodyType: "male" },
    });
    root.unmount();
    el.remove();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("남은 요청 주소를 알리고, 확인해야만 지운다", async () => {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  try {
    const routes = {
      ...PROFILE_ROUTES(1),
      "/config": {
        model: "x",
        provider: "openrouter",
        toolsets: null,
        reasoning_effort: null,
        baseUrl: "https://old.example/v1",
      },
    };
    const { root, el } = await mount(wizardWith(routes, calls));
    await createAndOpenModel(el);
    const warning = el.querySelector("[data-base-url-warning]");
    assert.ok(warning, "남은 주소를 알리지 않는다");
    assert.match(el.textContent ?? "", /https:\/\/old\.example\/v1/);
    // 경고는 버튼 줄 밖이어야 한다 — 같은 flex 줄에 들어가면 저장·완료 버튼이 눌려
    // 글자가 세로로 꺾인다(2026-09-20 실제로 그렇게 나갔다).
    const actions = el.querySelector("[data-config-actions]");
    assert.ok(actions, "버튼 줄을 찾지 못했다");
    assert.equal(actions.contains(warning), false, "경고가 버튼 줄 안에 있다");
    for (const button of actions.querySelectorAll("button"))
      assert.match(button.className, /whitespace-nowrap/, "버튼 글자가 줄바꿈될 수 있다");

    // 확인 없이 저장하면 주소를 건드리지 않는다 — 커스텀 엔드포인트를 말없이 지우지 않는다.
    await act(async () => {
      buttonByText(el, "저장").click();
    });
    const first = calls.filter((c) => c.method === "PUT" && c.url.includes("/config")).at(-1);
    assert.equal((first?.body as Record<string, unknown>)?.clearBaseUrl, undefined);

    const checkbox = [...el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].at(-1);
    assert.ok(checkbox, "지우기 확인칸을 찾지 못했다");
    await act(async () => {
      checkbox.click();
    });
    await act(async () => {
      buttonByText(el, "저장").click();
    });
    const second = calls.filter((c) => c.method === "PUT" && c.url.includes("/config")).at(-1);
    assert.equal((second?.body as Record<string, unknown>)?.clearBaseUrl, true);
    root.unmount();
    el.remove();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
