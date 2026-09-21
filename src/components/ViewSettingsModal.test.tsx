import "../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";

import { EventBus } from "@/game/EventBus";
import { I18nProvider } from "@/lib/i18n";
import { MEETING_CAMERA_PREFS_KEY, type MeetingCameraPrefs } from "@/lib/meeting-camera-prefs";
import ViewSettingsModal from "./ViewSettingsModal";

async function mount() {
  window.localStorage.clear();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <I18nProvider>
        <ViewSettingsModal onClose={() => {}} />
      </I18nProvider>,
    );
  });
  return host;
}

function field<T extends Element>(host: HTMLElement, name: string): T {
  const el = host.querySelector(`[data-view-setting="${name}"]`);
  assert.ok(el, `${name} 입력이 없습니다`);
  return el as T;
}

test("기본값으로 열린다 — 상반신·직행·2초·1.5초", async () => {
  const host = await mount();
  assert.equal(field<HTMLSelectElement>(host, "speakerFraming").value, "upperBody");
  assert.equal(field<HTMLInputElement>(host, "directHandoff").checked, true);
  assert.equal(field<HTMLInputElement>(host, "minSpeakerDwellSeconds").value, "2");
  assert.equal(field<HTMLInputElement>(host, "holdAfterSpeechSeconds").value, "1.5");
});

test("바꾸는 즉시 이 브라우저에 저장하고 카메라에 알린다 — 저장 버튼이 없다", async () => {
  const host = await mount();
  const seen: MeetingCameraPrefs[] = [];
  const listener = (prefs: MeetingCameraPrefs) => seen.push(prefs);
  EventBus.on("view:meeting-camera-prefs", listener);
  try {
    const select = field<HTMLSelectElement>(host, "speakerFraming");
    await act(async () => {
      select.value = "table";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.equal(seen.at(-1)?.speakerFraming, "table", "카메라에 즉시 알리지 않았습니다");
    const stored = JSON.parse(window.localStorage.getItem(MEETING_CAMERA_PREFS_KEY) ?? "{}");
    assert.equal(stored.speakerFraming, "table", "저장하지 않았습니다");
    // 채널 설정과 섞여 "무엇을 저장하나" 가 헷갈리지 않게, 이 화면에는 저장 버튼 자체가 없다.
    const labels = [...host.querySelectorAll("button")].map((b) => b.textContent ?? "");
    assert.ok(
      !labels.some((l) => /저장|Save/.test(l)),
      `저장 버튼이 있습니다: ${labels.join(",")}`,
    );
  } finally {
    EventBus.off("view:meeting-camera-prefs", listener);
  }
});

test("직행을 끄고 기본값으로 되돌릴 수 있다", async () => {
  const host = await mount();
  const box = field<HTMLInputElement>(host, "directHandoff");
  await act(async () => box.click());
  assert.equal(box.checked, false);
  await act(async () => field<HTMLButtonElement>(host, "reset").click());
  assert.equal(field<HTMLInputElement>(host, "directHandoff").checked, true);
  assert.equal(field<HTMLSelectElement>(host, "speakerFraming").value, "upperBody");
});
