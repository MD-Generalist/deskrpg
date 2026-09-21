export const DAY = 24 * 60 * 60 * 1000;
export const FIRST_SURVEY_AFTER_MS = 30 * 60 * 1000;
export const LATER_DELAY_MS = 7 * DAY;

export type Consent = "unknown" | "granted" | "denied";

export interface SurveyState {
  consent: Consent;
  /** 맵 화면이 보이는 동안 쌓인 사용 시간 */
  usageMs: number;
  /** 다음 설문을 띄워도 되는 시각. null 이면 아직 첫 설문 전 */
  nextAt: number | null;
}

export function initialSurveyState(): SurveyState {
  return { consent: "unknown", usageMs: 0, nextAt: null };
}

export function shouldShowSurvey(state: SurveyState, now: number): boolean {
  if (state.consent === "denied") return false;
  if (state.nextAt === null) return state.usageMs >= FIRST_SURVEY_AFTER_MS;
  return now >= state.nextAt;
}

export type SurveyOutcome = "sent" | "later" | "never";

export function afterSurvey(
  state: SurveyState,
  outcome: SurveyOutcome,
  now: number,
  intervalDays: number,
): SurveyState {
  if (outcome === "never") return { ...state, consent: "denied", nextAt: null };
  if (outcome === "sent") return { ...state, consent: "granted", nextAt: now + intervalDays * DAY };
  return { ...state, nextAt: now + LATER_DELAY_MS };
}
