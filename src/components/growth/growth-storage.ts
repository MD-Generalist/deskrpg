import { initialSurveyState, type SurveyState } from "./survey-schedule";

const KEYS = {
  seenVersion: "deskrpg.growth.seenVersion",
  starClicked: "deskrpg.growth.starClicked",
} as const;

export interface GrowthState {
  /** 저장소를 쓸 수 있는가. 못 쓰면 빨간 점을 띄우지 않는다 — 꺼도 매번 다시 켜지기 때문이다. */
  ok: boolean;
  seenVersion: string | null;
  starClicked: boolean;
}

export function readGrowthState(storage: Storage | null): GrowthState {
  try {
    if (!storage) throw new Error("no storage");
    return {
      ok: true,
      seenVersion: storage.getItem(KEYS.seenVersion),
      starClicked: storage.getItem(KEYS.starClicked) === "1",
    };
  } catch {
    return { ok: false, seenVersion: null, starClicked: false };
  }
}

export function writeGrowthFlag(
  storage: Storage | null,
  key: keyof typeof KEYS,
  value: string,
): void {
  try {
    storage?.setItem(KEYS[key], value);
  } catch {
    // 사생활 보호 모드 등 — 기억하지 못할 뿐 동작은 계속한다.
  }
}

export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const SURVEY_KEY = "deskrpg.feedback.survey";

/** 설문 상태. 저장소를 못 쓰면 null — 호출부는 설문을 띄우지 않는다. */
export function readSurveyState(storage: Storage | null): SurveyState | null {
  let raw: string | null;
  try {
    if (!storage) return null;
    raw = storage.getItem(SURVEY_KEY);
  } catch {
    return null;
  }
  try {
    const v = (raw ? JSON.parse(raw) : {}) as Partial<SurveyState>;
    return {
      consent: v.consent === "granted" || v.consent === "denied" ? v.consent : "unknown",
      usageMs: typeof v.usageMs === "number" && v.usageMs >= 0 ? v.usageMs : 0,
      nextAt: typeof v.nextAt === "number" ? v.nextAt : null,
    };
  } catch {
    // 망가진 값은 처음부터 다시 센다.
    return initialSurveyState();
  }
}

export function writeSurveyState(storage: Storage | null, state: SurveyState): void {
  try {
    storage?.setItem(SURVEY_KEY, JSON.stringify(state));
  } catch {
    // 기억하지 못할 뿐이다.
  }
}
