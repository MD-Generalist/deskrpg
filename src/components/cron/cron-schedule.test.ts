import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SCHEDULE_PRESETS,
  composeDeliver,
  exprForPreset,
  formatModelSpec,
  jobScheduleDisplay,
  jobScheduleExpr,
  parseDeliver,
  parseModelSpec,
  readOnlyReason,
  relativeTime,
  scheduleOptionForExpr,
  stateDotClass,
} from "./cron-schedule";

describe("프리셋 ↔ 표현식 (R17)", () => {
  it("프리셋 표현식은 스펙 그대로다", () => {
    assert.equal(exprForPreset("daily"), "0 9 * * *");
    assert.equal(exprForPreset("weekdays"), "0 9 * * 1-5");
    assert.equal(exprForPreset("weekly"), "0 9 * * 1");
    assert.equal(exprForPreset("monthly"), "0 9 1 * *");
    assert.equal(exprForPreset("hourly"), "0 * * * *");
    assert.equal(exprForPreset("every-15-minutes"), "*/15 * * * *");
    assert.equal(exprForPreset("custom"), null);
  });

  it("프리셋 → 표현식 → 프리셋 왕복이 자기 자신으로 돌아온다", () => {
    for (const preset of SCHEDULE_PRESETS) {
      if (!preset.expr) continue;
      assert.equal(scheduleOptionForExpr(preset.expr).value, preset.value, preset.value);
    }
  });

  it("모양이 같으면 시각이 달라도 같은 프리셋으로 되돌린다 (데스크톱 규칙)", () => {
    assert.equal(scheduleOptionForExpr("30 8 * * *").value, "daily");
    assert.equal(scheduleOptionForExpr("0 18 * * 1-5").value, "weekdays");
    assert.equal(scheduleOptionForExpr("15 7 * * 3").value, "weekly");
    assert.equal(scheduleOptionForExpr("0 9 15 * *").value, "monthly");
    assert.equal(scheduleOptionForExpr("45 * * * *").value, "hourly");
    // 공백이 여러 개여도 정규화한다.
    assert.equal(scheduleOptionForExpr("  0   9 * *   * ").value, "daily");
  });

  it("맞는 프리셋이 없으면 custom — Hermes 스케줄 문자열·다른 간격·6필드", () => {
    assert.equal(scheduleOptionForExpr("every 10m").value, "custom");
    assert.equal(scheduleOptionForExpr("*/5 * * * *").value, "custom");
    assert.equal(scheduleOptionForExpr("0 9 * * 1,3").value, "custom");
    assert.equal(scheduleOptionForExpr("0 0 9 * * *").value, "custom");
    assert.equal(scheduleOptionForExpr("").value, "custom");
  });

  it("작업의 표현식·표시 문자열은 빠진 것을 서로 메운다", () => {
    assert.equal(
      jobScheduleExpr({ schedule: { kind: "cron", expr: "0 9 * * *" }, schedule_display: "매일" }),
      "0 9 * * *",
    );
    assert.equal(
      jobScheduleExpr({ schedule: { kind: "every" }, schedule_display: "every 10m" }),
      "every 10m",
    );
    assert.equal(
      jobScheduleDisplay({ schedule: { kind: "cron", expr: "0 9 * * *" }, schedule_display: "" }),
      "0 9 * * *",
    );
    assert.equal(jobScheduleDisplay({ schedule: { kind: "cron" }, schedule_display: "" }), "—");
  });
});

describe("배달처 문자열 (R17)", () => {
  it("빈 값·null 은 local, 중복은 하나로", () => {
    assert.deepEqual(parseDeliver(null), ["local"]);
    assert.deepEqual(parseDeliver(""), ["local"]);
    assert.deepEqual(parseDeliver("local, slack ,slack"), ["local", "slack"]);
    assert.equal(composeDeliver([]), "local");
    assert.equal(composeDeliver(["local", "slack", " ", "slack"]), "local,slack");
  });

  it("parse → compose 왕복", () => {
    assert.equal(composeDeliver(parseDeliver("local,telegram")), "local,telegram");
  });
});

describe("모델 문자열 (R17)", () => {
  it("provider:model 은 한 번만 가른다 — 모델 안의 ':' 는 보존", () => {
    assert.deepEqual(parseModelSpec("openrouter:anthropic/claude-sonnet-4:beta"), {
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4:beta",
    });
    assert.deepEqual(parseModelSpec("gpt-5"), { provider: null, model: "gpt-5" });
    assert.deepEqual(parseModelSpec("   "), { provider: null, model: null });
  });

  it("format ↔ parse 왕복", () => {
    assert.equal(formatModelSpec("openai", "gpt-5"), "openai:gpt-5");
    assert.equal(formatModelSpec(null, "gpt-5"), "gpt-5");
    assert.equal(formatModelSpec("openai", null), "");
    const spec = "openai:gpt-5";
    const parsed = parseModelSpec(spec);
    assert.equal(formatModelSpec(parsed.provider, parsed.model), spec);
  });
});

describe("상대 시간 카운트다운 (R18)", () => {
  const now = Date.UTC(2026, 8, 14, 9, 0, 0);

  it("가장 굵은 단위 하나로 표시한다", () => {
    assert.match(relativeTime(now + 30_000, now, "en"), /30 sec/);
    assert.match(relativeTime(now + 5 * 60_000, now, "en"), /5 min/);
    assert.match(relativeTime(now + 3 * 3_600_000, now, "en"), /3 hr/);
    assert.match(relativeTime(now + 2 * 86_400_000, now, "en"), /2 days/);
  });

  it("지난 시각은 'ago' 로, 한국어 로케일도 동작한다", () => {
    assert.match(relativeTime(now - 10 * 60_000, now, "en"), /ago/);
    assert.match(relativeTime(now + 5 * 60_000, now, "ko"), /5분/);
  });

  it("1초 틱마다 값이 줄어든다", () => {
    const target = now + 90_000;
    const a = relativeTime(target, now, "en");
    const b = relativeTime(target, now + 60_000, "en");
    assert.notEqual(a, b);
    assert.match(b, /30 sec/);
  });
});

describe("상태 점·편집 불가 이유 (R16)", () => {
  it("여섯 상태 모두 색이 있고 모르는 상태는 회색", () => {
    for (const state of ["scheduled", "paused", "running", "error", "completed", "disabled"]) {
      assert.ok(stateDotClass(state).startsWith("bg-"), state);
    }
    assert.equal(stateDotClass("weird"), "bg-slate-500");
  });

  it("editable=false 의 이유: 출처가 있으면 다른 채널, 없으면 DeskRPG 밖", () => {
    assert.equal(readOnlyReason({ editable: true, origin: null }), null);
    assert.equal(
      readOnlyReason({ editable: false, origin: { channelId: "other" } }),
      "otherChannel",
    );
    assert.equal(readOnlyReason({ editable: false, origin: null }), "external");
  });
});
