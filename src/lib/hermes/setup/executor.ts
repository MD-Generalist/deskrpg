import {
  spawn,
  execFileSync,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  type StdioOptions,
} from "node:child_process";
import { openSync, closeSync, readFileSync, writeFileSync, rmSync, fstatSync } from "node:fs";
import { chmodSync, mkdtempSync } from "node:fs";
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

/**
 * Windows ssh 갈래가 쓸 임시 stdin/stdout 파일을 담을 **전용 디렉터리**를 만들고, 아직 비어 있을 때
 * 권한을 좁힌다. 파일에는 게이트웨이·프로필 토큰이 평문으로 놓이므로, 파일이 생긴 뒤에 좁히면
 * 그 사이에 `%TEMP%` 에서 상속된 ACL(그룹 Modify 포함)로 노출된다.
 *
 * Windows: `icacls <dir> /inheritance:r /grant:r <user>:(OI)(CI)F`. **`(OI)(CI)` 를 명시해야
 * 이 안에 새로 만들어지는 파일이 이 ACL 을 상속한다** — icacls 는 디렉터리라고 해서 상속 플래그를
 * 기본으로 붙이지 않는다. 빼고 `<user>:F` 만 주면 디렉터리 자체는 좁혀지지만 그 안의 파일은
 * SYSTEM·BUILTIN\Administrators 를 상속받아 그룹에 노출된다(2026-09-20 WinServer 실측:
 * `:F` 는 파일에 SYSTEM·Administrators·S-1-5-5-*, `:(OI)(CI)F` 는 사용자 단독 inherited=True).
 * Node 의 `chmodSync` 는 Windows 에서 읽기 전용 속성만 건드려 무효라 쓰지 않는다.
 * 실패하면 던져서 작업을 중단한다(fail-closed) — 좁혀지지 않은 채로 토큰을 쓰지 않는다.
 */
export function secureStdioDir(
  platform: string,
  make: () => string = () => mkdtempSync(path.join(tmpdir(), "deskrpg-ssh-")),
  harden: (dir: string) => void = (dir) =>
    execFileSync(
      "icacls",
      [dir, "/inheritance:r", "/grant:r", `${userInfo().username}:(OI)(CI)F`],
      {
        stdio: "ignore",
      },
    ),
): string {
  const dir = make();
  try {
    if (isWindows(platform)) harden(dir);
    else chmodSync(dir, 0o700);
  } catch (error) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 정리 실패가 fail-closed 를 막으면 안 된다.
    }
    throw error;
  }
  return dir;
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
      let stdioDir: string | undefined;
      let stdinFile: string | undefined;
      let stdinFd: number | undefined;
      let stdoutFile: string | undefined;
      let stdoutFd: number | undefined;
      /**
       * 임시 파일 정리는 디렉터리째. 두 번 불려도 안전하고, 실패하면 `false` 를 돌려준다.
       * Windows 에서 자식이 아직 살아 `stdin.in`·`stdout.out` 핸들을 쥐고 있으면 삭제가
       * 공유 위반으로 실패하므로, 지워질 때까지 `stdioDir` 을 비우지 않고 재시도에 맡긴다.
       */
      const removeStdioDir = (): boolean => {
        if (!stdioDir) return true;
        try {
          rmSync(stdioDir, { recursive: true, force: true });
          stdioDir = undefined;
          return true;
        } catch {
          // 삭제 실패는 오류 경로를 바꾸지 않는다. 호출자가 kill 뒤 다시 시도한다.
          return false;
        }
      };

      if (useFileStdio) {
        try {
          // 토큰이 오가는 파일들이므로, 파일을 만들기 **전에** 빈 전용 디렉터리에 권한을 좁힌다.
          // 파일마다 좁히면 payload 를 쓴 뒤·자식이 쓰기 시작한 뒤에야 좁아져 틈이 남는다.
          stdioDir = secureStdioDir(process.platform);
          if (options.input) {
            stdinFile = path.join(stdioDir, "stdin.in");
            writeFileSync(stdinFile, options.input);
            stdinFd = openSync(stdinFile, "r");
          }
          stdoutFile = path.join(stdioDir, "stdout.out");
          stdoutFd = openSync(stdoutFile, "w");
        } catch {
          if (stdinFd !== undefined) closeSync(stdinFd);
          if (stdoutFd !== undefined) closeSync(stdoutFd);
          removeStdioDir();
          reject(new Error("command_failed"));
          return;
        }
      }

      // 파일 갈래에서는 stdin(파일 fd)·stdout(파일 fd)이 파이프가 아니라 `null` 이다.
      // `ChildProcessWithoutNullStreams` 로 캐스트하면 그 null 가능성이 타입에서 지워져
      // 검사가 역참조를 놓친다 — 이 작업에서 실제로 결함 하나를 그렇게 통과시켰다.
      let child: ChildProcess;
      try {
        if (useFileStdio && stdoutFd !== undefined) {
          const stdio: StdioOptions = [stdinFd !== undefined ? stdinFd : "pipe", stdoutFd, "pipe"];
          child = spawn(command, args, {
            stdio,
            shell: false,
            detached: process.platform !== "win32",
            ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
          });
        } else {
          child = spawnImpl(command, args, options.env);
        }
      } catch {
        if (stdinFd !== undefined) closeSync(stdinFd);
        if (stdoutFd !== undefined) closeSync(stdoutFd);
        removeStdioDir();
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
              // 앞선 오류(command_timeout 등)를 덮어쓰지 않는다 — 사용자가 보는 원인이 뒤바뀐다.
              if (!error && stat.size > 1024 * 1024) {
                error = "output_limit";
              }
              closeSync(stdoutFd);
              stdoutFd = undefined;
            }
            if (!error) {
              stdout = readFileSync(stdoutFile, "utf-8");
            }
          } catch {
            // 파일 읽기 실패해도 계속 진행
          }
        }
        if (useFileStdio && stdinFd !== undefined) {
          try {
            closeSync(stdinFd);
          } catch {
            // close 실패는 무시
          }
          stdinFd = undefined;
        }
        // finish() 는 단 하나의 종결 경로이고 아래 try/catch 가 동기 예외까지 여기로 모으므로,
        // 리스너 등록 순서와 무관하게 정리를 **시도**한다. 성공은 보장되지 않는다 — 자식이
        // 살아서 핸들을 쥐고 있으면 Windows 에서 삭제가 실패한다. 그래서 오류 경로에서는
        // 먼저 자식을 죽이고, 그 뒤에 지운다.
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
          // 자식이 죽는 데 시간이 걸리므로, 지금 실패하면 한 틱 뒤에 한 번 더 시도한다.
          // 남으면 게이트웨이·프로필 토큰이 실린 payload 가 %TEMP% 에 남는다.
          if (!removeStdioDir()) setTimeout(removeStdioDir, 0).unref();
          reject(new Error(error));
        } else {
          removeStdioDir();
          resolve({ stdout, stderr, code });
        }
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
      try {
        // useFileStdio이면 stdout은 파일로 가므로 리스너는 필요 없다
        if (!useFileStdio) {
          child.stdout?.on("data", (data) => collect(data, "stdout"));
        }
        child.stderr?.on("data", (data) => collect(data, "stderr"));
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
      } catch {
        // 리스너 등록 중 동기 예외가 나도 finish() 가 임시 디렉터리를 지운다.
        finish("command_failed");
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
