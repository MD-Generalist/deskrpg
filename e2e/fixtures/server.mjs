import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 개인 환경·DB·게이트웨이를 상속하지 않는 단명 서버. CI와 로컬이 같은 경로를 쓴다.
for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  if (existsSync(name))
    throw new Error(`Isolated fixture server refuses repository ${name}; use a clean worktree`);
}
const directory = mkdtempSync(join(tmpdir(), "deskrpg-game-fixtures-"));
const child = spawn(process.execPath, ["--import", "tsx", "server.js"], {
  stdio: "inherit",
  env: {
    PATH: process.env.PATH ?? "",
    HOME: directory,
    TMPDIR: tmpdir(),
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: process.env.DESKRPG_FIXTURE_PORT ?? "13104",
    DB_TYPE: "sqlite",
    SQLITE_PATH: join(directory, "fixture.db"),
    DESKRPG_HOME: directory,
    JWT_SECRET: "deskrpg-e2e-synthetic-secret-not-for-production",
    INTERNAL_RPC_SECRET: "deskrpg-e2e-synthetic-internal-secret",
    NEXT_TELEMETRY_DISABLED: "1",
    COOKIE_SECURE: "false",
  },
});
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    timer.unref();
  });
}
child.on("exit", (code) => {
  rmSync(directory, { recursive: true, force: true });
  process.exit(stopping ? 0 : (code ?? 1));
});
child.on("error", (error) => {
  rmSync(directory, { recursive: true, force: true });
  console.error(error.message);
  process.exit(1);
});
