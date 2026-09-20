/**
 * 시스템 SSH 호스트 — Hermes Desktop 과 같은 방식.
 *
 * DeskRPG 서버를 돌리는 사용자의 `~/.ssh/config`·ssh-agent·키 파일을 그대로 쓴다. 전용 키를 만들지
 * 않고, 호스트 키는 Desktop 처럼 `StrictHostKeyChecking=accept-new`(처음 보는 키는 기록, 바뀐 키는 거절)다.
 * 대상은 config 별칭이나 호스트명이고 사용자·포트·키 경로는 선택이다. `BatchMode=yes` 라 비밀번호나
 * 패스프레이즈를 묻지 않는다 — 그런 키는 ssh-agent 에 먼저 올려야 한다.
 *
 * 쓸 수 있는 조건도 Desktop 과 같다: `ssh` 가 있고 서버 사용자에게 `~/.ssh` 가 있을 때.
 * 컨테이너처럼 그것이 없으면 이 방식은 숨고 DeskRPG 전용 키 등록(ssh-hosts.ts)만 남는다.
 *
 * 등록 목록은 `DESKRPG_HOME/ssh/system-hosts.json`(0600)에 둔다. 키 내용은 어디에도 저장하지 않는다.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type SystemHost = {
  id: string;
  label: string;
  target: string;
  user?: string;
  port?: number;
  keyPath?: string;
  addedAt: string;
};

const TARGET_RE = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,251}[A-Za-z0-9])?$/;
const IPV6_RE = /^[0-9A-Fa-f:]{2,39}$/;
const USER_RE = /^[a-z_][a-z0-9_.-]{0,31}$/;
const CONTROL = /[\x00-\x1f\x7f]/;

/** `~/.ssh/config` 의 `Host` 별칭 — 와일드카드·부정 패턴은 뺀다(Desktop 의 ssh-config.ts 와 같다). */
export function parseSshConfigHosts(text: string): string[] {
  const hosts: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*host\s+(.+)$/i.exec(raw);
    if (!m) continue;
    for (const pattern of m[1].trim().split(/\s+/)) {
      if (!pattern || /[*?!]/.test(pattern) || !TARGET_RE.test(pattern)) continue;
      if (!hosts.includes(pattern)) hosts.push(pattern);
    }
  }
  return hosts;
}

/** `Include` 가 가리키는 파일들. 상대 경로는 `~/.ssh` 기준, 마지막 조각의 `*` 만 푼다. 읽기 전용이다. */
function includeTargets(text: string, sshDir: string, home: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*include\s+(.+)$/i.exec(raw);
    if (!m) continue;
    for (let spec of m[1].trim().split(/\s+/)) {
      if (spec.startsWith("~/")) spec = path.join(home, spec.slice(2));
      else if (!path.isAbsolute(spec)) spec = path.join(sshDir, spec);
      const dir = path.dirname(spec);
      const base = path.basename(spec);
      if (!base.includes("*")) {
        out.push(spec);
        continue;
      }
      const re = new RegExp(
        "^" + base.replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, ".*") + "$",
      );
      try {
        for (const name of readdirSync(dir).sort())
          if (re.test(name)) out.push(path.join(dir, name));
      } catch {
        /* 없는 Include 는 ssh 도 건너뛴다 */
      }
    }
  }
  return out;
}

export function readSshConfigHosts(home = os.homedir()): string[] {
  const sshDir = path.join(home, ".ssh");
  const seen = new Set<string>();
  const hosts: string[] = [];
  const visit = (file: string, depth: number) => {
    if (depth > 8 || seen.has(file) || seen.size > 64) return;
    seen.add(file);
    let text = "";
    try {
      if (!statSync(file).isFile()) return;
      text = readFileSync(file, "utf8");
    } catch {
      return;
    }
    for (const h of parseSshConfigHosts(text)) if (!hosts.includes(h)) hosts.push(h);
    for (const inc of includeTargets(text, sshDir, home)) visit(inc, depth + 1);
  };
  visit(path.join(sshDir, "config"), 0);
  return hosts.slice(0, 256);
}

