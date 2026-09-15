import { hostname } from "node:os";
import { accessSync, constants } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, users, gatewayResources, nowForDb } from "@/db";
import { upsertOwnedGatewayResource } from "@/lib/gateway-resources";
import { registerHermesProfile } from "@/lib/hermes-profiles";
import { isValidProfileName } from "../profile-name";
import { discoverHost, inspectHost, prepareHost } from "./host";
import { localExecutor, sshExecutor, getSshHosts } from "./executor";
import { ensureSshTunnel, registerSshTransport, transportFetch } from "./transport";
import { hostSetupAllowed, safeSetupError, validateGatewayUrl } from "./policy";
import { SetupJobStore } from "./store";
import { buildPluginInfoCacheUpdate } from "../plugin-cache-update";
import { verifySetupGateway } from "./verify";
import type { HostTarget, PreparedHost, SetupCapabilities } from "./types";

const stores = globalThis as typeof globalThis & {
  __deskrpgSetupControllers?: Map<string, AbortController>;
};
const controllers = (stores.__deskrpgSetupControllers ??= new Map());
const store = () => new SetupJobStore();
const STEPS = new Set([
  "inspecting",
  "installing_service",
  "installing_plugin",
  "enabling_plugin",
  "updating_plugin",
  "configuring_api",
  "setting_timezone",
  "restarting_gateway",
  "verifying_gateway",
  "importing_profiles",
  "saving_gateway",
]);

