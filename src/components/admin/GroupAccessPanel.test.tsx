import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n";
import GroupAccessPanel from "./GroupAccessPanel";

const responses: Record<string, unknown> = {
  members: { members: [] },
  invites: { invites: [] },
  "join-requests": { joinRequests: [] },
  permissions: { permissions: [] },
  "user-overrides": {
    overrides: [
      {
        id: "o1",
        userId: "u1",
        permissionKey: "manage_group_members",
        effect: "deny",
        createdBy: null,
        createdAt: "2026-09-19T00:00:00.000Z",
        loginId: "alice",
        nickname: "앨리스",
      },
    ],
  },
};

test("권한 행은 원시 키 대신 사람이 읽는 이름과 번역된 값을 보인다", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const section = url.split("/").pop() ?? "";
    return new Response(JSON.stringify(responses[section] ?? {}), { status: 200 });
  }) as typeof fetch;

  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  try {
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="ko">
          <GroupAccessPanel
            groupId="g1"
            groupName="Default"
            canManageMembers
            canManagePermissions
            canApproveJoinRequests
          />
        </I18nProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const text = el.textContent ?? "";
    assert.match(text, /채널 만들기/);
    assert.match(text, /멤버 관리/);
    assert.match(text, /상속/);
    assert.match(text, /거부/);
    for (const raw of ["create_channel", "manage_group_members", "inherit", "deny"]) {
      assert.ok(!text.includes(raw), `원시 값 "${raw}" 가 화면에 보인다`);
    }
  } finally {
    await act(async () => root.unmount());
    el.remove();
    globalThis.fetch = originalFetch;
  }
});
