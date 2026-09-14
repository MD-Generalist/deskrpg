import assert from "node:assert/strict";
import test from "node:test";
import { discoverHost, inspectHost, prepareHost } from "./host";
import type { HostExecutor, SetupCandidate } from "./types";
const candidate: SetupCandidate = {
  id: "a".repeat(64),
  label: "Hermes default",
  version: "0.21.1",
  service: "hermes-gateway.service",
  port: 8642,
  pluginInstalled: false,
  pluginEnabled: false,
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
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { HOST_BOOTSTRAP, HOST_HELPER } from "./host-helper";
const installedPython = ["venv", ".venv"]
  .map((name) => join(homedir(), ".hermes/hermes-agent", name, "bin/python"))
  .find(existsSync);
function fixture(script: string, initial: { config?: object; env?: string } = {}) {
  const temp = mkdtempSync(join(tmpdir(), "deskrpg-host-test-"));
  const root = join(temp, ".hermes");
  mkdirSync(join(root, "hermes-agent"), { recursive: true });
  writeFileSync(join(root, "config.yaml"), JSON.stringify(initial.config ?? {}));
  writeFileSync(join(root, ".env"), initial.env ?? "");
  writeFileSync(join(root, "hermes-agent/pyproject.toml"), 'version = "0.21.1"\n');
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
def main(action,candidate_id=None):
    global LOCK
    try: return original_main(action,candidate_id)
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
test("inspection marks only the safely provisionable selected owner, not missing sibling keys", () => {
  const result = fixture(
    String.raw`
child = ROOT / 'profiles' / 'sophie'
child.mkdir(parents=True)
id = main('discover')['candidates'][0]['id']
print(json.dumps(main('inspect',id)))
`,
    { config: { gateway: { multiplex_profiles: true } } },
  );
  assert.deepEqual(result.body.profiles, [
    { name: "default", hasToken: false, canProvision: true },
    { name: "sophie", hasToken: false },
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
