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
  persistFixture,
  captureStages,
} from "./session";

test("capture development selects record only while the default retains all stages", () => {
  assert.deepEqual(captureStages(false), ["record", "media", "verify"]);
  assert.deepEqual(captureStages(true), ["record"]);
});

test("fixture manifest is atomically replaced before capture and has private permissions", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-manifest-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = {
    loginId: "capture",
    password: "local",
    characterName: "Dante",
    channelId: "one",
    reportCardId: "card-one",
    npcNames: ["Sophie", "Noah"] as ["Sophie", "Noah"],
    profileNames: ["sophie", "noah"] as ["sophie", "noah"],
  };
  const target = persistFixture(root, fixture);
  persistFixture(root, { ...fixture, channelId: "two" });
  assert.equal(JSON.parse(fs.readFileSync(target, "utf8")).channelId, "two");
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ["fixture.json"]);
});

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

for (const component of ["data", "data/db.sqlite"]) {
  for (const dangling of [false, true]) {
    test(`rejects ${dangling ? "dangling" : "existing"} ${component} symlink before any startup side effects`, async (t) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-database-link-"));
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      const runtime = path.join(root, ".artifacts/readme-capture/runtime");
      const link = path.join(runtime, component);
      const target = path.join(root, "outside", component);
      fs.mkdirSync(path.dirname(link), { recursive: true });
      if (!dangling) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (component === "data") fs.mkdirSync(target);
        else fs.writeFileSync(target, "untouched");
      }
      fs.symlinkSync(target, link);
      let spawned = 0;
      let requested = 0;
      await assert.rejects(
        () =>
          runCaptureSession({
            root,
            spawn: (() => {
              spawned += 1;
              return runningChild().child;
            }) as typeof nodeSpawn,
            fetch: (async () => {
              requested += 1;
              return Response.json({});
            }) as typeof fetch,
          }),
        /symlink/i,
      );
      assert.equal(spawned, 0);
      assert.equal(requested, 0);
      if (dangling) assert.equal(fs.existsSync(target), false);
      else if (component === "data") assert.deepEqual(fs.readdirSync(target), []);
      else assert.equal(fs.readFileSync(target, "utf8"), "untouched");
    });
  }
}

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
  const sourceRoot = path.resolve(import.meta.dirname, "../..");
  const testArtifacts = path.join(sourceRoot, ".artifacts/readme-capture");
  fs.mkdirSync(testArtifacts, { recursive: true });
  const root = fs.mkdtempSync(path.join(testArtifacts, "env-project-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Copy the actual entry/config and reference read-only source/dependencies. All env files
  // and Next build output belong to this test, regardless of the developer's local env files.
  for (const file of ["dev-server.ts", "package.json", "tsconfig.json"])
    fs.copyFileSync(path.join(sourceRoot, file), path.join(root, file));
  for (const dir of ["src", "node_modules"])
    fs.symlinkSync(path.join(sourceRoot, dir), path.join(root, dir));
  fs.writeFileSync(
    path.join(root, "next.config.js"),
    `module.exports = { turbopack: { root: ${JSON.stringify(sourceRoot)} } };\n`,
  );
  const sentinelPath = path.join(root, ".env.development.local");
  fs.writeFileSync(sentinelPath, "README_CAPTURE_ENV_SENTINEL=restored-from-repository\n");

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
    ["--import", "tsx", path.join(sourceRoot, "scripts/readme-capture/server-launcher.ts")],
    {
      cwd: root,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
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
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    output += String(chunk);
  });
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
  assert.ok(health?.ok, `capture server did not expose its health sentinel: ${output}`);
  assert.deepEqual(await health.json(), {
    instanceId,
    listenerAddress: "127.0.0.1",
    repositoryEnvLoaded: false,
  });
});
