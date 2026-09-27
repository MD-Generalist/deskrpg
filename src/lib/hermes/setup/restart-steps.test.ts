import assert from "node:assert/strict";
import test from "node:test";

import { prepareHost } from "./host";
import { onlyRestartSteps } from "./restart-support";
import type { HostExecutor, SetupCandidate } from "./types";

// [다시 시작] reuses the wizard's host pipeline but must touch nothing else: no plugin, API, service, timezone or
// profile work — only Hermes' own restart and the verification that follows.

const candidate: SetupCandidate = {
  id: "a".repeat(64),
  label: "Hermes default",
  version: "0.21.5",
  service: "Hermes_Gateway",
  port: 8652,
  pluginInstalled: true,
  pluginEnabled: true,
  pluginVersion: "0.30.2",
  timezone: "Asia/Seoul",
  hasToken: true,
};
const prepared = {
  prepared: {
    baseUrl: "http://127.0.0.1:8652",
    token: "existing-private-token",
    profiles: [{ name: "default", token: "existing-private-token" }],
  },
};

function fake(responses: unknown[]) {
  const actions: string[] = [];
  const execute: HostExecutor = async (_command, _args, options) => {
    actions.push(String(JSON.parse(options?.input ?? "{}").action ?? ""));
    return { code: 0, stdout: JSON.stringify(responses.shift()), stderr: "" };
  };
  return { execute, actions };
}

test("a stopped gateway is restarted and verified, and nothing else is changed", async () => {
  const f = fake([
    {
      candidate,
      pluginStatus: "unknown",
      changes: [
        "setting_worker_launch",
        "updating_plugin",
        "configuring_api",
        "restarting_gateway",
        "verifying_gateway",
      ],
    },
    { ok: true },
    prepared,
  ]);
  const steps: string[] = [];
  await prepareHost(
    f.execute,
    candidate.id,
    (s) => steps.push(s),
    undefined,
    undefined,
    undefined,
    onlyRestartSteps,
  );
  assert.deepEqual(steps, ["inspecting", "restarting_gateway", "verifying_gateway"]);
  assert.deepEqual(f.actions, ["inspect", "restart", "verify"]);
});

test("a gateway that answers after all is only verified, not restarted", async () => {
  const f = fake([{ candidate, pluginStatus: "plugin_ready", changes: [] }, prepared]);
  const steps: string[] = [];
  await prepareHost(
    f.execute,
    candidate.id,
    (s) => steps.push(s),
    undefined,
    undefined,
    undefined,
    onlyRestartSteps,
  );
  assert.deepEqual(f.actions, ["inspect", "verify"]);
});
