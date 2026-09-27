import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { parsePluginInfo } from "./plugin-capability";
import {
  WORKER_LAUNCH_DROP_IN,
  parseWorkerLaunchReport,
  workerLaunchFix,
  workerLaunchFixCommand,
  workerLaunchFixFor,
  workerLaunchHost,
  workerLaunchWarning,
} from "./worker-launch";

const LAUNCHER = "/home/dante/.hermes/hermes-agent/.hermes/bin/hermes";

function info(workerLaunch?: unknown) {
  return parsePluginInfo({
    plugin: "deskrpg",
    version: "0.28.1",
    capabilities: ["kanban"],
    kanban: {
      dispatcher_present: true,
      attachments: true,
      ...(workerLaunch === undefined ? {} : { worker_launch: workerLaunch }),
    },
  });
}

test("an old plugin without the field is unknown, not fine", () => {
  const parsed = info();
  assert.ok(parsed);
  assert.equal("worker_launch" in parsed.kanban, false);
  assert.equal(workerLaunchWarning(parsed), null);
});

test("a failed check (null) and a garbled report are kept apart from a missing field", () => {
  assert.equal(parseWorkerLaunchReport(undefined), undefined);
  assert.equal(parseWorkerLaunchReport(null), null);
  assert.equal(parseWorkerLaunchReport("x"), null);
  assert.deepEqual(parseWorkerLaunchReport({ ok: "yes", reason: "other", launcher: "" }), {
    ok: null,
    reason: null,
    hermes_bin: null,
    launcher: null,
  });
});

test("workers that cannot start without HERMES_BIN are a warning with the launcher to use", () => {
  const parsed = info({
    ok: false,
    reason: "hermes_bin_unset",
    hermes_bin: null,
    launcher: LAUNCHER,
  });
  assert.deepEqual(workerLaunchWarning(parsed), {
    reason: "hermes_bin_unset",
    launcher: LAUNCHER,
    hermesBin: null,
  });
});

test("a HERMES_BIN that points at nothing is a warning naming it", () => {
  const parsed = info({
    ok: false,
    reason: "hermes_bin_missing",
    hermes_bin: "/gone/hermes",
    launcher: null,
  });
  assert.deepEqual(workerLaunchWarning(parsed), {
    reason: "hermes_bin_missing",
    launcher: null,
    hermesBin: "/gone/hermes",
  });
});

test("no warning when workers can start or the plugin could not tell", () => {
  assert.equal(
    workerLaunchWarning(info({ ok: true, reason: null, hermes_bin: LAUNCHER, launcher: LAUNCHER })),
    null,
  );
  assert.equal(
    workerLaunchWarning(
      info({ ok: null, reason: "probe_failed", hermes_bin: null, launcher: null }),
    ),
    null,
  );
  assert.equal(workerLaunchWarning(info(null)), null);
});

test("no command without a launcher to point at", () => {
  assert.equal(workerLaunchFixCommand(null), null);
});

test(
  "the command writes the drop-in systemd reads and restarts the user service",
  { skip: process.platform === "win32" },
  () => {
    const home = mkdtempSync(path.join(tmpdir(), "worker-launch-"));
    const bin = path.join(home, "bin");
    mkdirSync(bin);
    const calls = path.join(home, "systemctl.log");
    writeFileSync(path.join(bin, "systemctl"), `#!/bin/sh\necho "$*" >> '${calls}'\n`);
    chmodSync(path.join(bin, "systemctl"), 0o755);
    // A launcher path with a space and a quote must survive both the shell and systemd's Environment= quoting.
    const odd = `${home}/it's a "hermes"`;
    const command = workerLaunchFixCommand(odd);
    assert.ok(command);
    execFileSync("/bin/sh", ["-c", command], {
      env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` } as unknown as NodeJS.ProcessEnv,
    });
    const dropIn = readFileSync(WORKER_LAUNCH_DROP_IN.replace("~", home), "utf8");
    assert.equal(dropIn, `[Service]\nEnvironment="HERMES_BIN=${odd.replace(/"/g, '\\"')}"\n`);
    assert.equal(
      readFileSync(calls, "utf8"),
      "--user daemon-reload\n--user restart hermes-gateway\n",
    );
  },
);

