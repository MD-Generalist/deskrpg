import assert from "node:assert/strict";
import test from "node:test";

import { SSH_OPTIONS } from "./executor";
import { forwardArgs, tunnelArgs, usesControlMaster } from "./ssh-args";

const base = {
  routeArgs: ["-F", "/home/u/.deskrpg/ssh/config"],
  routeOptions: [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "A=1",
    "-o",
    "B=2",
  ],
  dest: "h-1",
  socket: "/tmp/deskrpg-ssh-x/master",
  localPort: 41000,
  remotePort: 8642,
};

test("win32 은 멀티플렉싱을 쓰지 않는다", () => {
  assert.equal(usesControlMaster("win32"), false);
  assert.equal(usesControlMaster("darwin"), true);
  assert.equal(usesControlMaster("linux"), true);
});

test("win32 터널은 멀티플렉싱을 켜지 않는다", () => {
  // 실제 SSH_OPTIONS 로 본다. 그 배열은 `ControlMaster=no`·`ControlPath=none` 을 포함하고,
  // POSIX 갈래의 slice(0, -4) 는 바로 그 둘을 떼어 마스터를 켜는 장치다(executor.ts:6-21).
  // 따라서 win32 가 전체 옵션을 쓰는 것이 곧 "mux 가 명시적으로 꺼진다" 는 뜻이다.
  const args = tunnelArgs({ ...base, routeOptions: [...SSH_OPTIONS], platform: "win32" });
  const joined = args.join(" ");
  assert.ok(joined.includes("ControlMaster=no"), "mux 는 명시적으로 꺼져야 한다");
  assert.ok(!joined.includes("ControlMaster=auto"));
  assert.ok(!args.includes("-S") && !args.includes("-M"));
  assert.ok(!joined.includes("/dev/null"));
  assert.ok(joined.includes("-L 127.0.0.1:41000:127.0.0.1:8642"));
  assert.ok(joined.includes("ExitOnForwardFailure=yes"));
  assert.ok(args.includes("-N") && args.includes("-T"));
  assert.equal(args[args.length - 1], "h-1");
  assert.equal(args[args.length - 2], "--");
});

test("win32 터널은 로컬을 127.0.0.1 에만 묶는다", () => {
  const args = tunnelArgs({ ...base, platform: "win32" });
  assert.ok(!args.join(" ").includes("0.0.0.0"));
});

test("POSIX 터널 인자는 현행과 같다", () => {
  const args = tunnelArgs({ ...base, platform: "linux" });
  assert.deepEqual(args, [
    "-F",
    "/home/u/.deskrpg/ssh/config",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-M",
    "-S",
    "/tmp/deskrpg-ssh-x/master",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ClearAllForwardings=yes",
    "-N",
    "-T",
    "--",
    "h-1",
  ]);
});

test("POSIX forward 인자는 제어 소켓을 쓴다", () => {
  const args = forwardArgs({
    platform: "linux",
    socket: "/tmp/s/master",
    hostId: "h-1",
    localPort: 41000,
    remotePort: 8642,
  });
  assert.deepEqual(args, [
    "-F",
    "/dev/null",
    "-S",
    "/tmp/s/master",
    "-O",
    "forward",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-L",
    "127.0.0.1:41000:127.0.0.1:8642",
    "--",
    "h-1",
  ]);
});

test("win32 에서 forward 인자를 요구하면 거부한다", () => {
  assert.throws(
    () =>
      forwardArgs({
        platform: "win32",
        socket: "x",
        hostId: "h-1",
        localPort: 1,
        remotePort: 2,
      }),
    /setup_invalid_request/,
  );
});
