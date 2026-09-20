import { homedir, hostname } from "node:os";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, users, gatewayResources, nowForDb } from "@/db";
import { decryptGatewayToken, upsertOwnedGatewayResource } from "@/lib/gateway-resources";
import { registerHermesProfile } from "@/lib/hermes-profiles";
import { isValidProfileName } from "../profile-name";
import {
  checkLingerHost,
  checkModelHost,
  discoverHost,
  inspectHost,
  installHermesHost,
  SetupPackagesMissingError,
  prepareHost,
} from "./host";
import { localExecutor, sshExecutor, getSshHosts, sshFailureCode, sshOptions } from "./executor";
import {
  ensureSshTunnel,
  readSshTransportTarget,
  registerSshTransport,
  transportFetch,
} from "./transport";
import { classifyGatewayHost } from "./gateway-host-target";
import {
  collectSetupWarnings,
  hermesInstallAllowed,
  hostSetupAllowed,
  safeSetupError,
  validateGatewayUrl,
} from "./policy";
import { SetupJobStore } from "./store";
import { describeCapabilities } from "./capabilities";
import { hasCommandIn, hermesRootPath, venvPythonPath } from "./platform";
import { managedSsh } from "./ssh-hosts";
import {
  readSshConfigHosts,
  systemSsh,
  systemSshArgs,
  systemSshAvailable,
  validateSystemTarget,
} from "./system-ssh";
import { buildPluginCacheUpdate, buildPluginInfoCacheUpdate } from "../plugin-cache-update";
import { probeDeskrpgPluginWithInfo } from "../plugin-capability";
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
  "setting_port",
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
  return hasCommandIn(
    command,
    process.env as Record<string, string | undefined>,
    process.platform,
    (candidate) => {
      accessSync(candidate, constants.X_OK);
      return true;
    },
  );
}
/** 이 프로세스가 컨테이너 안에서 도는가. 판정 실패는 "아니다" — 막는 쪽으로 틀리지 않게. */
function inContainer() {
  if (existsSync("/.dockerenv") || existsSync("/run/.containerenv")) return true;
  try {
    return /docker|containerd|kubepods|libpod/.test(readFileSync("/proc/1/cgroup", "utf8"));
  } catch {
    return false;
  }
}
/** 호스트 도우미(HOST_BOOTSTRAP)와 같은 기준 — Hermes 홈 아래 `hermes-agent/{venv,.venv}` 의 venv 파이썬. */
function localHermesFound() {
  const root = path.join(
    hermesRootPath(process.platform, process.env as Record<string, string | undefined>, homedir()),
    "hermes-agent",
  );
  return ["venv", ".venv"].some((folder) =>
    existsSync(venvPythonPath(process.platform, path.join(root, folder))),
  );
}
export async function setupCapabilities(userId: string): Promise<SetupCapabilities> {
  const systemRole = await role(userId);
  const enabled = hostSetupAllowed(process.env, systemRole);
  return describeCapabilities({
    role: systemRole,
    switchedOff: systemRole === "system_admin" && !enabled,
    installAllowed: hermesInstallAllowed(process.env, systemRole, "local"),
    platform: process.platform,
    hasSsh: hasCommand("ssh"),
    hasPowershell: process.platform !== "win32" || hasCommand("powershell"),
    inContainer: inContainer(),
    localHermesFound: localHermesFound(),
    hostLabel: hostname(),
    sshHosts: enabled ? getSshHosts() : [],
  });
}
/** SSH 호스트 관리 — 관리자 전용(호스트 게이트와 같다). 개인키는 어느 응답에도 실리지 않는다. */
async function requireHostAdmin(userId: string) {
  if (!hostSetupAllowed(process.env, await role(userId))) throw new Error("setup_forbidden");
  return managedSsh();
}
export async function sshPublicKey(userId: string) {
  return { publicKey: await (await requireHostAdmin(userId)).publicKey() };
}
export async function sshScanHost(userId: string, input: Record<string, unknown>) {
  const keys = await (await requireHostAdmin(userId)).scan(input as never);
  return { keys: keys.map(({ type, fingerprint }) => ({ type, fingerprint })) };
}
export async function sshRegisterHost(userId: string, input: Record<string, unknown>) {
  const fingerprints = input.fingerprints;
  if (
    !Array.isArray(fingerprints) ||
    fingerprints.length === 0 ||
    fingerprints.length > 8 ||
    fingerprints.some((f) => typeof f !== "string" || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(f))
  )
    throw new Error("setup_invalid_request");
  const host = await (await requireHostAdmin(userId)).register(input as never, fingerprints);
  return { host: { id: host.id, label: host.label } };
}
export async function sshRemoveHost(userId: string, hostId: unknown) {
  if (typeof hostId !== "string" || !/^[hs]-[a-f0-9]{10}$/.test(hostId))
    throw new Error("setup_invalid_request");
  const managed = await requireHostAdmin(userId);
  if (hostId.startsWith("s-")) await systemSsh().remove(hostId);
  else await managed.remove(hostId);
  return { removed: hostId };
}
/** Desktop 방식을 쓸 수 있는지와 `~/.ssh/config` 별칭(추천용). 관리자 전용. */
export async function sshSystemInfo(userId: string) {
  await requireHostAdmin(userId);
  const available = systemSshAvailable();
  return { available, aliases: available ? readSshConfigHosts() : [] };
}
/**
 * Desktop 방식 호스트 추가 — 한 번 접속해 본 뒤에만 저장한다. 서버 사용자 설정·agent 를 그대로 쓰고,
 * 처음 보는 호스트 키는 서버 사용자 known_hosts 에 기록된다(accept-new).
 */
