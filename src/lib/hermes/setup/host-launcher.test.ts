import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { HOST_LAUNCHER } from "./host-helper";

/** Runs the launcher on a real /bin/sh with an isolated HOME/PATH. The system python3 is not on PATH. */
function sandbox() {
  const root = mkdtempSync(path.join(os.tmpdir(), "deskrpg-launcher-"));
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  mkdirSync(home);
  mkdirSync(bin);
  for (const tool of [
    "sh",
    "mkdir",
    "rm",
    "mktemp",
    "cat",
    "chmod",
    "id",
    "uname",
    "tr",
    "cut",
    "sed",
  ]) {
    const found = ["/bin", "/usr/bin"].map((d) => path.join(d, tool)).find((p) => existsSync(p));
    if (found) symlinkSync(found, path.join(bin, tool));
  }
  const script = (file: string, body: string) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
  };
  const run = (mode: string, code = "CODE", none = '{"candidates": []}') =>
    spawnSync("/bin/sh", ["-c", HOST_LAUNCHER, "deskrpg", mode, code, none], {
      env: { HOME: home, PATH: bin } as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
      timeout: 10000,
    }).stdout;
  /** A server with curl, git and a C++ compiler — passes the pre-install check. */
  const tools = () => {
    script(path.join(bin, "git"), "echo git version 2.0");
    script(path.join(bin, "g++"), "exit 0");
    if (!existsSync(path.join(bin, "curl"))) script(path.join(bin, "curl"), "exit 1");
  };
  return {
    root,
    home,
    bin,
    script,
    run,
    tools,
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}

// These run the sh launcher, which is the POSIX path. Windows uses HOST_LAUNCHER_PS, covered by the
// Windows runtime tests.
const posixOnly = process.platform === "win32" ? "the sh launcher is POSIX-only" : false;

test("runs with the Hermes venv python when present", { skip: posixOnly }, () => {
  const s = sandbox();
  try {
    s.script(path.join(s.home, ".hermes/hermes-agent/venv/bin/python"), 'echo "venv:$2"');
    s.script(path.join(s.bin, "python3"), 'echo "system:$2"');
    assert.equal(s.run("run").trim(), "venv:CODE");
  } finally {
    s.done();
  }
});

test("prefers the upstream PM runtime python over a leftover venv", { skip: posixOnly }, () => {
  const s = sandbox();
  try {
    const runtime = path.join(s.home, ".hermes/tools/python/bin/python3");
    s.script(runtime, 'echo "pm:$2"');
    s.script(
      path.join(s.home, ".hermes/hermes-agent/.hermes/bin/hermes"),
      `[ "$1" = --print-runtime-command ] && echo '["${runtime}", "-I", "-c", "boot"]'`,
    );
    s.script(path.join(s.home, ".hermes/hermes-agent/venv/bin/python"), 'echo "venv:$2"');
    assert.equal(s.run("run").trim(), "pm:CODE");
  } finally {
    s.done();
  }
});

test("falls back to the venv when the PM launcher prints no runtime", { skip: posixOnly }, () => {
  const s = sandbox();
  try {
    s.script(path.join(s.home, ".hermes/hermes-agent/.hermes/bin/hermes"), "exit 1");
    s.script(path.join(s.home, ".hermes/hermes-agent/venv/bin/python"), 'echo "venv:$2"');
    assert.equal(s.run("run").trim(), "venv:CODE");
  } finally {
    s.done();
  }
});

test("uses the system python3 when there is no venv", { skip: posixOnly }, () => {
  const s = sandbox();
  try {
    s.tools();
    s.script(path.join(s.bin, "python3"), 'echo "system:$2"');
    assert.equal(s.run("install").trim(), "system:CODE");
  } finally {
    s.done();
  }
});

test(
  "with no python at all, discovery returns the given JSON as-is (-> install offer)",
  { skip: posixOnly },
  () => {
    const s = sandbox();
    try {
      assert.equal(s.run("run"), '{"candidates": []}');
    } finally {
      s.done();
    }
  },
);

test(
  "when packages that can't be installed without sudo are missing, returns the list and distro before install",
  { skip: posixOnly },
  () => {
    const s = sandbox();
    try {
      s.script(path.join(s.bin, "sudo"), "exit 1");
      const body = JSON.parse(s.run("install"));
      assert.equal(body.error, "system_packages_missing");
      assert.deepEqual(body.packages.trim().split(" "), ["curl", "git"]);
      s.tools();
      s.script(path.join(s.bin, "curl"), "exit 0");
      s.script(path.join(s.bin, "python3"), 'echo "system:$2"');
      assert.equal(s.run("install").trim(), "system:CODE");
    } finally {
      s.done();
    }
  },
);

