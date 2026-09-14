import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ChildProcess, SpawnOptions, spawn as nodeSpawn } from "node:child_process";

import { assertCaptureRuntimePath, createFixtureApi, runCaptureSession } from "./session";

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