/** Desktop 방식을 쓸 수 있는가 — 서버 사용자에게 `~/.ssh` 가 있어야 agent·키·known_hosts 가 있다. */
export function systemSshAvailable(home = os.homedir()): boolean {
  try {
    return statSync(path.join(home, ".ssh")).isDirectory();
  } catch {
    return false;
  }
}

export function validateSystemTarget(
  input: { target?: unknown; user?: unknown; port?: unknown; keyPath?: unknown },
  home = os.homedir(),
): Omit<SystemHost, "id" | "label" | "addedAt"> {
  const bad = () => new Error("setup_invalid_request");
  const target = typeof input.target === "string" ? input.target.trim() : "";
  if (!(TARGET_RE.test(target) || (target.includes(":") && IPV6_RE.test(target)))) throw bad();
  if (target.startsWith("169.254.") || target === "metadata.google.internal") throw bad();
  const out: Omit<SystemHost, "id" | "label" | "addedAt"> = { target };
  const user = typeof input.user === "string" ? input.user.trim() : "";
  if (user) {
    if (!USER_RE.test(user)) throw bad();
    out.user = user;
  }
  const portRaw = typeof input.port === "number" ? String(input.port) : input.port;
  if (typeof portRaw === "string" && portRaw.trim()) {
    if (!/^\d{1,5}$/.test(portRaw.trim())) throw bad();
    const port = Number(portRaw.trim());
    if (port < 1 || port > 65535) throw bad();
    out.port = port;
  }
  const keyRaw = typeof input.keyPath === "string" ? input.keyPath.trim() : "";
  if (keyRaw) {
    if (keyRaw.length > 512 || CONTROL.test(keyRaw) || keyRaw.startsWith("-")) throw bad();
    const expanded = keyRaw.startsWith("~/") ? path.join(home, keyRaw.slice(2)) : keyRaw;
    if (!path.isAbsolute(expanded)) throw bad();
    // 내용은 읽지 않는다. 파일이 있는지만 본다 — 오타를 "인증 실패" 로 헤매지 않게.
    try {
      if (!statSync(expanded).isFile()) throw new Error("ssh_key_not_found");
    } catch {
      throw new Error("ssh_key_not_found");
    }
    out.keyPath = path.normalize(expanded);
  }
  return out;
}

export function labelOf(host: Omit<SystemHost, "id" | "label" | "addedAt">): string {
  return `${host.user ? `${host.user}@` : ""}${host.target}${host.port ? `:${host.port}` : ""}`;
}

/** 시스템 SSH 로 부를 때의 인자 — `-F` 없이 서버 사용자 설정을 그대로 읽는다. */
export function systemSshArgs(host: SystemHost): string[] {
  return [
    ...(host.port ? ["-p", String(host.port)] : []),
    ...(host.user ? ["-l", host.user] : []),
    ...(host.keyPath ? ["-i", host.keyPath] : []),
  ];
}

export function createSystemSsh(deskrpgHome: string) {
  const dir = path.join(deskrpgHome, "ssh");
  const file = path.join(dir, "system-hosts.json");
  function list(): SystemHost[] {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      return Array.isArray(parsed) ? (parsed as SystemHost[]) : [];
    } catch {
      return [];
    }
  }
  async function write(hosts: SystemHost[]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(hosts, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, file);
    await chmod(file, 0o600);
  }
  return {
    list,
    get(id: string): SystemHost | undefined {
      return existsSync(file) ? list().find((h) => h.id === id) : undefined;
    },
    async add(target: Omit<SystemHost, "id" | "label" | "addedAt">): Promise<SystemHost> {
      const id = `s-${createHash("sha256")
        .update(
          JSON.stringify([
            target.target,
            target.user ?? "",
            target.port ?? 0,
            target.keyPath ?? "",
          ]),
        )
        .digest("hex")
        .slice(0, 10)}`;
      const host: SystemHost = {
        ...target,
        id,
        label: labelOf(target),
        addedAt: new Date().toISOString(),
      };
      await write([...list().filter((h) => h.id !== id), host]);
      return host;
    },
    async remove(id: string) {
      await write(list().filter((h) => h.id !== id));
    },
  };
}

let singleton: ReturnType<typeof createSystemSsh> | null = null;
export function systemSsh() {
  singleton ??= createSystemSsh(process.env.DESKRPG_HOME || path.join(os.homedir(), ".deskrpg"));
  return singleton;
}
