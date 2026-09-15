import { hostname } from "node:os";
import { accessSync, constants } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, users, gatewayResources, nowForDb } from "@/db";
import { upsertOwnedGatewayResource } from "@/lib/gateway-resources";
import { registerHermesProfile } from "@/lib/hermes-profiles";
import { isValidProfileName } from "../profile-name";
import { checkModelHost, discoverHost, inspectHost, installHermesHost, prepareHost } from "./host";
import { localExecutor, sshExecutor, getSshHosts } from "./executor";
import { ensureSshTunnel, registerSshTransport, transportFetch } from "./transport";
import {
  collectSetupWarnings,
  hermesInstallAllowed,
  hostSetupAllowed,
  safeSetupError,
  validateGatewayUrl,
} from "./policy";
import { SetupJobStore } from "./store";
import { buildPluginInfoCacheUpdate } from "../plugin-cache-update";
import { verifySetupGateway } from "./verify";
import type {
  HostTarget,
  PreparedHost,
  SetupCapabilities,
  SetupModelState,
  SetupProvisionRequest,
} from "./types";

const stores = globalThis as typeof globalThis & {
  __deskrpgSetupControllers?: Map<string, AbortController>;
};
const controllers = (stores.__deskrpgSetupControllers ??= new Map());
const store = () => new SetupJobStore();
const STEPS = new Set([
  "installing_hermes",
  "inspecting",
  "creating_profile",
  "provisioning_keys",
  "installing_service",
  "installing_plugin",
  "enabling_plugin",
  "updating_plugin",
  "configuring_api",
  "setting_timezone",
  "restarting_gateway",
  "verifying_gateway",
  "checking_model",
  "importing_profiles",
  "saving_gateway",
]);
/**
 * 재개에서도 언제나 다시 도는 단계. 앞선 잡 이후 호스트 상태가 바뀌었을 수 있고,
 * 둘 다 읽기 전용 확인이라 다시 해도 잃는 것이 없다.
 * `inspecting` 도 같은 이유로 건너뛰지 않는다 — 이어지는 모든 판단이 그 결과 위에 선다.
 */
const ALWAYS_RERUN = new Set(["inspecting", "verifying_gateway", "checking_model"]);

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
  const systemRole = await role(userId);
  const enabled = hostSetupAllowed(process.env, systemRole);
  const hosts = enabled && hasCommand("ssh") ? getSshHosts() : [];
  const local = enabled && process.platform !== "win32" && hasCommand("python3");
  return {
    local,
    ssh: enabled && hosts.length > 0,
    hostLabel: enabled ? hostname() : "",
    sshHosts: hosts,
    // 설치는 local 전용이다. SSH 대상에는 어떤 조합으로도 열리지 않는다.
    canInstallHermes: local && hermesInstallAllowed(process.env, systemRole, "local"),
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
/**
 * 모델 자격 증명만 확인한다. 잡을 만들지 않고 즉시 답한다.
 * 기존 호스트 게이트는 그대로 통과해야 하지만, 확인 자체는 어떤 이유로도 실패가 되지 않는다.
 */
export async function checkSetupModel(
  userId: string,
  target: HostTarget,
  candidateId: string,
): Promise<SetupModelState> {
  return checkModelHost(await requireHost(userId, target), candidateId);
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
  provision?: SetupProvisionRequest,
  installHermes?: boolean,
  resumeFrom?: string,
) {
  const executor = await requireHost(userId, target);
  // 게이트 셋(호스트 설정 + DESKRPG_HERMES_INSTALL_ENABLED + local)을 모두 통과해야 한다.
  if (installHermes && !hermesInstallAllowed(process.env, await role(userId), target.mode))
    throw new Error("hermes_install_forbidden");
  const jobs = store();
  const targetKey = JSON.stringify(target);
  // 같은 사용자·같은 대상·실패한 잡만 이어받는다. 잠금을 잡기 전에 판정해 남의 잡으로 호스트를 묶지 않는다.
  const inherited = resumeFrom
    ? (jobs.resumable(userId, resumeFrom, targetKey).completed ?? [])
    : [];
  const done = (name: string) => inherited.includes(name) && !ALWAYS_RERUN.has(name);
  // Host-wide lock: default and named candidates may share config/plugin installation.
  const release = jobs.lock(targetKey);
  let job;
  try {
    job = jobs.create(userId, targetKey, { completed: inherited });
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
  // 다음 단계가 시작됐다는 것은 앞 단계가 던지지 않고 끝났다는 뜻이다 — 그때 `completed` 에 올린다.
  let pending: string | null = null;
  const complete = (name: string) => {
    const prior = jobs.get(userId, job.id);
    const completed = prior.completed ?? [];
    if (!completed.includes(name)) jobs.update(userId, job.id, { completed: [...completed, name] });
  };
  const settle = () => {
    if (pending) complete(pending);
    pending = null;
  };
  const step = (name: string) => {
    checkCancelled();
    if (!STEPS.has(name)) return;
    if (pending && pending !== name) complete(pending);
    pending = name;
    const prior = jobs.get(userId, job.id);
    if (prior.steps.at(-1) !== name) jobs.update(userId, job.id, { steps: [...prior.steps, name] });
  };
  // The server owns this job; request completion does not cancel its subprocess.
  void (async () => {
    try {
      let selectedCandidateId = candidateId;
      if (installHermes) {
        // 이미 설치를 끝낸 재개는 다시 깔지 않는다. 설치를 되돌리지도 않는다 — 후보만 다시 찾는다.
        if (!done("installing_hermes")) {
          step("installing_hermes");
          const { installerDigest, milestones } = await installHermesHost(
            executor,
            controller.signal,
          );
          jobs.update(userId, job.id, {
            installerDigest,
            // 마지막 이정표 하나만 남긴다. 코드이지 줄 내용이 아니다.
            ...(milestones.length ? { progress: milestones[milestones.length - 1] } : {}),
          });
          checkCancelled();
        }
        // 설치 뒤에는 후보가 새로 생긴다 — 클라이언트가 알 수 없으므로 서버가 다시 찾는다.
        const candidates = await discoverHost(executor);
        const fresh = candidates.find((item) => item.label === "Hermes default");
        if (!fresh) throw new Error("hermes_install_failed");
        selectedCandidateId = fresh.id;
      }
      step("inspecting");
      // Cancel only at safe command boundaries. The helper owns its process group
      // watchdog; killing the launcher cannot prove every descendant stopped.
      const boundedExecutor: typeof executor = (command, args, options) =>
        executor(command, args, { ...options, signal: undefined });
      const prepared = await prepareHost(
        boundedExecutor,
        selectedCandidateId,
        step,
        controller.signal,
        timezone,
        provision,
        done,
      );
      const collected = collectSetupWarnings(prepared.warnings, Boolean(installHermes));
      if (collected.length) jobs.update(userId, job.id, { warnings: collected });
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
      // 확인은 게이트웨이를 저장하기 전에, 그리고 어떤 결과여도 설정을 멈추지 않고 한다.
      step("checking_model");
      const modelState = await checkModelHost(
        boundedExecutor,
        selectedCandidateId,
        controller.signal,
      );
      jobs.update(userId, job.id, {
        warnings: collectSetupWarnings(prepared.warnings, Boolean(installHermes), modelState),
      });
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
      settle();
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
