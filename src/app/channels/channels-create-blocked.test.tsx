import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";

import { I18nProvider } from "@/lib/i18n";
import ChannelsPage from "./page";
import ko from "@/lib/i18n/locales/ko";
import { createBlockedReason } from "./create-blocked";

const router: AppRouterInstance = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
  bfcacheId: "test",
};

type Group = {
  id: string;
  name: string;
  role?: string;
  canCreateChannel?: boolean;
  canManageGroup?: boolean;
  canManagePermissions?: boolean;
};

async function render(groups: Group[]): Promise<HTMLElement> {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.endsWith("/api/characters/me")
      ? { character: { id: "c1" } }
      : url.endsWith("/api/groups")
        ? { groups }
        : { channels: [], currentUserId: "u1" };
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }) as typeof fetch;
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () =>
    root.render(
      <AppRouterContext.Provider value={router}>
        <I18nProvider initialLocale="ko">
          <ChannelsPage />
        </I18nProvider>
      </AppRouterContext.Provider>,
    ),
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return el;
}

const hint = (el: HTMLElement) => el.querySelector("[data-create-blocked]");

test("the blocked reason follows what the viewer can do about it", () => {
  assert.equal(createBlockedReason([]), "no_group");
  assert.equal(
    createBlockedReason([{ id: "g", name: "Default", role: "member", canCreateChannel: false }]),
    "ask_admin",
  );
  assert.equal(
    createBlockedReason([
      { id: "g", name: "Default", canCreateChannel: false, canManagePermissions: true },
    ]),
    "grant_yourself",
  );
  assert.equal(createBlockedReason([{ id: "g", name: "Default", canCreateChannel: true }]), null);
});

test("a member is told to ask the server admin for the create-office permission", async () => {
  const el = await render([
    { id: "g", name: "Default", role: "member", canCreateChannel: false, canManageGroup: false },
  ]);
  assert.equal(hint(el)?.getAttribute("data-create-blocked"), "ask_admin");
  assert.equal(Boolean(hint(el)?.querySelector('a[href="/admin/groups"]')), false);
});

test("with no group, the hint offers joining one with an invite code", async () => {
  const el = await render([]);
  assert.equal(hint(el)?.getAttribute("data-create-blocked"), "no_group");
  const join = hint(el)?.querySelector<HTMLButtonElement>('[data-action="join-group"]');
  assert.equal(Boolean(join), true);
  const invitePlaceholder = `input[placeholder="${ko["channels.groupInvitePlaceholder"]}"]`;
  assert.equal(Boolean(document.querySelector(invitePlaceholder)), false);
  await act(async () => join!.click());
  assert.equal(Boolean(document.querySelector(invitePlaceholder)), true);
});

test("a group admin whose group denies it gets a shortcut to the permission settings", async () => {
  const el = await render([
    {
      id: "g",
      name: "Default",
      role: "group_admin",
      canCreateChannel: false,
      canManageGroup: true,
      canManagePermissions: true,
    },
  ]);
  assert.equal(hint(el)?.getAttribute("data-create-blocked"), "grant_yourself");
  assert.equal(Boolean(hint(el)?.querySelector('a[href="/admin/groups"]')), true);
});

test("no hint when the viewer can create an office", async () => {
  const el = await render([{ id: "g", name: "Default", canCreateChannel: true }]);
  assert.equal(Boolean(hint(el)), false);
});
