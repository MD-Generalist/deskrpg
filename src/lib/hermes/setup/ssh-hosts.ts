/**
 * DeskRPG 가 관리하는 SSH — 전용 키, 관리자가 확인한 호스트 키, 등록한 호스트.
 *
 * 2026-09-19 단테 결정(A안): DeskRPG 가 `DESKRPG_HOME/ssh/id_ed25519` 를 한 번 만들고 **공개키만** 보여 준다.
 * 관리자는 대상 서버 `authorized_keys` 에 한 줄 붙인다. 개인키는 서버 밖으로 나가지 않고 DB 에도 없다.
 * 비밀번호는 받지 않는다(Hermes Desktop 과 같다).
 *
 * 호스트 키는 **확인 후 고정**한다. Desktop 은 `StrictHostKeyChecking=accept-new`(처음 보는 키 자동 수락)이지만
 * 웹 서버에는 그 순간 확인할 사람이 앞에 없다 — 등록 화면에서 지문을 보여 주고, 관리자가 확인한 지문과
 * 등록 순간 다시 스캔한 지문이 같을 때만 `known_hosts` 에 쓴다. 이후 연결은 `StrictHostKeyChecking yes`.
 *
 * 컨테이너의 HOME 이 `/nonexistent` 라서 ssh 가 쓰는 파일은 전부 이 디렉터리에 두고 설정으로 가리킨다.
 * 모든 ssh 호출은 `-F <config>` 로 이 설정만 읽는다 — 서버 사용자의 `~/.ssh/config` 를 섞지 않는다.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { nullDevicePath } from "./platform";

/** 관리형 config 의 전역 known_hosts 줄. Windows 에 `/dev/null` 은 없다. */
export function globalKnownHostsLine(platform: string): string {
  return `  GlobalKnownHostsFile ${nullDevicePath(platform)}`;
}

export type SshTarget = { host: string; port: number; user: string };
export type ManagedHost = SshTarget & {
  id: string;
  label: string;
  addedAt: string;
  fingerprints: string[];
};
export type ScannedKey = { type: string; blob: string; fingerprint: string };
export type ScanFn = (target: SshTarget) => Promise<string>;
export type KeygenFn = (keyPath: string, comment: string) => Promise<void>;

const HOST_RE = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const IPV6_RE = /^[0-9A-Fa-f:]{2,39}$/;
const USER_RE = /^[a-z_][a-z0-9_.-]{0,31}$/;
const KEY_TYPES = new Set([
  "ssh-ed25519",
  "ssh-rsa",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "sk-ssh-ed25519@openssh.com",
  "sk-ecdsa-sha2-nistp256@openssh.com",
]);

/** 사용자가 적은 대상을 검증한다. ssh 인자로 넘어가는 값이라 옵션 주입이 될 수 있는 모든 모양을 거부한다. */
export function validateSshTarget(input: {
  host?: unknown;
  port?: unknown;
  user?: unknown;
}): SshTarget {
  const bad = () => new Error("setup_invalid_request");
  const host = typeof input.host === "string" ? input.host.trim().toLowerCase() : "";
  const user = typeof input.user === "string" ? input.user.trim() : "";
  const port =
    typeof input.port === "number"
      ? input.port
      : typeof input.port === "string" && /^\d{1,5}$/.test(input.port.trim())
        ? Number(input.port.trim())
        : NaN;
  if (!(HOST_RE.test(host) || (host.includes(":") && IPV6_RE.test(host)))) throw bad();
  // 링크 로컬·클라우드 메타데이터 주소는 설정 대상이 될 이유가 없다(게이트웨이 주소 검증과 같다).
  if (host.startsWith("169.254.") || host === "metadata.google.internal" || /^fe[89ab]/.test(host))
    throw bad();
  if (!USER_RE.test(user)) throw bad();
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw bad();
  return { host, port, user };
}

/** OpenSSH 와 같은 형식의 지문: `SHA256:` + base64(sha256(키 blob)), 패딩 없음. */
export function fingerprintOf(blob: string): string {
  const digest = createHash("sha256").update(Buffer.from(blob, "base64")).digest("base64");
  return `SHA256:${digest.replace(/=+$/, "")}`;
}

/** `ssh-keyscan` 출력 → 키 목록. 주석(`#`)·모르는 유형·깨진 줄은 버린다. 같은 키는 한 번만. */
export function parseKeyscan(output: string): ScannedKey[] {
  const seen = new Set<string>();
  const rows: ScannedKey[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [, type, blob] = trimmed.split(/\s+/);
    if (!type || !blob || !KEY_TYPES.has(type) || !/^[A-Za-z0-9+/=]+$/.test(blob)) continue;
    if (seen.has(blob)) continue;
    seen.add(blob);
    rows.push({ type, blob, fingerprint: fingerprintOf(blob) });
  }
  return rows;
}

function run(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"], shell: false });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      if (out.length > 65536) child.kill("SIGKILL");
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("ssh_unavailable"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0 || out) resolve(out);
      else reject(new Error("ssh_connection_failed"));
    });
  });
}

const defaultScan: ScanFn = async (target) => {
  // keyscan 은 `--` 를 받지 않는다 — 호스트는 위에서 `-` 로 시작할 수 없게 검증했다.
  const out = await run("ssh-keyscan", ["-T", "5", "-p", String(target.port), target.host], 15_000);
  return out;
};

const defaultKeygen: KeygenFn = async (keyPath, comment) => {
  await run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", comment, "-f", keyPath], 15_000);
};

async function writePrivate(file: string, text: string) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, text, { mode: 0o600 });
  await rename(tmp, file);
  await chmod(file, 0o600);
}

