import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_PATHEXT, hasCommandIn, isWindows, nullDevicePath } from "./platform";

const winEnv = {
  PATH: "C:\\WINDOWS\\system32;C:\\WINDOWS\\System32\\OpenSSH\\",
  PATHEXT: ".COM;.EXE;.BAT;.CMD;.VBS",
};
const present = (...paths: string[]) => {
  const set = new Set(paths);
  return (p: string) => set.has(p);
};

test("win32 는 PATHEXT 확장자를 붙여 ssh.exe 를 찾는다", () => {
  const access = present("C:\\WINDOWS\\System32\\OpenSSH\\ssh.exe");
  assert.equal(hasCommandIn("ssh", winEnv, "win32", access), true);
});

test("win32 에서 확장자 없는 이름도 계속 시도한다", () => {
  const access = present("C:\\WINDOWS\\system32\\ssh");
  assert.equal(hasCommandIn("ssh", winEnv, "win32", access), true);
});

test("win32 에서 PATHEXT 가 비면 기본값을 쓴다", () => {
  const access = present("C:\\WINDOWS\\system32\\powershell.EXE");
  assert.equal(
    hasCommandIn("powershell", { PATH: "C:\\WINDOWS\\system32" }, "win32", access),
    true,
  );
  assert.ok(DEFAULT_PATHEXT.includes(".EXE"));
});

test("win32 에서 없는 명령은 false 다", () => {
  assert.equal(
    hasCommandIn("ssh", winEnv, "win32", () => false),
    false,
  );
});

test("비 win32 는 확장자를 붙이지 않는다", () => {
  const access = present("/usr/bin/ssh.exe");
  assert.equal(hasCommandIn("ssh", { PATH: "/usr/bin" }, "linux", access), false);
  assert.equal(hasCommandIn("ssh", { PATH: "/usr/bin" }, "linux", present("/usr/bin/ssh")), true);
});

test("PATH 가 비면 false 다", () => {
  assert.equal(
    hasCommandIn("ssh", {}, "linux", () => true),
    false,
  );
});

test("널 장치 이름은 플랫폼마다 다르다", () => {
  assert.equal(nullDevicePath("win32"), "NUL");
  assert.equal(nullDevicePath("darwin"), "/dev/null");
  assert.equal(isWindows("win32"), true);
  assert.equal(isWindows("linux"), false);
});
