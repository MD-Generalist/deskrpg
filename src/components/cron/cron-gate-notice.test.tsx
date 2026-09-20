import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n";
import { CronApiError } from "./cron-api";
import CronEditorDialog from "./CronEditorDialog";

/**
 * 배달처 목록을 못 받았을 때: local 폴백은 살아 있어야 하고(폼을 막지 않는다),
 * 게이트 실패였다면 사용자가 원인을 알 수 있어야 한다.
 */
test("배달처 프리로드가 게이트에 막히면 안내가 보인다", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("delivery-targets")) {
      return new Response(
        JSON.stringify({ code: "plugin_absent", error: "plugin is not installed" }),
        { status: 404 },
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as typeof fetch;

  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  try {
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="ko">
          <CronEditorDialog
            channelId="c1"
            npcs={[{ npcId: "n1", npcName: "테스트 NPC" }]}
            timezone={null}
            onSubmit={async () => {}}
            onClose={() => {}}
          />
        </I18nProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // local 폴백은 여전히 고를 수 있어야 한다 — 게이트 실패가 폼을 막지 않는다.
    const localCheckbox = el.querySelector('[data-testid="cron-deliver-local"]');
    assert.ok(localCheckbox, "local 배달처 체크박스가 남아 있어야 한다");

    const text = el.textContent ?? "";
    assert.match(text, /무엇이 필요한가요\?/);
  } finally {
    await act(async () => root.unmount());
    el.remove();
    globalThis.fetch = originalFetch;
  }
});

/**
 * 평범한 500·네트워크 오류는 게이트 실패가 아니다 — "설정이 더 필요하다"는 버튼을
 * 띄우면 거짓 신호다(`isSetupBlocker` 로 걸러지는 넷에 안 든다).
 */
test("평범한 오류에는 체크리스트 버튼이 안 보인다", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("delivery-targets")) {
      return new Response(JSON.stringify({ code: "internal_error", error: "boom" }), {
        status: 500,
      });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as typeof fetch;

  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  try {
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="ko">
          <CronEditorDialog
            channelId="c1"
            npcs={[{ npcId: "n1", npcName: "테스트 NPC" }]}
            timezone={null}
            onSubmit={async () => {}}
            onClose={() => {}}
          />
        </I18nProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // local 폴백은 여전히 고를 수 있다.
    const localCheckbox = el.querySelector('[data-testid="cron-deliver-local"]');
    assert.ok(localCheckbox, "local 배달처 체크박스가 남아 있어야 한다");

    const text = el.textContent ?? "";
    assert.doesNotMatch(text, /무엇이 필요한가요\?/);
  } finally {
    await act(async () => root.unmount());
    el.remove();
    globalThis.fetch = originalFetch;
  }
});

test("CronApiError 는 status·code 를 그대로 들고 있다", () => {
  const err = new CronApiError(404, "plugin_absent", "nope", {});
  assert.equal(err.status, 404);
  assert.equal(err.code, "plugin_absent");
});