export async function sshSystemAdd(userId: string, input: Record<string, unknown>) {
  await requireHostAdmin(userId);
  if (!systemSshAvailable()) throw new Error("ssh_system_unavailable");
  const target = validateSystemTarget(input);
  const probe = await localExecutor(
    "ssh",
    [
      ...systemSshArgs({ ...target, id: "", label: "", addedAt: "" }),
      ...sshOptions("accept-new"),
      "-T",
      "--",
      target.target,
      "true",
    ],
    { timeoutMs: 20_000 },
  );
  if (probe.code === 255) throw new Error(sshFailureCode(probe.stderr));
  if (probe.code !== 0) throw new Error("ssh_connection_failed");
  const host = await systemSsh().add(target);
  return { host: { id: host.id, label: host.label } };
}
async function requireHost(userId: string, target: HostTarget) {
  if (!hostSetupAllowed(process.env, await role(userId))) throw new Error("setup_forbidden");
  if (target.mode === "local") return localExecutor;
  if (target.mode === "ssh" && target.hostId) return sshExecutor(target.hostId);
  throw new Error("setup_invalid_request");
}
/** SSH 대상은 언제나 리눅스다 — 로컬 실행에서만 이 서버가 도는 실제 플랫폼을 쓴다. */
function hostPlatform(target: HostTarget): string {
  return target.mode === "ssh" ? "linux" : process.platform;
}
export async function discoverSetupHost(userId: string, target: HostTarget) {
  return discoverHost(await requireHost(userId, target), hostPlatform(target));
}
export async function inspectSetupHost(userId: string, target: HostTarget, candidateId: string) {
  return inspectHost(await requireHost(userId, target), candidateId, hostPlatform(target));
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
  return checkModelHost(
    await requireHost(userId, target),
    candidateId,
    undefined,
    hostPlatform(target),
  );
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
  /** 화면이 대안 포트 제안을 명시적으로 수락했을 때만 온다. */
  setPort?: number,
) {
  const executor = await requireHost(userId, target);
  // 호스트 게이트 + 설치 스위치 + 대상(local·ssh). 대상별 조건은 hermesInstallAllowed 가 판정한다.
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
            hostPlatform(target),
          );
          jobs.update(userId, job.id, {
            installerDigest,
            // 마지막 이정표 하나만 남긴다. 코드이지 줄 내용이 아니다.
            ...(milestones.length ? { progress: milestones[milestones.length - 1] } : {}),
          });
          checkCancelled();
        }
        // 설치 뒤에는 후보가 새로 생긴다 — 클라이언트가 알 수 없으므로 서버가 다시 찾는다.
        const candidates = await discoverHost(executor, hostPlatform(target));
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
        setPort,
        hostPlatform(target),
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
        hostPlatform(target),
      );
      // SSH 대상은 로그아웃·재부팅 뒤에도 게이트웨이가 살아야 한다 — Linger 가 꺼져 있으면 안내만 한다.
      // Windows 로컬은 의미가 다르다: 스케줄 작업은 다음 로그온에 뜬다.
      const windowsLocal = target.mode === "local" && process.platform === "win32";
      const lingerOff =
        target.mode === "ssh" && (await checkLingerHost(boundedExecutor)) === "disabled";
      const extraWarnings = [
        ...(lingerOff ? ["linger_required"] : []),
        ...(windowsLocal ? ["logon_required"] : []),
      ];
      jobs.update(userId, job.id, {
        warnings: collectSetupWarnings(
          [...(prepared.warnings ?? []), ...extraWarnings],
          Boolean(installHermes),
          modelState,
        ),
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
        ...(error instanceof SetupPackagesMissingError
          ? {
              missingPackages: error.packages,
              ...(error.manager ? { packageManager: error.manager } : {}),
            }
          : {}),
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
/**
 * 이미 등록해 쓰고 있는 게이트웨이의 **플러그인만** 고정 버전으로 올린다.
 *
 * 마법사(`startSetup`)를 그대로 쓸 수 없다: 그 흐름은 끝에서 게이트웨이를 upsert 하며
 * 표시 이름을 `Hermes · <host>` 로 덮어쓰고(`gateway-resources.ts:133`) 프로필을 다시
 * 들여온다. 사용자가 붙인 이름과 공유 설정을 건드리지 않는 것이 이 경로의 계약이다.
 *
 * 그래서 파이프라인은 그대로 쓰되(`prepareHost`), 갱신에 필요 없는 단계는 `skipStep` 으로
 * 닫고, 끝나면 **플러그인 캐시만** 새로 쓴다 — 토큰·주소·이름은 그대로 둔다.
 */
export async function startPluginUpdate(userId: string, gatewayId: string) {
  const [gateway] = await db
    .select()
    .from(gatewayResources)
    .where(eq(gatewayResources.id, gatewayId))
    .limit(1);
  // 남의 게이트웨이 호스트에서 명령을 돌리게 할 수는 없다 — 공유받은 사용자도 안 된다.
  if (!gateway || gateway.ownerUserId !== userId) throw new Error("setup_not_found");

  const kind = classifyGatewayHost(gateway.baseUrl);
  let target: HostTarget;
  let port: number;
  if (kind.mode === "local") {
    target = { mode: "local" };
    port = kind.port;
  } else if (kind.mode === "ssh") {
    const ssh = await readSshTransportTarget(gateway.baseUrl);
    if (!ssh) throw new Error("ssh_unknown_host");
    target = { mode: "ssh", hostId: ssh.hostId };
    port = ssh.remotePort;
  } else {
    // 컨테이너에서 본 `host.docker.internal` 처럼, 주소는 닿아도 그 호스트에서 명령을
    // 돌릴 방법이 없는 경우다. 화면이 이유를 말하도록 전용 코드로 던진다.
    throw new Error("plugin_update_unsupported_host");
  }

  const executor = await requireHost(userId, target);
  const platform = hostPlatform(target);
  const candidates = await discoverHost(executor, platform);
  // 주소의 포트가 이 게이트웨이의 정체다 — 이름표(label)는 호스트마다 다를 수 있다.
  const candidate = candidates.find((item) => item.port === port);
  if (!candidate) throw new Error("plugin_update_candidate_not_found");

  const jobs = store();
  const targetKey = JSON.stringify(target);
  const release = jobs.lock(targetKey);
  let job;
  try {
    job = jobs.create(userId, targetKey, {});
  } catch (error) {
    release();
    throw error;
  }
  const controller = new AbortController();
  controllers.set(job.id, controller);
  const step = (name: string) => {
    if (jobs.cancelled(userId, job.id) || controller.signal.aborted)
      throw new Error("setup_cancelled");
    if (!STEPS.has(name)) return;
    const prior = jobs.get(userId, job.id);
    if (prior.steps.at(-1) !== name) jobs.update(userId, job.id, { steps: [...prior.steps, name] });
  };

  void (async () => {
    try {
      // 갱신에 없어야 할 단계를 닫는다. 프로필·키·포트·시간대는 이미 운영 중인 설정이고,
      // 서비스 등록은 돌고 있는 게이트웨이에 다시 할 일이 아니다.
      const skipStep = (name: string) =>
        name === "setting_port" ||
        name === "creating_profile" ||
        name === "provisioning_keys" ||
        name === "installing_service" ||
        name === "configuring_api" ||
        name === "setting_timezone";
      await prepareHost(
        executor,
        candidate.id,
        step,
        controller.signal,
        undefined,
        undefined,
        skipStep,
        undefined,
        platform,
      );
      // 새 버전이 실제로 서빙되는지 우리 주소로 확인한다(ssh 는 transportFetch 가 터널을 연다).
      const probed = await probeDeskrpgPluginWithInfo({
        fetchImpl: transportFetch,
        baseUrl: gateway.baseUrl,
        // deskrpg-allow-token-arg: 응답이 아니라 서버가 Hermes 를 부를 때 쓰는 인자다.
        token: decryptGatewayToken(gateway.tokenEncrypted),
      });
      await db
        .update(gatewayResources)
        .set({
          ...buildPluginCacheUpdate(probed.capability),
          ...buildPluginInfoCacheUpdate(probed.info),
        })
        .where(eq(gatewayResources.id, gatewayId));
      if (probed.capability.status !== "plugin_ready") throw new Error("plugin_verify_failed");
      jobs.update(userId, job.id, { status: "succeeded", gatewayId });
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
    /* 잡에 실패를 남기지 못한 경우까지 여기서 삼킨다 — 호스트 출력은 절대 로그에 남기지 않는다. */
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
