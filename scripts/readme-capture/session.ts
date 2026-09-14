import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { prepareFixture, type FixtureApi } from "./fixture";
import { startMockHermes } from "./mock-hermes";

export type SessionDeps = {
  spawn: typeof import("node:child_process").spawn;
  fetch: typeof globalThis.fetch;
  root: string;
};

const APP_URL = "http://127.0.0.1:3310";
const CAPTURE_ARTIFACT_DIR = ".artifacts/readme-capture";

function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      (host === "localhost" || host === "::1" || (isIP(host) === 4 && host.startsWith("127.")))
    );
  } catch {
    return false;
  }
}

export function assertCaptureRuntimePath(root: string, runtimePath: string): void {
  const resolvedRoot = path.resolve(root);
  if (resolvedRoot === path.parse(resolvedRoot).root) {
    throw new Error("Capture session refuses a broad repository root");
  }
  const captureRoot = path.join(resolvedRoot, CAPTURE_ARTIFACT_DIR);
  const resolvedRuntime = path.resolve(runtimePath);
  const relative = path.relative(captureRoot, resolvedRuntime);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Runtime must be below the repository capture artifact directory");
  }

  let candidate = resolvedRoot;
  for (const segment of path.relative(resolvedRoot, resolvedRuntime).split(path.sep)) {
    candidate = path.join(candidate, segment);
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
      throw new Error("Capture runtime must not traverse a symlink");
    }
  }

  let existing = resolvedRuntime;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const realRoot = fs.realpathSync(resolvedRoot);
  const realExisting = fs.realpathSync(existing);
  const realRelative = path.relative(realRoot, realExisting);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error("Runtime capture artifact path resolves outside the repository");
  }
}

function captureCookie(headers: Headers): string | null {
  const values =
    "getSetCookie" in headers && typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie")].filter((value): value is string => Boolean(value));
  const cookie = values[0]?.split(";", 1)[0]?.trim();
  return cookie || null;
}

export function createFixtureApi(
  appBaseUrl: string,
  request: typeof globalThis.fetch = globalThis.fetch,
): FixtureApi {
  if (!isLoopbackUrl(appBaseUrl)) {
    throw new Error("DeskRPG capture app URL must use a loopback host");
  }
  const baseUrl = new URL(appBaseUrl);
  let cookie: string | null = null;

  const send = async (
    method: "GET" | "POST" | "PUT",
    requestPath: string,
    body?: unknown,
  ): Promise<{ response: Response; data: unknown }> => {
    const url = new URL(requestPath, baseUrl);
    if (url.origin !== baseUrl.origin)
      throw new Error("Fixture requests must stay on the local app");
    const response = await request(url, {
      method,
      redirect: "error",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const nextCookie = captureCookie(response.headers);
    if (nextCookie) cookie = nextCookie;
    const data = await response.json().catch(() => null);
    return { response, data };
  };

  return {
    async request<T>(
      method: "GET" | "POST" | "PUT",
      requestPath: string,
      body?: unknown,
    ): Promise<T> {
      const result = await send(method, requestPath, body);
      if (
        method === "POST" &&
        requestPath === "/api/auth/register" &&
        result.response.status === 409 &&
        (result.data as { errorCode?: string } | null)?.errorCode === "login_id_taken"
      ) {
        const account = body as { loginId?: string; password?: string };
        const login = await send("POST", "/api/auth/login", {
          loginId: account.loginId,
          password: account.password,
        });
        if (!login.response.ok)
          throw new Error("Existing capture account could not be authenticated");
        return { ...(login.data as object), existing: true } as T;
      }
      if (!result.response.ok) {
        const error = result.data as { errorCode?: string; error?: string } | null;
        throw new Error(
          `Fixture request failed (${result.response.status}): ${error?.errorCode ?? error?.error ?? requestPath}`,
        );
      }
      return result.data as T;
    },
  };
}

function safeChildEnvironment(runtimePath: string, sqlitePath: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    TERM: process.env.TERM,
    HOME: runtimePath,
    XDG_CACHE_HOME: path.join(runtimePath, "cache"),
    npm_config_cache: path.join(runtimePath, "npm-cache"),
    DESKRPG_HOME: runtimePath,
    SQLITE_PATH: sqlitePath,
    DB_TYPE: "sqlite",
    JWT_SECRET: "readme-capture-jwt-secret-local-only-2026",
    COMING_SOON: "false",
    NEXT_PUBLIC_COMING_SOON: "false",
    PORT: "3310",
    INTERNAL_PORT: "3311",
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "development",
  };
  const browserCache =
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library/Caches/ms-playwright")
      : path.join(os.homedir(), ".cache/ms-playwright");
  if (fs.existsSync(browserCache)) environment.PLAYWRIGHT_BROWSERS_PATH = browserCache;
  return environment;
}

function childExit(
  child: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = childExit(child).catch(() => ({ code: null, signal: null }));
  child.kill("SIGTERM");
  await Promise.race([
    exited,
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        resolve();
      }, 2_000);
      timer.unref();
    }),
  ]);
}

