import assert from "node:assert/strict";
import { spawn as spawnProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ChildProcess, SpawnOptions, spawn as nodeSpawn } from "node:child_process";

import {
  assertCaptureRuntimePath,
  createFixtureApi,
  runCaptureSession,
  terminateOwnedChild,
} from "./session";

function runningChild(): { child: ChildProcess; wasKilled(): boolean } {
  const child = new EventEmitter() as ChildProcess;
  let killed = false;
  Object.assign(child, {
    pid: 44001,
    exitCode: null,
    signalCode: null,
    kill() {
      killed = true;
      queueMicrotask(() => child.emit("exit", null, "SIGTERM"));
      return true;
    },
  });
  return { child, wasKilled: () => killed };
}

test("a failed health check terminates the DeskRPG child owned by the session", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-session-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fake = runningChild();
  let spawnOptions: SpawnOptions | undefined;
  const spawn = ((_command: string, _args: readonly string[], options: SpawnOptions) => {
    spawnOptions = options;
    return fake.child;
  }) as typeof nodeSpawn;
  const unhealthyFetch = async () => new Response("unhealthy", { status: 503 });

  await assert.rejects(
    () => runCaptureSession({ root, spawn, fetch: unhealthyFetch as typeof fetch }),
    /exited|health/i,
  );
  assert.equal(fake.wasKilled(), true);
  assert.equal(spawnOptions?.env?.DB_TYPE, "sqlite");
  assert.equal(
    spawnOptions?.env?.SQLITE_PATH,
    path.join(root, ".artifacts/readme-capture/runtime/data/db.sqlite"),
  );
  assert.equal(spawnOptions?.env?.DATABASE_URL, undefined);
  assert.equal(spawnOptions?.env?.PORT, "3310");
  assert.equal(spawnOptions?.env?.INTERNAL_PORT, "3311");
});

test("rejects runtime paths outside root/.artifacts/readme-capture", () => {
  assert.throws(
    () => assertCaptureRuntimePath("/repo", "/tmp/readme-capture/runtime"),
    /capture artifact/i,
  );
  assert.throws(
    () =>
      assertCaptureRuntimePath(
        path.parse(process.cwd()).root,
        "/.artifacts/readme-capture/runtime",
      ),
    /broad repository root/i,
  );
});

test("rejects a capture runtime that traverses a symlink", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-runtime-link-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const artifacts = path.join(root, ".artifacts");
  const outside = path.join(root, "outside");
  fs.mkdirSync(artifacts);
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(artifacts, "readme-capture"));

  assert.throws(
    () => assertCaptureRuntimePath(root, path.join(root, ".artifacts/readme-capture/runtime")),
    /symlink/i,
  );
});

test("rejects production app URLs", () => {
  assert.throws(() => createFixtureApi("https://deskrpg.com"), /loopback/i);
});

test("the local fixture client resumes an existing account and retains its auth cookie", async () => {
  const seen: Array<{ path: string; cookie: string | null }> = [];
  const request = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const headers = new Headers(init?.headers);
    seen.push({ path: url.pathname, cookie: headers.get("cookie") });
    if (url.pathname === "/api/auth/register") {
      return Response.json({ errorCode: "login_id_taken" }, { status: 409 });
    }
    if (url.pathname === "/api/auth/login") {
      return Response.json(
        { user: { id: "user-1", nickname: "Dante" } },
        { headers: { "Set-Cookie": "token=capture-cookie; Path=/; HttpOnly" } },
      );
    }
    return Response.json({ groups: [] });
  };
  const api = createFixtureApi("http://127.0.0.1:3310", request as typeof fetch);

  const registration = await api.request<{ existing: boolean }>("POST", "/api/auth/register", {
    loginId: "readme-capture",
    password: "readme-capture-local-only",
  });
  await api.request("GET", "/api/groups");

  assert.equal(registration.existing, true);
  assert.deepEqual(seen, [
    { path: "/api/auth/register", cookie: null },
    { path: "/api/auth/login", cookie: null },
    { path: "/api/groups", cookie: "token=capture-cookie" },
  ]);
});

