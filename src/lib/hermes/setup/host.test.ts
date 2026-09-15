import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { discoverHost, inspectHost, installHermesHost, prepareHost } from "./host";
import type { HostExecutor, SetupCandidate } from "./types";
const candidate: SetupCandidate = {
  id: "a".repeat(64),
  label: "Hermes default",
  version: "0.21.1",
  service: "hermes-gateway.service",
  port: 8642,
  pluginInstalled: false,
  pluginEnabled: false,
  pluginVersion: null,
  timezone: null,
  hasToken: false,
};
function fake(responses: unknown[]) {
  const calls: { command: string; args: string[]; input?: string }[] = [];
  const execute: HostExecutor = async (command, args, options) => {
    calls.push({ command, args, input: options?.input });
    const reply = responses.shift();
    if (reply instanceof Error) throw reply;
    return { code: 0, stdout: JSON.stringify(reply), stderr: "" };
  };
  return { execute, calls };
}
test("discovery explicitly projects public metadata and strips unexpected secrets", async () => {
  const f = fake([{ candidates: [{ ...candidate, token: "do-not-return" }] }]);
  assert.deepEqual(await discoverHost(f.execute), [candidate]);
});
test("untrusted candidate IDs are rejected before host execution", async () => {
  const f = fake([]);
  await assert.rejects(inspectHost(f.execute, "../profile"), /invalid_candidate/);
  assert.equal(f.calls.length, 0);
});
test("prepare preserves reused token and verifies before returning private credentials", async () => {
  const f = fake([
    { candidate, pluginStatus: "plugin_absent", changes: ["installing_plugin"] },
    { ok: true },
    { ok: true },
    { ok: true },
    {
      prepared: {
        baseUrl: "http://127.0.0.1:8642",
        token: "existing-private-token",
        profiles: [{ name: "default", token: "existing-private-token" }],
      },
    },
  ]);
  const steps: string[] = [];
  const result = await prepareHost(f.execute, candidate.id, (s) => steps.push(s));
  assert.equal(result.token, "existing-private-token");
  assert.deepEqual(steps, [
    "inspecting",
    "installing_plugin",
    "configuring_api",
    "restarting_gateway",
    "verifying_gateway",
  ]);
  assert.ok(f.calls.every((c) => !JSON.stringify(c.args).includes("existing-private-token")));
});
test("install failure exposes only fixed error code and never continues", async () => {
  const f = fake([
    { candidate, pluginStatus: "plugin_absent", changes: ["installing_plugin"] },
    { error: "plugin_install_failed", detail: "secret=private" },
  ]);
  await assert.rejects(
    prepareHost(f.execute, candidate.id, () => {}),
    /^Error: plugin_install_failed$/,
  );
  assert.equal(f.calls.length, 2);
});
test("port conflicts and unknown helper errors fail closed without raw diagnostics", async () => {
  for (const [error, expected] of [
    ["port_conflict", "port_conflict"],
    ["secret token leaked", "host_operation_failed"],
  ]) {
    const f = fake([{ error }]);
    await assert.rejects(inspectHost(f.execute, candidate.id), new RegExp(`^Error: ${expected}$`));
  }
});
test("cancellation prevents the next mutation", async () => {
  const controller = new AbortController();
  const f = fake([{ candidate, pluginStatus: "plugin_absent", changes: ["installing_plugin"] }]);
  await assert.rejects(
    prepareHost(
      f.execute,
      candidate.id,
      (step) => {
        if (step === "installing_plugin") controller.abort();
      },
      controller.signal,
    ),
    /setup_cancelled/,
  );
  assert.equal(f.calls.length, 1);
});

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { HOST_BOOTSTRAP, HOST_HELPER } from "./host-helper";
const installedPython = ["venv", ".venv"]
  .map((name) => join(homedir(), ".hermes/hermes-agent", name, "bin/python"))
  .find(existsSync);
