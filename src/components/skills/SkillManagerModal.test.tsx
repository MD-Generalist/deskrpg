import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";

import SkillDetailPane from "./SkillDetailPane";
import SkillManagerModal from "./SkillManagerModal";
import { createSkillsApi } from "./skills-api";
import {
  $,
  LIST,
  ROOT,
  cleanup,
  click,
  container,
  flush,
  mockFetch,
  render,
  row,
  text,
  type,
} from "./skills-test-harness";

const listBody = (canManage = true) => ({
  skills: [row("weekly"), row("pdf", { source: "hub" })],
  canManage,
  capabilityReady: true,
  sharedChannelCount: 0,
});
const detail = (over: Record<string, unknown> = {}) => ({
  skill: {
    name: "weekly",
    source: "local",
    curatorManaged: false,
    pinned: false,
    frontmatter: { name: "weekly" },
    ...over,
  },
  files: [
    { path: "SKILL.md", size: 10, editable: true },
    { path: "scripts/run.py", size: 5, editable: false },
  ],
});
const file = (content: string, hash: string) => ({ path: "SKILL.md", content, hash });
const opened = () => ({
  [`GET ${ROOT}/weekly`]: detail(),
  [`GET ${ROOT}/weekly/file?path=SKILL.md`]: file("본문", "h1"),
});
// 모달이 함께 부르는 부속 조회(curator 줄) — 테스트마다 넣지 않도록 기본으로 둔다.
const extras = {
  [`GET ${ROOT}/curator`]: {
    enabled: true,
    paused: false,
    intervalHours: 24,
    lastRunAt: null,
    minIdleHours: 2,
    staleAfterDays: 14,
    archiveAfterDays: 30,
  },
};

let closed = 0;
const modal = () => (
  <SkillManagerModal
    channelId="ch-1"
    npcId="n-1"
    npcName="소피"
    onClose={() => {
      closed += 1;
    }}
  />
);

test.afterEach(cleanup);

test("머리에 직원 이름, 스킬을 고르면 파일 트리와 편집기, scripts 는 잠금", async () => {
  mockFetch({ ...extras, [LIST]: listBody(), ...opened() });
  await render(modal());
  assert.ok(text().includes("소피 · 스킬 관리"));
  await click('[data-skill="weekly"]');
  assert.ok(container.querySelector('[data-file="scripts/run.py"][data-locked="true"]'));
  assert.ok(container.querySelector('[data-file="SKILL.md"][data-locked="false"]'));
  assert.equal(($("textarea") as HTMLTextAreaElement).value, "본문");
});

test("저장은 baseHash 를 싣고, 충돌이면 내용을 지우지 않고 다시 불러오기를 보인다", async () => {
  const log = mockFetch({
    ...extras,
    [LIST]: listBody(),
    ...opened(),
    [`PUT ${ROOT}/weekly/file`]: { status: 409, json: { code: "skill_changed", message: "" } },
  });
  await render(modal());
  await click('[data-skill="weekly"]');
  await type("textarea", "내 변경");
  await click('[data-action="save"]');
  assert.deepEqual(log.bodies[`PUT ${ROOT}/weekly/file`], {
    path: "SKILL.md",
    content: "내 변경",
    baseHash: "h1",
  });
  assert.equal(($("textarea") as HTMLTextAreaElement).value, "내 변경");
  assert.ok(container.querySelector('[data-action="reload"]'));
});

test("멤버는 편집기가 읽기 전용이고 변경 버튼·추가 탭이 없다", async () => {
  mockFetch({ ...extras, [LIST]: listBody(false), ...opened() });
  await render(modal());
  await click('[data-skill="weekly"]');
  assert.equal(($("textarea") as HTMLTextAreaElement).readOnly, true);
  for (const a of ["save", "pin", "archive", "disable-unused", "enable-all", "disable-all"]) {
    assert.equal(container.querySelector(`[data-action="${a}"]`), null, a);
  }
  assert.equal(container.querySelector('[data-tab="add"]'), null);
});

test("잠긴 파일은 소유자에게도 읽기 전용이고 저장 버튼이 없다", async () => {
  mockFetch({
    ...extras,
    [LIST]: listBody(),
    ...opened(),
    [`GET ${ROOT}/weekly/file?path=scripts%2Frun.py`]: {
      path: "scripts/run.py",
      content: "print(1)",
      hash: "h2",
    },
  });
  await render(modal());
  await click('[data-skill="weekly"]');
  await click('[data-file="scripts/run.py"]');
  assert.equal(($("textarea") as HTMLTextAreaElement).value, "print(1)");
  assert.equal(($("textarea") as HTMLTextAreaElement).readOnly, true);
  assert.equal(container.querySelector('[data-action="save"]'), null);
});

test("보관은 확인을 거쳐 POST …/archive 후 선택을 비운다", async () => {
  const log = mockFetch({
    ...extras,
    [LIST]: listBody(),
    ...opened(),
    [`POST ${ROOT}/weekly/archive`]: { name: "weekly" },
  });
  await render(modal());
  await click('[data-skill="weekly"]');
  await click('[data-action="archive"]');
  assert.ok(!log.calls.includes(`POST ${ROOT}/weekly/archive`));
  await click('[data-action="confirm-archive"]');
  assert.ok(log.calls.includes(`POST ${ROOT}/weekly/archive`));
  assert.equal(container.querySelector("textarea"), null);
});

