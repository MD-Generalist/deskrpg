/**
 * 크론 화면의 순수 규칙 — 프리셋↔표현식, 배달처 문자열, 모델 문자열, 상대 시간, 상태 색.
 *
 * React 도 fetch 도 없다. 데스크톱(hermes-ko-macos `apps/desktop/src/app/cron`)의
 * `scheduleOptionForExpr` 규칙을 그대로 옮겼다 — 저장된 표현식을 프리셋으로 되돌릴 때
 * 두 클라이언트가 같은 답을 내야 한다(R17).
 */

import type { CronJob, CronJobState } from "@/lib/hermes/deskrpg-plugin-types";

// ---------------------------------------------------------------------------
// 주기 프리셋 (R17)
// ---------------------------------------------------------------------------

export const SCHEDULE_PRESET_VALUES = [
  "daily",
  "weekdays",
  "weekly",
  "monthly",
  "hourly",
  "every-15-minutes",
  "custom",
] as const;

export type SchedulePresetValue = (typeof SCHEDULE_PRESET_VALUES)[number];

export type SchedulePreset = { value: SchedulePresetValue; expr?: string };

export const SCHEDULE_PRESETS: ReadonlyArray<SchedulePreset> = [
  { value: "daily", expr: "0 9 * * *" },
  { value: "weekdays", expr: "0 9 * * 1-5" },
  { value: "weekly", expr: "0 9 * * 1" },
  { value: "monthly", expr: "0 9 1 * *" },
  { value: "hourly", expr: "0 * * * *" },
  { value: "every-15-minutes", expr: "*/15 * * * *" },
  { value: "custom" },
];

const CUSTOM_PRESET: SchedulePreset = SCHEDULE_PRESETS[SCHEDULE_PRESETS.length - 1];

function presetByValue(value: SchedulePresetValue): SchedulePreset {
  return SCHEDULE_PRESETS.find((p) => p.value === value) ?? CUSTOM_PRESET;
}

/** 프리셋 값 → 저장할 표현식. custom 은 표현식이 없으므로 null. */
export function exprForPreset(value: SchedulePresetValue): string | null {
  return presetByValue(value).expr ?? null;
}

function normalizeExpr(expr: string): string {
  return expr.trim().replace(/\s+/g, " ");
}

function cronParts(expr: string): string[] | null {
  const parts = normalizeExpr(expr).split(" ");
  return parts.length === 5 ? parts : null;
}

function isIntegerToken(value: string): boolean {
  return /^\d+$/.test(value);
}

/**
 * 저장된 표현식 → 프리셋 역매핑. 정확히 같은 표현식이 아니어도 모양이 같으면 같은
 * 프리셋으로 본다(예: `30 8 * * *` 도 daily). 5필드 cron 이 아니면(Hermes 스케줄 문자열
 * `every 10m` 등) custom.
 */
export function scheduleOptionForExpr(expr: string): SchedulePreset {
  const normalized = normalizeExpr(expr);
  const exact = SCHEDULE_PRESETS.find((p) => p.expr === normalized);
  if (exact) return exact;

  const parts = cronParts(normalized);
  if (!parts) return CUSTOM_PRESET;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const timed = isIntegerToken(minute) && isIntegerToken(hour);

  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*" && timed) {
    return presetByValue("daily");
  }
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "1-5" && timed) {
    return presetByValue("weekdays");
  }
  if (dayOfMonth === "*" && month === "*" && isIntegerToken(dayOfWeek) && timed) {
    return presetByValue("weekly");
  }
  if (month === "*" && dayOfWeek === "*" && isIntegerToken(dayOfMonth) && timed) {
    return presetByValue("monthly");
  }
  if (
    hour === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*" &&
    isIntegerToken(minute)
  ) {
    return presetByValue("hourly");
  }
  return CUSTOM_PRESET;
}

/** 작업에서 편집 폼에 넣을 표현식. Hermes 가 `expr` 을 안 주면 표시 문자열로 대신한다. */
export function jobScheduleExpr(job: Pick<CronJob, "schedule" | "schedule_display">): string {
  return job.schedule?.expr?.trim() || job.schedule_display?.trim() || "";
}

