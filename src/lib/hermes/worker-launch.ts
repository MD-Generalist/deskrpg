/**
 * Whether Hermes can start kanban workers from a gateway — the plugin's `kanban.worker_launch` report.
 *
 * Hermes starts a worker with `$HERMES_BIN` when it is set, and otherwise as `<gateway python> -m hermes_cli.main`
 * without the gateway's PYTHONPATH. On the upstream PM runtime that command cannot import Hermes, so every worker
 * exits at once and its card is given up — a board that silently never runs anything. The fix is one environment
 * variable on the gateway; this module turns the report into a warning and the command that sets it on that host.
 *
 * Pure functions (also goes into the browser bundle — does not pull in `@/db`).
 */
import type { PluginInfo, WorkerLaunchReason, WorkerLaunchReport } from "./deskrpg-plugin-types";

const REASONS: readonly WorkerLaunchReason[] = [
  "hermes_bin_unset",
  "hermes_bin_missing",
  "probe_failed",
];

/** Where the fix goes on a Linux host: a drop-in beside the unit `hermes gateway install` writes. */
export const WORKER_LAUNCH_DROP_IN =
  "~/.config/systemd/user/hermes-gateway.service.d/hermes-bin.conf";

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Folds `info.kanban.worker_launch`. **Distinguishes `undefined` from `null`** — old plugins lack the field
 * (`undefined`), a failed check is `null`; neither is turned into "fine".
 */
export function parseWorkerLaunchReport(value: unknown): WorkerLaunchReport | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const reason = REASONS.find((known) => known === r.reason) ?? null;
  return {
    ok: typeof r.ok === "boolean" ? r.ok : null,
    reason,
    hermes_bin: stringOrNull(r.hermes_bin),
    launcher: stringOrNull(r.launcher),
  };
}

export type WorkerLaunchWarning = {
  reason: "hermes_bin_unset" | "hermes_bin_missing";
  /** What `HERMES_BIN` should be. null when the plugin found no launcher to suggest. */
  launcher: string | null;
  /** The current, broken `HERMES_BIN` (only for `hermes_bin_missing`). */
  hermesBin: string | null;
};

/** The warning to show, or null when workers can start or it is unknown. */
export function workerLaunchWarning(info: PluginInfo | null): WorkerLaunchWarning | null {
  const report = info?.kanban.worker_launch;
  if (!report || report.ok !== false) return null;
  if (report.reason !== "hermes_bin_unset" && report.reason !== "hermes_bin_missing") return null;
  return { reason: report.reason, launcher: report.launcher, hermesBin: report.hermes_bin };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** systemd `Environment=` quoting: a double-quoted assignment with `\` and `"` escaped. */
function systemdQuote(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * One shell command for the gateway host (Linux, systemd user unit) that writes the drop-in and restarts the
 * gateway. null without a launcher to point at.
 */
export function workerLaunchFixCommand(launcher: string | null): string | null {
  if (!launcher) return null;
  const line = `Environment="HERMES_BIN=${systemdQuote(launcher)}"`;
  return [
    "mkdir -p ~/.config/systemd/user/hermes-gateway.service.d",
    `printf '[Service]\\n%s\\n' ${shellQuote(line)} > ${WORKER_LAUNCH_DROP_IN}`,
    "systemctl --user daemon-reload",
    "systemctl --user restart hermes-gateway",
  ].join(" && ");
}

/** The gateway host's OS, read from the launcher path the plugin reports (the report carries no OS field). */
export type WorkerLaunchHost = "linux" | "macos" | "windows";

export function workerLaunchHost(launcher: string): WorkerLaunchHost {
  if (/^[A-Za-z]:[\\/]/.test(launcher) || launcher.startsWith("\\\\")) return "windows";
  // macOS keeps every account home under /Users; Linux does not use that folder.
  if (launcher.startsWith("/Users/")) return "macos";
  return "linux";
}

export type WorkerLaunchFix = {
  host: WorkerLaunchHost;
  /** The file the fix writes, for the line above the command. */
  file: string;
  /** null where DeskRPG has no verified command for that host yet. */
  command: string | null;
};

/** Hermes's own env file on a macOS host (`<HERMES_HOME>/.env`). */
export const WORKER_LAUNCH_ENV_FILE_MACOS = "~/.hermes/.env";
export const WORKER_LAUNCH_ENV_FILE_WINDOWS = "%LOCALAPPDATA%\\hermes\\.env";

/**
 * The fix for one host OS.
 *
 * - Linux: the systemd drop-in above (the setup wizard writes the same file).
 * - macOS: Hermes rewrites its launchd plist from scratch whenever it differs from what it would generate
 *   (`refresh_launchd_plist_if_needed` on every `hermes gateway start|restart`), so a value put there is lost. The
 *   gateway loads `<HERMES_HOME>/.env` into its environment at start, and `hermes config set` writes an UPPER_SNAKE
 *   name there — so the launcher sets it and restarts the gateway. `--profile default` pins the root home that a
 *   DeskRPG gateway runs as, whatever profile the shell has selected.
 * - Windows: not verified yet, so only the file is named.
 */
export function workerLaunchFixFor(host: WorkerLaunchHost, launcher: string): WorkerLaunchFix {
  if (host === "linux") {
    return { host, file: WORKER_LAUNCH_DROP_IN, command: workerLaunchFixCommand(launcher) };
  }
  if (host === "macos") {
    const bin = shellQuote(launcher);
    return {
      host,
      file: WORKER_LAUNCH_ENV_FILE_MACOS,
      command: [
        `${bin} --profile default config set HERMES_BIN ${bin}`,
        `${bin} --profile default gateway restart`,
      ].join(" && "),
    };
  }
  return { host, file: WORKER_LAUNCH_ENV_FILE_WINDOWS, command: null };
}

/** The fix for the host the launcher path belongs to. null without a launcher to point at. */
export function workerLaunchFix(launcher: string | null): WorkerLaunchFix | null {
  return launcher ? workerLaunchFixFor(workerLaunchHost(launcher), launcher) : null;
}