export function createManagedSsh(
  deskrpgHome: string,
  deps: { scan?: ScanFn; keygen?: KeygenFn } = {},
) {
  const dir = path.join(deskrpgHome, "ssh");
  const keyPath = path.join(dir, "id_ed25519");
  const knownPath = path.join(dir, "known_hosts");
  const hostsPath = path.join(dir, "hosts.json");
  const configPath = path.join(dir, "config");
  const scan = deps.scan ?? defaultScan;
  const keygen = deps.keygen ?? defaultKeygen;

  async function ensureDir() {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
  }

  function list(): ManagedHost[] {
    try {
      const parsed: unknown = JSON.parse(readFileSync(hostsPath, "utf8"));
      return Array.isArray(parsed) ? (parsed as ManagedHost[]) : [];
    } catch {
      return [];
    }
  }

  /** hosts.json 이 정본이다. config·known_hosts 는 검증된 값으로 매번 다시 만든다. */
  async function writeAll(hosts: ManagedHost[], keys: Map<string, ScannedKey[]>) {
    await ensureDir();
    await writePrivate(hostsPath, `${JSON.stringify(hosts, null, 2)}\n`);
    const blocks = hosts.map((h) =>
      [
        `Host ${h.id}`,
        `  HostName ${h.host}`,
        `  Port ${h.port}`,
        `  User ${h.user}`,
        `  IdentityFile ${keyPath}`,
        "  IdentitiesOnly yes",
        `  HostKeyAlias ${h.id}`,
        `  UserKnownHostsFile ${knownPath}`,
        globalKnownHostsLine(process.platform),
        "  StrictHostKeyChecking yes",
        "  PasswordAuthentication no",
        "  KbdInteractiveAuthentication no",
        "",
      ].join("\n"),
    );
    await writePrivate(configPath, blocks.join("\n"));
    const known: string[] = [];
    for (const h of hosts) {
      for (const k of keys.get(h.id) ?? []) known.push(`${h.id} ${k.type} ${k.blob}`);
    }
    await writePrivate(knownPath, known.length ? `${known.join("\n")}\n` : "");
  }

  async function readKnown(): Promise<Map<string, ScannedKey[]>> {
    const map = new Map<string, ScannedKey[]>();
    let text = "";
    try {
      text = await readFile(knownPath, "utf8");
    } catch {
      return map;
    }
    for (const line of text.split("\n")) {
      const [alias, type, blob] = line.trim().split(/\s+/);
      if (!alias || !type || !blob) continue;
      const rows = map.get(alias) ?? [];
      rows.push({ type, blob, fingerprint: fingerprintOf(blob) });
      map.set(alias, rows);
    }
    return map;
  }

  return {
    configPath,
    list,
    /** 관리 호스트면 `-F <관리 설정>` — 호환용 환경변수 별칭은 서버 ssh 설정을 그대로 쓴다. */
    configArgs(hostId: string): string[] {
      return existsSync(configPath) && list().some((h) => h.id === hostId)
        ? ["-F", configPath]
        : [];
    },
    /** 전용 키의 공개키. 없으면 만든다. 개인키는 돌려주지 않는다. */
    async publicKey(): Promise<string> {
      await ensureDir();
      if (!existsSync(keyPath)) await keygen(keyPath, `deskrpg@${os.hostname()}`);
      await chmod(keyPath, 0o600).catch(() => {});
      return (await readFile(`${keyPath}.pub`, "utf8")).trim();
    },
    async scan(input: SshTarget): Promise<ScannedKey[]> {
      const target = validateSshTarget(input);
      const rows = parseKeyscan(await scan(target));
      if (!rows.length) throw new Error("ssh_connection_failed");
      return rows;
    },
    /**
     * 확인한 지문으로 등록한다. 등록 순간 다시 스캔해, 확인한 지문 집합과 같지 않으면 거절한다 —
     * 화면을 보는 사이에 키가 바뀌었다면 관리자가 확인한 것이 아니다.
     */
    async register(input: SshTarget, confirmed: string[]): Promise<ManagedHost> {
      const target = validateSshTarget(input);
      const rows = parseKeyscan(await scan(target));
      const now = new Set(rows.map((r) => r.fingerprint));
      const want = new Set(confirmed);
      if (!rows.length || now.size !== want.size || [...now].some((f) => !want.has(f)))
        throw new Error("ssh_host_key_failed");
      const id = `h-${createHash("sha256")
        .update(`${target.user}@${target.host}:${target.port}`)
        .digest("hex")
        .slice(0, 10)}`;
      const host: ManagedHost = {
        ...target,
        id,
        label: `${target.user}@${target.host}${target.port === 22 ? "" : `:${target.port}`}`,
        addedAt: new Date().toISOString(),
        fingerprints: rows.map((r) => r.fingerprint),
      };
      const keys = await readKnown();
      keys.set(id, rows);
      await writeAll([...list().filter((h) => h.id !== id), host], keys);
      return host;
    },
    async remove(hostId: string): Promise<void> {
      const keys = await readKnown();
      keys.delete(hostId);
      await writeAll(
        list().filter((h) => h.id !== hostId),
        keys,
      );
    },
  };
}

let singleton: ReturnType<typeof createManagedSsh> | null = null;
/** 서버가 쓰는 관리 SSH. `DESKRPG_HOME`(Docker 에서는 볼륨)에 둬 재배포 뒤에도 키가 남는다. */
export function managedSsh() {
  singleton ??= createManagedSsh(process.env.DESKRPG_HOME || path.join(os.homedir(), ".deskrpg"));
  return singleton;
}