/** 목록에 보여 줄 주기. */
export function jobScheduleDisplay(job: Pick<CronJob, "schedule" | "schedule_display">): string {
  return (
    job.schedule_display?.trim() ||
    job.schedule?.display?.trim() ||
    job.schedule?.expr?.trim() ||
    "—"
  );
}

// ---------------------------------------------------------------------------
// 배달처 (R17) — 체크박스 목록 ↔ 콤마 문자열
// ---------------------------------------------------------------------------

export const DEFAULT_DELIVER = "local";

export function parseDeliver(deliver: string | null | undefined): string[] {
  const ids = (deliver ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return ids.length > 0 ? Array.from(new Set(ids)) : [DEFAULT_DELIVER];
}

export function composeDeliver(ids: ReadonlyArray<string>): string {
  const clean = Array.from(new Set(ids.map((s) => s.trim()).filter((s) => s.length > 0)));
  return clean.length > 0 ? clean.join(",") : DEFAULT_DELIVER;
}

// ---------------------------------------------------------------------------
// 모델 (R17) — `provider:model` 한 문자열 ↔ 본문의 두 필드
// ---------------------------------------------------------------------------

/**
 * `provider:model` 을 한 번만 가른다 — 모델 이름에 `:` 가 또 들어갈 수 있다
 * (`openrouter:anthropic/claude-sonnet-4:beta`). `:` 가 없으면 모델만.
 * 비어 있으면 둘 다 null — "프로필 기본".
 */
export function parseModelSpec(spec: string): { provider: string | null; model: string | null } {
  const trimmed = spec.trim();
  if (!trimmed) return { provider: null, model: null };
  const idx = trimmed.indexOf(":");
  if (idx < 0) return { provider: null, model: trimmed };
  const provider = trimmed.slice(0, idx).trim();
  const model = trimmed.slice(idx + 1).trim();
  return { provider: provider || null, model: model || null };
}

export function formatModelSpec(provider: string | null, model: string | null): string {
  if (!model) return "";
  return provider ? `${provider}:${model}` : model;
}

// ---------------------------------------------------------------------------
// 시간 (R18)
// ---------------------------------------------------------------------------

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "5분 후" / "2시간 전" — 데스크톱 사이드바와 같은 규칙: 가장 굵은 단위 하나만.
 * 1초 틱과 함께 쓰면 카운트다운이 된다.
 */
export function relativeTime(targetMs: number, nowMs: number, locale?: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  const diff = targetMs - nowMs;
  const abs = Math.abs(diff);
  const sign = diff < 0 ? -1 : 1;
  if (abs < MINUTE) return rtf.format(sign * Math.round(abs / SECOND), "second");
  if (abs < HOUR) return rtf.format(sign * Math.round(abs / MINUTE), "minute");
  if (abs < DAY) return rtf.format(sign * Math.round(abs / HOUR), "hour");
  return rtf.format(sign * Math.round(abs / DAY), "day");
}

/** ISO → epoch ms. 못 읽으면 null. */
export function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** 게이트웨이의 시각을 브라우저 로컬로 환산해 표시한다. */
export function formatLocalDateTime(iso: string | null | undefined, locale?: string): string {
  const ms = parseIsoMs(iso);
  if (ms === null) return "—";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

// ---------------------------------------------------------------------------
// 상태 점 색
// ---------------------------------------------------------------------------

export const STATE_DOT_CLASS: Record<CronJobState, string> = {
  scheduled: "bg-emerald-400",
  running: "bg-sky-400 animate-pulse",
  paused: "bg-amber-400",
  error: "bg-red-500",
  completed: "bg-slate-400",
  disabled: "bg-slate-600",
};

export function stateDotClass(state: string): string {
  return (STATE_DOT_CLASS as Record<string, string>)[state] ?? "bg-slate-500";
}

// ---------------------------------------------------------------------------
// 편집 불가 이유 (R16)
// ---------------------------------------------------------------------------

export type ReadOnlyReason = "otherChannel" | "external";

/**
 * `editable:false` 인 작업의 이유. 서버가 출처를 게이트웨이 기준으로 이미 걸러 줬으므로
 * 출처가 남아 있으면 "다른 채널", 없으면 "DeskRPG 밖".
 */
export function readOnlyReason(job: {
  editable: boolean;
  origin: { channelId: string } | null;
}): ReadOnlyReason | null {
  if (job.editable) return null;
  return job.origin ? "otherChannel" : "external";
}
