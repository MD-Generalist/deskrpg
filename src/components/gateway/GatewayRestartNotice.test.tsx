import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n";
import GatewayRestartNotice, { type GatewayRestartApi } from "./GatewayRestartNotice";

const COMMAND = "hermes gateway start";

async function render(api: GatewayRestartApi) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="ko">
        <GatewayRestartNotice gatewayId="gw-1" api={api} pollMs={0} />
      </I18nProvider>,
    );
  });
  const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  await flush();
  return {
    host,
    flush,
    unmount: () => act(async () => root.unmount()),
    q: (selector: string) => host.querySelector(selector),
  };
}

test("the owner who can restart gets the button, and a finished restart says so", async () => {
  const started: string[] = [];
  const view = await render({
    support: async () => ({ canRestart: true, command: COMMAND }),
    start: async (id) => (started.push(id), "job-1"),
    job: async () => ({ status: "succeeded" }),
  });
  const button = view.q("[data-restart-button]") as HTMLButtonElement;
  assert.ok(button, "the button is offered");
  assert.equal(view.q("[data-gateway-restart]")?.getAttribute("data-restart-state"), "idle");

  await act(async () => button.click());
  await view.flush();
  assert.deepEqual(started, ["gw-1"]);
  assert.equal(view.q("[data-gateway-restart]")?.getAttribute("data-restart-state"), "succeeded");
  assert.equal(view.q("[data-restart-button]"), null, "nothing left to press");
  await view.unmount();
});

test("a failed restart says why and offers the button again", async () => {
  const view = await render({
    support: async () => ({ canRestart: true, command: COMMAND }),
    start: async () => "job-1",
    job: async () => ({ status: "failed", error: "gateway_restart_failed" }),
  });
  await act(async () => (view.q("[data-restart-button]") as HTMLButtonElement).click());
  await view.flush();
  const notice = view.q("[data-gateway-restart]");
  assert.equal(notice?.getAttribute("data-restart-state"), "failed");
  assert.equal(notice?.getAttribute("data-restart-error"), "gateway_restart_failed");
  assert.ok(view.q("[data-restart-error-text]")?.textContent?.trim(), "the reason is written out");
  assert.ok(view.q("[data-restart-button]"), "the person can try again");
  await view.unmount();
});

test("a refusal to start (not allowed, busy) is shown the same way", async () => {
  const view = await render({
    support: async () => ({ canRestart: true, command: COMMAND }),
    start: async () => {
      throw "setup_busy";
    },
    job: async () => ({ status: "succeeded" }),
  });
  await act(async () => (view.q("[data-restart-button]") as HTMLButtonElement).click());
  await view.flush();
  assert.equal(view.q("[data-gateway-restart]")?.getAttribute("data-restart-error"), "setup_busy");
  await view.unmount();
});

test("where DeskRPG cannot send commands, only the instructions and the command to run", async () => {
  for (const reason of ["no_host_access", "remote_windows", "not_host_admin"] as const) {
    const view = await render({
      support: async () => ({ canRestart: false, reason, command: COMMAND }),
      start: async () => assert.fail("never started"),
      job: async () => assert.fail("never polled"),
    });
    assert.equal(view.q("[data-restart-button]"), null, reason);
    assert.equal(view.q("[data-gateway-restart]")?.getAttribute("data-restart-reason"), reason);
    assert.equal(view.q("[data-restart-command]")?.textContent, COMMAND, reason);
    await view.unmount();
  }
});

test("someone who does not own the gateway is told to ask its owner, without host details", async () => {
  const view = await render({
    support: async () => ({ canRestart: false, reason: "not_owner", command: COMMAND }),
    start: async () => assert.fail("never started"),
    job: async () => assert.fail("never polled"),
  });
  assert.equal(view.q("[data-restart-button]"), null);
  assert.equal(view.q("[data-gateway-restart]")?.getAttribute("data-restart-reason"), "not_owner");
  assert.equal(view.q("[data-restart-command]"), null);
  await view.unmount();
});

test("when the support check itself fails, the instructions still show", async () => {
  const view = await render({
    support: async () => {
      throw "unauthorized";
    },
    start: async () => assert.fail("never started"),
    job: async () => assert.fail("never polled"),
  });
  assert.equal(view.q("[data-restart-button]"), null);
  assert.equal(view.q("[data-restart-command]")?.textContent, COMMAND);
  await view.unmount();
});
