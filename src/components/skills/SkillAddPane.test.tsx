import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";

import SkillAddPane from "./SkillAddPane";
import { createSkillsApi } from "./skills-api";
import {
  $,
  ROOT,
  cleanup,
  click,
  container,
  flush,
  mockFetch,
  render,
  text,
  type,
} from "./skills-test-harness";

const preview = (over: Record<string, unknown> = {}) => ({
  name: "pdf-tools",
  identifier: "official/pdf-tools",
  description: "PDF",
  source: "official",
  trustLevel: "builtin",
  skillMd: "---\nname: pdf-tools\n---",
  files: ["SKILL.md", "scripts/run.py"],
  hasScripts: true,
  verdict: "caution",
  policy: "ask",
  policyReason: "",
  ...over,
});
const SEARCH = `GET ${ROOT}/hub/search?q=pdf`;
const PREVIEW = `GET ${ROOT}/hub/preview?identifier=official%2Fpdf-tools`;
const results = {
  results: [
    {
      identifier: "official/pdf-tools",
      name: "pdf-tools",
      description: "PDF",
      source: "official",
      trustLevel: "builtin",
    },
  ],
  timedOut: [],
};

let installed = 0;
const pane = (mode: "hub" | "url") => (
  <SkillAddPane
    api={createSkillsApi("ch-1", "n-1")}
    mode={mode}
    onInstalled={() => {
      installed += 1;
    }}
    pollIntervalMs={1}
  />
);

test.afterEach(cleanup);

test("검색 → 결과 클릭 → 미리보기에 판정과 실행 코드 안내", async () => {
  mockFetch({ [SEARCH]: results, [PREVIEW]: preview() });
  await render(pane("hub"));
  await type('[name="hub-query"]', "pdf");
  await click('[data-action="hub-go"]');
  await click('[data-hub="official/pdf-tools"]');
  assert.ok(text().includes("스캔 판정: caution"));
  assert.ok(text().includes("실행 코드(scripts/)"));
});

test("Hermes 가 막는(policy block) 스킬은 설치 버튼을 그리지 않는다", async () => {
  mockFetch({
    [SEARCH]: results,
    [PREVIEW]: preview({ policy: "block", verdict: "dangerous", policyReason: "위험" }),
  });
  await render(pane("hub"));
  await type('[name="hub-query"]', "pdf");
  await click('[data-action="hub-go"]');
  await click('[data-hub="official/pdf-tools"]');
  assert.equal(container.querySelector('[data-action="install"]'), null);
  assert.ok(text().includes("위험"));
});

test("주의(ask) 는 확인 체크 전에는 설치 버튼이 꺼지고, 체크 뒤 force:true 로 설치해 완료까지 폴링", async () => {
  installed = 0;
  const log = mockFetch({
    [SEARCH]: results,
    [PREVIEW]: preview(),
    [`POST ${ROOT}/hub/installs`]: { jobId: "j1" },
    [`GET ${ROOT}/hub/installs/j1`]: {
      jobId: "j1",
      kind: "hub_install",
      state: "succeeded",
      exitCode: 0,
      outputTail: "",
    },
  });
  await render(pane("hub"));
  await type('[name="hub-query"]', "pdf");
  await click('[data-action="hub-go"]');
  await click('[data-hub="official/pdf-tools"]');
  assert.equal(($('[data-action="install"]') as HTMLButtonElement).disabled, true);
  await click('[data-action="caution-confirm"]');
  await click('[data-action="install"]');
  await flush();
  assert.deepEqual(log.bodies[`POST ${ROOT}/hub/installs`], {
    identifier: "official/pdf-tools",
    force: true,
  });
  assert.equal($("[data-job-state]").dataset.jobState, "succeeded");
  assert.equal(installed, 1);
});

test("설치가 실패하면 출력 끝부분을 보인다", async () => {
  mockFetch({
    [SEARCH]: results,
    [PREVIEW]: preview({ policy: "allow", verdict: "safe" }),
    [`POST ${ROOT}/hub/installs`]: { jobId: "j1" },
    [`GET ${ROOT}/hub/installs/j1`]: {
      jobId: "j1",
      kind: "hub_install",
      state: "failed",
      exitCode: 1,
      outputTail: "scan blocked",
    },
  });
  await render(pane("hub"));
  await type('[name="hub-query"]', "pdf");
  await click('[data-action="hub-go"]');
  await click('[data-hub="official/pdf-tools"]');
  await click('[data-action="install"]');
  await flush();
  assert.equal($("[data-job-state]").dataset.jobState, "failed");
  assert.ok(text().includes("scan blocked"));
});

