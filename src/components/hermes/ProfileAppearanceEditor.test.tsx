import "../../test-setup/dom";
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../lib/i18n/context";
import ProfileAppearanceEditor from "./ProfileAppearanceEditor";
import { officeLookAppearance } from "../../game/three/office-looks";

test("profile save preserves unknown look identity until explicit replacement", async () => {
  const initial = { ...officeLookAppearance("office-eun"), officeLookId: "future-look" };
  const bodies: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response("{}", { status: 200 });
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <I18nProvider initialLocale="ko">
          <ProfileAppearanceEditor
            gatewayId="g"
            profileId="p"
            initialAppearance={initial}
            onSaved={() => {}}
          />
        </I18nProvider>,
      ),
    );
    const save = () =>
      Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("저장"))!;
    await act(async () => save().click());
    assert.deepEqual(bodies[0], { appearance: initial });
    const selector = host.querySelector("select")!;
    await act(async () => {
      selector.value = "office-hyeon";
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => save().click());
    assert.deepEqual(bodies[1], { appearance: officeLookAppearance("office-hyeon") });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    globalThis.fetch = originalFetch;
  }
});
