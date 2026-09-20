import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  createExecutor,
  getSshHosts,
  sshExecutor,
  quoteShellArg,
  killProcessTree,
  secureStdioDir,
} from "./executor";
function fake() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killed: false,
    kill() {
      this.killed = true;
      return true;
    },
  });
  return child as unknown as ChildProcessWithoutNullStreams;
}
test("SSH aliases must be explicitly opted in and arguments remain one quoted command", async () => {
  process.env.DESKRPG_SETUP_SSH_HOSTS = "test-host, -oProxyCommand=bad, test-host";
  assert.deepEqual(getSshHosts(), [{ id: "test-host", label: "test-host" }]);
  assert.throws(() => sshExecutor("unknown"), /ssh_unknown_host/);
  assert.throws(() => sshExecutor("-oProxyCommand=bad"), /ssh_unknown_host/);
  let recorded: string[] = [];
  const executor = sshExecutor("test-host", async (command, args) => {
    assert.equal(command, "ssh");
    recorded = args;
    return { stdout: "", stderr: "", code: 0 };
  });
  await executor("python3", ["-c", "print('safe'); $(touch /tmp/no)"]);
  assert.ok(recorded.includes("StrictHostKeyChecking=yes"));
  assert.ok(recorded.includes("BatchMode=yes"));
  assert.equal(
    recorded.at(-1),
    ["python3", "-c", "print('safe'); $(touch /tmp/no)"].map(quoteShellArg).join(" "),
  );
  await assert.rejects(executor("python3;evil", []), /setup_invalid_request/);
});
test("SSH identity failures redact raw stderr", async () => {
  process.env.DESKRPG_SETUP_SSH_HOSTS = "test-host";
  const executor = sshExecutor("test-host", async () => ({
    stdout: "",
    stderr: "SECRET Host key verification failed",
    code: 255,
  }));
  await assert.rejects(
    executor("true", []),
    (error) =>
      error instanceof Error &&
      /ssh_host_key_failed/.test(error.message) &&
      !error.message.includes("SECRET"),
  );
});
test("키가 거절되면 연결 실패가 아니라 인증 실패로 알린다 — stderr 는 싣지 않는다", async () => {
  process.env.DESKRPG_SETUP_SSH_HOSTS = "test-host";
  const executor = sshExecutor("test-host", async () => ({
    stdout: "",
    stderr: "SECRET dante@host.docker.internal: Permission denied (publickey).",
    code: 255,
  }));
  await assert.rejects(
    executor("true", []),
    (error) =>
      error instanceof Error &&
      error.message === "ssh_auth_failed" &&
      !error.message.includes("SECRET"),
  );
});
test("bounded subprocess timeouts and cancellation stop owned process", async () => {
  const child = fake();
  await assert.rejects(
    createExecutor(() => child)("python3", [], { timeoutMs: 5 }),
    /command_timeout/,
  );
  assert.ok(child.killed);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    createExecutor(() => {
      throw new Error("must not spawn");
    })("python3", [], { signal: cancelled.signal }),
    /setup_cancelled/,
  );
});
test("oversized output is rejected and normal output stays internal", async () => {
  const child = fake();
  const result = createExecutor(() => child)("python3", []);
  child.stdout.emit("data", Buffer.alloc(1024 * 1024 + 1));
  await assert.rejects(result, /output_limit/);
  assert.ok(child.killed);
  const other = fake();
  const normal = createExecutor(() => other)("python3", [], { input: "private" });
  other.stdout.emit("data", Buffer.from("answer"));
  other.emit("close", 0);
  assert.deepEqual(await normal, { stdout: "answer", stderr: "", code: 0 });
});

test("win32는 taskkill로 트리를 끊는다", () => {
  const runs: [string, string[]][] = [];
  killProcessTree(
    4242,
    "win32",
    () => assert.fail("직계만 죽이면 안 된다"),
    (c: string, a: string[]) => runs.push([c, a]),
  );
  assert.deepEqual(runs, [["taskkill", ["/PID", "4242", "/T", "/F"]]]);
});

