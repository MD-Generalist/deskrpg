import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { managedSsh } from "./ssh-hosts";
import { systemSsh, systemSshArgs } from "./system-ssh";
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
/**
 * SSH 로 닿아도 되는 호스트: 관리자가 화면에서 등록한 호스트(관리 SSH, 전용 키) + 운영자가 환경변수로
 * 승인한 서버 `~/.ssh/config` 별칭(예전 방식, 호환용).
 */
export function getSshHosts(): { id: string; label: string; kind?: "system" | "managed" }[] {
  const managed = [
    ...systemSsh()
      .list()
      .map((h) => ({ id: h.id, label: h.label, kind: "system" as const })),
    ...managedSsh()
      .list()
      .map((h) => ({ id: h.id, label: h.label, kind: "managed" as const })),
  ];
  const legacy = [
    ...new Set(
      (process.env.DESKRPG_SETUP_SSH_HOSTS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => ALIAS.test(s)),
    ),
  ]
    .filter((id) => !managed.some((h) => h.id === id))
    .map((id) => ({ id, label: id }));
  return [...managed, ...legacy];
}
/** 관리 호스트면 관리 ssh 설정(`-F`)을 가리킨다. 예전 별칭은 서버 ssh 설정을 그대로 쓴다. */
export function sshConfigArgs(hostId: string): string[] {
  return managedSsh().configArgs(hostId);
}
/**
 * 호스트 하나를 ssh 로 부르는 방법 — 앞 인자, 호스트 키 정책, 목적지.
 * - 시스템 호스트(Desktop 방식): 서버 사용자 설정 그대로 + `-p/-l/-i`, `accept-new`, 목적지는 별칭·호스트명.
 * - 전용 키 호스트: `-F <관리 설정>`, 지문 고정(`yes`), 목적지는 관리 별칭.
 * - 예전 환경변수 별칭: 서버 설정 그대로, `yes`.
 */
export function sshRoute(hostId: string): { args: string[]; options: string[]; dest: string } {
  const system = hostId.startsWith("s-") ? systemSsh().get(hostId) : undefined;
  if (system)
    return {
      args: systemSshArgs(system),
      options: sshOptions("accept-new"),
      dest: system.target,
    };
  return { args: sshConfigArgs(hostId), options: SSH_OPTIONS, dest: hostId };
}
export function sshOptions(hostKey: "yes" | "accept-new"): string[] {
  return SSH_OPTIONS.map((o) =>
    o === "StrictHostKeyChecking=yes" ? `StrictHostKeyChecking=${hostKey}` : o,
  );
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
    const route = sshRoute(hostId);
    const result = await execute(
      "ssh",
      [
        ...route.args,
        ...route.options,
        "-T",
        "--",
        route.dest,
        [command, ...args].map(quoteShellArg).join(" "),
      ],
      options,
    );
    // OpenSSH stderr may contain remote banners, paths or secrets. Never propagate it on transport failures.
    if (result.code === 255) throw new Error(sshFailureCode(result.stderr));
    return result;
  };
}

/** ssh 종료 코드 255 의 stderr → 안전한 오류 코드. stderr 원문은 배너·경로를 담을 수 있어 넘기지 않는다. */
export function sshFailureCode(stderr: string): string {
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(stderr))
    return "ssh_host_key_failed";
  // 호스트에는 닿았지만 키가 거절됐다 — 대개 공개키를 authorized_keys 에 아직 안 넣었다.
  // "연결 실패" 로 뭉치면 서버·포트를 의심하게 된다(2026-09-19 스테이징 실측).
  if (/Permission denied \(publickey/i.test(stderr)) return "ssh_auth_failed";
  return "ssh_connection_failed";
}