test(
  "with passwordless sudo, missing curl and git are installed with the package manager before install",
  { skip: posixOnly },
  () => {
    // The Hermes install script only checks for git and curl and stops if either is missing, so a
    // minimal image would fail even though sudo works. The launcher installs them first.
    const s = sandbox();
    try {
      s.script(
        path.join(s.bin, "sudo"),
        '[ "$1" = -n ] && shift; [ "$1" = true ] && exit 0; exec "$@"',
      );
      s.script(
        path.join(s.bin, "env"),
        'while [ "${1#*=}" != "$1" ]; do export "$1"; shift; done; exec "$@"',
      );
      const log = path.join(s.root, "apt.log");
      s.script(
        path.join(s.bin, "apt-get"),
        `echo "$*" >> "${log}"
case "$*" in *install*)
  printf '#!/bin/sh\\nexit 1\\n' > "${s.bin}/curl"
  printf '#!/bin/sh\\necho git version 2.0\\n' > "${s.bin}/git"
  chmod +x "${s.bin}/curl" "${s.bin}/git";;
esac`,
      );
      // No python3: the launcher goes on to fetch uv with the curl it just installed (the fake curl
      // fails that download) instead of stopping at system_packages_missing.
      assert.deepEqual(JSON.parse(s.run("install")), { error: "hermes_installer_unavailable" });
      assert.match(readFileSync(log, "utf8"), /install -y -qq +curl git ca-certificates/);
    } finally {
      s.done();
    }
  },
);

test(
  "when the package install fails even with sudo, the missing packages are still reported",
  { skip: posixOnly },
  () => {
    const s = sandbox();
    try {
      s.script(
        path.join(s.bin, "sudo"),
        '[ "$1" = -n ] && shift; [ "$1" = true ] && exit 0; exec "$@"',
      );
      s.script(
        path.join(s.bin, "env"),
        'while [ "${1#*=}" != "$1" ]; do export "$1"; shift; done; exec "$@"',
      );
      s.script(path.join(s.bin, "apt-get"), "exit 100");
      s.script(path.join(s.bin, "curl"), "exit 0");
      const body = JSON.parse(s.run("install"));
      assert.equal(body.error, "system_packages_missing");
      assert.deepEqual(body.packages.trim().split(" "), ["git"]);
    } finally {
      s.done();
    }
  },
);

// A Linux host that has the library (a CI runner) cannot show it missing.
const hostHasLibatomic = [
  "/usr/lib/x86_64-linux-gnu/libatomic.so.1",
  "/usr/lib64/libatomic.so.1",
].some((p) => existsSync(p));

test(
  "on Linux, a missing libatomic is reported before install",
  { skip: posixOnly || (hostHasLibatomic ? "this host has libatomic" : false) },
  () => {
    // The installer's Node.js links libatomic.so.1 and fails late without it; this host has none
    // of the library paths the launcher looks at (the test runs outside those directories).
    const s = sandbox();
    try {
      s.tools();
      s.script(path.join(s.bin, "curl"), "exit 0");
      rmSync(path.join(s.bin, "uname"));
      s.script(path.join(s.bin, "uname"), "echo Linux");
      s.script(path.join(s.bin, "sudo"), "exit 1");
      const body = JSON.parse(s.run("install"));
      assert.equal(body.error, "system_packages_missing");
      assert.deepEqual(body.packages.trim().split(" "), ["libatomic"]);
    } finally {
      s.done();
    }
  },
);

test(
  "install without python3 downloads uv into ~/.hermes/bin and runs the driver with uv python",
  { skip: posixOnly },
  () => {
    const s = sandbox();
    try {
      s.tools();
      const py = path.join(s.root, "uvpython", "python3.12");
      s.script(py, 'echo "uv-python:$2"');
      // Fake curl: writes a "uv install script" to the -o target. That script creates uv in UV_UNMANAGED_INSTALL.
      s.script(
        path.join(s.bin, "curl"),
        `out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out=$2; shift; done
cat > "$out" <<'UV'
mkdir -p "$UV_UNMANAGED_INSTALL"
cat > "$UV_UNMANAGED_INSTALL/uv" <<'BIN'
#!/bin/sh
[ "$2" = find ] && echo "${py}"
exit 0
BIN
chmod +x "$UV_UNMANAGED_INSTALL/uv"
UV`,
      );
      assert.equal(s.run("install").trim(), "uv-python:CODE");
      assert.ok(existsSync(path.join(s.home, ".hermes/bin/uv")));
    } finally {
      s.done();
    }
  },
);

test("downloads nothing when ~/.hermes is a symlink", { skip: posixOnly }, () => {
  const s = sandbox();
  try {
    mkdirSync(path.join(s.root, "elsewhere"));
    symlinkSync(path.join(s.root, "elsewhere"), path.join(s.home, ".hermes"));
    s.tools();
    s.script(path.join(s.bin, "curl"), "echo should-not-run >&2; exit 1");
    assert.deepEqual(JSON.parse(s.run("install")), { error: "unsafe_host_path" });
  } finally {
    s.done();
  }
});

test("package commands — built per distro, null for an unknown distro", async () => {
  const { packageManagerFor, parseSystemPackages, systemPackagesCommand } =
    await import("./system-packages");
  const pkgs = parseSystemPackages(" git libatomic evil;rm ");
  assert.deepEqual(pkgs, ["git", "libatomic"]);
  assert.equal(
    systemPackagesCommand(packageManagerFor("ubuntu"), pkgs),
    "sudo apt-get update && sudo apt-get install -y git libatomic1",
  );
  assert.equal(
    systemPackagesCommand(packageManagerFor("fedora"), pkgs),
    "sudo dnf install -y git libatomic",
  );
  assert.equal(systemPackagesCommand(packageManagerFor("macos"), pkgs), "xcode-select --install");
  assert.equal(systemPackagesCommand(packageManagerFor("plan9"), pkgs), null);
});
