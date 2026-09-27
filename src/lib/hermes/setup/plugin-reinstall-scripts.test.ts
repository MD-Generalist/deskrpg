import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Upstream refuses a non-interactive `plugins install --force` over an ENABLED plugin whose Python
// dependencies need consent ("Reinstall declined"), and keeps the old version. Every container start path
// must disable, reinstall with --no-enable, then enable, and put the old commit back if enable fails.
// These run the real script blocks against a fake `hermes`/`git` that record the calls.

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const OLD = "1".repeat(40);
const NEW = "2".repeat(40);

type Scenario = { head?: string; pin: string; failInstallRef?: string; failEnableOnce?: boolean };
type Run = { status: number | null; calls: string[]; head: string | null };
type Runner = (scenario: Scenario) => Run;

function sandbox(scenario: Scenario) {
  const dir = mkdtempSync(path.join(tmpdir(), "plugin-reinstall-"));
  const bin = path.join(dir, "bin");
  const pluginDir = path.join(dir, "data", "plugins", "deskrpg");
  const state = path.join(dir, "head");
  mkdirSync(bin, { recursive: true });
  if (scenario.head) {
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(state, scenario.head);
  }
  if (scenario.failEnableOnce) writeFileSync(path.join(dir, "fail-enable"), "");
  const fake = (name: string, body: string) => {
    writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(path.join(bin, name), 0o755);
  };
  fake(
    "hermes",
    `echo "$*" >> "${dir}/calls"
case "$2" in
  install)
    ref=""; prev=""
    for a in "$@"; do [ "$prev" = "--ref" ] && ref="$a"; prev="$a"; done
    [ -n "$ref" ] && [ "$ref" = "${scenario.failInstallRef ?? ""}" ] && exit 1
    mkdir -p "${pluginDir}"; echo "\${ref:-${NEW}}" > "${state}" ;;
  enable) [ -f "${dir}/fail-enable" ] && { rm "${dir}/fail-enable"; exit 1; } ;;
  disable) [ -d "${pluginDir}" ] || exit 1 ;;
esac
exit 0`,
  );
  fake("git", `[ -d "${pluginDir}" ] && [ -f "${state}" ] && cat "${state}" || exit 128`);
  return { dir, bin, pluginDir, state };
}

function execute(script: string, box: ReturnType<typeof sandbox>): Run {
  const done = spawnSync("sh", ["-c", script], {
    env: { ...process.env, PATH: `${box.bin}:${process.env.PATH}` },
    encoding: "utf8",
  });
  const calls = existsSync(path.join(box.dir, "calls"))
    ? readFileSync(path.join(box.dir, "calls"), "utf8").trim().split("\n")
    : [];
  const head = existsSync(box.state) ? readFileSync(box.state, "utf8").trim() : null;
  rmSync(box.dir, { recursive: true, force: true });
  return {
    status: done.status,
    calls: calls.map((c) => c.replace(/ https:\/\/\S+/, " SRC")),
    head,
  };
}

function composeRunner(file: string): Runner {
  const text = readFileSync(path.join(ROOT, file), "utf8");
  const start = text.indexOf("        u=https://github.com/dandacompany/deskrpg-hermes-plugin");
  const end = text.indexOf("\n\n", start);
  assert.ok(start > 0 && end > start, `${file} has no plugin install block`);
  const block = text
    .slice(start, end)
    .split("\n")
    .map((line) => line.slice(8))
    .join("\n")
    .replaceAll("$$", "$");
  return (scenario) => {
    const box = sandbox(scenario);
    writeFileSync(path.join(box.dir, "pin"), scenario.pin);
    const script = block
      .replaceAll("/opt/data/plugins/deskrpg", box.pluginDir)
      .replaceAll("/pin/ref", path.join(box.dir, "pin"));
    return execute(`set -e\n${script}`, box);
  };
}

function officeRunner(): Runner {
  const text = readFileSync(path.join(ROOT, "deploy/office/cont-init.d/03-deskrpg-setup"), "utf8");
  const start = text.indexOf("# ── 4.");
  const end = text.indexOf("# 게이트웨이 기동", start);
  assert.ok(start > 0 && end > start, "the init script has no plugin section");
  const block = text.slice(start, end);
  return (scenario) => {
    const box = sandbox(scenario);
    const npmRoot = path.join(box.dir, "npm");
    mkdirSync(path.join(npmRoot, "deskrpg/src/lib/hermes/setup"), { recursive: true });
    writeFileSync(
      path.join(npmRoot, "deskrpg/src/lib/hermes/setup/pin.ts"),
      `export const PLUGIN_PIN = "${scenario.pin}";\n`,
    );
    writeFileSync(path.join(box.bin, "npm"), `#!/bin/sh\necho "${npmRoot}"\n`);
    chmodSync(path.join(box.bin, "npm"), 0o755);
    const prelude = [
      "set -e",
      'log() { echo "$*"; }',
      `HERMES_HOME="${path.dirname(path.dirname(box.pluginDir))}"`,
      'PLUGIN_SOURCE="https://github.com/dandacompany/deskrpg-hermes-plugin"',
    ].join("\n");
    return execute(`${prelude}\n${block}`, box);
  };
}

const RUNNERS: [string, Runner][] = [
  ["docker-compose.yml", composeRunner("docker-compose.yml")],
  ["docker/docker-compose.hermes.yml", composeRunner("docker/docker-compose.hermes.yml")],
  ["deploy/office/cont-init.d/03-deskrpg-setup", officeRunner()],
];

for (const [name, run] of RUNNERS) {
  test(`${name}: a new pin disables, reinstalls without enabling, then enables`, () => {
    const result = run({ head: OLD, pin: NEW });
    assert.equal(result.status, 0);
    assert.deepEqual(result.calls, [
      "plugins disable deskrpg",
      `plugins install SRC --ref ${NEW} --force --no-enable`,
      "plugins enable deskrpg",
    ]);
    assert.equal(result.head, NEW);
  });

  test(`${name}: a failed reinstall enables the version that was there`, () => {
    const result = run({ head: OLD, pin: NEW, failInstallRef: NEW });
    assert.equal(result.status, 0);
    assert.equal(result.calls.at(-1), "plugins enable deskrpg");
    assert.equal(result.head, OLD);
  });

  test(`${name}: a new commit that cannot be enabled is put back to the old one and enabled`, () => {
    const result = run({ head: OLD, pin: NEW, failEnableOnce: true });
    assert.equal(result.status, 0);
    assert.deepEqual(result.calls.slice(-2), [
      `plugins install SRC --ref ${OLD} --force --no-deps`,
      "plugins enable deskrpg",
    ]);
    assert.equal(result.head, OLD);
  });

  test(`${name}: the pinned commit already installed only enables`, () => {
    const result = run({ head: NEW, pin: NEW });
    assert.equal(result.status, 0);
    assert.deepEqual(result.calls, ["plugins enable deskrpg"]);
  });

  test(`${name}: a fresh volume installs the pin without enabling, then enables`, () => {
    const result = run({ pin: NEW });
    assert.equal(result.status, 0);
    assert.deepEqual(result.calls.slice(-2), [
      `plugins install SRC --ref ${NEW} --force --no-enable`,
      "plugins enable deskrpg",
    ]);
    assert.equal(result.head, NEW);
  });
}
