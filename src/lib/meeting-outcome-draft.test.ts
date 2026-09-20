import assert from "node:assert/strict";
import test from "node:test";

import type { MeetingOutcome } from "./meeting-outcome";
import { createOutcomeDraft, draftToRegistration, updateDraftItem } from "./meeting-outcome-draft";
import { isTenantSlug, tenantSlugFromName } from "./tenant-slug";

const followUp = (title: string, after: number[] = [], assigneeNpcId: string | null = null) => ({
  title,
  summary: null,
  acceptance: null,
  assigneeNpcId,
  assigneeName: null,
  after,
});

const outcome: MeetingOutcome = {
  decisions: [],
  followUps: [followUp("조사", [], "npc-1"), followUp("초안", [0]), followUp("검토", [1])],
  project: { recommended: true, name: "가격 개편", reason: null },
};

test("초안은 모든 항목을 선택한 채로 시작하고 프로젝트 이름에서 서브프로젝트를 제안한다", () => {
  const draft = createOutcomeDraft(outcome);
  assert.deepEqual(
    draft.items.map((item) => [item.index, item.selected, item.title, item.npcId]),
    [
      [0, true, "조사", "npc-1"],
      [1, true, "초안", null],
      [2, true, "검토", null],
    ],
  );
  assert.equal(draft.subprojectName, "가격 개편");
});

test("권고가 없으면 서브프로젝트 이름은 비어 있다", () => {
  assert.equal(createOutcomeDraft({ ...outcome, project: null }).subprojectName, "");
});

test("항목 수정은 그 항목만 바꾼다", () => {
  const draft = updateDraftItem(createOutcomeDraft(outcome), 1, {
    title: "초안 v2",
    npcId: "npc-2",
  });
  assert.deepEqual(
    draft.items.map((item) => [item.title, item.npcId]),
    [
      ["조사", "npc-1"],
      ["초안 v2", "npc-2"],
      ["검토", null],
    ],
  );
});

test("등록 본문은 선택한 항목만 담고, 빠진 항목으로 가는 after 는 버린다", () => {
  const draft = updateDraftItem(createOutcomeDraft(outcome), 1, { selected: false });
  const body = draftToRegistration(draft);
  assert.deepEqual(body.items, [
    { index: 0, title: "조사", npcId: "npc-1", after: [] },
    { index: 2, title: "검토", npcId: null, after: [] },
  ]);
  assert.deepEqual(body.tenant, { slug: "가격-개편", name: "가격 개편" });
});

test("서브프로젝트 이름을 비우면 tenant 는 null 이다", () => {
  const draft = { ...createOutcomeDraft(outcome), subprojectName: "  " };
  assert.equal(draftToRegistration(draft).tenant, null);
});

test("제목을 비운 항목은 등록 본문에서 빠진다", () => {
  const draft = updateDraftItem(createOutcomeDraft(outcome), 0, { title: "   " });
  assert.deepEqual(
    draftToRegistration(draft).items.map((item) => item.index),
    [1, 2],
  );
  // 0번이 빠졌으니 1번의 after 도 비어야 한다.
  assert.deepEqual(draftToRegistration(draft).items[0].after, []);
});

test("테넌트 슬러그는 소문자·하이픈이고 64자를 넘지 않는다", () => {
  assert.equal(tenantSlugFromName("  Q4 Content  Pipeline! "), "q4-content-pipeline");
  assert.equal(tenantSlugFromName("가격 개편"), "가격-개편");
  assert.equal(tenantSlugFromName("---"), "");
  assert.equal(tenantSlugFromName("a".repeat(100)).length, 64);
  for (const slug of ["q4-content-pipeline", "가격-개편", "research_2"])
    assert.ok(isTenantSlug(slug), slug);
  for (const slug of ["", "-a", "Upper", "a b", "a".repeat(65)])
    assert.ok(!isTenantSlug(slug), slug);
});
