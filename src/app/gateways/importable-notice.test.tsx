/**
 * The "profiles waiting to be imported" notice must be visible where the owner lands after connecting.
 * On `/gateways` a ready connection selects the new gateway at once (reloadAfterSave), so the wizard's
 * own success screen is replaced before anyone sees it — the notice belongs to the selected gateway's
 * employees section. These tests drive the page, not the wizard alone.
 */
import "../../test-setup/dom";
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

import { I18nProvider } from "@/lib/i18n/context";

import GatewayManagementPage from "./page";

const router: AppRouterInstance = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
  bfcacheId: "test",
};

const GATEWAY = {
  id: "gw-new",
  displayName: "데모 게이트웨이",
  baseUrl: "http://gw.example",
  isOwner: true,
  pluginStatus: "plugin_ready",
  pluginVersion: "0.30.2",
  workerPluginWarning: null,
  workerPropagation: "enabled",
};
const IMPORTABLE = "GET /api/gateways/gw-new/plugin/profiles/importable";
const THREE = { profiles: ["ann", "bo", "cy"].map((name) => ({ name, description: "" })) };

const originalFetch = globalThis.fetch;
let root: Root | null = null;
let host: HTMLElement;
let calls: string[] = [];

type Route = { status?: number; body: unknown };

function mockFetch(routes: Record<string, Route | (() => Route)>) {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push(key);
    await new Promise((r) => setTimeout(r, 2));
    const found = routes[key];
    const route = typeof found === "function" ? found() : found;
    return new Response(JSON.stringify(route?.body ?? {}), {
      status: route ? (route.status ?? 200) : 404,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

async function settle() {
  for (let i = 0; i < 20; i += 1) await act(async () => new Promise((r) => setTimeout(r, 2)));
}

async function renderPage(search = "") {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const r = root;
  await act(async () => {
    r.render(
      <AppRouterContext.Provider value={router}>
        <SearchParamsContext.Provider value={new URLSearchParams(search)}>
          <I18nProvider initialLocale="ko">
            <GatewayManagementPage />
          </I18nProvider>
        </SearchParamsContext.Provider>
      </AppRouterContext.Provider>,
    );
  });
  await settle();
}

async function clickButton(text: string) {
  const button = Array.from(host.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text),
  );
  assert.ok(button, text);
  await act(async () => button.click());
  await settle();
}

test.afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
    root = null;
    host.remove();
  }
  globalThis.fetch = originalFetch;
});

test("right after connecting, the selected gateway says how many profiles wait to be imported", async () => {
  let connected = false;
  mockFetch({
    "GET /api/gateways?refreshPlugin=1": () => ({
      body: { gateways: connected ? [GATEWAY] : [] },
    }),
    "GET /api/gateways/setup": {
      body: { local: true, ssh: true, hostLabel: "server", sshHosts: [] },
    },
    "POST /api/gateways/setup": () => {
      connected = true;
      return { body: { gatewayId: "gw-new", pluginStatus: "plugin_ready" } };
    },
    "GET /api/gateways/gw-new": { body: { gateway: GATEWAY } },
    [IMPORTABLE]: { body: THREE },
    "GET /api/admin/diagnostics": { status: 404, body: {} },
  });
  await renderPage();
  await clickButton("원격 연결");
  await clickButton("게이트웨이 주소로 연결");
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await settle();

  assert.ok(host.querySelector("[data-gateway-share-link]"), "the new gateway is selected");
  const notice = host.querySelector("[data-importable-notice]");
  assert.ok(notice, "the notice is on screen after the selection switch");
  assert.equal(notice.getAttribute("data-importable-notice"), "3");
  assert.match(
    notice.querySelector("a")?.getAttribute("href") ?? "",
    /^\/profiles\?gateway=gw-new.*#profile-import$/,
  );
});

test("an owned gateway with nothing to import shows no notice", async () => {
  mockFetch({
    "GET /api/gateways?refreshPlugin=1": { body: { gateways: [GATEWAY] } },
    "GET /api/gateways/gw-new": { body: { gateway: GATEWAY } },
    [IMPORTABLE]: { body: { profiles: [] } },
    "GET /api/admin/diagnostics": { status: 404, body: {} },
  });
  await renderPage("gateway=gw-new");
  assert.ok(calls.includes(IMPORTABLE));
  assert.ok(!host.querySelector("[data-importable-notice]"));
});

test("a shared gateway does not ask for importable profiles (only the owner imports)", async () => {
  mockFetch({
    "GET /api/gateways?refreshPlugin=1": { body: { gateways: [{ ...GATEWAY, isOwner: false }] } },
    "GET /api/gateways/gw-new": { body: { gateway: { ...GATEWAY, isOwner: false } } },
    [IMPORTABLE]: { body: THREE },
    "GET /api/admin/diagnostics": { status: 404, body: {} },
  });
  await renderPage("gateway=gw-new");
  assert.ok(!calls.includes(IMPORTABLE));
  assert.ok(!host.querySelector("[data-importable-notice]"));
});
