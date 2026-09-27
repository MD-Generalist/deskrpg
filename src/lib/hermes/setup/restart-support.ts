/**
 * Whether DeskRPG may offer [다시 시작] for a gateway that stopped answering, or only the instructions.
 *
 * DeskRPG never restarts a gateway on its own — the button is a person's choice, so a gateway someone stopped on
 * purpose is not brought back and a crashing one is not looped. The button needs a host DeskRPG can send commands
 * to (this computer, or an SSH host that is not Windows — setup drives remote hosts as Linux only) and a person who
 * may run commands there: the gateway's owner, with host setup allowed (`hostSetupAllowed`). Everyone else gets the
 * instructions with the command to run on the computer where Hermes is installed.
 *
 * Pure — safe for the client bundle.
 */

export type RestartHost = "local" | "ssh" | "unsupported";

export type RestartBlockedReason =
  "not_owner" | "not_host_admin" | "remote_windows" | "no_host_access";

export type GatewayRestartSupport =
  { canRestart: true } | { canRestart: false; reason: RestartBlockedReason };

export function gatewayRestartSupport(input: {
  isOwner: boolean;
  hostAdmin: boolean;
  host: RestartHost;
  /** Only asked for an SSH host — whether it answered as Windows. */
  remoteWindows?: boolean;
}): GatewayRestartSupport {
  if (!input.isOwner) return { canRestart: false, reason: "not_owner" };
  if (!input.hostAdmin) return { canRestart: false, reason: "not_host_admin" };
  if (input.host === "unsupported") return { canRestart: false, reason: "no_host_access" };
  if (input.host === "ssh" && input.remoteWindows)
    return { canRestart: false, reason: "remote_windows" };
  return { canRestart: true };
}

/** What to run by hand on the computer where Hermes is installed (upstream `hermes gateway start`). */
export const GATEWAY_START_COMMAND = "hermes gateway start";

/**
 * `prepareHost`'s skip rule for [다시 시작]: every step is skipped except the restart and its verification. Plugin,
 * API, service, timezone and profile work stay as they are — the host decides whether a restart is needed.
 */
export function onlyRestartSteps(step: string): boolean {
  return step !== "restarting_gateway" && step !== "verifying_gateway";
}
