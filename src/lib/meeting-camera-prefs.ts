/**
 * 회의 카메라 연출 설정 — **보는 사람마다** 다르다(각자 취향). 그래서 DB 가 아니라 이 브라우저의
 * `localStorage` 에 두고, 바꾸면 저장 버튼 없이 곧바로 반영한다.
 *
 * 채널 전체가 같아야 하는 값(NPC 걸음 속도)은 여기 두지 않는다 — NPC 이동은 한 브라우저가 구동해
 * 방송하므로 사람마다 다르면 누가 구동하느냐에 따라 모두가 보는 속도가 바뀐다.
 */

/**
 * 발언자를 얼마나 당길까. `face` 는 가슴 위, `upperBody` 는 상반신이되 옆자리 사람이 화면에 걸리면
 * 가슴 위까지 당긴다. `table` 은 테이블 전체를 담은 채 발언자 쪽으로만 돈다. */
export type MeetingSpeakerFraming = "face" | "upperBody" | "fullBody" | "table";
export const MEETING_SPEAKER_FRAMINGS: readonly MeetingSpeakerFraming[] = [
  "face",
  "upperBody",
  "fullBody",
  "table",
];

export type MeetingCameraPrefs = {
  speakerFraming: MeetingSpeakerFraming;
  /** 다음 발언자가 이어지면 테이블 구도를 거치지 않고 바로 넘어간다. */
  directHandoff: boolean;
  /** 발언자 구도에 최소한 머무는 시간(초). 짧은 발언에 카메라가 흔들리지 않게 한다. */
  minSpeakerDwellSeconds: number;
  /** 발언이 끝난 뒤 다음 발언자를 기다리는 시간(초). 지나면 테이블 구도로 돌아간다. */
  holdAfterSpeechSeconds: number;
};

/** 단테 결정(2026-09-21): 상반신 · 직행 · 체류 2.0초 · 머묾 1.5초(짧은 발언 체감 뒤 상향). */
export const DEFAULT_MEETING_CAMERA_PREFS: MeetingCameraPrefs = {
  speakerFraming: "upperBody",
  directHandoff: true,
  minSpeakerDwellSeconds: 2,
  holdAfterSpeechSeconds: 1.5,
};

/** 조정 범위. 0 이면 짧은 발언마다 카메라가 따라 움직여 멀미가 나고, 너무 길면 대화를 놓친다. */
export const MEETING_DWELL_RANGE = { min: 0, max: 5, step: 0.1 } as const;

export const MEETING_CAMERA_PREFS_KEY = "deskrpg.meetingCamera.v1";

function clampSeconds(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(MEETING_DWELL_RANGE.max, Math.max(MEETING_DWELL_RANGE.min, n));
  return Math.round(clamped * 10) / 10;
}

/**
 * 저장된 값을 믿지 않고 접는다. 낡은 스키마·손으로 고친 값·다른 버전이 남긴 값이 섞여 있어도
 * 화면이 깨지지 않고 항목별로 기본값에 떨어진다.
 */
export function normalizeMeetingCameraPrefs(value: unknown): MeetingCameraPrefs {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const d = DEFAULT_MEETING_CAMERA_PREFS;
  return {
    speakerFraming: MEETING_SPEAKER_FRAMINGS.includes(raw.speakerFraming as MeetingSpeakerFraming)
      ? (raw.speakerFraming as MeetingSpeakerFraming)
      : d.speakerFraming,
    directHandoff: typeof raw.directHandoff === "boolean" ? raw.directHandoff : d.directHandoff,
    minSpeakerDwellSeconds: clampSeconds(raw.minSpeakerDwellSeconds, d.minSpeakerDwellSeconds),
    holdAfterSpeechSeconds: clampSeconds(raw.holdAfterSpeechSeconds, d.holdAfterSpeechSeconds),
  };
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // 사생활 보호 모드·차단된 사이트 데이터에서는 접근 자체가 던진다.
    return null;
  }
}

export function loadMeetingCameraPrefs(store: StorageLike | null = storage()): MeetingCameraPrefs {
  if (!store) return DEFAULT_MEETING_CAMERA_PREFS;
  try {
    const raw = store.getItem(MEETING_CAMERA_PREFS_KEY);
    return normalizeMeetingCameraPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_MEETING_CAMERA_PREFS;
  }
}

/** 저장에 실패해도 던지지 않는다 — 이번 세션에는 그대로 반영되고, 다음에 기본값으로 돌아갈 뿐이다. */
export function saveMeetingCameraPrefs(
  prefs: MeetingCameraPrefs,
  store: StorageLike | null = storage(),
): MeetingCameraPrefs {
  const normalized = normalizeMeetingCameraPrefs(prefs);
  try {
    store?.setItem(MEETING_CAMERA_PREFS_KEY, JSON.stringify(normalized));
  } catch {
    // 저장 공간이 꽉 찼거나 막혔다.
  }
  return normalized;
}
