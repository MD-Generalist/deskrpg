import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMeetingMinutesRecord } from "./meeting-minutes";

test("normalizeMeetingMinutesRecord parses SQLite JSON strings into arrays", () => {
  const normalized = normalizeMeetingMinutesRecord({
    participants: '[{"id":"npc-1","name":"마틴","type":"npc"}]',
    keyTopics: '["우선순위","KPI"]',
  });

  assert.deepEqual(normalized.participants, [{ id: "npc-1", name: "마틴", type: "npc" }]);
  assert.deepEqual(normalized.keyTopics, ["우선순위", "KPI"]);
});

test("normalizeMeetingMinutesRecord falls back to empty arrays for invalid values", () => {
  const normalized = normalizeMeetingMinutesRecord({
    participants: "oops",
    keyTopics: null,
  });

  assert.deepEqual(normalized.participants, []);
  assert.deepEqual(normalized.keyTopics, []);
});

test("outcomeJson 은 SQLite 문자열이든 PG 객체든 outcome 으로 읽힌다", () => {
  const outcome = { decisions: ["A안"], followUps: [], project: null };
  for (const stored of [JSON.stringify(outcome), outcome]) {
    const normalized = normalizeMeetingMinutesRecord({ outcomeJson: stored });
    assert.deepEqual(normalized.outcome, outcome);
    assert.equal("outcomeJson" in normalized, false);
  }
});

test("outcomeJson 이 없거나 깨졌으면 outcome 은 null", () => {
  for (const stored of [null, undefined, "oops", "[]", 3]) {
    assert.equal(normalizeMeetingMinutesRecord({ outcomeJson: stored }).outcome, null);
  }
});
