import assert from "node:assert/strict";
import test from "node:test";

import { describeCapabilities, type CapabilityProbe } from "./capabilities";

const base: CapabilityProbe = {
  role: "system_admin",
  switchedOff: false,
  installAllowed: true,
  platform: "linux",
  hasPython3: true,
  hasSsh: true,
  inContainer: false,
  localHermesFound: true,
  hostLabel: "minipc",
  sshHosts: [{ id: "h-1", label: "h-1" }],
};

test("관리자는 환경변수 없이 로컬·SSH 가 열린다", () => {
  const c = describeCapabilities(base);
  assert.equal(c.local, true);
  assert.equal(c.ssh, true);
  assert.equal(c.localReason, null);
  assert.equal(c.sshReason, null);
});

test("관리자가 아니거나 운영자가 끄면 둘 다 닫히고 이유가 다르다", () => {
  const user = describeCapabilities({ ...base, role: "user" });
  assert.equal(user.local, false);
  assert.equal(user.localReason, "not_admin");
  assert.equal(user.sshReason, "not_admin");
  assert.deepEqual(user.sshHosts, []);
  assert.equal(user.hostLabel, "");
  const off = describeCapabilities({ ...base, switchedOff: true });
  assert.equal(off.localReason, "disabled");
  assert.equal(off.sshReason, "disabled");
});

test("로컬에 Hermes 가 없으면 열어 두고 설치를 제안한다", () => {
  const c = describeCapabilities({ ...base, localHermesFound: false });
  assert.equal(c.local, true);
  assert.equal(c.canInstallHermes, true);
  assert.equal(
    describeCapabilities({ ...base, localHermesFound: false, installAllowed: false })
      .canInstallHermes,
    false,
  );
  assert.equal(describeCapabilities(base).canInstallHermes, false, "이미 있으면 설치하지 않는다");
});

test("컨테이너 안에 Hermes 가 없으면 로컬을 닫는다 — Docker 여서가 아니라 설치가 남지 않아서", () => {
  const c = describeCapabilities({ ...base, inContainer: true, localHermesFound: false });
  assert.equal(c.local, false);
  assert.equal(c.localReason, "container_without_hermes");
  assert.equal(c.canInstallHermes, false);
  // 이미지에 Hermes 가 들어 있으면 컨테이너라도 쓴다.
  assert.equal(describeCapabilities({ ...base, inContainer: true }).local, true);
});

test("python3·ssh 가 없으면 그 이유를 준다", () => {
  assert.equal(describeCapabilities({ ...base, hasPython3: false }).localReason, "python3_missing");
  const noSsh = describeCapabilities({ ...base, hasSsh: false });
  assert.equal(noSsh.ssh, false);
  assert.equal(noSsh.sshReason, "ssh_missing");
  assert.equal(
    describeCapabilities({ ...base, platform: "win32" }).localReason,
    "unsupported_platform",
  );
});

test("등록한 호스트가 없어도 SSH 는 열린다 — 화면에서 등록한다", () => {
  const c = describeCapabilities({ ...base, sshHosts: [] });
  assert.equal(c.ssh, true);
  assert.equal(c.canInstallHermesSsh, true);
});