async function role(userId: string) {
  const [user] = await db
    .select({ role: users.systemRole })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user?.role;
}
function hasCommand(command: string) {
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .some((directory) => {
      try {
        accessSync(path.join(directory, command), constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
}
export async function setupCapabilities(userId: string): Promise<SetupCapabilities> {
  const enabled = hostSetupAllowed(process.env, await role(userId));
  const hosts = enabled && hasCommand("ssh") ? getSshHosts() : [];
  return {
    local: enabled && process.platform !== "win32" && hasCommand("python3"),
    ssh: enabled && hosts.length > 0,
    hostLabel: enabled ? hostname() : "",
    sshHosts: hosts,
  };
}
async function requireHost(userId: string, target: HostTarget) {
  if (!hostSetupAllowed(process.env, await role(userId))) throw new Error("setup_forbidden");
  if (target.mode === "local") return localExecutor;
  if (target.mode === "ssh" && target.hostId) return sshExecutor(target.hostId);
  throw new Error("setup_invalid_request");
}
export async function discoverSetupHost(userId: string, target: HostTarget) {
  return discoverHost(await requireHost(userId, target));
}
export async function inspectSetupHost(userId: string, target: HostTarget, candidateId: string) {
  return inspectHost(await requireHost(userId, target), candidateId);
}

function assertPrepared(value: PreparedHost) {
  let parsed: URL;
  try {
    parsed = new URL(value.baseUrl);
  } catch {
    throw new Error("setup_failed");
  }
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/" ||
    typeof value.token !== "string" ||
    value.token.length < 16 ||
    value.token.length > 4096
  )
    throw new Error("setup_failed");
  if (
    !Array.isArray(value.profiles) ||
    value.profiles.length > 1000 ||
    value.profiles.some(
      (p) =>
        !isValidProfileName(p.name) ||
        typeof p.token !== "string" ||
        p.token.length < 16 ||
        p.token.length > 4096,
    )
  )
    throw new Error("profile_import_failed");
  return Number(parsed.port || 80);
}

export async function startSetup(
  userId: string,
  target: HostTarget,
  candidateId: string,
  selectedProfiles: string[],
  timezone?: string,
) {
  const executor = await requireHost(userId, target);
  const jobs = store();
  // Host-wide lock: default and named candidates may share config/plugin installation.
  const release = jobs.lock(JSON.stringify(target));
  let job;
  try {
    job = jobs.create(userId);
  } catch (error) {
    release();
    throw error;
  }
  const controller = new AbortController();
  controllers.set(job.id, controller);
  const checkCancelled = () => {
    if (jobs.cancelled(userId, job.id) || controller.signal.aborted)
      throw new Error("setup_cancelled");
  };
  const step = (name: string) => {
    checkCancelled();
    if (!STEPS.has(name)) return;
    const prior = jobs.get(userId, job.id);
    if (prior.steps.at(-1) !== name) jobs.update(userId, job.id, { steps: [...prior.steps, name] });
  };
  // The server owns this job; request completion does not cancel its subprocess.
  void (async () => {
    try {
      step("inspecting");
      // Cancel only at safe command boundaries. The helper owns its process group
      // watchdog; killing the launcher cannot prove every descendant stopped.
      const boundedExecutor: typeof executor = (command, args, options) =>
        executor(command, args, { ...options, signal: undefined });
      const prepared = await prepareHost(
        boundedExecutor,
        candidateId,
        step,
        controller.signal,
        timezone,
      );
      const remotePort = assertPrepared(prepared);
      const selected = new Set(selectedProfiles);
      if (
        selectedProfiles.some((name) => !prepared.profiles.some((profile) => profile.name === name))
      )
        throw new Error("profile_import_failed");
      checkCancelled();
      const probeUrl =
        target.mode === "ssh"
          ? await ensureSshTunnel(target.hostId!, remotePort)
          : prepared.baseUrl;
      step("verifying_gateway");
      const capability = await verifySetupGateway(probeUrl, prepared.token, transportFetch);
      if (capability.status !== "plugin_ready")
        throw new Error(
          capability.status === "plugin_unauthorized"
            ? "plugin_unauthorized"
            : "plugin_verify_failed",
        );
      checkCancelled();
      const baseUrl =
        target.mode === "ssh"
          ? await registerSshTransport(target.hostId!, remotePort)
          : prepared.baseUrl;
      step("saving_gateway");
      const gateway = await upsertOwnedGatewayResource({
        ownerUserId: userId,
        baseUrl,
        token: prepared.token,
        displayName: target.mode === "ssh" ? `Hermes · ${target.hostId}` : `Hermes · ${hostname()}`,
      });
      // Preserve a recoverable resource link even if profile import is interrupted.
      jobs.update(userId, job.id, { gatewayId: gateway.id });
      await db
        .update(gatewayResources)
        .set({
          lastValidatedAt: nowForDb(),
          lastValidationStatus: "valid",
          lastValidationError: null,
          pluginStatus: capability.status,
          pluginVersion: capability.version,
          pluginCheckedAt: nowForDb(),
          // 보드 확보(kanban-boards.ts)가 계약 판정에 쓴다 — 없으면 캐시가 신선해도 재프로브한다.
          ...buildPluginInfoCacheUpdate(capability.info),
        })
        .where(eq(gatewayResources.id, gateway.id));
      step("importing_profiles");
      for (const profile of prepared.profiles.filter((profile) => selected.has(profile.name))) {
        checkCancelled();
        const result = await registerHermesProfile({
          userId,
          gatewayId: gateway.id,
          profileName: profile.name,
          token: profile.token,
        });
        if ("error" in result) throw new Error("profile_import_failed");
      }
      checkCancelled();
      jobs.update(userId, job.id, { status: "succeeded" });
    } catch (error) {
      const code =
        controller.signal.aborted || jobs.cancelled(userId, job.id)
          ? "setup_cancelled"
          : safeSetupError(error);
      jobs.update(userId, job.id, {
        status: code === "setup_cancelled" ? "cancelled" : "failed",
        error: code,
      });
    } finally {
      controllers.delete(job.id);
      release();
    }
  })().catch(() => {
    /* persist failure if storage failed; never log raw host output */
  });
  return job;
}
export function getSetupJob(userId: string, id: string) {
  return store().get(userId, id);
}
export function cancelSetupJob(userId: string, id: string) {
  const job = store().cancel(userId, id); // owner check precedes cancellation
  controllers.get(id)?.abort();
  return job;
}

export async function connectSetupUrl(
  userId: string,
  input: { url?: unknown; token?: unknown; displayName?: unknown },
) {
  const baseUrl = validateGatewayUrl(input.url);
  const token = typeof input.token === "string" ? input.token.trim() : "";
  if (token.length < 16 || token.length > 4096 || /[\r\n]/.test(token))
    throw new Error("setup_invalid_request");
  const displayName =
    typeof input.displayName === "string" ? input.displayName.trim().slice(0, 120) : "";
  const capability = await verifySetupGateway(baseUrl, token);
  if (capability.status === "plugin_unauthorized") throw new Error("plugin_unauthorized");
  if (capability.status === "unknown") throw new Error("plugin_unknown");
  const gateway = await upsertOwnedGatewayResource({
    ownerUserId: userId,
    baseUrl,
    token,
    displayName,
  });
  await db
    .update(gatewayResources)
    .set({
      lastValidatedAt: nowForDb(),
      lastValidationStatus: "valid",
      lastValidationError: null,
      pluginStatus: capability.status,
      pluginVersion: capability.version,
      pluginCheckedAt: nowForDb(),
      ...buildPluginInfoCacheUpdate(capability.info),
    })
    .where(eq(gatewayResources.id, gateway.id));
  return { gatewayId: gateway.id, pluginStatus: capability.status };
}
