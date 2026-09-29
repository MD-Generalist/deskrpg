import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  PathParamsContext,
  SearchParamsContext,
} from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { I18nProvider } from "@/lib/i18n";
import { PINNED_PLUGIN_SETUP_COMMAND } from "@/lib/hermes/plugin-install-command";
import { PLUGIN_PIN } from "@/lib/hermes/setup/pin";
import EmployeeDetailPage from "./[name]/page";

// Persona and AI model lock while the gateway's plugin is not ready. The reason and the fix must be
// on the page itself — a tooltip does not exist on touch screens, and the header's "connection test"
// checks only this employee's key, so it can never lift this lock.
const router: AppRouterInstance = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
  bfcacheId: "test",
};

async function render(pluginStatus: string) {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const data =
      url.startsWith("/api/gateways?") || url === "/api/gateways"
        ? {
            gateways: [
              {
                id: "gw-1",
                displayName: "GW",
                isOwner: true,
                pluginStatus,
                pluginCheckedAt: new Date().toISOString(),
              },
            ],
          }
        : url === "/api/gateways/gw-1/profiles"
          ? {
              profiles: [
                {
                  id: "p-1",
                  profileName: "sophie",
                  displayName: "소피",
                  lastValidationStatus: "ok",
                },
              ],
            }
          : url === "/api/gateways/gw-1/test"
            ? { plugin: { status: pluginStatus } }
            : {};
    return { ok: true, status: 200, json: async () => data } as Response;
  }) as typeof fetch;
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(
      <AppRouterContext.Provider value={router}>
        <PathParamsContext.Provider value={{ name: "sophie" }}>
          <SearchParamsContext.Provider value={new URLSearchParams("gateway=gw-1")}>
            <I18nProvider initialLocale="ko">
              <EmployeeDetailPage />
            </I18nProvider>
          </SearchParamsContext.Provider>
        </PathParamsContext.Provider>
      </AppRouterContext.Provider>,
    );
  });
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };
  await settle();
  return {
    el,
    calls,
    settle,
    cleanup: async () => {
      await act(async () => root.unmount());
      el.remove();
      globalThis.fetch = originalFetch;
    },
  };
}

const lock = (el: HTMLElement) => el.querySelector("[data-plugin-lock]");
const details = (el: HTMLElement) =>
  lock(el)?.querySelector("[data-more-details]")?.textContent ?? "";
const gatewayLink = (el: HTMLElement) =>
  Boolean(lock(el)?.querySelector('a[href="/gateways?gateway=gw-1"]'));

test("a token that is not the owner key: says so and links to the gateway settings", async () => {
  const { el, cleanup } = await render("plugin_unauthorized");
  try {
    assert.equal(lock(el)?.getAttribute("data-plugin-lock"), "plugin_unauthorized");
    assert.match(details(el), /API_SERVER_KEY/);
    assert.equal(gatewayLink(el), true);
  } finally {
    await cleanup();
  }
});

test("no plugin: gives the disable, pinned install, enable and restart command to copy", async () => {
  const { el, cleanup } = await render("plugin_absent");
  try {
    assert.equal(lock(el)?.getAttribute("data-plugin-lock"), "plugin_absent");
    const command = lock(el)?.querySelector("pre")?.textContent ?? "";
    assert.equal(command, PINNED_PLUGIN_SETUP_COMMAND);
    const steps = [
      "hermes plugins disable deskrpg",
      `--ref ${PLUGIN_PIN} --force`,
      "hermes plugins enable deskrpg",
      "hermes gateway restart",
    ].map((step) => command.indexOf(step));
    assert.ok(steps.every((position) => position >= 0));
    assert.deepEqual(
      steps,
      [...steps].sort((a, b) => a - b),
    );
  } finally {
    await cleanup();
  }
});

test("an unreachable gateway: asks to check the URL points at the API server port", async () => {
  const { el, cleanup } = await render("unknown");
  try {
    assert.equal(lock(el)?.getAttribute("data-plugin-lock"), "unknown");
    assert.match(details(el), /8642/);
    assert.equal(gatewayLink(el), true);
  } finally {
    await cleanup();
  }
});

test("the recheck button says it re-checks the gateway, apart from the connection test", async () => {
  const { el, calls, settle, cleanup } = await render("plugin_absent");
  try {
    const recheck = lock(el)?.querySelector<HTMLButtonElement>('[data-action="gateway-recheck"]');
    assert.equal(Boolean(recheck), true);
    const before = calls.filter((c) => c === "POST /api/gateways/gw-1/test").length;
    await act(async () => recheck!.click());
    await settle();
    assert.equal(calls.filter((c) => c === "POST /api/gateways/gw-1/test").length, before + 1);
  } finally {
    await cleanup();
  }
});

test("locked wizard steps show their reason as text, not only as a tooltip", async () => {
  const { el, cleanup } = await render("plugin_absent");
  try {
    const locks = el.querySelector("[data-step-locks]");
    assert.equal(Boolean(locks), true);
    assert.equal(
      Boolean(locks?.querySelector('[data-reason="hermes.plugin.locked.absent"]')),
      true,
    );
  } finally {
    await cleanup();
  }
});

test("no lock notice once the plugin is ready", async () => {
  const { el, cleanup } = await render("plugin_ready");
  try {
    assert.equal(Boolean(lock(el)), false);
    assert.equal(Boolean(el.querySelector("[data-step-locks]")), false);
  } finally {
    await cleanup();
  }
});