test("win32에서 taskkill이 실패하면 직계라도 죽인다", () => {
  const killed: number[] = [];
  killProcessTree(
    7,
    "win32",
    (pid: number) => killed.push(pid),
    () => {
      throw new Error("taskkill missing");
    },
  );
  assert.deepEqual(killed, [7]);
});

test("비 win32는 프로세스 그룹을 죽인다", () => {
  const killed: [number, string][] = [];
  killProcessTree(
    9,
    "linux",
    (pid: number, signal: string) => killed.push([pid, signal]),
    () => assert.fail("taskkill을 쓰면 안 된다"),
  );
  assert.deepEqual(killed, [[-9, "SIGKILL"]]);
});

test("executor 소스: win32 ssh 는 stdin/stdout 을 파일 fd 로 받고, 타입이 null 을 숨기지 않는다", () => {
  // process.platform 을 바꿀 수 없어 이 갈래는 macOS 에서 실행되지 않는다. 구조로 고정한다.
  // 실기 동작은 WinServer 에서 확인했다(stdin/stdout 파일, SSH discover 849ms).
  const source = readFileSync(new URL("./executor.ts", import.meta.url), "utf-8");
  assert.match(
    source,
    /const stdio: StdioOptions = \[\s*stdinFd !== undefined \? stdinFd : "pipe",\s*stdoutFd,/,
    "파일 갈래의 stdio 는 파이프가 아니라 파일 fd 여야 한다",
  );
  // 캐스트로 null 가능성을 지우면 타입 검사가 역참조를 놓친다 — 실제로 결함 하나가 그렇게 통과했다.
  assert.equal(
    source.includes("as ChildProcessWithoutNullStreams"),
    false,
    "spawn 결과를 non-null 스트림 타입으로 캐스트하면 안 된다",
  );
  assert.match(source, /let child: ChildProcess;/);
  assert.match(source, /child\.stdout\?\.on\(/, "stdout 은 null 일 수 있다");
  assert.match(source, /child\.stderr\?\.on\(/, "stderr 은 null 일 수 있다");
});

// --- 임시 stdio 는 파일 단위가 아니라 전용 디렉터리 단위로 보호한다 ---

test("secureStdioDir: win32 는 빈 디렉터리에 ACL 을 한 번 건다", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "deskrpg-acl-test-"));
  const calls: string[] = [];
  const result = secureStdioDir(
    "win32",
    () => dir,
    (d) => {
      calls.push(d);
      // 권한을 좁히는 시점에 디렉터리는 비어 있어야 한다 — 토큰 파일이 먼저 생기면 안 된다.
      assert.deepEqual(readdirSync(d), []);
    },
  );
  assert.equal(result, dir);
  assert.deepEqual(calls, [dir], "디렉터리에 정확히 한 번");
  rmSync(dir, { recursive: true, force: true });
});

test("secureStdioDir: ACL 실패는 fail-closed — 던지고 디렉터리를 남기지 않는다", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "deskrpg-acl-fail-"));
  assert.throws(() =>
    secureStdioDir(
      "win32",
      () => dir,
      () => {
        throw new Error("icacls_failed");
      },
    ),
  );
  assert.equal(existsSync(dir), false, "실패하면 디렉터리를 지운다");
});

test("secureStdioDir: posix 는 icacls 를 부르지 않고 0700 으로 좁힌다", () => {
  let hardened = false;
  const dir = secureStdioDir(
    "linux",
    () => mkdtempSync(path.join(os.tmpdir(), "deskrpg-acl-posix-")),
    () => {
      hardened = true;
    },
  );
  assert.equal(hardened, false);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  rmSync(dir, { recursive: true, force: true });
});

