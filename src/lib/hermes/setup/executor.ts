import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { openSync, closeSync, readFileSync, writeFileSync, unlinkSync, fstatSync } from "node:fs";
import { chmodSync } from "node:fs";
import path from "node:path";
import { tmpdir, userInfo } from "node:os";
import { managedSsh } from "./ssh-hosts";
import { systemSsh, systemSshArgs } from "./system-ssh";
import { isWindows } from "./platform";
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

/**
 * 자식과 그 손자까지 끊는다. 설치 스크립트는 자식을 더 낳으므로 직계만 죽이면 남는다.
 *
 * POSIX 는 프로세스 그룹(`spawn` 이 `detached: true` 로 만든다)을 통째로 죽인다.
 * Windows 는 프로세스 그룹 신호가 없어 `taskkill /T` 로 트리를 끊는다. 정리 실패가 오류 경로를
 * 바꾸면 안 되므로 taskkill 이 없거나 실패하면 직계라도 죽이고 넘어간다.
 */
export function killProcessTree(
  pid: number,
  platform: string,
  kill: (pid: number, signal: string) => void,
  run: (command: string, args: string[]) => void,
): void {
  if (isWindows(platform)) {
    try {
      run("taskkill", ["/PID", String(pid), "/T", "/F"]);
    } catch {
      try {
        kill(pid, "SIGKILL");
      } catch {
        // 이미 죽었다.
      }
    }
    return;
  }
  kill(-pid, "SIGKILL");
}

export type SpawnCommand = (
  command: string,
  args: string[],
  /** 부모 환경에 얹을 값. argv 에 실을 수 없는 페이로드(Windows PowerShell 런처)를 위해서만 쓴다. */
  env?: Record<string, string>,
) => ChildProcessWithoutNullStreams;
const spawnCommand: SpawnCommand = (command, args, env) =>
  spawn(command, args, {
    stdio: "pipe",
    shell: false,
    detached: process.platform !== "win32",
    // 넘길 게 없으면 필드 자체를 생략한다 — node 의 기본 동작(부모 환경 상속)을 그대로 둔다.
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
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
      // Windows ssh 는 stdout/stdin 파이프에서 멈추므로, 대신 임시 파일로 받는다.
      const useFileStdio = isWindows(process.platform) && command === "ssh";
      let stdinFile: string | undefined;
      let stdinFd: number | undefined;
      let stdoutFile: string | undefined;
      let stdoutFd: number | undefined;

      if (useFileStdio) {
        try {
          const pid = process.pid;
          const timestamp = Date.now();
          const random = Math.random().toString(36).slice(2, 8);
          const baseName = `deskrpg-${pid}-${timestamp}-${random}`;

          // stdin 파일
          if (options.input) {
            stdinFile = path.join(tmpdir(), `${baseName}-stdin.in`);
            writeFileSync(stdinFile, options.input);
            // 토큰이 담길 수 있으므로 권한을 좁힌다
            if (isWindows(process.platform)) {
              // Windows: icacls로 명시적 ACL 설정 (chmod는 Windows에서 무효)
              const username = userInfo().username;
              execFileSync("icacls", [stdinFile, "/inheritance:r", `/grant:r`, `${username}:F`], {
                stdio: "ignore",
              });
            } else {
              // POSIX: chmod 사용
              chmodSync(stdinFile, 0o600);
            }
            stdinFd = openSync(stdinFile, "r");
          }

          // stdout 파일
          stdoutFile = path.join(tmpdir(), `${baseName}-stdout.out`);
          stdoutFd = openSync(stdoutFile, "w");
        } catch {
          if (stdinFd !== undefined) closeSync(stdinFd);
          if (stdoutFd !== undefined) closeSync(stdoutFd);
          if (stdinFile) {
            try {
              unlinkSync(stdinFile);
            } catch {}
          }
          if (stdoutFile) {
            try {
              unlinkSync(stdoutFile);
            } catch {}
          }
          reject(new Error("command_failed"));
          return;
        }
      }

      let child: ChildProcessWithoutNullStreams;
      try {
        if (useFileStdio && stdoutFd !== undefined) {
          const stdio: any = [stdinFd !== undefined ? stdinFd : "pipe", stdoutFd, "pipe"];
          child = spawn(command, args, {
            stdio: stdio,
            shell: false,
            detached: process.platform !== "win32",
            ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
          }) as ChildProcessWithoutNullStreams;
        } else {
          child = spawnImpl(command, args, options.env);
        }
      } catch {
        if (stdinFd !== undefined) closeSync(stdinFd);
        if (stdoutFd !== undefined) closeSync(stdoutFd);
        if (stdinFile) {
          try {
            unlinkSync(stdinFile);
          } catch {}
        }
        if (stdoutFile) {
          try {
            unlinkSync(stdoutFile);
          } catch {}
        }
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

        // 파일에서 stdout 읽기
        if (useFileStdio && stdoutFile) {
          try {
            if (stdoutFd !== undefined) {
              // 파일 크기 상한 검사 (output_limit과 일치)
              const stat = fstatSync(stdoutFd);
              if (stat.size > 1024 * 1024) {
                error = "output_limit";
              }
              closeSync(stdoutFd);
              stdoutFd = undefined;
            }
            if (!error) {
              const content = readFileSync(stdoutFile, "utf-8");
              stdout = content;
            }
          } catch {
            // 파일 읽기 실패해도 계속 진행
          } finally {
            try {
              unlinkSync(stdoutFile);
            } catch {
              // 삭제 실패는 무시
            }
          }
        }

        // stdin 파일 정리
        if (useFileStdio && stdinFile) {
          try {
            if (stdinFd !== undefined) {
              closeSync(stdinFd);
              stdinFd = undefined;
            }
          } catch {
            // close 실패는 무시
          } finally {
            try {
              unlinkSync(stdinFile);
            } catch {
              // 삭제 실패는 무시
            }
          }
        }

        if (error) {
          // Include helper-owned installers, not just their parent Python process.
          try {
            if (child.pid)
              killProcessTree(
                child.pid,
                process.platform,
                (pid, signal) => process.kill(pid, signal as NodeJS.Signals),
                (command, args) => execFileSync(command, args, { stdio: "ignore" }),
              );
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
      // useFileStdio이면 stdout은 파일로 가므로 리스너는 필요 없다
      if (!useFileStdio) {
        child.stdout.on("data", (data) => collect(data, "stdout"));
      }
      child.stderr.on("data", (data) => collect(data, "stderr"));
      child.on("error", () => finish("command_failed"));
      child.on("close", (code) => finish(undefined, code ?? 1));
      // stdin이 파일 fd면 Node는 child.stdin을 null로 둔다
      if (child.stdin) {
        child.stdin.on("error", () => {
          /* early exit is handled by close */
        });
      }
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      // stdin이 파일이면 이미 파일에서 읽으므로 end() 호출 안 함
      if (child.stdin) {
        if (useFileStdio && stdinFd !== undefined) {
          child.stdin.end();
        } else {
          child.stdin.end(options.input);
        }
      }
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
