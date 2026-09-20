import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createManagedSsh,
  fingerprintOf,
  globalKnownHostsLine,
  parseKeyscan,
  validateSshTarget,
  type ScanFn,
} from "./ssh-hosts";

// 공개 호스트 키 모양의 고정 값(실제 키가 아니다 — base64 blob 이면 지문 계산에는 충분하다).
const ED = "AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl";
const RSA = "AAAAB3NzaC1yc2EAAAADAQABAAABAQC7";

function dir() {
  return mkdtempSync(path.join(os.tmpdir(), "deskrpg-ssh-"));
}

function scanOf(lines: string): ScanFn {
  return async () => lines;
}

test("keyscan 출력에서 키 유형과 SHA256 지문을 뽑는다 — 주석 줄은 버린다", () => {
  const rows = parseKeyscan(
    `# box:22 SSH-2.0-OpenSSH\nbox ssh-ed25519 ${ED}\nbox ssh-rsa ${RSA}\n`,
  );
  assert.deepEqual(
    rows.map((r) => r.type),
    ["ssh-ed25519", "ssh-rsa"],
  );
  assert.equal(rows[0].fingerprint, fingerprintOf(ED));
  assert.match(rows[0].fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
});

test("대상 입력을 검증한다 — 옵션 주입·공백·메타데이터 주소를 거부한다", () => {
  assert.deepEqual(validateSshTarget({ host: "minipc.local", port: 22, user: "dante" }), {
    host: "minipc.local",
    port: 22,
    user: "dante",
  });
  assert.deepEqual(validateSshTarget({ host: "10.0.0.5", port: "2222", user: "ubuntu" }), {
    host: "10.0.0.5",
    port: 2222,
    user: "ubuntu",
  });
  for (const bad of [
    { host: "-oProxyCommand=x", port: 22, user: "u" },
    { host: "a b", port: 22, user: "u" },
    { host: "a,b", port: 22, user: "u" },
    { host: "u@h", port: 22, user: "u" },
    { host: "169.254.169.254", port: 22, user: "u" },
    { host: "metadata.google.internal", port: 22, user: "u" },
    { host: "h", port: 0, user: "u" },
    { host: "h", port: 70000, user: "u" },
    { host: "h", port: 22, user: "-u" },
    { host: "h", port: 22, user: "Root User" },
  ]) {
    assert.throws(() => validateSshTarget(bad), /setup_invalid_request/, JSON.stringify(bad));
  }
});

test("전용 키를 한 번 만들고, 다시 부르면 같은 공개키를 준다", async () => {
  const home = dir();
  let generated = 0;
  const ssh = createManagedSsh(home, {
    keygen: async (keyPath) => {
      generated += 1;
      writeFileSync(keyPath, "PRIVATE", { mode: 0o600 });
      writeFileSync(`${keyPath}.pub`, "ssh-ed25519 AAAAPUB deskrpg@test\n");
    },
    scan: scanOf(""),
  });
  assert.equal(await ssh.publicKey(), "ssh-ed25519 AAAAPUB deskrpg@test");
  assert.equal(await ssh.publicKey(), "ssh-ed25519 AAAAPUB deskrpg@test");
  assert.equal(generated, 1);
  assert.equal(statSync(path.join(home, "ssh")).mode & 0o777, 0o700);
});

test("확인한 지문과 다시 스캔한 지문이 같을 때만 등록하고, config·known_hosts 를 만든다", async () => {
  const home = dir();
  const ssh = createManagedSsh(home, {
    keygen: async (keyPath) => writeFileSync(keyPath, "K", { mode: 0o600 }),
    scan: scanOf(`box ssh-ed25519 ${ED}\n`),
  });
  const target = { host: "box", port: 2222, user: "dante" };
  const scanned = await ssh.scan(target);
  const host = await ssh.register(
    target,
    scanned.map((r) => r.fingerprint),
  );
  assert.match(host.id, /^h-[a-f0-9]{10}$/);
  assert.equal(host.label, "dante@box:2222");
  assert.deepEqual(
    ssh.list().map((h) => h.id),
    [host.id],
  );

  const config = readFileSync(ssh.configPath, "utf8");
  assert.match(config, new RegExp(`Host ${host.id}\\n`));
  assert.match(config, /HostName box\n/);
  assert.match(config, /Port 2222\n/);
  assert.match(config, /User dante\n/);
  assert.match(config, /IdentitiesOnly yes/);
  assert.match(config, /StrictHostKeyChecking yes/);
  assert.match(config, new RegExp(`HostKeyAlias ${host.id}`));
  const known = readFileSync(path.join(home, "ssh", "known_hosts"), "utf8");
  assert.equal(known, `${host.id} ssh-ed25519 ${ED}\n`);
  assert.equal(statSync(ssh.configPath).mode & 0o777, 0o600);
});

test("스캔과 등록 사이에 호스트 키가 바뀌면 거절한다", async () => {
  const home = dir();
  let lines = `box ssh-ed25519 ${ED}\n`;
  const ssh = createManagedSsh(home, {
    keygen: async (keyPath) => writeFileSync(keyPath, "K"),
    scan: async () => lines,
  });
  const target = { host: "box", port: 22, user: "dante" };
  const confirmed = (await ssh.scan(target)).map((r) => r.fingerprint);
  lines = `box ssh-rsa ${RSA}\n`;
  await assert.rejects(ssh.register(target, confirmed), /ssh_host_key_failed/);
  assert.deepEqual(ssh.list(), []);
});

test("호스트를 지우면 그 줄만 사라진다", async () => {
  const home = dir();
  const ssh = createManagedSsh(home, {
    keygen: async (keyPath) => writeFileSync(keyPath, "K"),
    scan: scanOf(`x ssh-ed25519 ${ED}\n`),
  });
  const a = await ssh.register({ host: "a", port: 22, user: "u" }, [fingerprintOf(ED)]);
  const b = await ssh.register({ host: "b", port: 22, user: "u" }, [fingerprintOf(ED)]);
  await ssh.remove(a.id);
  assert.deepEqual(
    ssh.list().map((h) => h.id),
    [b.id],
  );
  const known = readFileSync(path.join(home, "ssh", "known_hosts"), "utf8");
  assert.equal(known.includes(a.id), false);
  assert.equal(known.includes(b.id), true);
  assert.equal(readFileSync(ssh.configPath, "utf8").includes(a.id), false);
});

test("관리 호스트면 -F 로 관리 설정을 가리키고, 모르는 별칭이면 인자가 없다", async () => {
  const home = dir();
  const ssh = createManagedSsh(home, {
    keygen: async (keyPath) => writeFileSync(keyPath, "K"),
    scan: scanOf(`x ssh-ed25519 ${ED}\n`),
  });
  const h = await ssh.register({ host: "a", port: 22, user: "u" }, [fingerprintOf(ED)]);
  assert.deepEqual(ssh.configArgs(h.id), ["-F", ssh.configPath]);
  assert.deepEqual(ssh.configArgs("legacy-alias"), []);
});

test("관리형 config 의 널 장치는 플랫폼을 따른다", () => {
  assert.equal(globalKnownHostsLine("win32"), "  GlobalKnownHostsFile NUL");
  assert.equal(globalKnownHostsLine("linux"), "  GlobalKnownHostsFile /dev/null");
});
