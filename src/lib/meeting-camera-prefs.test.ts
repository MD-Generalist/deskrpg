import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MEETING_CAMERA_PREFS,
  MEETING_CAMERA_PREFS_KEY,
  loadMeetingCameraPrefs,
  normalizeMeetingCameraPrefs,
  saveMeetingCameraPrefs,
} from "./meeting-camera-prefs";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

test("기본값은 단테 결정 그대로다 — 상반신·직행·체류 2.0초·머묾 1.5초", () => {
  assert.deepEqual(DEFAULT_MEETING_CAMERA_PREFS, {
    speakerFraming: "upperBody",
    directHandoff: true,
    minSpeakerDwellSeconds: 2,
    holdAfterSpeechSeconds: 1.5,
  });
});

test("저장된 값을 믿지 않는다 — 틀린 항목만 기본값으로 떨어지고 나머지는 산다", () => {
  const prefs = normalizeMeetingCameraPrefs({
    speakerFraming: "portrait",
    directHandoff: "yes",
    minSpeakerDwellSeconds: 99,
    holdAfterSpeechSeconds: 0.73,
  });
  assert.equal(prefs.speakerFraming, "upperBody");
  assert.equal(prefs.directHandoff, true);
  assert.equal(prefs.minSpeakerDwellSeconds, 5, "범위 위로 넘치면 잘라 낸다");
  assert.equal(prefs.holdAfterSpeechSeconds, 0.7, "0.1초 단위로 맞춘다");
  assert.deepEqual(normalizeMeetingCameraPrefs("garbage"), DEFAULT_MEETING_CAMERA_PREFS);
  assert.deepEqual(normalizeMeetingCameraPrefs(null), DEFAULT_MEETING_CAMERA_PREFS);
});

test("'얼굴 가까이' 단계를 더해도 이전 버전이 저장한 값은 그대로 읽힌다", () => {
  const stored = {
    speakerFraming: "fullBody",
    directHandoff: false,
    minSpeakerDwellSeconds: 2,
    holdAfterSpeechSeconds: 1,
  };
  const store = memory({ [MEETING_CAMERA_PREFS_KEY]: JSON.stringify(stored) });
  assert.deepEqual(loadMeetingCameraPrefs(store), stored);
  assert.equal(normalizeMeetingCameraPrefs({ speakerFraming: "face" }).speakerFraming, "face");
});

test("저장하고 다시 읽으면 같은 값이다", () => {
  const store = memory();
  saveMeetingCameraPrefs({ ...DEFAULT_MEETING_CAMERA_PREFS, speakerFraming: "table" }, store);
  assert.equal(loadMeetingCameraPrefs(store).speakerFraming, "table");
});

test("깨진 JSON 이나 막힌 저장소에서도 던지지 않고 기본값이다", () => {
  assert.deepEqual(
    loadMeetingCameraPrefs(memory({ [MEETING_CAMERA_PREFS_KEY]: "{not json" })),
    DEFAULT_MEETING_CAMERA_PREFS,
  );
  const blocked = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  assert.deepEqual(loadMeetingCameraPrefs(blocked), DEFAULT_MEETING_CAMERA_PREFS);
  assert.doesNotThrow(() => saveMeetingCameraPrefs(DEFAULT_MEETING_CAMERA_PREFS, blocked));
  assert.deepEqual(loadMeetingCameraPrefs(null), DEFAULT_MEETING_CAMERA_PREFS);
});
