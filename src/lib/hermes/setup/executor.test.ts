import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createExecutor, getSshHosts, sshExecutor, quoteShellArg } from "./executor";
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
