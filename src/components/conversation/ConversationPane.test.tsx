import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import ConversationPane from "./ConversationPane";

test("conversation pane exposes a labelled right-side workspace region", async () => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);

  await act(async () => {
    root.render(
      <ConversationPane label="소피와 대화">
        <div>대화 내용</div>
      </ConversationPane>,
    );
  });

  const pane = element.querySelector("aside");
  assert.ok(pane);
  assert.equal(pane.getAttribute("aria-label"), "소피와 대화");
  assert.equal(pane.getAttribute("data-conversation-pane"), "true");
  assert.match(pane.className, /min-h-0/);
  assert.match(pane.textContent ?? "", /대화 내용/);
});
