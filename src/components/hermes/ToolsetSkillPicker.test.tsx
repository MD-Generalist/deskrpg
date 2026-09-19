import "../../test-setup/dom";
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../lib/i18n/context";
import ToolsetSkillPicker from "./ToolsetSkillPicker";

const TOOLSETS = {
  platform: "api_server",
  toolsets: [
    { name: "web", label: "🔍 Web", description: "검색", enabled: true, configured: true },
    { name: "tts", label: "🔊 TTS", description: "음성", enabled: false, configured: false },
  ],
};
const SKILLS = {
  skills: [
    {
      name: "hermes-agent",
      category: "core",
      description: "필수",
      disabled: false,
      essential: true,
    },
    { name: "pdf", category: "docs", description: "PDF", disabled: true, essential: false },
  ],
};

function stubFetch(map: Record<string, unknown>) {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    const key = Object.keys(map).find((k) => String(url).endsWith(k))!;
    return new Response(JSON.stringify(map[key]), { status: 200 });
  }) as typeof fetch;
  return {
    urls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

async function mount(props: Partial<React.ComponentProps<typeof ToolsetSkillPicker>>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <I18nProvider initialLocale="ko">
        <ToolsetSkillPicker
          profileBase="/api/gateways/g/plugin/profiles/noah"
          enabledToolsets={null}
          onEnabledToolsetsChange={() => {}}
          disabledSkills={null}
          onDisabledSkillsChange={() => {}}
          {...props}
        />
      </I18nProvider>,
    ),
  );
  await act(async () => {
    await Promise.resolve();
  });
  return { host, unmount: () => act(async () => root.unmount()) };
}

test("목록을 불러와 서버 상태를 기본값으로 체크하고 onLoaded 로 알린다", async () => {
  const f = stubFetch({ "/toolsets": TOOLSETS, "/skills": SKILLS });
  const loaded: unknown[] = [];
  const { host, unmount } = await mount({ onLoaded: (v) => loaded.push(v) });
  try {
    assert.deepEqual(f.urls.sort(), [
      "/api/gateways/g/plugin/profiles/noah/skills",
      "/api/gateways/g/plugin/profiles/noah/toolsets",
    ]);
    assert.deepEqual(loaded, [{ enabledToolsets: ["web"], disabledSkills: ["pdf"] }]);
    const box = (name: string) =>
      host.querySelector<HTMLInputElement>(`input[data-toolset="${name}"]`)!;
    assert.equal(box("web").checked, true);
    assert.equal(box("tts").checked, false);
    assert.ok(host.textContent?.includes("키 필요"));
    // 스킬 체크박스는 "켜짐" 을 뜻한다 — disabled 의 반대.
    assert.equal(host.querySelector<HTMLInputElement>('input[data-skill="pdf"]')!.checked, false);
    assert.equal(
      host.querySelector<HTMLInputElement>('input[data-skill="hermes-agent"]')!.disabled,
      true,
    );
  } finally {
    await unmount();
    f.restore();
  }
});

test("체크를 바꾸면 새 목록을 올린다", async () => {
  const f = stubFetch({ "/toolsets": TOOLSETS, "/skills": SKILLS });
  const toolsets: string[][] = [];
  const skills: string[][] = [];
  const { host, unmount } = await mount({
    enabledToolsets: ["web"],
    disabledSkills: ["pdf"],
    onEnabledToolsetsChange: (v) => toolsets.push(v),
    onDisabledSkillsChange: (v) => skills.push(v),
  });
  try {
    await act(async () =>
      host.querySelector<HTMLInputElement>('input[data-toolset="tts"]')!.click(),
    );
    await act(async () => host.querySelector<HTMLInputElement>('input[data-skill="pdf"]')!.click());
    assert.deepEqual(toolsets, [["tts", "web"]]);
    assert.deepEqual(skills, [[]]);
  } finally {
    await unmount();
    f.restore();
  }
});