test("the host OS is read from the launcher path", () => {
  assert.equal(workerLaunchHost(LAUNCHER), "linux");
  assert.equal(workerLaunchHost("/Users/dante/.hermes/hermes-agent/.hermes/bin/hermes"), "macos");
  assert.equal(
    workerLaunchHost("C:\\Users\\dante\\AppData\\Local\\hermes\\bin\\hermes.exe"),
    "windows",
  );
  assert.equal(workerLaunchHost("D:/hermes/bin/hermes.exe"), "windows");
  assert.equal(workerLaunchHost("\\\\server\\share\\hermes.exe"), "windows");
});

test("Linux keeps the systemd drop-in command", () => {
  assert.deepEqual(workerLaunchFix(LAUNCHER), {
    host: "linux",
    file: WORKER_LAUNCH_DROP_IN,
    command: workerLaunchFixCommand(LAUNCHER),
  });
});

test("Windows gets no command yet — only the file to edit", () => {
  const fix = workerLaunchFix("C:\\Users\\u\\AppData\\Local\\hermes\\bin\\hermes.exe");
  assert.deepEqual(fix, { host: "windows", file: "%LOCALAPPDATA%\\hermes\\.env", command: null });
});

test("no fix without a launcher", () => {
  assert.equal(workerLaunchFix(null), null);
});

test("a macOS launcher gets the .env command", () => {
  const launcher = "/Users/dante/.hermes/hermes-agent/.hermes/bin/hermes";
  assert.deepEqual(workerLaunchFix(launcher), workerLaunchFixFor("macos", launcher));
  assert.equal(workerLaunchFix(launcher)?.file, "~/.hermes/.env");
});

test(
  "macOS sets HERMES_BIN in the Hermes .env through the launcher, then restarts the gateway",
  { skip: process.platform === "win32" },
  () => {
    const home = mkdtempSync(path.join(tmpdir(), "worker-launch-mac-"));
    const calls = path.join(home, "calls.log");
    // A launcher path with a space and a quote must reach Hermes as one argument.
    const dir = path.join(home, "it's a", ".hermes", "bin");
    mkdirSync(dir, { recursive: true });
    const odd = path.join(dir, "hermes");
    writeFileSync(
      odd,
      `#!/bin/sh\nfor a in "$@"; do printf '%s|' "$a" >> '${calls}'; done\necho >> '${calls}'\n`,
    );
    chmodSync(odd, 0o755);
    const fix = workerLaunchFixFor("macos", odd);
    assert.ok(fix.command);
    execFileSync("/bin/sh", ["-c", fix.command], {
      env: { HOME: home, PATH: "/usr/bin:/bin" } as unknown as NodeJS.ProcessEnv,
    });
    assert.equal(
      readFileSync(calls, "utf8"),
      `--profile|default|config|set|HERMES_BIN|${odd}|\n--profile|default|gateway|restart|\n`,
    );
  },
);

test(
  "macOS does not run the restart when setting the value fails",
  { skip: process.platform === "win32" },
  () => {
    const home = mkdtempSync(path.join(tmpdir(), "worker-launch-mac-fail-"));
    const calls = path.join(home, "calls.log");
    const launcher = path.join(home, "hermes");
    writeFileSync(launcher, `#!/bin/sh\necho "$*" >> '${calls}'\nexit 3\n`);
    chmodSync(launcher, 0o755);
    const fix = workerLaunchFixFor("macos", launcher);
    assert.ok(fix.command);
    assert.throws(() => execFileSync("/bin/sh", ["-c", fix.command!], { stdio: "ignore" }));
    assert.equal(
      readFileSync(calls, "utf8"),
      `--profile default config set HERMES_BIN ${launcher}\n`,
    );
  },
);
