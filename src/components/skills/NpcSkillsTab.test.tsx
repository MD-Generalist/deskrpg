import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";

import NpcSkillsTab from "./NpcSkillsTab";
import {
  LIST,
  ROOT,
  cleanup,
  container,
  flush,
  mockFetch,
  render,
  row,
  text,
} from "./skills-test-harness";

const view = (over: Record<string, unknown> = {}) => ({
  skills: [row("weekly")],
  canManage: false,
  capabilityReady: true,
  sharedChannelCount: 0,
  ...over,
});

const tab = (npcId = "n-1") => (
  <NpcSkillsTab key={npcId} channelId="ch-1" npcId={npcId} onOpenManager={() => {}} />
);

test.afterEach(cleanup);

test("멤버에게는 켜짐 표시만, 소유자에게는 스위치", async () => {
  mockFetch({ [LIST]: view() });
  await render(tab());
  assert.equal(container.querySelectorAll('[role="switch"]').length, 0);
  assert.ok(text().includes("켜짐"));
  await cleanup();
  mockFetch({ [LIST]: view({ canManage: true }) });
  await render(tab());
  assert.equal(container.querySelectorAll('[role="switch"]').length, 1);
});

test("공유 경고와 필수 스킬 스위치 비활성", async () => {
  mockFetch({
    [LIST]: view({
      skills: [row("hermes-agent", { essential: true })],
      canManage: true,
      sharedChannelCount: 2,
    }),
  });
  await render(tab());
  assert.ok(text().includes("다른 채널 2곳"));
  assert.equal((container.querySelector('[role="switch"]') as HTMLButtonElement).disabled, true);
});

test("스위치를 누르면 PUT …/enabled 후 다시 읽는다", async () => {
  const log = mockFetch({
    [LIST]: view({ canManage: true }),
    [`PUT ${ROOT}/weekly/enabled`]: { name: "weekly", enabled: false },
  });
  await render(tab());
  await act(async () => (container.querySelector('[role="switch"]') as HTMLButtonElement).click());
  await flush();
  assert.deepEqual(log.calls, [LIST, `PUT ${ROOT}/weekly/enabled`, LIST]);
  assert.deepEqual(log.bodies[`PUT ${ROOT}/weekly/enabled`], { enabled: false });
});

test("capability 가 없으면 업그레이드 안내, 관리 버튼 없음", async () => {
  mockFetch({ [LIST]: view({ capabilityReady: false }) });
  await render(tab());
  assert.ok(text().includes("0.15.0"));
  assert.equal(container.querySelector('[data-testid="open-skill-manager"]'), null);
});

test("묶음 제목과 사용·조회 횟수, 항목을 누르면 설명", async () => {
  mockFetch({
    [LIST]: view({
      skills: [
        row("weekly", { useCount: 3, viewCount: 1, description: "주간 보고" }),
        row("pdf", { source: "hub" }),
      ],
    }),
  });
  await render(tab());
  assert.ok(text().includes("로컬"));
  assert.ok(text().includes("Hub"));
  assert.ok(text().includes("사용 3 · 조회 1"));
  assert.ok(!text().includes("주간 보고"));
  await act(async () =>
    (container.querySelector('[data-skill-row="weekly"]') as HTMLElement).click(),
  );
  await flush();
  assert.ok(text().includes("주간 보고"));
});

test("게이트웨이가 끊기면(409) 목록 대신 재연결 안내", async () => {
  mockFetch({ [LIST]: { status: 409, json: { code: "gateway_disconnected", message: "" } } });
  await render(tab());
  assert.ok(text().includes("게이트웨이 연결이 끊겼습니다"));
});
