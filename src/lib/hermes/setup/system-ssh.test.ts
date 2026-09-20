import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createSystemSsh,
  parseSshConfigHosts,
  readSshConfigHosts,
  systemSshArgs,
  systemSshAvailable,
  validateSystemTarget,
} from "./system-ssh";

function tempHome() {
  return mkdtempSync(path.join(os.tmpdir(), "deskrpg-sysssh-"));
}

test("config 별칭 — 와일드카드·부정 패턴은 빼고 순서를 지킨다", () => {
  assert.deepEqual(
    parseSshConfigHosts("Host my-server nas\n  User deploy\nHost *\nhost !bad web-1 *.x\n"),
    ["my-server", "nas", "web-1"],
  );
});

test("Include 를 따라 별칭을 모은다(상대 경로·마지막 조각 *)", () => {
  const home = tempHome();
  try {
    mkdirSync(path.join(home, ".ssh", "conf.d"), { recursive: true });
    writeFileSync(path.join(home, ".ssh", "config"), "Include conf.d/*.conf\nHost main\n");
    writeFileSync(path.join(home, ".ssh", "conf.d", "a.conf"), "Host inc-a\n");
    writeFileSync(path.join(home, ".ssh", "conf.d", "skip.txt"), "Host no\n");
    assert.deepEqual(readSshConfigHosts(home), ["main", "inc-a"]);
    assert.equal(systemSshAvailable(home), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("~/.ssh 가 없으면 Desktop 방식은 숨는다(컨테이너)", () => {
  const home = tempHome();
  try {
    assert.equal(systemSshAvailable(home), false);
    assert.deepEqual(readSshConfigHosts(home), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("대상 검증 — 옵션 주입·제어문자·메타데이터 주소를 거절하고 키 파일은 있어야 한다", () => {
  const home = tempHome();
  try {
    mkdirSync(path.join(home, ".ssh"));
    writeFileSync(path.join(home, ".ssh", "id_ed25519"), "x");
    assert.deepEqual(
      validateSystemTarget(
        { target: "my-server", user: "deploy", port: "2222", keyPath: "~/.ssh/id_ed25519" },
        home,
      ),
      {
        target: "my-server",
        user: "deploy",
        port: 2222,
        keyPath: path.join(home, ".ssh", "id_ed25519"),
      },
    );
    for (const bad of [
      { target: "-oProxyCommand=x" },
      { target: "a b" },
      { target: "169.254.169.254" },
      { target: "ok", user: "Root;" },
      { target: "ok", port: "99999" },
      { target: "ok", keyPath: "-i/x" },
      { target: "ok", keyPath: "relative/key" },
    ])
      assert.throws(
        () => validateSystemTarget(bad, home),
        /setup_invalid_request/,
        JSON.stringify(bad),
      );
    assert.throws(
      () => validateSystemTarget({ target: "ok", keyPath: "~/.ssh/missing" }, home),
      /ssh_key_not_found/,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("시스템 호스트 인자는 -F 없이 선택값만 싣고, 목록은 0600 파일에 남는다", async () => {
  const home = tempHome();
  try {
    const store = createSystemSsh(home);
    const host = await store.add({ target: "my-server", port: 2222, user: "deploy" });
    assert.match(host.id, /^s-[a-f0-9]{10}$/);
    assert.equal(host.label, "deploy@my-server:2222");
    assert.deepEqual(systemSshArgs(host), ["-p", "2222", "-l", "deploy"]);
    assert.deepEqual(systemSshArgs({ ...host, port: undefined, user: undefined }), []);
    assert.equal(store.get(host.id)?.target, "my-server");
    assert.equal(statSync(path.join(home, "ssh", "system-hosts.json")).mode & 0o777, 0o600);
    await store.remove(host.id);
    assert.equal(store.list().length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
