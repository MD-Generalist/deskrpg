import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/lib/i18n";
import ConversationWorkspace from "./ConversationWorkspace";

function localized(node: React.ReactNode) {
  return <I18nProvider initialLocale="ko">{node}</I18nProvider>;
}

test("desktop workspace reserves navigator and conversation widths around the map", async () => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);

  await act(async () => {
    root.render(
      localized(
        <ConversationWorkspace
          navigator={<div>탐색</div>}
          conversation={<div>대화</div>}
          conversationWidth={412}
        >
          <div>3D 맵</div>
        </ConversationWorkspace>,
      ),
    );
  });

  const workspace = element.querySelector<HTMLElement>("[data-conversation-workspace]");
  assert.ok(workspace);
  assert.equal(workspace.style.getPropertyValue("--conversation-pane-width"), "412px");
  assert.ok(element.querySelector("[data-workspace-navigator]"));
  assert.ok(element.querySelector("[data-workspace-map]"));
  assert.ok(element.querySelector("[data-workspace-conversation]"));

  const collapse = [...element.querySelectorAll("button")].find(
    (button) => button.getAttribute("aria-label") === "대화 패널 접기",
  );
  assert.ok(collapse);
  await act(async () => collapse.click());
  assert.equal(workspace.style.getPropertyValue("--conversation-pane-width"), "0px");
  assert.equal(
    element.querySelector("[data-workspace-conversation]")?.getAttribute("data-collapsed"),
    "true",
  );
});

test("responsive controls expose navigator and conversation drawers", async () => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  await act(async () => {
    root.render(
      localized(
        <ConversationWorkspace
          navigator={<div>탐색 내용</div>}
          conversation={<div>대화 내용</div>}
          conversationWidth={388}
        >
          <div>3D 맵</div>
        </ConversationWorkspace>,
      ),
    );
  });

  const buttons = [...element.querySelectorAll("button")];
  const navigatorButton = buttons.find((button) => button.textContent?.includes("탐색"));
  const conversationButton = buttons.find((button) => button.textContent?.includes("대화"));
  assert.ok(navigatorButton);
  assert.ok(conversationButton);

  await act(async () => navigatorButton.click());
  assert.equal(
    element.querySelector("[data-workspace-navigator]")?.getAttribute("data-drawer-open"),
    "true",
  );
  await act(async () => conversationButton.click());
  assert.equal(
    element.querySelector("[data-workspace-conversation]")?.getAttribute("data-drawer-open"),
    "true",
  );
});
