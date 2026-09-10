import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { HostExecutor } from "./types";

export const SSH_OPTIONS = [
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=yes",
  "-o",
  "ConnectTimeout=10",
  "-o",
  "ServerAliveInterval=15",
  "-o",
  "ServerAliveCountMax=2",
  "-o",
  "ControlMaster=no",
  "-o",
  "ControlPath=none",
];
const ALIAS = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
export function getSshHosts(): { id: string; label: string }[] {
  return [
    ...new Set(
      (process.env.DESKRPG_SETUP_SSH_HOSTS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => ALIAS.test(s)),
    ),
  ].map((id) => ({ id, label: id }));
}
export function assertSshHost(hostId: string) {
  if (!ALIAS.test(hostId) || !getSshHosts().some((h) => h.id === hostId))
    throw new Error("ssh_unknown_host");
}
export function quoteShellArg(value: string) {
  if (value.includes("\0")) throw new Error("setup_invalid_request");
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
export type SpawnCommand = (command: string, args: string[]) => ChildProcessWithoutNullStreams;
const spawnCommand: SpawnCommand = (command, args) =>
  spawn(command, args, { stdio: "pipe", shell: false, detached: process.platform !== "win32" });
/** Only server-authored commands may reach this adapter. Input carries helper payloads/secrets outside argv. */
export function createExecutor(spawnImpl: SpawnCommand = spawnCommand): HostExecutor {
  return async (command, args, options = {}) => {
    if (
      !/^[A-Za-z0-9_./-]+$/.test(command) ||
      command.startsWith("-") ||
      args.some((a) => a.includes("\0"))
    )
      throw new Error("setup_invalid_request");
    if (options.signal?.aborted) throw new Error("setup_cancelled");
    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawnImpl(command, args);
      } catch {
        reject(new Error("command_failed"));
        return;
      }
      let stdout = "",
        stderr = "",
        bytes = 0,
        settled = false;
      const finish = (error?: string, code = 1) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        if (error) {
          // Include helper-owned installers, not just their parent Python process.
          try {
            if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
            else child.kill("SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
          reject(new Error(error));
        } else resolve({ stdout, stderr, code });
      };
      const abort = () => finish("setup_cancelled");
      const timer = setTimeout(
        () => finish("command_timeout"),
        Math.max(1, Math.min(options.timeoutMs ?? 30_000, 600_000)),
      );
      const collect = (value: Buffer, stream: "stdout" | "stderr") => {
        bytes += value.length;
        if (bytes > 1024 * 1024) {
          finish("output_limit");
          return;
        }
        if (stream === "stdout") stdout += value.toString();
        else stderr += value.toString();
      };
      child.stdout.on("data", (data) => collect(data, "stdout"));
      child.stderr.on("data", (data) => collect(data, "stderr"));
      child.on("error", () => finish("command_failed"));
      child.on("close", (code) => finish(undefined, code ?? 1));
      child.stdin.on("error", () => {
        /* early exit is handled by close */
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      child.stdin.end(options.input);
    });
  };
}
export const localExecutor = createExecutor();
export function sshExecutor(hostId: string, execute: HostExecutor = localExecutor): HostExecutor {
  assertSshHost(hostId);
  return async (command, args, options) => {
    assertSshHost(hostId);
    if (!/^[A-Za-z0-9_./-]+$/.test(command) || command.startsWith("-"))
      throw new Error("setup_invalid_request");
    const result = await execute(
      "ssh",
      [...SSH_OPTIONS, "-T", "--", hostId, [command, ...args].map(quoteShellArg).join(" ")],
      options,
    );
    // OpenSSH stderr may contain remote banners, paths or secrets. Never propagate it on transport failures.
    if (result.code === 255)
      throw new Error(
        /REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(result.stderr)
          ? "ssh_host_key_failed"
          : "ssh_connection_failed",
      );
    return result;
  };
}
