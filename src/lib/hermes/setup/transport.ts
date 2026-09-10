/** Server-owned SSH transport. Stored URLs identify targets, never ephemeral local ports. */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, access, rm, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { assertSshHost, localExecutor, SSH_OPTIONS } from "./executor";

type Target = { hostId: string; remotePort: number };
const SUFFIX = ".deskrpg-ssh.invalid";
function validatePort(port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("setup_invalid_request");
}
function targetId(target: Target) {
  return createHash("sha256").update(JSON.stringify(target)).digest("hex");
}
const state = globalThis as typeof globalThis & {
  __deskrpgTunnels?: Map<string, Promise<{ url: string; child: ChildProcess }>>;
};
const tunnels = (state.__deskrpgTunnels ??= new Map());
const ownedProcesses = new Set<ChildProcess>();
process.once("exit", () => {
  for (const child of ownedProcesses) child.kill("SIGTERM");
});
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) =>
        error ? reject(error) : resolve((address as { port: number }).port),
      );
    });
  });
}
type TunnelDependencies = {
  spawnImpl?: typeof spawn;
  getPort?: () => Promise<number>;
  forward?: (socket: string, hostId: string, port: number, remotePort: number) => Promise<void>;
};
async function forwardThroughMaster(
  socket: string,
  hostId: string,
  port: number,
  remotePort: number,
) {
  await access(socket);
  const result = await localExecutor(
    "ssh",
    [
      "-F",
      "/dev/null",
      "-S",
      socket,
      "-O",
      "forward",
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-L",
      `127.0.0.1:${port}:127.0.0.1:${remotePort}`,
      "--",
      hostId,
    ],
    { timeoutMs: 2000 },
  );
  if (result.code !== 0)
    throw new Error(
      /cannot listen|Address already in use|cannot bind/i.test(result.stderr)
        ? "port_conflict"
        : "ssh_connection_failed",
    );
}
export async function ensureSshTunnel(
  hostId: string,
  remotePort: number,
  dependencies: TunnelDependencies = {},
): Promise<string> {
  assertSshHost(hostId);
  validatePort(remotePort);
  const key = targetId({ hostId, remotePort });
  const existing = tunnels.get(key);
  if (existing) {
    const current = await existing;
    if (current.child.exitCode == null && !current.child.killed) return current.url;
    tunnels.delete(key);
  }
  if (tunnels.size >= 8) throw new Error("setup_busy");
  const pending = (async () => {
    const port = await (dependencies.getPort ?? freePort)();
    const controlDir = await mkdtemp(path.join(os.tmpdir(), "deskrpg-ssh-"));
    const socket = path.join(controlDir, "master");
    // A private control socket acknowledges forward creation; a random open TCP port is not proof of ownership.
    const child = (dependencies.spawnImpl ?? spawn)(
      "ssh",
      [
        ...SSH_OPTIONS.slice(0, -4),
        "-M",
        "-S",
        socket,
        "-o",
        "ExitOnForwardFailure=yes",
        "-o",
        "ClearAllForwardings=yes",
        "-N",
        "-T",
        "--",
        hostId,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    ownedProcesses.add(child);
    let failure = "",
      exited = false,
      bytes = 0;
    child.stderr!.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (
        /REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(
          chunk.toString(),
        )
      )
        failure = "ssh_host_key_failed";
      if (bytes > 64 * 1024) {
        failure = "output_limit";
        child.kill("SIGKILL");
      }
    });
    child.once("error", () => {
      failure = "ssh_unavailable";
      exited = true;
    });
    child.once("exit", () => {
      void rm(controlDir, { recursive: true, force: true });
      ownedProcesses.delete(child);
      exited = true;
      if (tunnels.get(key) === pending) tunnels.delete(key);
    });
    try {
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        if (exited || failure) throw new Error(failure || "ssh_connection_failed");
        try {
          await (dependencies.forward ?? forwardThroughMaster)(socket, hostId, port, remotePort);
          if (exited || failure) throw new Error(failure || "ssh_connection_failed");
          return { url: `http://127.0.0.1:${port}`, child };
        } catch (error) {
          if (error instanceof Error && error.message === "port_conflict") throw error;
          // Master authentication may still be in progress; bounded retry.
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("ssh_timeout");
    } catch (error) {
      ownedProcesses.delete(child);
      child.kill("SIGKILL");
      await rm(controlDir, { recursive: true, force: true });
      throw error;
    }
  })();
  tunnels.set(key, pending);
  try {
    return (await pending).url;
  } catch (error) {
    if (tunnels.get(key) === pending) tunnels.delete(key);
    throw error;
  }
}
/** Available for explicit server shutdown; only processes created here are stopped. */
export async function closeSshTunnels() {
  const owned = [...tunnels.values()];
  tunnels.clear();
  await Promise.allSettled(owned.map(async (pending) => (await pending).child.kill("SIGTERM")));
}
export function createTransportRegistry(directory: string, ensure = ensureSshTunnel) {
  return {
    async register(hostId: string, remotePort: number): Promise<string> {
      assertSshHost(hostId);
      validatePort(remotePort);
      const target = { hostId, remotePort },
        id = targetId(target);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = path.join(directory, `${id}.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify(target), { mode: 0o600, flag: "wx" });
        await rename(temporary, path.join(directory, `${id}.json`));
      } finally {
        await unlink(temporary).catch(() => {});
      }
      return `http://${id}${SUFFIX}`;
    },
    async resolve(url: string): Promise<string> {
      const parsed = new URL(url);
      if (!parsed.hostname.endsWith(SUFFIX)) return url;
      const id = parsed.hostname.slice(0, -SUFFIX.length);
      if (
        !/^[a-f0-9]{64}$/.test(id) ||
        parsed.protocol !== "http:" ||
        parsed.port ||
        parsed.username ||
        parsed.password
      )
        throw new Error("setup_invalid_request");
      let target: Target;
      try {
        target = JSON.parse(await readFile(path.join(directory, `${id}.json`), "utf8"));
      } catch {
        throw new Error("ssh_unknown_host");
      }
      if (targetId({ hostId: target.hostId, remotePort: target.remotePort }) !== id)
        throw new Error("setup_invalid_request");
      assertSshHost(target.hostId);
      validatePort(target.remotePort);
      return `${await ensure(target.hostId, target.remotePort)}${parsed.pathname}${parsed.search}`;
    },
  };
}
function registry() {
  return createTransportRegistry(
    path.join(process.env.DESKRPG_HOME || path.join(os.homedir(), ".deskrpg"), "setup-transports"),
  );
}
export async function registerSshTransport(hostId: string, remotePort: number) {
  return registry().register(hostId, remotePort);
}
export async function resolveTransportUrl(url: string) {
  return registry().resolve(url);
}
/** Redirects must not forward credentials to a destination outside the chosen gateway. */
export const transportFetch: typeof fetch = async (input, init) => {
  const original = input instanceof Request ? input.url : input.toString();
  const resolved = await resolveTransportUrl(original);
  return fetch(input instanceof Request ? new Request(resolved, input) : resolved, {
    ...init,
    redirect: "error",
  });
};