test("executor 소스: 파일 단위 icacls 도, 파일 단위 삭제도 남아 있지 않다", () => {
  const source = readFileSync(new URL("./executor.ts", import.meta.url), "utf-8");
  const icacls = source.match(/execFileSync\(\s*"icacls",\s*\[[^\]]*\]/g) ?? [];
  assert.equal(icacls.length, 1, "icacls 호출은 디렉터리용 하나뿐이어야 한다");
  assert.match(icacls[0], /\[dir,/, "icacls 대상은 디렉터리여야 한다");
  // (OI)(CI) 가 없으면 디렉터리만 좁혀지고 그 안의 토큰 파일은 SYSTEM·Administrators 를 상속받는다.
  assert.match(icacls[0], /:\(OI\)\(CI\)F/, "파일로 상속되려면 (OI)(CI) 를 명시해야 한다");
  assert.ok(
    !/stdinFile|stdoutFile/.test(icacls[0]),
    "stdin/stdout 파일에 직접 icacls 를 걸면 안 된다",
  );
  assert.equal(source.includes("unlinkSync"), false, "파일 단위 삭제가 남아 있으면 안 된다");
});

test("executor 소스: 정리는 removeStdioDir 로 디렉터리째 한 번만 한다", () => {
  const source = readFileSync(new URL("./executor.ts", import.meta.url), "utf-8");
  const body = source.slice(source.indexOf("export function createExecutor"));
  const removals = body.match(/rmSync\(/g) ?? [];
  assert.equal(removals.length, 1, "createExecutor 안의 rmSync 는 removeStdioDir 하나뿐");
  assert.match(
    body,
    /const removeStdioDir = \(\): boolean => \{[\s\S]*?rmSync\(stdioDir, \{ recursive: true, force: true \}\)/,
  );
  // finish() 가 유일한 종결 경로이고, 그 안에서 지운다 — 리스너 등록 순서와 무관하다.
  const finish = body.slice(body.indexOf("const finish ="), body.indexOf("const abort ="));
  assert.ok(finish.includes("removeStdioDir()"), "finish() 안에서 정리해야 한다");
});

test("executor 소스: 오류 경로는 자식을 죽인 뒤에 임시 파일을 지운다", () => {
  // 타임아웃·취소·output_limit 에서는 ssh.exe 가 살아서 stdin.in·stdout.out 핸들을 쥐고 있다.
  // 먼저 지우려 들면 Windows 에서 공유 위반으로 실패하고, 토큰이 실린 payload 가 %TEMP% 에 남는다.
  const source = readFileSync(new URL("./executor.ts", import.meta.url), "utf-8");
  const body = source.slice(source.indexOf("export function createExecutor"));
  const finish = body.slice(body.indexOf("const finish ="), body.indexOf("const abort ="));
  const errorBranch = finish.slice(finish.indexOf("if (error) {"));
  const kill = errorBranch.indexOf("killProcessTree(");
  const cleanup = errorBranch.indexOf("removeStdioDir()");
  assert.ok(kill >= 0 && cleanup >= 0, "오류 경로에 kill 과 정리가 둘 다 있어야 한다");
  assert.ok(kill < cleanup, "정리는 killProcessTree 뒤여야 한다");
  assert.ok(cleanup < errorBranch.indexOf("reject("), "정리는 reject 전에 시도해야 한다");
  // 자식이 죽는 데 시간이 걸리므로 첫 시도가 실패하면 한 틱 뒤에 다시 시도한다.
  assert.match(
    errorBranch,
    /if \(!removeStdioDir\(\)\) setTimeout\(removeStdioDir, 0\)\.unref\(\)/,
  );
  // 성공 경로는 자식이 이미 죽어 있으므로 그대로 한 번만 지운다.
  const successBranch = finish.slice(finish.indexOf("} else {"));
  assert.match(successBranch, /removeStdioDir\(\);\s*resolve\(/);
});
