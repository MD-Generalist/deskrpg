import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMeetingSummaryPrompt,
  MEETING_OUTCOME_LIMITS,
  parseMeetingOutcome,
  type OutcomeParticipant,
} from "./meeting-outcome";

const participants: OutcomeParticipant[] = [
  { npcId: "npc-sophie", name: "소피" },
  { npcId: "npc-noah", name: "Noah" },
];

function parse(json: unknown, raw = false) {
  return parseMeetingOutcome(raw ? (json as string) : JSON.stringify(json), participants);
}

test("넓힌 JSON 에서 결정·후속 업무·프로젝트 권고를 읽는다", () => {
  const parsed = parse({
    keyTopics: ["가격", "일정"],
    conclusions: "A안으로 간다.",
    decisions: ["A안 채택", "9월 말 초안"],
    followUps: [
      {
        title: "경쟁사 가격 조사",
        summary: "세 곳을 본다",
        acceptance: "표 한 장",
        assignee: "소피",
      },
      { title: "초안 작성", assignee: "noah", after: [0] },
    ],
    project: { recommended: true, name: "가격 개편", reason: "세 단계로 이어진다" },
  });

  assert.equal(parsed.status, "ok");
  assert.deepEqual(parsed.keyTopics, ["가격", "일정"]);
  assert.equal(parsed.conclusions, "A안으로 간다.");
  assert.deepEqual(parsed.outcome?.decisions, ["A안 채택", "9월 말 초안"]);
  assert.deepEqual(parsed.outcome?.followUps, [
    {
      title: "경쟁사 가격 조사",
      summary: "세 곳을 본다",
      acceptance: "표 한 장",
      assigneeNpcId: "npc-sophie",
      assigneeName: "소피",
      after: [],
    },
    {
      title: "초안 작성",
      summary: null,
      acceptance: null,
      assigneeNpcId: "npc-noah",
      assigneeName: "noah",
      after: [0],
    },
  ]);
  assert.deepEqual(parsed.outcome?.project, {
    recommended: true,
    name: "가격 개편",
    reason: "세 단계로 이어진다",
  });
});

test("앞뒤에 다른 글이 붙어도 JSON 덩어리를 찾아 읽는다", () => {
  const parsed = parse('알겠습니다.\n```json\n{"keyTopics":["a"],"conclusions":"b"}\n```', true);
  assert.equal(parsed.status, "ok");
  assert.deepEqual(parsed.keyTopics, ["a"]);
  assert.deepEqual(parsed.outcome, { decisions: [], followUps: [], project: null });
});

test("JSON 이 없거나 깨졌으면 실패로 남긴다 — 빈 값으로 성공한 척하지 않는다", () => {
  for (const raw of ["", "요약할 수 없습니다", '{"keyTopics": [']) {
    const parsed = parse(raw, true);
    assert.equal(parsed.status, "failed");
    assert.equal(parsed.outcome, null);
    assert.deepEqual(parsed.keyTopics, []);
    assert.equal(parsed.conclusions, null);
  }
});

test("참석자가 아닌 담당은 미지정으로 두되 모델이 쓴 이름은 남긴다", () => {
  const parsed = parse({
    followUps: [
      { title: "검토", assignee: "리나" },
      { title: "정리", assignee: null },
    ],
  });
  assert.deepEqual(
    parsed.outcome?.followUps.map((item) => [item.assigneeNpcId, item.assigneeName]),
    [
      [null, "리나"],
      [null, null],
    ],
  );
});

test("after 는 범위 밖·자기 참조·중복을 걸러 낸다", () => {
  const parsed = parse({
    followUps: [{ title: "a", after: [0, 1, 1, 9, -1, "x"] }, { title: "b" }],
  });
  assert.deepEqual(parsed.outcome?.followUps[0].after, [1]);
});

test("after 가 순환하면 고리를 만드는 쪽 링크를 뺀다", () => {
  const parsed = parse({
    followUps: [
      { title: "a", after: [2] },
      { title: "b", after: [0] },
      { title: "c", after: [1] },
    ],
  });
  const after = parsed.outcome?.followUps.map((item) => item.after);
  // 앞에서부터 받아들이고, 고리를 닫는 마지막 링크(c → b)만 버린다.
  assert.deepEqual(after, [[2], [0], []]);
});

test("제목 없는 항목은 버리고 남은 항목의 after 를 새 번호로 옮긴다", () => {
  const parsed = parse({
    followUps: [{ title: "  " }, { title: "a" }, { title: "b", after: [0, 1] }],
  });
  assert.deepEqual(
    parsed.outcome?.followUps.map((item) => [item.title, item.after]),
    [
      ["a", []],
      ["b", [0]],
    ],
  );
});

test("개수와 길이를 상한에서 자른다", () => {
  const parsed = parse({
    decisions: Array.from({ length: 30 }, (_, i) => `결정 ${i}`),
    followUps: Array.from({ length: 30 }, (_, i) => ({ title: `${i}`.padEnd(500, "x") })),
  });
  assert.equal(parsed.outcome?.decisions.length, MEETING_OUTCOME_LIMITS.decisions);
  assert.equal(parsed.outcome?.followUps.length, MEETING_OUTCOME_LIMITS.followUps);
  assert.equal(parsed.outcome?.followUps[0].title.length, MEETING_OUTCOME_LIMITS.title);
});

test("project 가 없거나 모양이 틀리면 null", () => {
  assert.equal(parse({ project: "yes" }).outcome?.project, null);
  assert.deepEqual(parse({ project: { recommended: "true", name: 3 } }).outcome?.project, {
    recommended: false,
    name: null,
    reason: null,
  });
});

test("요약 프롬프트는 담당 후보를 참석 직원 이름으로 못 박는다", () => {
  const prompt = buildMeetingSummaryPrompt("가격 개편", "소피: A안이 낫습니다", participants);
  assert.match(prompt, /참석 직원: 소피, Noah/);
  assert.match(prompt, /회의 주제: 가격 개편/);
  assert.match(prompt, /소피: A안이 낫습니다/);
  for (const key of ["decisions", "followUps", "project", "after", "acceptance"])
    assert.ok(prompt.includes(`"${key}"`), key);
});
