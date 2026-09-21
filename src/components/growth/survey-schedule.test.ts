import assert from "node:assert/strict";
import test from "node:test";

import {
  afterSurvey,
  DAY,
  FIRST_SURVEY_AFTER_MS,
  initialSurveyState,
  shouldShowSurvey,
} from "./survey-schedule";

test("첫 설문은 맵 누적 사용 30분이 지나야 뜬다", () => {
  const s = initialSurveyState();
  assert.equal(shouldShowSurvey({ ...s, usageMs: FIRST_SURVEY_AFTER_MS - 1 }, 0), false);
  assert.equal(shouldShowSurvey({ ...s, usageMs: FIRST_SURVEY_AFTER_MS }, 0), true);
});

test("보내면 설문 세트의 간격 뒤, 나중에는 7일 뒤, 다시 묻지 않기는 영영 뜨지 않는다", () => {
  const base = { ...initialSurveyState(), usageMs: FIRST_SURVEY_AFTER_MS };
  const sent = afterSurvey(base, "sent", 1000, 30);
  assert.equal(sent.consent, "granted");
  assert.equal(shouldShowSurvey(sent, 1000 + 30 * DAY - 1), false);
  assert.equal(shouldShowSurvey(sent, 1000 + 30 * DAY), true);

  const later = afterSurvey(base, "later", 1000, 30);
  assert.equal(later.consent, "unknown");
  assert.equal(shouldShowSurvey(later, 1000 + 7 * DAY), true);

  const never = afterSurvey(base, "never", 1000, 30);
  assert.equal(never.consent, "denied");
  assert.equal(shouldShowSurvey({ ...never, usageMs: 10 * FIRST_SURVEY_AFTER_MS }, 1e15), false);
});

test("한 번 동의한 뒤의 나중에는 동의를 유지한다", () => {
  const granted = {
    ...initialSurveyState(),
    consent: "granted" as const,
    usageMs: FIRST_SURVEY_AFTER_MS,
  };
  assert.equal(afterSurvey(granted, "later", 0, 30).consent, "granted");
});
