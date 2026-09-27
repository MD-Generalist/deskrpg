import assert from "node:assert/strict";
import test from "node:test";

import { gatewayRestartSupport } from "./restart-support";

const owner = { isOwner: true, hostAdmin: true } as const;

test("the owner who runs host setup can restart a gateway on this computer, Windows included", () => {
  assert.deepEqual(gatewayRestartSupport({ ...owner, host: "local" }), { canRestart: true });
});

test("an SSH host that is Linux or macOS can be restarted; one that answered as Windows cannot", () => {
  assert.deepEqual(gatewayRestartSupport({ ...owner, host: "ssh", remoteWindows: false }), {
    canRestart: true,
  });
  assert.deepEqual(gatewayRestartSupport({ ...owner, host: "ssh", remoteWindows: true }), {
    canRestart: false,
    reason: "remote_windows",
  });
});

test("an address DeskRPG cannot send commands to only gets the instructions", () => {
  assert.deepEqual(gatewayRestartSupport({ ...owner, host: "unsupported" }), {
    canRestart: false,
    reason: "no_host_access",
  });
});

test("only the gateway's owner, and only one allowed to run host setup, gets the button", () => {
  // Checked before the host: someone else must not even learn how the host is reached.
  assert.deepEqual(gatewayRestartSupport({ isOwner: false, hostAdmin: true, host: "local" }), {
    canRestart: false,
    reason: "not_owner",
  });
  assert.deepEqual(gatewayRestartSupport({ isOwner: true, hostAdmin: false, host: "local" }), {
    canRestart: false,
    reason: "not_host_admin",
  });
});