test("URL 모드는 입력한 URL 로 바로 미리보기를 부른다", async () => {
  const url = "https://example.com/skills/pdf-tools";
  const log = mockFetch({
    [`GET ${ROOT}/hub/preview?identifier=${encodeURIComponent(url)}`]: preview({
      identifier: url,
    }),
  });
  await render(pane("url"));
  await type('[name="hub-query"]', url);
  await click('[data-action="hub-go"]');
  assert.ok(log.calls.includes(`GET ${ROOT}/hub/preview?identifier=${encodeURIComponent(url)}`));
  assert.ok(text().includes("pdf-tools"));
});

const hit = (identifier: string, trustLevel: string, source = "clawhub") => ({
  identifier,
  name: "pdf",
  description: "",
  source,
  trustLevel,
});

async function search() {
  await type('[name="hub-query"]', "pdf");
  await click('[data-action="hub-go"]');
}

test("같은 이름이 여럿이면 행마다 identifier 로 구별하고, 신뢰 등급 순으로 늘어선다", async () => {
  mockFetch({
    [SEARCH]: {
      results: [
        hit("browse-sh/pdf", "community"),
        hit("anthropics/skills/pdf", "trusted", "github"),
        hit("official/pdf", "builtin", "official"),
      ],
      timedOut: [],
    },
  });
  await render(pane("hub"));
  await search();
  const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-hub]"));
  assert.deepEqual(
    rows.map((el) => el.dataset.hub),
    ["official/pdf", "anthropics/skills/pdf", "browse-sh/pdf"],
  );
  assert.ok(rows[2].textContent!.includes("browse-sh/pdf"));
});

test("미리보기를 기다리는 동안 불러오는 중 표시, 늦게 온 앞 응답은 버린다", async () => {
  mockFetch({
    [SEARCH]: {
      results: [hit("slow/pdf", "trusted"), hit("fast/pdf", "trusted")],
      timedOut: [],
    },
    [`GET ${ROOT}/hub/preview?identifier=slow%2Fpdf`]: {
      ...preview({ name: "느린-미리보기", identifier: "slow/pdf" }),
      delayMs: 60,
    },
    [`GET ${ROOT}/hub/preview?identifier=fast%2Fpdf`]: {
      ...preview({ name: "빠른-미리보기", identifier: "fast/pdf" }),
      delayMs: 20,
    },
  });
  await render(pane("hub"));
  await search();
  const slow = $('[data-hub="slow/pdf"]');
  await act(async () => slow.click());
  assert.ok(text().includes("미리보기 불러오는 중"));
  const fast = $('[data-hub="fast/pdf"]');
  await act(async () => fast.click());
  await act(async () => new Promise((r) => setTimeout(r, 120)));
  await flush();
  assert.ok(text().includes("빠른-미리보기"));
  assert.ok(!text().includes("느린-미리보기"));
  assert.ok(!text().includes("미리보기 불러오는 중"));
});

test("미리보기가 시간 초과(504 timeout)면 그 안내와 [다시 시도], 다시 시도하면 보인다", async () => {
  const routes: Record<string, Record<string, unknown>> = {
    [SEARCH]: results,
    [PREVIEW]: { status: 504, json: { code: "timeout", message: "" } },
  };
  mockFetch(routes);
  await render(pane("hub"));
  await search();
  await click('[data-hub="official/pdf-tools"]');
  assert.ok(text().includes("게이트웨이 응답이 늦어"));
  routes[PREVIEW] = preview();
  await click('[data-action="preview-retry"]');
  assert.ok(text().includes("스캔 판정: caution"));
  assert.equal(container.querySelector('[data-action="preview-retry"]'), null);
});

test("미리보기가 열리면 그 칸을 화면 안으로 스크롤한다", async () => {
  mockFetch({ [SEARCH]: results, [PREVIEW]: preview() });
  const scrolled: string[] = [];
  const original = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
    scrolled.push(this.dataset.pane ?? "");
  };
  try {
    await render(pane("hub"));
    await search();
    await click('[data-hub="official/pdf-tools"]');
    assert.ok(scrolled.includes("hub-preview"));
  } finally {
    HTMLElement.prototype.scrollIntoView = original;
  }
});
