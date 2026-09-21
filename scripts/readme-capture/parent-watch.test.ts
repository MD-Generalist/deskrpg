import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { processAlive, watchParent } from "./parent-watch";

test("processAlive treats only ESRCH as gone", () => {
  const throwing = (code: string) =>
    (() => {
      throw Object.assign(new Error(code), { code });
    }) as unknown as typeof process.kill;
  assert.equal(processAlive(1234, (() => true) as unknown as typeof process.kill), true);
  assert.equal(processAlive(1234, throwing("ESRCH")), false);
  assert.equal(processAlive(1234, throwing("EPERM")), true, "살아 있지만 신호 권한이 없는 경우");
});

test("watchParent reports a vanished parent exactly once", async () => {
  let alive = true;
  let calls = 0;
  const stop = watchParent(42, () => calls++, { intervalMs: 5, isAlive: () => alive });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 0);
  alive = false;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, 1);
  stop();
});

// 테스트 러너가 SIGKILL·Ctrl-C 로 끊기면 `t.after` 도 `finally` 도 돌지 않는다. 그때 캡처 서버가
// 스스로 끝나는지를 실제 런처로 본다 — 부모를 SIGKILL 해 정리 경로를 일부러 건너뛴다.
//
// 앱은 Next 대신 가만히 살아 있는 대역(`dev-server.ts`)이다. 감시는 런처가 앱을 불러오기 전에 켜지므로
// 이것으로 충분하고, 부하가 걸린 전체 실행에서 Next 부팅(수십 초)을 기다리지 않는다.
test(
  "the capture server stops itself when its parent is killed without cleanup",
  { timeout: 60_000 },
  async (t) => {
    const sourceRoot = path.resolve(import.meta.dirname, "../..");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-parent-watch-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const marker = path.join(root, "app-started");
    fs.writeFileSync(
      path.join(root, "dev-server.ts"),
      `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(marker)}, String(process.pid));\nsetInterval(() => {}, 1_000);\n`,
    );

    // 중간 부모: 런처를 띄우고 그 pid 를 알린 뒤 가만히 있는다. 이 프로세스를 SIGKILL 한다.
    const launcher = path.join(sourceRoot, "scripts/readme-capture/server-launcher.ts");
    const parentScript = `
      const { spawn } = require("node:child_process");
      const child = spawn(process.execPath, ["--import", "tsx", ${JSON.stringify(launcher)}], {
        cwd: ${JSON.stringify(sourceRoot)}, detached: true, stdio: "ignore",
        env: { PATH: process.env.PATH, DESKRPG_CAPTURE_MODE: "1",
          DESKRPG_PROJECT_ROOT: ${JSON.stringify(root)}, DESKRPG_CAPTURE_PARENT_PID: String(process.pid) },
      });
      child.unref();
      process.stdout.write(String(child.pid) + "\\n");
      setInterval(() => {}, 1000);
    `;
    const parent = spawn(process.execPath, ["-e", parentScript], {
      stdio: ["ignore", "pipe", "inherit"],
      env: { PATH: process.env.PATH, NODE_ENV: "test" },
    });
    // 이 테스트가 어떻게 끝나든 둘 다 남기지 않는다. 살아 있는 자식은 이 파일의 종료를 막아
    // 러너 전체를 멈춘다 — 고치려는 결함을 테스트가 다시 만들지 않게 한다.
    let launcherPid = 0;
    t.after(() => {
      parent.kill("SIGKILL");
      if (launcherPid)
        try {
          process.kill(-launcherPid, "SIGKILL");
        } catch {}
    });
    launcherPid = await new Promise<number>((resolve, reject) => {
      parent.stdout?.once("data", (chunk) => resolve(Number(String(chunk).trim())));
      parent.once("exit", () => reject(new Error("intermediate parent exited early")));
    });

    const started = Date.now() + 30_000;
    while (!fs.existsSync(marker) && Date.now() < started)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(fs.existsSync(marker), "launcher never loaded the app");

    parent.kill("SIGKILL");
    const gone = Date.now() + 15_000;
    while (processAlive(launcherPid) && Date.now() < gone)
      await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(processAlive(launcherPid), false, "런처가 부모 없이 살아남았다");
  },
);
