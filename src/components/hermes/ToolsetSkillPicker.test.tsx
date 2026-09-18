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
