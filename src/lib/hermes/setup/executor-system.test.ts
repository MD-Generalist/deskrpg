import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// 싱글턴이 이 임시 홈을 잡도록 import 전에 둔다(파일마다 프로세스가 따로다).
const home = mkdtempSync(path.join(os.tmpdir(), "deskrpg-exec-sys-"));
process.env.DESKRPG_HOME = home;
delete process.env.DESKRPG_SETUP_SSH_HOSTS;
test.after(() => rmSync(home, { recursive: true, force: true }));

test("시스템 호스트는 -F 없이 목적지를 별칭으로, 호스트 키는 accept-new 로 부른다", async () => {
  const { systemSsh } = await import("./system-ssh");
  const { getSshHosts, sshExecutor } = await import("./executor");
  const host = await systemSsh().add({ target: "my-server", user: "deploy" });
  assert.deepEqual(getSshHosts(), [{ id: host.id, label: "deploy@my-server", kind: "system" }]);
  let recorded: string[] = [];
  await sshExecutor(host.id, async (_command, args) => {
    recorded = args;
    return { stdout: "", stderr: "", code: 0 };
  })("true", []);
  assert.ok(!recorded.includes("-F"));
  assert.ok(recorded.includes("StrictHostKeyChecking=accept-new"));
  assert.ok(!recorded.includes("StrictHostKeyChecking=yes"));
  assert.deepEqual(recorded.slice(0, 2), ["-l", "deploy"]);
  assert.equal(recorded[recorded.indexOf("--") + 1], "my-server");
});

test("시스템 호스트의 키 거절은 ssh_auth_failed 로 올라간다", async () => {
  const { systemSsh } = await import("./system-ssh");
  const { sshExecutor } = await import("./executor");
  const host = await systemSsh().add({ target: "nas" });
  const run = sshExecutor(host.id, async () => ({
    stdout: "",
    stderr: "deploy@nas: Permission denied (publickey).",
    code: 255,
  }));
  await assert.rejects(run("true", []), /^Error: ssh_auth_failed$/);
});
