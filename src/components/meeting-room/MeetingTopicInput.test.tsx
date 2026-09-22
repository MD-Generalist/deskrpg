import "../../test-setup/dom";
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { fireEvent } from "@testing-library/dom";
import { I18nProvider } from "@/lib/i18n";
import MeetingTopicInput, { canSubmitMeetingTopic } from "./MeetingTopicInput";

test("long topics remain intact with a visible limit and cannot submit via shortcut", async () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  let submits = 0;
  const text = "가".repeat(430);
  try {
    await act(async () =>
      root.render(
        <I18nProvider initialLocale="ko">
          <MeetingTopicInput
            value={text}
            onChange={() => {}}
            onSubmit={() => {
              submits++;
            }}
          />
        </I18nProvider>,
      ),
    );
    const input = el.querySelector("textarea")!;
    assert.equal(input.value, text);
    assert.equal(input.hasAttribute("maxlength"), false);
    assert.equal(input.getAttribute("aria-invalid"), "true");
    assert.match(el.textContent!, /430 \/ 200/);
    assert.match(el.textContent!, /삭제되지 않았습니다/);
    await act(async () => fireEvent.keyDown(input, { key: "Enter", ctrlKey: true }));
    assert.equal(submits, 0);
    assert.equal(canSubmitMeetingTopic(text), false);
    assert.equal(canSubmitMeetingTopic("가".repeat(200)), true);
    assert.equal(canSubmitMeetingTopic(" "), false);
    await act(async () =>
      root.render(
        <I18nProvider initialLocale="ko">
          <MeetingTopicInput
            value="짧은 주제"
            onChange={() => {}}
            onSubmit={() => {
              submits++;
            }}
          />
        </I18nProvider>,
      ),
    );
    assert.equal(input.getAttribute("aria-invalid"), "false");
    await act(async () => fireEvent.keyDown(input, { key: "Enter", ctrlKey: true }));
    assert.equal(submits, 1);
  } finally {
    await act(async () => root.unmount());
    el.remove();
  }
});