test("구버전 플러그인이면 아무것도 그리지 않고 onUnsupported 를 부른다", async () => {
  const f = stubFetch({
    "/toolsets": { errorCode: "plugin_upgrade_required" },
    "/skills": { errorCode: "plugin_upgrade_required" },
  });
  let called = 0;
  const { host, unmount } = await mount({
    onUnsupported: () => {
      called += 1;
    },
  });
  try {
    assert.equal(called, 1);
    assert.equal(host.querySelectorAll("input").length, 0);
  } finally {
    await unmount();
    f.restore();
  }
});

test("다른 오류는 메시지와 다시 시도 버튼을 보여 준다", async () => {
  const f = stubFetch({ "/toolsets": { errorCode: "config_unreadable" }, "/skills": SKILLS });
  const { host, unmount } = await mount({});
  try {
    assert.ok(
      Array.from(host.querySelectorAll("button")).some((b) => b.textContent?.includes("다시 시도")),
    );
  } finally {
    await unmount();
    f.restore();
  }
});

test("부모가 준 목록에 플러그인이 거절할 이름이 있어도 올리는 목록에는 싣지 않는다", async () => {
  const f = stubFetch({ "/toolsets": TOOLSETS, "/skills": SKILLS });
  const toolsets: string[][] = [];
  const skills: string[][] = [];
  const { host, unmount } = await mount({
    // config GET 의 enabledToolsets 에는 MCP 서버 이름이 섞여 올 수 있다.
    enabledToolsets: ["web", "my-mcp", "ghost-toolset"],
    disabledSkills: ["pdf", "hermes-agent", "ghost-skill"],
    onEnabledToolsetsChange: (v) => toolsets.push(v),
    onDisabledSkillsChange: (v) => skills.push(v),
  });
  try {
    await act(async () =>
      host.querySelector<HTMLInputElement>('input[data-toolset="tts"]')!.click(),
    );
    await act(async () => host.querySelector<HTMLInputElement>('input[data-skill="pdf"]')!.click());
    assert.deepEqual(toolsets, [["tts", "web"]]);
    assert.deepEqual(skills, [[]]);
  } finally {
    await unmount();
    f.restore();
  }
});

test("소유자는 제공자를 고르는 도구에 '설정' 이 있고, 키가 없는 도구를 켜면 설정 팝업이 뜬다", async () => {
  const withProviders = {
    ...TOOLSETS,
    toolsets: TOOLSETS.toolsets.map((t) => ({ ...t, hasProviders: t.name === "tts" })),
  };
  const providers = {
    toolset: "tts",
    hasProviders: true,
    activeProvider: null,
    cliCommand: "hermes -p noah tools",
    providers: [],
  };
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    const body = u.endsWith("/providers")
      ? providers
      : u.endsWith("/skills")
        ? SKILLS
        : withProviders;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  const { host, unmount } = await mount({ canManageToolProviders: true });
  try {
    assert.ok(host.querySelector('[data-configure-tool="tts"]'), "tts 에 설정이 없다");
    assert.equal(
      host.querySelector('[data-configure-tool="web"]'),
      null,
      "web 에는 설정이 없어야 한다",
    );
    await act(async () => {
      host.querySelector<HTMLInputElement>('input[data-toolset="tts"]')!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const panel = host.querySelector('[data-tool-panel="tts"]');
    assert.ok(panel, "키 없는 도구를 켰는데 설정이 열리지 않았다");
    // 목록 사이에 펼치지 않고 팝업으로 띄운다.
    assert.ok(panel.closest("[data-modal-overlay]"), "설정이 팝업이 아니라 목록 안에 펼쳐졌다");
    const close = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "닫기",
    )!;
    await act(async () => close.click());
    assert.equal(host.querySelector("[data-modal-overlay]"), null, "닫기로 팝업이 닫히지 않았다");
  } finally {
    globalThis.fetch = original;
    await unmount();
  }
});

test("공유 사용자에게는 '설정' 이 없다", async () => {
  const withProviders = {
    ...TOOLSETS,
    toolsets: TOOLSETS.toolsets.map((t) => ({ ...t, hasProviders: true })),
  };
  const f = stubFetch({ "/toolsets": withProviders, "/skills": SKILLS });
  const { host, unmount } = await mount({});
  try {
    assert.equal(host.querySelector("[data-configure-tool]"), null);
  } finally {
    f.restore();
    await unmount();
  }
});
