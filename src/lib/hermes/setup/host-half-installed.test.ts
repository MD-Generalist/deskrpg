import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { HOST_BOOTSTRAP } from "./host-helper";
import { discoverHostState, installHermesHost } from "./host";
import type { HostExecutor } from "./types";

// An install that stopped halfway (dev3, SSH to a fresh host: install.sh died on a missing library about two
// minutes in) leaves ~/.hermes/hermes-agent behind with no Hermes that runs. Discovery must say so, instead of an
// empty list that offers an install the installer then refuses, or a bare host_operation_failed.
const posixOnly = process.platform === "win32" ? "runs the POSIX layout" : false;

function discover(layout: (install: string) => void, action = "discover"): Record<string, unknown> {
  const home = mkdtempSync(join(tmpdir(), "deskrpg-half-"));
  try {
    layout(join(home, ".hermes", "hermes-agent"));
    const result = spawnSync("python3", ["-c", HOST_BOOTSTRAP], {
      env: { ...process.env, HOME: home },
      encoding: "utf8",
      input: JSON.stringify({ action, timeout: 20, script: "raise SystemExit(3)\n" }),
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** A venv python stand-in: `--version` through `-m hermes_cli.main` exits with `version`, anything else fails. */
function venvPython(install: string, version: number) {
  const python = join(install, "venv", "bin", "python");
  mkdirSync(join(install, "venv", "bin"), { recursive: true });
  writeFileSync(python, `#!/bin/sh\n[ "$3" = --version ] && exit ${version}\nexit 1\n`);
  chmodSync(python, 0o755);
}

test(
  "no Hermes folder at all: an empty list, not a half-installed one",
  { skip: posixOnly },
  () => {
    assert.deepEqual(
      discover(() => {}),
      { candidates: [] },
    );
  },
);

test(
  "a Hermes folder with nothing that runs is reported as incomplete",
  { skip: posixOnly },
  () => {
    assert.deepEqual(
      discover((install) => mkdirSync(install, { recursive: true })),
      { candidates: [], incomplete: true },
    );
    // Other actions keep the old code — there is no Hermes to act on.
    assert.deepEqual(
      discover((install) => mkdirSync(install, { recursive: true }), "inspect"),
      { error: "hermes_not_found" },
    );
  },
);

test(
  "a Python that cannot even print the Hermes version is incomplete",
  { skip: posixOnly },
  () => {
    assert.deepEqual(
      discover((install) => venvPython(install, 1)),
      { candidates: [], incomplete: true },
    );
  },
);

test(
  "a Hermes that runs but whose helper failed stays host_operation_failed",
  { skip: posixOnly },
  () => {
    assert.deepEqual(
      discover((install) => venvPython(install, 0)),
      { error: "host_operation_failed" },
    );
  },
);

test("discovery passes the half-installed verdict through, and only a real true counts", async () => {
  const reply =
    (stdout: string): HostExecutor =>
    async () => ({ code: 0, stdout, stderr: "" });
  assert.deepEqual(
    await discoverHostState(reply('{"candidates": [], "incomplete": true}'), "linux"),
    {
      candidates: [],
      incomplete: true,
    },
  );
  assert.deepEqual(await discoverHostState(reply('{"candidates": []}'), "linux"), {
    candidates: [],
    incomplete: false,
  });
  assert.deepEqual(
    await discoverHostState(reply('{"candidates": [], "incomplete": "yes"}'), "linux"),
    { candidates: [], incomplete: false },
  );
});

test("the reinstall choice reaches the installer as a first line, and only when asked", async () => {
  const codes: string[] = [];
  const execute: HostExecutor = async (_command, args) => {
    codes.push(args[4]);
    return {
      code: 0,
      stdout: JSON.stringify({ ok: true, installerDigest: "a".repeat(64), milestones: [] }),
      stderr: "",
    };
  };
  await installHermesHost(execute, undefined, "linux", { reinstall: true });
  await installHermesHost(execute, undefined, "linux");
  assert.ok(codes[0].startsWith("REINSTALL = True\n"));
  assert.ok(!codes[1].includes("REINSTALL = True"));
});
