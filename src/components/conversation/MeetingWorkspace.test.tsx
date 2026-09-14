import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/lib/i18n";
import MeetingWorkspace from "./MeetingWorkspace";

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver;

test("meeting workspace keeps the existing meeting controls inside a labelled surface", async () => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="ko">
        <MeetingWorkspace
          channelId="channel"
          character={{
            id: "user",
            name: "은채",
            appearance: { gender: "female", body: "female" } as never,
          }}
          socket={null}
          npcs={[]}
          onLeave={() => {}}
        />
      </I18nProvider>,
    );
  });

  const surface = element.querySelector("[data-meeting-workspace]");
  assert.ok(surface);
  assert.equal(surface.getAttribute("aria-label"), "회의실");
  assert.match(surface.textContent ?? "", /회의/);
  await act(async () => root.unmount());
});