test("고정은 PUT …/pinned 후 상세를 다시 읽는다", async () => {
  const log = mockFetch({
    ...extras,
    [LIST]: listBody(),
    ...opened(),
    [`PUT ${ROOT}/weekly/pinned`]: { name: "weekly", pinned: true },
  });
  await render(modal());
  await click('[data-skill="weekly"]');
  await click('[data-action="pin"]');
  assert.deepEqual(log.bodies[`PUT ${ROOT}/weekly/pinned`], { pinned: true });
  assert.equal(log.calls.filter((c) => c === `GET ${ROOT}/weekly`).length, 2);
});

test("미사용 끄기는 목록을 보여 준 뒤 확인하면 일괄 PUT", async () => {
  const log = mockFetch({
    ...extras,
    [LIST]: listBody(),
    [`PUT ${ROOT}/enabled`]: { disabled: ["weekly", "pdf"] },
  });
  await render(modal());
  await click('[data-action="disable-unused"]');
  assert.ok(text().includes("다음 2개를 바꿉니다"));
  assert.ok(!log.calls.includes(`PUT ${ROOT}/enabled`));
  await click('[data-action="confirm-bulk"]');
  assert.deepEqual(log.bodies[`PUT ${ROOT}/enabled`], { enable: [], disable: ["weekly", "pdf"] });
});

test("새로 만들기는 틀을 채우고 POST, 잘못된 이름이면 버튼이 꺼진다", async () => {
  const log = mockFetch({
    ...extras,
    [LIST]: listBody(),
    [`POST ${ROOT}/`]: { name: "invoice" },
    [`GET ${ROOT}/invoice`]: detail({ name: "invoice" }),
    [`GET ${ROOT}/invoice/file?path=SKILL.md`]: file("x", "h9"),
  });
  await render(modal());
  await click('[data-tab="add"]');
  await click('[data-add="new"]');
  await type('[name="skill-name"]', "Invoice");
  await type('[name="skill-description"]', "청구서");
  assert.equal(($('[data-action="create"]') as HTMLButtonElement).disabled, true);
  await type('[name="skill-name"]', "invoice");
  await click('[data-action="create"]');
  const body = log.bodies[`POST ${ROOT}/`] as { name: string; content: string };
  assert.equal(body.name, "invoice");
  assert.ok(body.content.startsWith("---\nname: invoice\ndescription: 청구서\n---"));
});

test("Esc 는 닫되, 먼저 처리한 레이어가 있으면(defaultPrevented) 닫지 않는다", async () => {
  mockFetch({ ...extras, [LIST]: listBody() });
  closed = 0;
  await render(modal());
  const prevented = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
  prevented.preventDefault();
  await act(async () => {
    window.dispatchEvent(prevented);
  });
  assert.equal(closed, 0);
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  });
  await flush();
  assert.equal(closed, 1);
});

test("initialSkill 로 열면 그 스킬의 상세가 바로 보이고, 보관함 탭에 개수", async () => {
  mockFetch({
    ...extras,
    [LIST]: listBody(),
    ...opened(),
    [`GET ${ROOT}/archive`]: { archived: [{ name: "old", archivedAt: null }] },
  });
  await render(
    <SkillManagerModal
      channelId="ch-1"
      npcId="n-1"
      npcName="소피"
      initialSkill="weekly"
      onClose={() => {}}
    />,
  );
  assert.equal(($("textarea") as HTMLTextAreaElement).value, "본문");
  assert.equal($('[data-badge="archive"]').textContent, "1");
});

test("Hub 스킬 [삭제] 는 확인 뒤 작업을 끝까지 폴링하고 선택을 비운다", async () => {
  const log = mockFetch({
    [`GET ${ROOT}/pdf`]: { ...detail({ name: "pdf", source: "hub" }), files: [] },
    [`GET ${ROOT}/pdf/file?path=SKILL.md`]: file("hub", "h3"),
    [`POST ${ROOT}/hub/uninstall`]: { jobId: "u1" },
    [`GET ${ROOT}/hub/installs/u1`]: {
      jobId: "u1",
      kind: "hub_update",
      state: "succeeded",
      exitCode: 0,
      outputTail: "",
    },
  });
  let removed = 0;
  await render(
    <SkillDetailPane
      api={createSkillsApi("ch-1", "n-1")}
      name="pdf"
      canManage
      onChanged={() => {}}
      onRemoved={() => {
        removed += 1;
      }}
      pollIntervalMs={1}
    />,
  );
  assert.equal(container.querySelector('[data-action="pin"]'), null);
  await click('[data-action="uninstall"]');
  await click('[data-action="confirm-uninstall"]');
  await flush();
  assert.deepEqual(log.bodies[`POST ${ROOT}/hub/uninstall`], { name: "pdf" });
  assert.ok(log.calls.includes(`GET ${ROOT}/hub/installs/u1`));
  assert.equal(removed, 1);
});