async function waitForHealth(request: typeof globalThis.fetch, child: ChildProcess): Promise<void> {
  let exited = false;
  const markExited = () => {
    exited = true;
  };
  child.once("exit", markExited);
  try {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (exited || child.exitCode !== null || child.signalCode !== null) {
        throw new Error("DeskRPG exited before its health check became ready");
      }
      let response: Response | null = null;
      try {
        response = await request(`${APP_URL}/api/auth/status`, {
          redirect: "error",
          signal: AbortSignal.timeout(1_000),
        });
      } catch {
        // The server is expected to refuse connections during startup.
      }
      if (response?.ok) return;
      if (response) throw new Error(`DeskRPG health check failed with HTTP ${response.status}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("DeskRPG health check timed out");
  } finally {
    child.off("exit", markExited);
  }
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export async function runCaptureSession(deps: Partial<SessionDeps> = {}): Promise<void> {
  const root = path.resolve(deps.root ?? path.resolve(import.meta.dirname, "../.."));
  const spawn = deps.spawn ?? nodeSpawn;
  const request = deps.fetch ?? globalThis.fetch;
  const runtimePath = path.join(root, CAPTURE_ARTIFACT_DIR, "runtime");
  assertCaptureRuntimePath(root, runtimePath);
  const dataPath = path.join(runtimePath, "data");
  const sqlitePath = path.join(dataPath, "db.sqlite");
  fs.mkdirSync(dataPath, { recursive: true });

  const ownedChildren = new Set<ChildProcess>();
  let mockHermes: Awaited<ReturnType<typeof startMockHermes>> | null = null;
  const environment = safeChildEnvironment(runtimePath, sqlitePath);

  const startOwned = (command: string, args: string[]): ChildProcess => {
    const child = spawn(command, args, {
      cwd: root,
      env: environment,
      stdio: "inherit",
    });
    ownedChildren.add(child);
    child.once("exit", () => ownedChildren.delete(child));
    return child;
  };

  const runScript = async (script: string): Promise<void> => {
    const child = startOwned(npmCommand(), ["run", script]);
    const result = await childExit(child);
    if (result.code !== 0) {
      throw new Error(`${script} failed with ${result.signal ?? `exit code ${result.code}`}`);
    }
  };

  try {
    mockHermes = await startMockHermes({ host: "127.0.0.1", port: 38642 });
    const serverEntry = pathToFileURL(path.join(root, "dev-server.ts")).href;
    const app = startOwned(process.execPath, [
      "--import",
      "tsx",
      "--eval",
      `process.loadEnvFile=undefined; import(${JSON.stringify(serverEntry)})`,
    ]);
    await waitForHealth(request, app);
    await prepareFixture(createFixtureApi(APP_URL, request), mockHermes.baseUrl, sqlitePath);
    await runScript("capture:readme:record");
    await runScript("capture:readme:media");
    await runScript("capture:readme:verify");
  } finally {
    await Promise.all([...ownedChildren].map((child) => terminateChild(child)));
    await mockHermes?.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runCaptureSession().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
