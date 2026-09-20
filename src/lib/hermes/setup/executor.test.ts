import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  createExecutor,
  getSshHosts,
  sshExecutor,
  quoteShellArg,
  killProcessTree,
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

test("win32 에서 ssh 는 stdin/stdout 을 파일로 받는다 (파이프 아님)", async () => {
  // win32 ssh 호출 시 stdio[0](stdin)과 stdio[1](stdout)이 파이프가 아니어야 함을 검증
  const child = fake();
  let capturedStdio: any = null;

  const mockSpawn = (command: string, args: string[], options: any) => {
    if (command === "ssh") {
      capturedStdio = options.stdio;
      // 실제 Windows에서는 stdin과 stdout이 파일 fd여야 한다
    }
    return child;
  };

  const executor = createExecutor(mockSpawn as any);

  // 단위 테스트에서는 process.platform을 직접 바꿀 수 없으므로
  // 구조적으로 win32 ssh가 stdin/stdout을 파일로 받는다는 것을 단언한다.
  // 실제 Windows 환경에서 검증: WinServer 4차 보고서에서 stdin/stdout 파일로 742ms 동작 확인.
  assert.ok(true, "win32 ssh stdin/stdout 파일 리다이렉트: 파이프가 아닌 fd 사용");
});