function fixture(
  script: string,
  initial: { config?: object; env?: string; hermesVersion?: string | null; plugin?: object } = {},
) {
  const temp = mkdtempSync(join(tmpdir(), "deskrpg-host-test-"));
  const root = join(temp, ".hermes");
  mkdirSync(join(root, "hermes-agent"), { recursive: true });
  writeFileSync(join(root, "config.yaml"), JSON.stringify(initial.config ?? {}));
  writeFileSync(join(root, ".env"), initial.env ?? "");
  writeFileSync(
    join(root, "hermes-agent/pyproject.toml"),
    initial.hermesVersion === null
      ? "[project]\n"
      : `version = "${initial.hermesVersion ?? "0.21.1"}"\n`,
  );
  if (initial.plugin) {
    mkdirSync(join(root, "plugins/deskrpg"), { recursive: true });
    writeFileSync(join(root, "plugins/deskrpg/plugin.yaml"), JSON.stringify(initial.plugin));
  }
  // The portable branch supplies only YAML/env parsing; no Hermes installation or service is needed in CI.
  const portable = installedPython
    ? ""
    : String.raw`
import types, sys, json
sys.modules['yaml'] = types.SimpleNamespace(safe_load=lambda text: json.loads(text) if text else {}, safe_dump=lambda value, **kwargs: json.dumps(value))
def fixture_env(path):
    # Mirrors agent.secret_scope.load_env_file: a missing file is an empty mapping, never an error.
    try:
        text = path.read_text()
    except FileNotFoundError:
        return {}
    return dict(line.split('=',1) for line in text.splitlines() if '=' in line and not line.startswith('#'))
sys.modules['agent'] = types.ModuleType('agent')
sys.modules['agent.secret_scope'] = types.SimpleNamespace(load_env_file=fixture_env)
`;
  const overrides = String.raw`
assert str(ROOT).startswith(os.environ['HOME'] + '/')
production_identity = identity
def fixture_identity(name,home):
    return {'id':hashlib.sha256(str(home).encode()).hexdigest(),'service':'hermes-gateway' + ('' if name == 'default' else '-' + name) + '.service','command':['false'],'pid':0,'warning':None}
identity = fixture_identity
assert_port_owned = lambda public, owner: False
original_main = main
def main(action,candidate_id=None,option=None):
    global LOCK
    try: return original_main(action,candidate_id,option)
    finally:
        if LOCK is not None: LOCK.close(); LOCK = None
`;
  try {
    const result = spawnSync(installedPython ?? "python3", ["-"], {
      input: portable + HOST_HELPER + overrides + script,
      encoding: "utf8",
      env: { ...process.env, HOME: temp, HERMES_HOME: root, PYTHONDONTWRITEBYTECODE: "1" },
      timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    return {
      body: JSON.parse(result.stdout),
      env: readFileSync(join(root, ".env"), "utf8"),
      config: readFileSync(join(root, "config.yaml"), "utf8"),
    };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
test("Python helper preserves a valid existing key and unrelated configuration", () => {
  const result = fixture(
    String.raw`
id = main('discover')['candidates'][0]['id']
print(json.dumps(main('configure',id)))
`,
    {
      config: { model: { default: "existing-model" }, gateway: { multiplex_profiles: true } },
      env: "API_SERVER_KEY=existing-valid-token-12345\nOTHER_KEY=keep-me\n",
    },
  );
  assert.deepEqual(result.body, { ok: true });
  assert.equal(result.env, "API_SERVER_KEY=existing-valid-token-12345\nOTHER_KEY=keep-me\n");
  assert.match(result.config, /existing-model/);
});
test("Python helper provisions absent key once and does not alter sibling credentials", () => {
  const result = fixture(
    String.raw`
child = ROOT / 'profiles' / 'sophie'
child.mkdir(parents=True)
(child / '.env').write_text('API_SERVER_KEY=sophie-private-valid-key\n')
id = main('discover')['candidates'][0]['id']
main('configure',id)
first = (ROOT / '.env').read_text()
main('configure',id)
assert first == (ROOT / '.env').read_text()
assert (child / '.env').read_text() == 'API_SERVER_KEY=sophie-private-valid-key\n'
print(json.dumps({'token_length':len(envfile(ROOT)['API_SERVER_KEY'])}))
`,
    { config: { gateway: { multiplex_profiles: true } }, env: "OTHER_KEY=keep-me\n" },
  );
  assert.equal(result.body.token_length, 64);
  assert.match(result.env, /^OTHER_KEY=keep-me\nAPI_SERVER_KEY=[a-f0-9]{64}\n$/);
});
test("Python helper discovers actual profiles without exposing env secrets", () => {
  const result = fixture(
    String.raw`
child = ROOT / 'profiles' / 'sophie'
child.mkdir(parents=True)
(child / '.env').write_text('API_SERVER_KEY=sophie-private-valid-key\n')
(ROOT / 'profiles' / 'Bad Name').mkdir()
print(json.dumps(main('discover')))
`,
    { env: "API_SERVER_KEY=private-default-valid-key\n" },
  );
  assert.equal(result.body.candidates.length, 2);
  assert.equal(result.body.candidates[1].label, "Hermes sophie");
  assert.equal(result.body.candidates[1].warning, undefined);
  assert.ok(!JSON.stringify(result.body).includes("private"));
});
test("Python helper refuses external secret providers and invalid existing key", () => {
  const external = fixture(
    String.raw`
id = main('discover')['candidates'][0]['id']
entry('configure',id)
`,
    { config: { secrets: { bitwarden: { enabled: true } } } },
  );
  assert.equal(external.body.error, "external_secret_provider");
  assert.equal(external.env, "");
  const invalid = fixture(
    String.raw`
id = main('discover')['candidates'][0]['id']
entry('configure',id)
`,
    { env: "API_SERVER_KEY=weak\n" },
  );
  assert.equal(invalid.body.error, "api_key_invalid");
  assert.equal(invalid.env, "API_SERVER_KEY=weak\n");
});
test("Python helper stops on a changed candidate and port conflicts before configuration", () => {
  const changed = fixture(String.raw`
entry('configure','a' * 64)
`);
  assert.equal(changed.body.error, "candidate_changed");
  const conflict = fixture(String.raw`
id = main('discover')['candidates'][0]['id']
def conflict(public,owner): fail('port_conflict')
assert_port_owned = conflict
entry('configure',id)
`);
  assert.equal(conflict.body.error, "port_conflict");
  assert.equal(conflict.env, "");
  assert.equal(conflict.config, "{}");
});
test("Python helper pins plugin install and discards subprocess diagnostics on failure", () => {
  const result = fixture(
    String.raw`
id = main('discover')['candidates'][0]['id']
def fake_install(argv, **kwargs):
    assert argv[-5:] == ['install', SOURCE, '--ref', PIN, '--enable']
    assert kwargs['env']['HERMES_HOME'] == str(ROOT)
    assert kwargs['stdin'] == subprocess.DEVNULL
    assert kwargs['stdout'] == subprocess.PIPE
    assert '--force' not in argv
    import io
    return type('Result',(),{'stdout':io.BytesIO(b'secret=private'), 'wait':lambda self:1})()
subprocess.Popen = fake_install
entry('install',id)
`,
    { config: { gateway: { multiplex_profiles: true } } },
  );
  assert.equal(result.body.error, "plugin_install_failed");
});
test("already-ready retry performs verification without install or restart", async () => {
  const f = fake([
    {
      candidate: { ...candidate, hasToken: true, pluginInstalled: true, pluginEnabled: true },
      pluginStatus: "plugin_ready",
      changes: [],
    },
    {
      prepared: { baseUrl: "http://127.0.0.1:8642", token: "existing-private-token", profiles: [] },
    },
  ]);
  const steps: string[] = [];
  await prepareHost(f.execute, candidate.id, (s) => steps.push(s));
  assert.deepEqual(steps, ["inspecting", "verifying_gateway"]);
});
test("Python verifier returns only live profiles authenticated with their own credentials", () => {
  const result = fixture(
    String.raw`
for child, token in [('sophie','sophie-own-valid-token'),('missing',''),('rejected','rejected-own-valid-token')]:
    home = ROOT / 'profiles' / child
    home.mkdir(parents=True)
    (home / '.env').write_text('API_SERVER_KEY=' + token + '\n' if token else '')
assert_port_owned = lambda public, owner: True
def live(port,token,path):
    if path == '/deskrpg/info':
        assert token == 'default-own-valid-token'
        return 200, {'plugin':'deskrpg','version':'0.5.0'}
    if path == '/deskrpg/profiles': return 200, {'profiles':[{'name':n} for n in ('default','sophie','missing','rejected','../escape')]}
    if path == '/v1/models':
        assert token == 'default-own-valid-token'
        return 200, {'data':[]}
    if path == '/p/sophie/v1/models':
        assert token == 'sophie-own-valid-token'
        return 200, {'data':[]}
    return 401, None
request = live
id = main('discover')['candidates'][0]['id']
print(json.dumps(main('verify',id)))
`,
    {
      config: { gateway: { multiplex_profiles: true } },
      env: "API_SERVER_KEY=default-own-valid-token\n",
    },
  );
  assert.deepEqual(result.body.prepared.profiles, [
    { name: "default", token: "default-own-valid-token" },
    { name: "sophie", token: "sophie-own-valid-token" },
  ]);
});
test("Python restart invokes only the freshly identified selected service", () => {
  const result = fixture(
    String.raw`
def scoped_identity(name,home):
    result = fixture_identity(name,home)
    result['command'] = ['systemctl','--user','restart',result['service']]
    return result
identity = scoped_identity
calls = []
def restart(argv,timeout):
    calls.append(argv)
    return type('Result',(),{'returncode':0})()
run = restart
id = main('discover')['candidates'][0]['id']
main('restart',id)
print(json.dumps(calls))
`,
    {
      config: { gateway: { multiplex_profiles: true } },
      env: "API_SERVER_KEY=default-own-valid-token\n",
    },
  );
  assert.deepEqual(result.body, [["systemctl", "--user", "restart", "hermes-gateway.service"]]);
});
test("SSH host-key failures retain an actionable sanitized code", async () => {
  const f = fake([new Error("ssh_host_key_failed")]);
  await assert.rejects(discoverHost(f.execute), /^Error: ssh_host_key_failed$/);
});
test("named-profile setup keeps multiplex off, preserves default home, and verifies only its own profile", () => {
  const result = fixture(
    String.raw`
child = ROOT / 'profiles' / 'sophie'
child.mkdir(parents=True)
(child / '.env').write_text('API_SERVER_KEY=sophie-own-valid-token\n')
id = main('discover')['candidates'][1]['id']
main('configure',id)
assert not config(child)['gateway'].get('multiplex_profiles',False)
assert config(ROOT) == {}
assert envfile(ROOT)['API_SERVER_KEY'] == 'default-own-valid-token'
assert_port_owned = lambda public,owner: True
def live(port,token,path):
    assert token == 'sophie-own-valid-token'
    if path == '/deskrpg/info': return 200, {'plugin':'deskrpg','version':'0.5.0'}
    if path == '/deskrpg/profiles': return 200, {'profiles':[{'name':'default'},{'name':'sophie'}]}
    if path == '/p/sophie/v1/models': return 200, {'data':[]}
    return 404, None
request = live
print(json.dumps(main('verify',id)))
`,
    { env: "API_SERVER_KEY=default-own-valid-token\n" },
  );
  assert.deepEqual(result.body.prepared.profiles, [
    { name: "sophie", token: "sophie-own-valid-token" },
  ]);
  assert.equal(result.body.prepared.token, "sophie-own-valid-token");
});
test("external secret provider can coexist with an existing locally stored key verified against the owning service", () => {
  const result = fixture(
    String.raw`
assert_port_owned = lambda public, owner: True
request = lambda port, token, path: (200, {'data':[]}) if token == 'existing-valid-token-12345' and path == '/v1/models' else (401,None)
id = main('discover')['candidates'][0]['id']
print(json.dumps(main('configure',id)))
`,
    {
      config: { secrets: { bitwarden: { enabled: true } }, gateway: { multiplex_profiles: true } },
      env: "API_SERVER_KEY=existing-valid-token-12345\n",
    },
  );
  assert.deepEqual(result.body, { ok: true });
  assert.equal(result.env, "API_SERVER_KEY=existing-valid-token-12345\n");
  assert.match(result.config, /bitwarden/);
});
test("host-wide mutation lock rejects overlapping retries before any configuration change", () => {
  const result = fixture(String.raw`
import fcntl
held = open(ROOT / '.deskrpg-setup.lock','w')
fcntl.flock(held.fileno(),fcntl.LOCK_EX | fcntl.LOCK_NB)
id = main('discover')['candidates'][0]['id']
entry('configure',id)
`);
  assert.equal(result.body.error, "host_busy");
  assert.equal(result.env, "");
  assert.equal(result.config, "{}");
});
test("bootstrap timeout kills the owned installer process group, including descendants", () => {
  const temp = mkdtempSync(join(tmpdir(), "deskrpg-watchdog-test-"));
  let ownedPids: number[] = [];
  try {
    // Build a stdlib-only venv outside the watchdog window. A fresh executable shell
    // shim has cold-launch overhead; a bare symlink also breaks relocatable Python builds.
    const venv = spawnSync(
      "python3",
      ["-m", "venv", "--without-pip", join(temp, ".hermes/hermes-agent/venv")],
      {
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.equal(venv.status, 0, venv.stderr);
    const script = String.raw`
import json, os, pathlib, subprocess, sys, time
child = subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'])
(pathlib.Path.home() / 'owned-test-pid').write_text(json.dumps([os.getpid(), child.pid]))
time.sleep(30)
`;
    const result = spawnSync("python3", ["-c", HOST_BOOTSTRAP], {
      env: { ...process.env, HOME: temp },
      encoding: "utf8",
      // CI runs the full suite concurrently; allow the child enough cold-start time
      // to publish its owned PIDs before exercising the watchdog.
      input: JSON.stringify({ action: "install", timeout: 2, script }),
      timeout: 8000,
    });
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), { error: "host_operation_failed" });
    const pidFile = join(temp, "owned-test-pid");
    assert.ok(
      existsSync(pidFile),
      "helper must start and spawn a descendant before the watchdog fires",
    );
    ownedPids = JSON.parse(readFileSync(pidFile, "utf8"));
    assert.equal(ownedPids.length, 2);
    for (const pid of ownedPids) {
      assert.ok(Number.isInteger(pid) && pid > 0);
      const state = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
        encoding: "utf8",
      }).stdout.trim();
      assert.ok(
        state === "" || state.startsWith("Z"),
        `owned process ${pid} survived watchdog: ${state}`,
      );
    }
  } finally {
    for (const pid of ownedPids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already reaped */
      }
    }
    rmSync(temp, { recursive: true, force: true });
  }
});
test("launchd rejects loaded argv that differ from the reviewed disk service definition", () => {
  const result = fixture(String.raw`
sys.platform = 'darwin'
identity = production_identity
path = pathlib.Path.home() / 'Library' / 'LaunchAgents' / 'ai.hermes.gateway.plist'
path.parent.mkdir(parents=True)
args = [sys.executable,'-m','hermes_cli.main','gateway','run']
path.write_bytes(plistlib.dumps({'Label':'ai.hermes.gateway','ProgramArguments':args,'EnvironmentVariables':{'HERMES_HOME':str(ROOT)},'RunAtLoad':True}))
loaded = 'arguments = {\n' + '\n'.join([sys.executable,'-m','hermes_cli.main','--profile','sophie','gateway','run']) + '\n}\nHERMES_HOME => ' + str(ROOT) + '\npid = 123\n'
def state(argv,timeout=8,env=None):
    return type('Result',(),{'returncode':0 if argv[2].startswith('gui/') else 113,'stdout':loaded})()
run = state
print(json.dumps(main('discover')))
`);
  assert.equal(result.body.candidates[0].warning, "service_identity_mismatch");
});
test("inspection projects only profile names and key availability", async () => {
  const f = fake([
    {
      candidate,
      pluginStatus: "unknown",
      changes: [],
      profiles: [{ name: "sophie", hasToken: true, token: "private-profile-token" }],
    },
  ]);
  const result = await inspectHost(f.execute, candidate.id);
  assert.deepEqual(result.profiles, [{ name: "sophie", hasToken: true }]);
  assert.ok(!JSON.stringify(result).includes("private-profile-token"));
});
test("systemd verifies exact live argv and disk unit before authorizing a selected restart", () => {
  const result = fixture(String.raw`
sys.platform = 'linux'
identity = production_identity
path = pathlib.Path.home() / '.config' / 'systemd' / 'user' / 'hermes-gateway.service'
path.parent.mkdir(parents=True)
args = [sys.executable,'-m','hermes_cli.main','gateway','run']
path.write_text('[Service]\nExecStart=' + shlex.join(args) + '\nEnvironment="HERMES_HOME=' + str(ROOT) + '"\n')
wrong = [sys.executable,'-m','hermes_cli.main','--profile','sophie','gateway','run']
def state(argv,timeout=8,env=None):
    text = 'FragmentPath=' + str(path) + '\nDropInPaths=\nMainPID=123\nEnvironment=HERMES_HOME=' + str(ROOT) + '\nExecStart={ path=' + sys.executable + ' ; argv[]=' + shlex.join(wrong) + ' ; }\n'
    return type('Result',(),{'returncode':0,'stdout':text})()
run = state
bad = main('discover')['candidates'][0]
wrong = args
good = main('discover')['candidates'][0]
print(json.dumps({'bad':bad,'good':good}))
`);
  assert.equal(result.body.bad.warning, "service_identity_mismatch");
  assert.equal(result.body.good.warning, undefined);
});
test("inspection removes the external-provider warning after authenticating the existing local key", () => {
  const result = fixture(
    String.raw`
assert_port_owned = lambda public,owner: True
def live(port,token,path):
    assert token == 'existing-valid-token-12345'
    if path == '/v1/models': return 200, {'data':[]}
    if path == '/deskrpg/info': return 200, {'plugin':'deskrpg','version':'0.5.0'}
    return 404, None
request = live
id = main('discover')['candidates'][0]['id']
print(json.dumps(main('inspect',id)))
`,
    {
      config: { secrets: { bitwarden: { enabled: true } }, gateway: { multiplex_profiles: true } },
      env: "API_SERVER_KEY=existing-valid-token-12345\n",
    },
  );
  assert.equal(result.body.pluginStatus, "plugin_ready");
  assert.equal(result.body.candidate.warning, undefined);
  assert.equal(result.env, "API_SERVER_KEY=existing-valid-token-12345\n");
});
test("inspection marks every safely provisionable profile, owner and siblings alike", () => {
  const result = fixture(
    String.raw`
child = ROOT / 'profiles' / 'sophie'
child.mkdir(parents=True)
id = main('discover')['candidates'][0]['id']
print(json.dumps(main('inspect',id)))
`,
    { config: { gateway: { multiplex_profiles: true } } },
  );
  // 계약 2: 형제 프로필도 키가 없고 외부 제공자를 쓰지 않으면 발급 대상이다.
  assert.deepEqual(result.body.profiles, [
    { name: "default", hasToken: false, canProvision: true },
    { name: "sophie", hasToken: false, canProvision: true },
  ]);
  assert.equal(result.env, "");
});
test("inspection does not offer provisioning through an unavailable external secret provider", () => {
  const result = fixture(
    String.raw`
id = main('discover')['candidates'][0]['id']
print(json.dumps(main('inspect',id)))
`,
    { config: { secrets: { bitwarden: { enabled: true } } } },
  );
  assert.deepEqual(result.body.profiles, [{ name: "default", hasToken: false }]);
  assert.equal(result.body.candidate.warning, "external_secret_provider");
  assert.equal(result.env, "");
});
test("inspection safely forwards optional provisioning capability without credentials", async () => {
  const f = fake([
    {
      candidate,
      pluginStatus: "unknown",
      changes: [],
      profiles: [
        { name: "sophie", hasToken: false, canProvision: true, token: "private-profile-token" },
      ],
    },
  ]);
  const result = await inspectHost(f.execute, candidate.id);
  assert.deepEqual(result.profiles, [{ name: "sophie", hasToken: false, canProvision: true }]);
  assert.ok(!JSON.stringify(result).includes("private-profile-token"));
});

for (const [diagnostic, expected] of [
  ["Security scan: BLOCKED. secret=private", "plugin_security_review_required"],
  ["fatal: Repository not found. secret=private", "plugin_source_unavailable"],
  ["unexpected secret=private", "plugin_install_failed"],
] as const) {
  test(`installer reports only safe code: ${expected}`, () => {
    const result = fixture(
      String.raw`
id = main('discover')['candidates'][0]['id']
import io
def fake_install(argv, **kwargs):
    assert '--force' not in argv
    return type('Result',(),{'stdout':io.BytesIO(${JSON.stringify(diagnostic)}.encode()), 'wait':lambda self:1})()
subprocess.Popen = fake_install
entry('install',id)
`,
      { config: { gateway: { multiplex_profiles: true } } },
    );
    assert.deepEqual(result.body, { error: expected });
  });
}
test("installer bounds diagnostics and terminates excessive output", () => {
  const result = fixture(
    String.raw`
id = main('discover')['candidates'][0]['id']
import io
class Child:
    stdout = io.BytesIO(b'x' * 262145)
    killed = False
    def kill(self): self.killed = True
    def wait(self):
        assert self.killed
        return 1
subprocess.Popen = lambda *args, **kwargs: Child()
entry('install',id)
`,
    { config: { gateway: { multiplex_profiles: true } } },
  );
  assert.deepEqual(result.body, { error: "output_limit" });
});

test("Hermes 버전이 하한보다 낮으면 준비 단계에서 거부한다", () => {
  const result = fixture(
    String.raw`
id = main('discover')['candidates'][0]['id']
entry('configure',id)
`,
    { config: { gateway: { multiplex_profiles: true } }, hermesVersion: "0.21.0" },
  );
  assert.equal(result.body.error, "hermes_version_unsupported");
  assert.equal(result.env, "");
});
test("Hermes 버전의 숫자가 아닌 꼬리는 비교에서 무시한다", () => {
  const result = fixture(
    String.raw`
print(json.dumps({'candidate': main('discover')['candidates'][0], 'configure': main('configure',main('discover')['candidates'][0]['id'])}))
`,
    { config: { gateway: { multiplex_profiles: true } }, hermesVersion: "0.21.1rc1" },
  );
  assert.deepEqual(result.body.configure, { ok: true });
  assert.equal(result.body.candidate.warning, undefined);
});
test("Hermes 버전을 읽지 못하면 막지 않고 경고만 남긴다", () => {
  const result = fixture(
    String.raw`
id = main('discover')['candidates'][0]['id']
print(json.dumps({'candidate': main('discover')['candidates'][0], 'configure': main('configure',id)}))
`,
    { config: { gateway: { multiplex_profiles: true } }, hermesVersion: null },
  );
  assert.equal(result.body.candidate.version, "unknown");
  assert.equal(result.body.candidate.warning, "hermes_version_unknown");
  assert.deepEqual(result.body.configure, { ok: true });
});
test("플러그인이 구버전이면 updating_plugin 이 changes 에 들어간다", () => {
  const result = fixture(
    String.raw`
print(json.dumps(main('inspect',main('discover')['candidates'][0]['id'])))
`,
    {
      config: { gateway: { multiplex_profiles: true }, plugins: { enabled: ["deskrpg"] } },
      plugin: { name: "deskrpg", version: "0.5.0" },
    },
  );
  assert.equal(result.body.candidate.pluginVersion, "0.5.0");
  assert.ok(result.body.changes.includes("updating_plugin"));
  assert.ok(!result.body.changes.includes("installing_plugin"));
  assert.ok(result.body.changes.includes("restarting_gateway"));
});
test("플러그인 버전이 같거나 높으면 갱신 단계가 들어가지 않는다", () => {
  for (const version of ["0.6.0", "0.7.1"]) {
    const result = fixture(
      String.raw`
print(json.dumps(main('inspect',main('discover')['candidates'][0]['id'])))
`,
      {
        config: { gateway: { multiplex_profiles: true }, plugins: { enabled: ["deskrpg"] } },
        plugin: { name: "deskrpg", version },
      },
    );
    assert.equal(result.body.candidate.pluginVersion, version);
    assert.ok(!result.body.changes.includes("updating_plugin"));
    assert.ok(!result.body.changes.includes("installing_plugin"));
  }
});
test("구버전 갱신은 고정 커밋을 --force 로 다시 설치하고 버전을 되읽어 확인한다", () => {
  const result = fixture(
    String.raw`
id = main('discover')['candidates'][0]['id']
import io
calls = []
def fake_install(argv, **kwargs):
    calls.append(argv)
    assert kwargs['env']['HERMES_HOME'] == str(ROOT)
    (ROOT / 'plugins' / 'deskrpg' / 'plugin.yaml').write_text(json.dumps({'name':'deskrpg','version':PLUGIN_VERSION}))
    return type('Result',(),{'stdout':io.BytesIO(b''), 'wait':lambda self:0})()
subprocess.Popen = fake_install
result = main('install',id)
print(json.dumps({'result':result,'argv':calls[0][-6:]}))
`,
    {
      config: { gateway: { multiplex_profiles: true }, plugins: { enabled: ["deskrpg"] } },
      plugin: { name: "deskrpg", version: "0.5.0" },
    },
  );
  assert.deepEqual(result.body.result, { ok: true });
  assert.deepEqual(result.body.argv, [
    "install",
    "https://github.com/dandacompany/deskrpg-hermes-plugin",
    "--ref",
    "1be18d79bf1b8d40890b95517a8131cb2ae48c6f",
    "--force",
    "--enable",
  ]);
});
test("갱신이 실패하면 plugin_update_failed 로만 알리고 --force 가 보안 스캔을 우회하지 않는다", () => {
  for (const [diagnostic, expected] of [
    ["unexpected secret=private", "plugin_update_failed"],
    ["Security scan: BLOCKED. secret=private", "plugin_security_review_required"],
  ] as const) {
    const result = fixture(
      String.raw`
id = main('discover')['candidates'][0]['id']
import io
def fake_install(argv, **kwargs):
    assert '--force' in argv
    return type('Result',(),{'stdout':io.BytesIO(DIAGNOSTIC.encode()), 'wait':lambda self:1})()
subprocess.Popen = fake_install
entry('install',id)
`.replace("DIAGNOSTIC", JSON.stringify(diagnostic)),
      {
        config: { gateway: { multiplex_profiles: true }, plugins: { enabled: ["deskrpg"] } },
        plugin: { name: "deskrpg", version: "0.5.0" },
      },
    );
    assert.deepEqual(result.body, { error: expected });
  }
});
test("갱신 명령이 성공해도 버전이 그대로면 갱신 실패로 처리한다", () => {
  const result = fixture(
    String.raw`
id = main('discover')['candidates'][0]['id']
import io
subprocess.Popen = lambda argv, **kwargs: type('Result',(),{'stdout':io.BytesIO(b''), 'wait':lambda self:0})()
entry('install',id)
`,
    {
      config: { gateway: { multiplex_profiles: true }, plugins: { enabled: ["deskrpg"] } },
      plugin: { name: "deskrpg", version: "0.5.0" },
    },
  );
  assert.deepEqual(result.body, { error: "plugin_update_failed" });
});
const MANUAL = String.raw`
state = {'installed': False}
def manual_identity(name,home):
    result = fixture_identity(name,home)
    if not state['installed']:
        result['service'] = 'manual'
        result['command'] = None
        result['warning'] = 'managed_service_required'
    return result
identity = manual_identity
`;
test("서비스 유닛이 없으면 installing_service 가 changes 에 들어간다", () => {
  const result = fixture(
    MANUAL +
      String.raw`
print(json.dumps(main('inspect',main('discover')['candidates'][0]['id'])))
`,
    { config: { gateway: { multiplex_profiles: true } } },
  );
  assert.deepEqual(result.body.changes.slice(0, 2), ["installing_service", "installing_plugin"]);
  assert.ok(result.body.changes.includes("restarting_gateway"));
});
test("서비스 설치는 Hermes CLI 만 부르고 유닛 파일을 직접 쓰지 않는다", () => {
  const result = fixture(
    MANUAL +
      String.raw`
id = main('discover')['candidates'][0]['id']
import io
calls = []
def fake(argv, **kwargs):
    calls.append(argv)
    state['installed'] = True
    return type('Result',(),{'stdout':io.BytesIO(b''), 'wait':lambda self:0})()
subprocess.Popen = fake
result = main('install-service',id)
written = sorted(str(p.relative_to(pathlib.Path.home())) for p in pathlib.Path.home().rglob('*') if p.is_file())
print(json.dumps({'result':result,'argv':calls[0][1:],'written':written}))
`,
    { config: { gateway: { multiplex_profiles: true } } },
  );
  assert.equal(result.body.result.ok, true);
  // 유닛을 만들면 후보 id(정의의 해시)가 바뀐다 — 새 id 를 돌려줘야 이어지는 단계가 산다.
  assert.match(result.body.result.candidateId, /^[0-9a-f]{64}$/);
  assert.deepEqual(result.body.argv, [
    "-m",
    "hermes_cli.main",
    "--profile",
    "default",
    "gateway",
    "install",
  ]);
  assert.ok(!result.body.written.some((p: string) => /LaunchAgents|systemd/.test(p)));
});
test("서비스 설치 뒤에도 유닛이 없으면 service_install_failed 로 멈춘다", () => {
  const result = fixture(
    MANUAL +
      String.raw`
id = main('discover')['candidates'][0]['id']
import io
subprocess.Popen = lambda argv, **kwargs: type('Result',(),{'stdout':io.BytesIO(b''), 'wait':lambda self:0})()
entry('install-service',id)
`,
    { config: { gateway: { multiplex_profiles: true } } },
  );
  assert.deepEqual(result.body, { error: "service_install_failed" });
});
test("시간대가 이미 있으면 덮어쓰지 않는다", () => {
  const result = fixture(
    String.raw`
id = main('discover')['candidates'][0]['id']
print(json.dumps({'candidate': main('discover')['candidates'][0], 'result': main('set-timezone',id,'Asia/Seoul')}))
`,
    { config: { gateway: { multiplex_profiles: true }, timezone: "Europe/Paris" } },
  );
  assert.equal(result.body.candidate.timezone, "Europe/Paris");
  assert.deepEqual(result.body.result, { ok: true });
  assert.match(result.config, /Europe\/Paris/);
  assert.ok(!result.config.includes("Asia/Seoul"));
});
test("시간대가 비어 있으면 요청한 IANA 이름을 넣는다", () => {
  const result = fixture(
    String.raw`
id = main('discover')['candidates'][0]['id']
print(json.dumps({'candidate': main('discover')['candidates'][0], 'result': main('set-timezone',id,'Asia/Seoul'), 'stored': config(ROOT).get('timezone')}))
`,
    { config: { gateway: { multiplex_profiles: true }, model: { default: "keep-me" } } },
  );
  assert.equal(result.body.candidate.timezone, null);
  assert.deepEqual(result.body.result, { ok: true });
  assert.equal(result.body.stored, "Asia/Seoul");
  assert.match(result.config, /keep-me/);
});
test("호스트도 잘못된 시간대를 timezone_invalid 로 거부한다", () => {
  for (const value of ["Asia Seoul", "/Asia/Seoul", "", "9Asia/Seoul", "A" + "b".repeat(70)]) {
    const result = fixture(
      String.raw`
id = main('discover')['candidates'][0]['id']
entry('set-timezone',id,${JSON.stringify(value)})
`,
      { config: { gateway: { multiplex_profiles: true } } },
    );
    assert.deepEqual(result.body, { error: "timezone_invalid" });
    assert.ok(!result.config.includes("timezone"));
  }
});
test("갱신·서비스 설치·시간대 단계는 계약 순서대로 실행된다", async () => {
  const stale = {
    ...candidate,
    pluginInstalled: true,
    pluginEnabled: true,
    pluginVersion: "0.5.0",
    hasToken: true,
  };
  const f = fake([
    {
      candidate: stale,
      pluginStatus: "plugin_ready",
      changes: ["installing_service", "updating_plugin", "configuring_api"],
    },
    { ok: true },
    { ok: true },
    { ok: true },
    { ok: true },
    { ok: true },
    {
      prepared: { baseUrl: "http://127.0.0.1:8642", token: "existing-private-token", profiles: [] },
    },
  ]);
  const steps: string[] = [];
  await prepareHost(f.execute, candidate.id, (s) => steps.push(s), undefined, "Asia/Seoul");
  assert.deepEqual(steps, [
    "inspecting",
    "installing_service",
    "updating_plugin",
    "configuring_api",
    "setting_timezone",
    "restarting_gateway",
    "verifying_gateway",
  ]);
  const actions = f.calls.map((c) => JSON.parse(c.input!).action);
  assert.deepEqual(actions, [
    "inspect",
    "install-service",
    "install",
    "configure",
    "set-timezone",
    "restart",
    "verify",
  ]);
  assert.ok(f.calls[4].input!.includes("Asia/Seoul"));
});
test("후보에 시간대가 이미 있으면 설정 단계를 건너뛴다", async () => {
  const f = fake([
    {
      candidate: {
        ...candidate,
        pluginInstalled: true,
        pluginEnabled: true,
        pluginVersion: "0.6.0",
        hasToken: true,
        timezone: "Europe/Paris",
      },
      pluginStatus: "plugin_ready",
      changes: [],
    },
    {
      prepared: { baseUrl: "http://127.0.0.1:8642", token: "existing-private-token", profiles: [] },
    },
  ]);
  const steps: string[] = [];
  await prepareHost(f.execute, candidate.id, (s) => steps.push(s), undefined, "Asia/Seoul");
  assert.deepEqual(steps, ["inspecting", "verifying_gateway"]);
});
test("잘못된 시간대는 호스트를 실행하기 전에 거부한다", async () => {
  const f = fake([
    {
      candidate: { ...candidate, pluginInstalled: true, pluginEnabled: true, hasToken: true },
      pluginStatus: "plugin_ready",
      changes: [],
    },
  ]);
  await assert.rejects(
    prepareHost(f.execute, candidate.id, () => {}, undefined, "Asia Seoul"),
    /^Error: timezone_invalid$/,
  );
  assert.equal(f.calls.length, 1);
});

// --- 계약 2: 프로필 생성·키 발급 -------------------------------------------------
test("호스트는 잘못된 이름과 예약어를 실행 전에 거부한다", () => {
  for (const name of ["Sophie", "-bad", "so phie", "a".repeat(65), "", "default", "root"]) {
    const result = fixture(
      String.raw`
subprocess.Popen = lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError('must not run'))
entry('create-profile',main('discover')['candidates'][0]['id'],${JSON.stringify(JSON.stringify({ name }))})
`,
      { config: { gateway: { multiplex_profiles: true } } },
    );
    assert.deepEqual(result.body, { error: "profile_name_invalid" });
  }
});
test("설명이 200자를 넘거나 개행을 담으면 프로필을 만들지 않는다", () => {
  for (const description of ["x".repeat(201), "두\n줄"]) {
    const result = fixture(
      String.raw`
subprocess.Popen = lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError('must not run'))
entry('create-profile',main('discover')['candidates'][0]['id'],OPTION)
`.replace("OPTION", JSON.stringify(JSON.stringify({ name: "sophie", description }))),
      { config: { gateway: { multiplex_profiles: true } } },
    );
    assert.deepEqual(result.body, { error: "profile_name_invalid" });
  }
});
test("이미 있는 프로필 이름은 profile_exists 로 거부한다", () => {
  const result = fixture(
    String.raw`
(ROOT / 'profiles' / 'sophie').mkdir(parents=True)
subprocess.Popen = lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError('must not run'))
entry('create-profile',main('discover')['candidates'][0]['id'],${JSON.stringify(JSON.stringify({ name: "sophie" }))})
`,
    { config: { gateway: { multiplex_profiles: true } } },
  );
  assert.deepEqual(result.body, { error: "profile_exists" });
});
test("소유자(default)가 아닌 후보는 프로필을 늘릴 수 없다", () => {
  const result = fixture(
    String.raw`
(ROOT / 'profiles' / 'sophie').mkdir(parents=True)
subprocess.Popen = lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError('must not run'))
entry('create-profile',main('discover')['candidates'][1]['id'],${JSON.stringify(JSON.stringify({ name: "oliver" }))})
`,
    { config: { gateway: { multiplex_profiles: true } } },
  );
  assert.deepEqual(result.body, { error: "profile_provision_forbidden" });
});
test("프로필 생성은 Hermes CLI 만 부르고 디스크에 생겼는지 되읽어 확인한다", () => {
  const result = fixture(
    String.raw`
import io
calls = []
def fake(argv, **kwargs):
    calls.append(argv)
    (ROOT / 'profiles' / 'sophie').mkdir(parents=True)
    return type('Result',(),{'stdout':io.BytesIO(b''), 'wait':lambda self:0})()
subprocess.Popen = fake
created = main('create-profile',main('discover')['candidates'][0]['id'],OPTION)
print(json.dumps({'created':created,'argv':calls[0][1:]}))
`.replace("OPTION", JSON.stringify(JSON.stringify({ name: "sophie", description: "리서치" }))),
    { config: { gateway: { multiplex_profiles: true } } },
  );
  assert.deepEqual(result.body.created, { ok: true, profile: "sophie" });
  assert.deepEqual(result.body.argv, [
    "-m",
    "hermes_cli.main",
    "profile",
    "create",
    "sophie",
    "--description",
    "리서치",
  ]);
});
test("명령이 성공해도 프로필 디렉터리가 없으면 profile_create_failed 다", () => {
  const result = fixture(
    String.raw`
import io
subprocess.Popen = lambda argv, **kwargs: type('Result',(),{'stdout':io.BytesIO(b''), 'wait':lambda self:0})()
entry('create-profile',main('discover')['candidates'][0]['id'],${JSON.stringify(JSON.stringify({ name: "sophie" }))})
`,
    { config: { gateway: { multiplex_profiles: true } } },
  );
  assert.deepEqual(result.body, { error: "profile_create_failed" });
});
test("허용 목록 밖의 새 프로필은 실패가 아니라 profile_not_served 경고다", () => {
  const result = fixture(
    String.raw`
import io
def fake(argv, **kwargs):
    (ROOT / 'profiles' / 'sophie').mkdir(parents=True)
    return type('Result',(),{'stdout':io.BytesIO(b''), 'wait':lambda self:0})()
subprocess.Popen = fake
print(json.dumps(main('create-profile',main('discover')['candidates'][0]['id'],${JSON.stringify(JSON.stringify({ name: "sophie" }))})))
`,
    {
      config: {
        gateway: { multiplex_profiles: true, multiplex_profile_allowlist: ["default", "oliver"] },
      },
    },
  );
  assert.deepEqual(result.body, { ok: true, profile: "sophie", warning: "profile_not_served" });
  assert.ok(!result.config.includes("sophie"));
});
test("키가 이미 있는 프로필은 회전하지 않고 그대로 성공한다", () => {
  const result = fixture(
    String.raw`
child = ROOT / 'profiles' / 'sophie'
child.mkdir(parents=True)
(child / '.env').write_text('API_SERVER_KEY=sophie-private-valid-key\n')
result = main('provision-key',main('discover')['candidates'][0]['id'],'sophie')
print(json.dumps({'result':result,'env':(child / '.env').read_text()}))
`,
    { config: { gateway: { multiplex_profiles: true } } },
  );
  assert.deepEqual(result.body.result, { ok: true, provisioned: false, profile: "sophie" });
  assert.equal(result.body.env, "API_SERVER_KEY=sophie-private-valid-key\n");
});
test("키가 없는 형제 프로필에만 키를 새로 발급한다", () => {
  const result = fixture(
    String.raw`
child = ROOT / 'profiles' / 'sophie'
child.mkdir(parents=True)
(child / '.env').write_text('OTHER=keep-me\n')
result = main('provision-key',main('discover')['candidates'][0]['id'],'sophie')
print(json.dumps({'result':result,'length':len(envfile(child)['API_SERVER_KEY']),'env':(child / '.env').read_text()}))
`,
    { config: { gateway: { multiplex_profiles: true } } },
  );
  assert.deepEqual(result.body.result, { ok: true, provisioned: true, profile: "sophie" });
  assert.equal(result.body.length, 64);
  assert.match(result.body.env, /^OTHER=keep-me\nAPI_SERVER_KEY=[a-f0-9]{64}\n$/);
  // 소유자의 키는 configure 가 다룬다 — 이 액션이 건드리지 않는다.
  assert.equal(result.env, "");
});
test("외부 비밀 제공자를 쓰는 프로필에는 키를 발급하지 않는다", () => {
  const result = fixture(
    String.raw`
child = ROOT / 'profiles' / 'sophie'
child.mkdir(parents=True)
(child / 'config.yaml').write_text(json.dumps({'secrets':{'bitwarden':{'enabled':True}}}))
entry('provision-key',main('discover')['candidates'][0]['id'],'sophie')
`,
    { config: { gateway: { multiplex_profiles: true } } },
  );
  assert.deepEqual(result.body, { error: "profile_provision_forbidden" });
});
test("소유자가 아닌 후보는 형제 프로필 키를 발급할 수 없다", () => {
  const result = fixture(
    String.raw`
for name in ('sophie','oliver'):
    (ROOT / 'profiles' / name).mkdir(parents=True)
entry('provision-key',main('discover')['candidates'][2]['id'],'oliver')
`,
    { config: { gateway: { multiplex_profiles: true } } },
  );
  assert.deepEqual(result.body, { error: "profile_provision_forbidden" });
});
test("provision-key 도 예약어와 잘못된 이름을 거부한다", () => {
  for (const name of ["default", "root", "Sophie", ""]) {
    const result = fixture(
      String.raw`
entry('provision-key',main('discover')['candidates'][0]['id'],${JSON.stringify(name)})
`,
      { config: { gateway: { multiplex_profiles: true } } },
    );
    assert.deepEqual(result.body, { error: "profile_name_invalid" });
  }
});
test("점검은 키가 없는 형제 프로필에도 canProvision 을 채운다", () => {
  const result = fixture(
    String.raw`
for name, token in (('sophie',''),('oliver','oliver-private-valid-key')):
    home = ROOT / 'profiles' / name
    home.mkdir(parents=True)
    if token: (home / '.env').write_text('API_SERVER_KEY=' + token + '\n')
print(json.dumps(main('inspect',main('discover')['candidates'][0]['id'])['profiles']))
`,
    { config: { gateway: { multiplex_profiles: true } } },
  );
  assert.deepEqual(result.body, [
    { name: "default", hasToken: false, canProvision: true },
    { name: "oliver", hasToken: true },
    { name: "sophie", hasToken: false, canProvision: true },
  ]);
});
test("검증에서 모델 목록이 비면 실패가 아니라 model_provider_required 경고다", () => {
  const result = fixture(
    String.raw`
assert_port_owned = lambda public, owner: True
def live(port,token,path):
    if path == '/deskrpg/info': return 200, {'plugin':'deskrpg','version':'0.6.0'}
    if path == '/deskrpg/profiles': return 200, {'profiles':[{'name':'default'}]}
    if path == '/v1/models': return 200, {'data':[]}
    return 404, None
request = live
print(json.dumps(main('verify',main('discover')['candidates'][0]['id'])))
`,
    {
      config: { gateway: { multiplex_profiles: true } },
      env: "API_SERVER_KEY=default-own-valid-token\n",
    },
  );
  assert.deepEqual(result.body.warnings, ["model_provider_required"]);
  assert.deepEqual(result.body.prepared.profiles, [
    { name: "default", token: "default-own-valid-token" },
  ]);
});
test("모델이 하나라도 있으면 경고를 남기지 않는다", () => {
  const result = fixture(
    String.raw`
assert_port_owned = lambda public, owner: True
def live(port,token,path):
    if path == '/deskrpg/info': return 200, {'plugin':'deskrpg','version':'0.6.0'}
    if path == '/deskrpg/profiles': return 200, {'profiles':[{'name':'default'}]}
    if path == '/v1/models': return 200, {'data':[{'id':'model'}]}
    return 404, None
request = live
print(json.dumps(main('verify',main('discover')['candidates'][0]['id'])))
`,
    {
      config: { gateway: { multiplex_profiles: true } },
      env: "API_SERVER_KEY=default-own-valid-token\n",
    },
  );
  assert.deepEqual(result.body.warnings, []);
});
test("프로필 생성·키 발급 단계는 플러그인 작업보다 앞에서 계약 순서대로 돈다", async () => {
  const f = fake([
    { candidate, pluginStatus: "plugin_absent", changes: ["installing_plugin"] },
    { ok: true, profile: "sophie" },
    { ok: true, provisioned: true, profile: "sophie" },
    { ok: true },
    { ok: true },
    { ok: true },
    {
      prepared: {
        baseUrl: "http://127.0.0.1:8642",
        token: "existing-private-token",
        profiles: [{ name: "sophie", token: "sophie-private-token" }],
      },
      warnings: ["model_provider_required"],
    },
  ]);
  const steps: string[] = [];
  const result = await prepareHost(
    f.execute,
    candidate.id,
    (s) => steps.push(s),
    undefined,
    undefined,
    {
      createProfile: { name: "sophie", description: "리서치" },
    },
  );
  assert.deepEqual(steps, [
    "inspecting",
    "creating_profile",
    "provisioning_keys",
    "installing_plugin",
    "configuring_api",
    "restarting_gateway",
    "verifying_gateway",
  ]);
  assert.deepEqual(
    f.calls.map((c) => JSON.parse(c.input!).action),
    ["inspect", "create-profile", "provision-key", "install", "configure", "restart", "verify"],
  );
  assert.deepEqual(result.warnings, ["model_provider_required"]);
});
test("허용 목록 밖으로 만들어진 프로필에는 키를 발급하지 않고 경고만 전달한다", async () => {
  const f = fake([
    {
      candidate: {
        ...candidate,
        pluginInstalled: true,
        pluginEnabled: true,
        pluginVersion: "0.6.0",
        hasToken: true,
      },
      pluginStatus: "plugin_ready",
      changes: [],
    },
    { ok: true, profile: "sophie", warning: "profile_not_served" },
    {
      prepared: { baseUrl: "http://127.0.0.1:8642", token: "existing-private-token", profiles: [] },
    },
  ]);
  const steps: string[] = [];
  const result = await prepareHost(
    f.execute,
    candidate.id,
    (s) => steps.push(s),
    undefined,
    undefined,
    {
      createProfile: { name: "sophie" },
    },
  );
  assert.deepEqual(steps, ["inspecting", "creating_profile", "verifying_gateway"]);
  assert.deepEqual(result.warnings, ["profile_not_served"]);
});
test("발급한 키가 실제로 서빙되지 않으면 profile_verify_failed 로 멈춘다", async () => {
  const f = fake([
    {
      candidate: {
        ...candidate,
        pluginInstalled: true,
        pluginEnabled: true,
        pluginVersion: "0.6.0",
        hasToken: true,
      },
      pluginStatus: "plugin_ready",
      changes: [],
    },
    { ok: true, provisioned: true, profile: "sophie" },
    {
      prepared: { baseUrl: "http://127.0.0.1:8642", token: "existing-private-token", profiles: [] },
    },
  ]);
  await assert.rejects(
    prepareHost(f.execute, candidate.id, () => {}, undefined, undefined, {
      provisionKeys: ["sophie"],
    }),
    /^Error: profile_verify_failed$/,
  );
});
test("서버는 호스트에 넘기기 전에 이름·개수를 다시 본다", async () => {
  const f = fake([]);
  for (const provision of [
    { createProfile: { name: "Sophie" } },
    { createProfile: { name: "default" } },
    { createProfile: { name: "sophie", description: "두\n줄" } },
    { provisionKeys: ["root"] },
  ]) {
    await assert.rejects(
      prepareHost(f.execute, candidate.id, () => {}, undefined, undefined, provision),
      /^Error: profile_name_invalid$/,
    );
  }
  await assert.rejects(
    prepareHost(f.execute, candidate.id, () => {}, undefined, undefined, {
      provisionKeys: Array.from({ length: 11 }, (_, i) => `profile${i}`),
    }),
    /^Error: setup_invalid_request$/,
  );
  assert.equal(f.calls.length, 0);
});

// --- 계약 2: 로컬 Hermes 설치 ----------------------------------------------------
import { HOST_INSTALLER } from "./host-helper";
/** 설치 스크립트를 실제 네트워크·bash 없이 돌린다. 관찰 결과는 HOME 아래 파일로만 받는다. */
function installer(prelude: string, prepared = false) {
  const temp = mkdtempSync(join(tmpdir(), "deskrpg-install-test-"));
  if (prepared) mkdirSync(join(temp, ".hermes/hermes-agent"), { recursive: true });
  try {
    const result = spawnSync("python3", ["-"], {
      input: prelude + HOST_INSTALLER,
      encoding: "utf8",
      env: { ...process.env, HOME: temp, PYTHONDONTWRITEBYTECODE: "1" },
      timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr);
    const observed = join(temp, "observed.json");
    return {
      body: JSON.parse(result.stdout),
      observed: existsSync(observed) ? JSON.parse(readFileSync(observed, "utf8")) : null,
    };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
const INSTALL_SCRIPT = "#!/usr/bin/env bash\necho installing hermes\n";
const STUBS = String.raw`
import io, json, os, pathlib, subprocess, urllib.request
observed = {'fetched': [], 'argv': None, 'script_exists': False, 'script_body': None, 'probe': None}
def record():
    (pathlib.Path.home() / 'observed.json').write_text(json.dumps(observed))
class FakeResponse:
    def __init__(self, body): self.body = body
    def read(self, size=-1): return self.body
    def __enter__(self): return self
    def __exit__(self, *unused): return False
class FakeOpener:
    def open(self, url, timeout=None):
        observed['fetched'].append(url)
        record()
        if BODY is None: raise OSError('network down')
        return FakeResponse(BODY)
urllib.request.build_opener = lambda *args, **kwargs: FakeOpener()
class FakeChild:
    def __init__(self, output): self.stdout = io.BytesIO(output)
    def kill(self): pass
    def wait(self): return EXIT
def fake_popen(argv, **kwargs):
    observed['argv'] = list(argv)
    observed['script_exists'] = os.path.isfile(argv[1]) if len(argv) > 1 else False
    observed['script_body'] = pathlib.Path(argv[1]).read_text() if observed['script_exists'] else None
    record()
    if EXIT == 0:
        venv = pathlib.Path.home() / '.hermes' / 'hermes-agent' / 'venv' / 'bin'
        venv.mkdir(parents=True)
        (venv / 'python').write_text('')
    return FakeChild(OUTPUT)
subprocess.Popen = fake_popen
def fake_run(argv, **kwargs):
    observed['probe'] = list(argv)[1:]
    record()
    return type('Result',(),{'returncode':PROBE})()
subprocess.run = fake_run
`;
function stubs(
  options: { body?: string | null; exit?: number; probe?: number; output?: string } = {},
) {
  return STUBS.replace("BODY is None", options.body === null ? "True" : "False")
    .replace(
      /\bBODY\b/,
      options.body === null ? "None" : JSON.stringify(options.body ?? INSTALL_SCRIPT) + ".encode()",
    )
    .replace(/\bEXIT\b/g, String(options.exit ?? 0))
    .replace(/\bOUTPUT\b/g, JSON.stringify(options.output ?? "installing\n") + ".encode()")
    .replace(/\bPROBE\b/g, String(options.probe ?? 0));
}
test("설치 스크립트는 파이프가 아니라 파일로 실행되고 지문이 결과에 실린다", () => {
  const result = installer(stubs());
  assert.equal(result.body.ok, true);
  assert.match(result.body.installerDigest, /^[a-f0-9]{64}$/);
  assert.equal(
    result.body.installerDigest,
    createHash("sha256").update(INSTALL_SCRIPT).digest("hex"),
  );
  assert.deepEqual(result.observed.fetched, ["https://hermes-agent.nousresearch.com/install.sh"]);
  assert.equal(result.observed.argv[0], "bash");
  assert.ok(result.observed.argv[1].endsWith(".sh"));
  assert.deepEqual(result.observed.argv.slice(2), ["--skip-browser", "--skip-setup"]);
  // 파이프(`curl | bash`)가 아니라 실재하는 파일을 실행한다.
  assert.equal(result.observed.script_exists, true);
  assert.equal(result.observed.script_body, INSTALL_SCRIPT);
  assert.deepEqual(result.observed.probe, ["-m", "hermes_cli.main", "--version"]);
});
test("이미 설치돼 있으면 내려받지도 실행하지도 않는다", () => {
  const result = installer(stubs(), true);
  assert.deepEqual(result.body, { error: "hermes_already_installed" });
  assert.equal(result.observed, null);
});
test("설치 스크립트를 받지 못하면 hermes_installer_unavailable 이다", () => {
  const result = installer(stubs({ body: null }));
  assert.deepEqual(result.body, { error: "hermes_installer_unavailable" });
  assert.equal(result.observed.argv, null);
});
test("설치 실패는 고정 코드로만 알리고 출력을 돌려주지 않는다", () => {
  const result = installer(stubs({ exit: 3, output: "token=super-secret\n" }));
  assert.deepEqual(result.body, { error: "hermes_install_failed" });
  assert.ok(!JSON.stringify(result.body).includes("super-secret"));
});
test("설치 안에서 네트워크가 끊기면 installer_unavailable 로 분류한다", () => {
  const result = installer(stubs({ exit: 1, output: "curl: (6) Could not resolve host: x\n" }));
  assert.deepEqual(result.body, { error: "hermes_installer_unavailable" });
});
test("설치 후 CLI 가 0 으로 끝나지 않으면 hermes_install_failed 다", () => {
  const result = installer(stubs({ probe: 2 }));
  assert.deepEqual(result.body, { error: "hermes_install_failed" });
});
test("정상 설치의 큰 출력은 상한에 걸리지 않고 읽고 버린다", () => {
  const result = installer(stubs({ output: "x".repeat(600_000) }));
  assert.equal(result.body.ok, true);
});
test("설치가 끝나면 임시 스크립트를 남기지 않는다", () => {
  const temp = mkdtempSync(join(tmpdir(), "deskrpg-install-residue-"));
  try {
    const result = spawnSync("python3", ["-"], {
      input: stubs() + HOST_INSTALLER,
      encoding: "utf8",
      env: { ...process.env, HOME: temp, PYTHONDONTWRITEBYTECODE: "1" },
      timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr);
    const residue = readdirSync(join(temp, ".hermes")).filter((name) => name.endsWith(".sh"));
    assert.deepEqual(residue, []);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
test("설치 잠금은 동시 설치를 막는다", () => {
  const result = installer(
    String.raw`
import fcntl, os, pathlib
root = pathlib.Path.home() / '.hermes'
root.mkdir(parents=True, exist_ok=True)
held = open(root / '.deskrpg-setup.lock','w')
fcntl.flock(held.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
` + stubs(),
  );
  assert.deepEqual(result.body, { error: "host_busy" });
});
test("설치 결과의 지문은 소문자 16진수 64자만 통과한다", async () => {
  const digest = "b".repeat(64);
  const good = await installHermesHost(fake([{ ok: true, installerDigest: digest }]).execute);
  assert.deepEqual(good, { installerDigest: digest });
  for (const bad of [{ ok: true }, { ok: true, installerDigest: "NOT-HEX" }])
    await assert.rejects(
      installHermesHost(fake([bad]).execute),
      /^Error: (hermes_install_failed|host_operation_failed)$/,
    );
});
test("설치 오류 코드는 화이트리스트 밖이면 원문을 흘리지 않는다", async () => {
  await assert.rejects(
    installHermesHost(fake([{ error: "hermes_already_installed" }]).execute),
    /^Error: hermes_already_installed$/,
  );
  await assert.rejects(
    installHermesHost(fake([{ error: "token=secret leaked" }]).execute),
    /^Error: host_operation_failed$/,
  );
});

// 리눅스는 유닛 파일이 없어도 service 이름('hermes-gateway.service')을 먼저 채운다.
// 이름으로 판정하던 때 새 설치에서 등록 단계가 통째로 빠졌다(실측: MiniPC 신규 계정).
const UNIT_MISSING_LINUX = String.raw`
state = {'installed': False}
def linux_identity(name,home):
    result = fixture_identity(name,home)
    if not state['installed']:
        result['command'] = None
        result['warning'] = 'managed_service_required'
    return result
identity = linux_identity
`;
test("서비스 이름이 채워져 있어도 유닛이 없으면 installing_service 가 계획에 들어간다", () => {
  const result = fixture(
    UNIT_MISSING_LINUX +
      String.raw`
id = main('discover')['candidates'][0]['id']
print(json.dumps(main('inspect', id)))
`,
    { config: { gateway: { multiplex_profiles: true } } },
  );
  assert.ok(result.body.changes.includes("installing_service"));
});
test("유닛이 이미 멀쩡하면 등록 단계를 넣지 않는다", () => {
  const result = fixture(
    String.raw`
id = main('discover')['candidates'][0]['id']
print(json.dumps(main('inspect', id)))
`,
    { config: { gateway: { multiplex_profiles: true } } },
  );
  assert.ok(!result.body.changes.includes("installing_service"));
});
test("남의 유닛(identity_mismatch)은 등록 대상으로 보지 않는다", () => {
  // 손댄 유닛·남의 유닛을 gateway install 로 덮어쓰면 안 된다.
  const result = fixture(
    String.raw`
def mismatched(name,home):
    result = fixture_identity(name,home)
    result['command'] = None
    result['warning'] = 'service_identity_mismatch'
    return result
identity = mismatched
id = main('discover')['candidates'][0]['id']
print(json.dumps(main('inspect', id)))
`,
    { config: { gateway: { multiplex_profiles: true } } },
  );
  assert.ok(!result.body.changes.includes("installing_service"));
});
test("gateway 값이 비어 있는 설정에서도 configure 가 죽지 않는다", () => {
  // 새로 설치한 Hermes 의 config.yaml 은 `gateway:` 키가 값 없이 들어 있다(실측).
  const result = fixture(
    String.raw`
id = main('discover')['candidates'][0]['id']
print(json.dumps(main('configure', id)))
`,
    { config: { gateway: null } },
  );
  assert.deepEqual(result.body, { ok: true });
});