test("refuses to start or mutate fixtures while the capture app port is occupied", async (t) => {
  const blocker = createServer();
  await new Promise<void>((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(3310, "127.0.0.1", resolve);
  });
  t.after(() => new Promise<void>((resolve) => blocker.close(() => resolve())));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-occupied-port-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let spawnCount = 0;
  let fetchCount = 0;

  await assert.rejects(
    () =>
      runCaptureSession({
        root,
        spawn: (() => {
          spawnCount += 1;
          return runningChild().child;
        }) as typeof nodeSpawn,
        fetch: (async () => {
          fetchCount += 1;
          return Response.json({});
        }) as typeof fetch,
      }),
    /exclusive|already in use/i,
  );
  assert.equal(spawnCount, 0);
  assert.equal(fetchCount, 0);
});

test("rejects a healthy response that does not identify the owned capture instance", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-instance-health-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fake = runningChild();
  const spawn = (() => fake.child) as typeof nodeSpawn;

  await assert.rejects(
    () =>
      runCaptureSession({
        root,
        spawn,
        fetch: (async () =>
          Response.json({
            instanceId: "some-other-server",
            listenerAddress: "127.0.0.1",
          })) as typeof fetch,
      }),
    /owned capture instance/i,
  );
  assert.equal(fake.wasKilled(), true);
});

test("SIGTERM cancels pending startup and cleans up the owned process group", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-signal-cleanup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const signals = new EventEmitter();
  const fake = runningChild();
  const spawn = (() => fake.child) as typeof nodeSpawn;
  const groupSignals: Array<{ pid: number; signal: NodeJS.Signals | number | undefined }> = [];
  const kill = ((pid: number, signal?: NodeJS.Signals | number) => {
    groupSignals.push({ pid, signal });
    queueMicrotask(() => fake.child.emit("exit", null, signal));
    return true;
  }) as typeof process.kill;
  const pendingFetch = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })) as typeof fetch;

  const session = runCaptureSession({
    root,
    spawn,
    fetch: pendingFetch,
    signals,
    kill,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  signals.emit("SIGTERM", "SIGTERM");

  await assert.rejects(() => session, /SIGTERM/i);
  assert.deepEqual(groupSignals, [{ pid: -44001, signal: "SIGTERM" }]);
});

test("terminates the whole owned process group instead of only the npm wrapper", async () => {
  const fake = runningChild();
  const killed: number[] = [];
  const kill = ((pid: number, signal?: NodeJS.Signals | number) => {
    killed.push(pid);
    queueMicrotask(() => fake.child.emit("exit", null, signal));
    return true;
  }) as typeof process.kill;

  await terminateOwnedChild(fake.child, kill);

  assert.deepEqual(killed, [-44001]);
  assert.equal(fake.wasKilled(), false);
});

test("the real capture server ignores repository env files and listens on IPv4 loopback", async (t) => {
  const root = path.resolve(import.meta.dirname, "../..");
  const sentinelPath = path.join(root, ".env.development.local");
  assert.equal(fs.existsSync(sentinelPath), false, "test must not overwrite an existing env file");
  fs.writeFileSync(sentinelPath, "README_CAPTURE_ENV_SENTINEL=restored-from-repository\n");
  t.after(() => fs.rmSync(sentinelPath, { force: true }));

  const portProbe = createServer();
  await new Promise<void>((resolve, reject) => {
    portProbe.once("error", reject);
    portProbe.listen(0, "127.0.0.1", resolve);
  });
  const address = portProbe.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve) => portProbe.close(() => resolve()));

  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-real-listener-"));
  t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));
  const instanceId = "real-listener-sentinel-test";
  const child = spawnProcess(
    process.execPath,
    ["--import", "tsx", path.join(root, "scripts/readme-capture/server-launcher.ts")],
    {
      cwd: root,
      detached: true,
      stdio: "ignore",
      env: {
        PATH: process.env.PATH,
        HOME: runtime,
        NODE_ENV: "development",
        DB_TYPE: "sqlite",
        SQLITE_PATH: path.join(runtime, "db.sqlite"),
        JWT_SECRET: "readme-capture-listener-test-secret",
        PORT: String(port),
        DESKRPG_CAPTURE_MODE: "1",
        DESKRPG_CAPTURE_INSTANCE_ID: instanceId,
        DESKRPG_PROJECT_ROOT: root,
      },
    },
  );
  t.after(async () => {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
    }
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", () => resolve());
      setTimeout(resolve, 2_000).unref();
    });
  });

  let health: Response | null = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      health = await fetch(`http://127.0.0.1:${port}/__readme-capture/health`);
      if (health.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(health?.ok, "capture server did not expose its health sentinel");
  assert.deepEqual(await health.json(), {
    instanceId,
    listenerAddress: "127.0.0.1",
    repositoryEnvLoaded: false,
  });
});
