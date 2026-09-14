/** Kept in a TS constant so Next standalone output includes the helper. No filesystem asset lookup. */
export const HOST_BOOTSTRAP = String.raw`
import json, os, pathlib, signal, subprocess, sys
child = None
def terminate_owned(signum=None, frame=None):
    if child is not None:
        try: os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        child.wait()
    if signum is not None: raise SystemExit(1)
for signum in (signal.SIGHUP, signal.SIGTERM, signal.SIGINT):
    signal.signal(signum, terminate_owned)
try:
    payload = json.load(sys.stdin)
    root = pathlib.Path.home() / '.hermes' / 'hermes-agent'
    python = next((root / folder / 'bin' / 'python' for folder in ('venv', '.venv') if (root / folder / 'bin' / 'python').is_file()), None)
    if python is None:
        print(json.dumps({'candidates': []} if payload['action'] == 'discover' else {'error': 'hermes_not_found'}))
    else:
        child = subprocess.Popen([str(python), '-'], text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
        output, unused = child.communicate(payload['script'], timeout=payload['timeout'])
        terminate_owned()
        if child.returncode or len(output) > 262144:
            print(json.dumps({'error': 'host_operation_failed'}))
        else:
            sys.stdout.write(output)
except Exception:
    terminate_owned()
    print(json.dumps({'error': 'host_operation_failed'}))
`;

// Only fixed operations are accepted. Raw subprocess output, configuration, env and exceptions never leave here.
export const HOST_HELPER = String.raw`
import hashlib, json, os, pathlib, plistlib, re, secrets, shlex, socket, subprocess, sys, tempfile, time, urllib.request, urllib.error
import yaml
ROOT = pathlib.Path.home() / '.hermes'
INSTALL = ROOT / 'hermes-agent'
sys.dont_write_bytecode = True
sys.path.insert(0, str(INSTALL))
os.environ['HERMES_HOME'] = str(ROOT)
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
NAME = re.compile(r'^[a-z0-9][a-z0-9_-]{0,63}$')
RESERVED = {'hermes','test','tmp','root','sudo'}
PIN = '9e200eb1d2418d47c3b65a754ca111e13c5aafb4'
SOURCE = 'https://github.com/dandacompany/deskrpg-hermes-plugin'
LOCK = None
class Failure(Exception): pass
def fail(code): raise Failure(code)
def read(path):
    if path.is_symlink(): fail('unsafe_host_path')
    if path.exists() and path.stat().st_size > 1048576: fail('invalid_host_config')
    return path.read_text(encoding='utf-8-sig') if path.exists() else ''
def config(home):
    value = yaml.safe_load(read(home / 'config.yaml')) or {}
    if not isinstance(value, dict): fail('invalid_host_config')
    return value
def envfile(home):
    # Hermes's supported parser: profile-local only, never inherited process credentials.
    read(home / '.env')
    from agent.secret_scope import load_env_file
    return load_env_file(home / '.env')
def mapping(value):
    if value is None: return {}
    if not isinstance(value, dict): fail('invalid_host_config')
    return value
def settings(home):
    cfg = config(home)
    gateway = mapping(cfg.get('gateway'))
    block = {}
    for entry in (mapping(gateway.get('platforms')).get('api_server'), mapping(cfg.get('platforms')).get('api_server'), gateway.get('api_server')):
        entry = mapping(entry)
        extra = {**mapping(block.get('extra')), **mapping(entry.get('extra'))}
        block.update(entry)
        block['extra'] = extra
    extra = mapping(block.get('extra'))
    for key in ('key','host','port'):
        if key in block and key not in extra: extra[key] = block[key]
    env = envfile(home)
    token = env.get('API_SERVER_KEY') or extra.get('key') or ''
    port = env.get('API_SERVER_PORT') or extra.get('port') or 8642
    try: port = int(port)
    except (ValueError, TypeError): fail('invalid_host_config')
    if not 1024 <= port <= 65535: fail('invalid_host_config')
    if not isinstance(token, str): fail('invalid_host_config')
    external = any(mapping(v).get('enabled') for v in mapping(cfg.get('secrets')).values())
    # Resolve secret-provider references only through Hermes, never replace them with a newly minted value.
    if token.startswith((chr(36) + '{', 'op://', 'bw://')): external = True
    return cfg, env, token, port, external

def run(argv, timeout=8, env=None):
    return subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=timeout, env=env)
def homes():
    result = [('default', ROOT)]
    profiles = ROOT / 'profiles'
    if profiles.is_symlink(): fail('unsafe_host_path')
    if profiles.is_dir():
        for child in sorted(profiles.iterdir()):
            if NAME.fullmatch(child.name) and child.name not in RESERVED and child.name != 'default' and child.is_dir() and not child.is_symlink() and not (child / '.deleted').exists():
                result.append((child.name, child))
    return result

def identity(name, home):
    suffix = '' if name == 'default' else '-' + name
    definition, service, command, pid, warning = '', 'manual', None, 0, 'managed_service_required'
    python = str(pathlib.Path(sys.executable))
    if sys.platform == 'darwin':
        label = 'ai.hermes.gateway' + suffix
        path = pathlib.Path.home() / 'Library' / 'LaunchAgents' / (label + '.plist')
        if path.exists():
            definition = read(path)
            data = plistlib.loads(definition.encode())
            args = data.get('ProgramArguments', [])
            env = data.get('EnvironmentVariables', {})
            valid = data.get('Label') == label and env.get('HERMES_HOME') == str(home) and len(args) >= 4
            valid = valid and pathlib.Path(args[0]).parent.resolve() == pathlib.Path(python).parent.resolve() and pathlib.Path(args[0]).name in ('python', 'python3', pathlib.Path(python).name) and 'gateway' in args and 'run' in args
            valid = valid and 'hermes_cli.main' in args and not any(k.startswith(('API_SERVER_', 'GATEWAY_MULTIPLEX')) for k in env)
            expected_profile = ['--profile', name] if name != 'default' else []
            for flag in ('--profile', '-p'):
                if flag in args and (name == 'default' or args[args.index(flag)+1:args.index(flag)+2] != [name]): valid = False
            if expected_profile and '--profile' not in args and '-p' not in args: valid = False
            service = label
            if valid:
                matches = []
                found_unmatched = False
                for domain in ('gui/' + str(os.getuid()), 'user/' + str(os.getuid())):
                    state = run(['launchctl', 'print', domain + '/' + label])
                    if state.returncode == 0:
                        loaded_args = re.search(r'^\s*arguments = \{\n(.*?)^\s*\}', state.stdout, re.M | re.S)
                        actual_args = [line.strip() for line in loaded_args.group(1).splitlines()] if loaded_args else None
                        loaded_home = re.search(r'^\s*HERMES_HOME\s*=>?\s*(.*?)\s*$', state.stdout, re.M)
                        if not loaded_home or loaded_home.group(1) != str(home) or actual_args != args:
                            found_unmatched = True
                            continue
                        matches.append(domain)
                        match = re.search(r'^\s*pid = (\d+)', state.stdout, re.M)
                        pid = int(match.group(1)) if match else 0
                if len(matches) == 1 and not found_unmatched:
                    service = matches[0] + '/' + label
                    command = ['launchctl', 'kickstart', '-k', service]
                    warning = None
                elif not matches and not found_unmatched:
                    # Same managername rule as Hermes's _probe_launchd_domain_for_label.
                    manager = run(['launchctl','managername'])
                    domain = ('gui/' if 'Aqua' in manager.stdout else 'user/') + str(os.getuid())
                    if manager.returncode == 0 and run(['launchctl','print',domain]).returncode == 0 and data.get('RunAtLoad') is True:
                        service = domain + '/' + label
                        command = ['launchctl','bootstrap',domain,str(path)]
                        warning = None
                    else: warning = 'managed_service_required'
                else: warning = 'service_identity_mismatch' if found_unmatched else 'service_identity_ambiguous'
            else: warning = 'service_identity_mismatch'
    elif sys.platform.startswith('linux'):
        service = 'hermes-gateway' + suffix + '.service'
        path = pathlib.Path.home() / '.config' / 'systemd' / 'user' / service
        if path.exists():
            definition = read(path)
            state = run(['systemctl', '--user', 'show', service, '--property=FragmentPath,DropInPaths,MainPID,Environment,ExecStart'])
            props = dict(line.split('=',1) for line in state.stdout.splitlines() if '=' in line)
            pinned = 'HERMES_HOME=' + str(home)
            valid = state.returncode == 0 and props.get('FragmentPath') == str(path) and not props.get('DropInPaths')
            service_env = dict(v.split('=',1) for v in shlex.split(props.get('Environment','')) if '=' in v)
            valid = valid and service_env.get('HERMES_HOME') == str(home) and pinned in definition
            live_exec = re.search(r'argv\[\]=(.*?)\s*;', props.get('ExecStart',''))
            live_args = shlex.split(live_exec.group(1)) if live_exec else []
            disk_execs = re.findall(r'^ExecStart=(.+)$', definition, re.M)
            disk_args = shlex.split(disk_execs[0]) if len(disk_execs) == 1 else []
            expected_tail = ['-m','hermes_cli.main'] + (['--profile',name] if name != 'default' else []) + ['gateway','run']
            valid = valid and live_args == disk_args and bool(live_args) and live_args[1:] == expected_tail
            valid = valid and pathlib.Path(live_args[0]).parent.resolve() == pathlib.Path(python).parent.resolve() and pathlib.Path(live_args[0]).name in ('python','python3',pathlib.Path(python).name)
            valid = valid and not re.search(r'(API_SERVER_|GATEWAY_MULTIPLEX|EnvironmentFile)', definition + props.get('Environment',''))
            if name != 'default': valid = valid and ('--profile ' + name) in props.get('ExecStart','')
            else: valid = valid and not re.search(r'--profile| -p ', props.get('ExecStart',''))
            if valid:
                command = ['systemctl', '--user', 'restart', service]
                pid = int(props.get('MainPID') or '0')
                warning = None
            else: warning = 'service_identity_mismatch'
    digest = hashlib.sha256((str(INSTALL.resolve()) + '\0' + str(home) + '\0' + service + '\0' + definition).encode()).hexdigest()
    return {'id': digest, 'service': service, 'command': command, 'pid': pid, 'warning': warning}

def plugin(home, cfg):
    manifests = []
    directory = home / 'plugins'
    if directory.is_symlink(): fail('unsafe_host_path')
    if directory.exists():
        for child in directory.iterdir():
            if child.is_symlink(): continue
            manifest = child / 'plugin.yaml'
            if manifest.is_file():
                data = yaml.safe_load(read(manifest)) or {}
                if isinstance(data, dict) and data.get('name') == 'deskrpg': manifests.append(child.name)
    if len(manifests) > 1: fail('plugin_identity_ambiguous')
    plugins = mapping(cfg.get('plugins'))
    names = {'deskrpg', *manifests}
    enabled = plugins.get('enabled') or []
    disabled = plugins.get('disabled') or []
    if not isinstance(enabled, list) or not isinstance(disabled, list): fail('invalid_host_config')
    return bool(manifests), bool(names.intersection(enabled)) and not bool(names.intersection(disabled)), manifests[0] if manifests else 'deskrpg'

def candidate(name, home):
    cfg, env, token, port, external = settings(home)
    owner = identity(name, home)
    installed, enabled, plugin_name = plugin(home, cfg)
    match = re.search(r'^version\s*=\s*"([^"]+)"', read(INSTALL / 'pyproject.toml'), re.M)
    public = {'id': owner['id'], 'label': 'Hermes ' + name, 'version': match.group(1) if match else 'unknown', 'service': owner['service'], 'pluginInstalled': installed, 'pluginEnabled': enabled, 'hasToken': bool(token), 'port': port}
    warning = owner['warning'] or ('external_secret_provider' if external else None)
    if warning: public['warning'] = warning
    return public, owner, cfg, token, plugin_name

def select(candidate_id):
    for name, home in homes():
        item = candidate(name, home)
        if item[0]['id'] == candidate_id: return name, home, item
    fail('candidate_changed')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl): return None
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
def request(port, token, path):
    req = urllib.request.Request('http://127.0.0.1:' + str(port) + path, headers={'Authorization': 'Bearer ' + token})
    try:
        with OPENER.open(req, timeout=3) as response:
            data = response.read(65537)
            if len(data) > 65536: return 0, None
            return response.status, json.loads(data)
    except urllib.error.HTTPError as error: return error.code, None
    except Exception: return 0, None

def probe(public, token):
    if not token: return 'unknown', 'api_key_missing'
    status, body = request(public['port'], token, '/deskrpg/info')
    if status in (401,403): return 'plugin_unauthorized', 'plugin_unauthorized'
    if status == 200 and isinstance(body,dict) and body.get('plugin') == 'deskrpg' and isinstance(body.get('version'),str): return 'plugin_ready', None
    if status == 404: return 'plugin_absent', 'plugin_pending_restart' if public['pluginEnabled'] else 'plugin_disabled' if public['pluginInstalled'] else 'plugin_absent'
    return 'unknown', 'gateway_unreachable' if status == 0 else 'gateway_identity_unverified'

def assert_port_owned(public, owner):
    # Never send a discovered key to an arbitrary local listener. psutil verifies PID ownership first.
    import psutil
    try:
        connections = [c for c in psutil.net_connections(kind='tcp') if c.status == psutil.CONN_LISTEN and c.laddr.port == public['port']]
    except psutil.AccessDenied:
        # macOS restricts system-wide socket enumeration; bind proves a free port, otherwise fail closed.
        connections = None
    if connections == []: return False
    if connections is None:
        # macOS allows lsof to inspect sockets owned by this login even when psutil's system scan is denied.
        listing = run(['/usr/sbin/lsof', '-nP', '-iTCP:' + str(public['port']), '-sTCP:LISTEN', '-Fp'])
        pids = [int(line[1:]) for line in listing.stdout.splitlines() if re.fullmatch(r'p[0-9]+',line)]
        if pids:
            try:
                parent = psutil.Process(owner['pid']) if owner['pid'] else None
                owned = {parent.pid, *(p.pid for p in parent.children(recursive=True))} if parent else set()
            except psutil.Error: owned = set()
            if any(pid not in owned for pid in pids): fail('port_conflict')
            return True
        try:
            sock = socket.socket(); sock.bind(('127.0.0.1', public['port'])); sock.close(); return False
        except OSError: fail('listener_ownership_unverified')
    owned = set()
    if owner['pid']:
        try:
            process = psutil.Process(owner['pid'])
            owned = {process.pid, *(p.pid for p in process.children(recursive=True))}
        except psutil.Error: pass
    if not connections or any(c.pid not in owned for c in connections): fail('port_conflict')
    return True

def profile_names(cfg):
    gateway = mapping(cfg.get('gateway'))
    allow = cfg.get('multiplex_profile_allowlist', gateway.get('multiplex_profile_allowlist'))
    if allow is not None and (not isinstance(allow,list) or any(not isinstance(n,str) or not NAME.fullmatch(n) for n in allow)): fail('invalid_host_config')
    return [(name,home) for name,home in homes() if name == 'default' or allow is None or name in allow]

def preflight(name, home, item):
    public, owner, cfg, token, plugin_name = item
    if not owner['command']: fail(owner['warning'] or 'managed_service_required')
    if settings(home)[4]:
        listening = assert_port_owned(public,owner)
        code, models = request(public['port'],token,'/v1/models') if token and listening else (0,None)
        if code != 200 or not isinstance(models,dict) or not isinstance(models.get('data'),list): fail('external_secret_provider')
    if token and (len(token) < 16 or '\n' in token or '\r' in token): fail('api_key_invalid')
    gateway = mapping(cfg.get('gateway'))
    env = envfile(home)
    if 'GATEWAY_MULTIPLEX_PROFILES' in env: fail('multiplex_override_present')
    multiplex = cfg.get('multiplex_profiles', gateway.get('multiplex_profiles', False))
    if name != 'default':
        if multiplex: fail('listener_owner_required')
        assert_port_owned(public,owner)
        return
    if not multiplex or not owner['pid']:
        for child, childhome in profile_names(cfg):
            if child == 'default': continue
            other = identity(child, childhome)
            if other['pid']: fail('multiplex_conflict')
            # Also catch unmanaged profile processes; PID files alone are never treated as service ownership.
            if (childhome / 'gateway.pid').exists():
                from hermes_cli.gateway import get_running_pid
                if get_running_pid(childhome / 'gateway.pid', cleanup_stale=False): fail('multiplex_conflict')
    assert_port_owned(public, owner)

def atomic(path, content):
    read(path)
    mode = (path.stat().st_mode & 0o777) if path.exists() else 0o600
    fd, tmp = tempfile.mkstemp(prefix='.deskrpg-setup-', dir=str(path.parent))
    try:
        os.fchmod(fd, mode & 0o600)
        with os.fdopen(fd,'w',encoding='utf-8') as stream:
            stream.write(content); stream.flush(); os.fsync(stream.fileno())
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def main(action, candidate_id=None):
    global LOCK
    if ROOT.is_symlink(): fail('unsafe_host_path')
    if action in ('install','configure','restart'):
        # A host-wide advisory lock also protects against a retry from a restarted DeskRPG server.
        # Keep it inherited by the installer until the entire bounded action exits.
        import fcntl
        fd = os.open(str(ROOT / '.deskrpg-setup.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(fd)
            fail('host_busy')
        LOCK = os.fdopen(fd,'w')
    if action == 'discover':
        return {'candidates': [candidate(name,home)[0] for name,home in homes()]}
    name, home, item = select(candidate_id)
    public, owner, cfg, token, plugin_name = item
    if action == 'inspect':
        listening = assert_port_owned(public, owner)
        status, warning = probe(public,token) if listening else ('unknown','gateway_unreachable')
        if warning and 'warning' not in public: public['warning'] = warning
        preparation_safe = False
        try:
            preflight(name,home,item)
            preparation_safe = True
            if public.get('warning') == 'external_secret_provider':
                public.pop('warning',None)
                if warning: public['warning'] = warning
        except Failure as error: public['warning'] = str(error)
        changes = []
        if not public['pluginInstalled']: changes.append('installing_plugin')
        elif not public['pluginEnabled']: changes.append('enabling_plugin')
        gateway = mapping(cfg.get('gateway'))
        if status != 'plugin_ready' or (name == 'default' and not cfg.get('multiplex_profiles',gateway.get('multiplex_profiles',False))):
            changes.extend(['configuring_api','restarting_gateway','verifying_gateway'])
        available = profile_names(cfg) if name == 'default' else [(name,home)]
        profiles = []
        for child,childhome in available:
            child_settings = settings(childhome)
            metadata = {'name':child, 'hasToken':bool(child_settings[2])}
            if child == name and preparation_safe and not child_settings[2] and not child_settings[4]:
                metadata['canProvision'] = True
            profiles.append(metadata)
        return {'candidate': public, 'pluginStatus': status, 'changes': changes, 'profiles':profiles}
    preflight(name,home,item)
    if action == 'install':
        env = {**os.environ, 'HERMES_HOME': str(home)}
        argv = [sys.executable, '-m', 'hermes_cli.main', '--profile', name, 'plugins']
        if not public['pluginInstalled']: argv += ['install', SOURCE, '--ref', PIN, '--enable']
        elif not public['pluginEnabled']: argv += ['enable', plugin_name]
        else: return {'ok': True}
        # Keep diagnostics in bounded memory only. Never return them or persist them in jobs.
        child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, cwd=str(INSTALL), pass_fds=(LOCK.fileno(),))
        try:
            output = child.stdout.read(262145)
            if len(output) > 262144:
                child.kill()
                child.wait()
                fail('output_limit')
            code = child.wait()
        finally:
            child.stdout.close()
        if code:
            diagnostic = output.decode('utf-8', errors='replace').lower()
            if 'blocked' in diagnostic and ('security' in diagnostic or 'scan' in diagnostic):
                fail('plugin_security_review_required')
            if 'repository not found' in diagnostic or 'could not resolve host' in diagnostic:
                fail('plugin_source_unavailable')
            fail('plugin_install_failed')
        installed, enabled, unused = plugin(home,config(home))
        if not installed or not enabled: fail('plugin_install_failed')
    elif action == 'configure':
        # Preserve existing config shapes while setting the effective merged API block.
        cfg.setdefault('gateway', {})
        if name == 'default':
            cfg['gateway']['multiplex_profiles'] = True
            if 'multiplex_profiles' in cfg: cfg['multiplex_profiles'] = True
        api = mapping(cfg['gateway'].get('api_server'))
        api['enabled'] = True
        cfg['gateway']['api_server'] = api
        atomic(home / 'config.yaml', yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True))
        if not token:
            old = read(home / '.env')
            # Empty assignment is absent; append wins in Hermes's canonical parser.
            atomic(home / '.env', old.rstrip('\n') + '\nAPI_SERVER_KEY=' + secrets.token_hex(32) + '\n')
    elif action == 'restart':
        if run(owner['command'],timeout=25).returncode: fail('gateway_restart_failed')
    elif action == 'verify':
        ready = False
        for attempt in range(20):
            public, owner, cfg, token, plugin_name = select(candidate_id)[2]
            if assert_port_owned(public,owner) and probe(public,token)[0] == 'plugin_ready':
                ready = True; break
            time.sleep(1)
        if not ready: fail('gateway_verification_failed')
        code, live = request(public['port'],token,'/deskrpg/profiles')
        if code != 200 or not isinstance(live,dict) or not isinstance(live.get('profiles'),list): fail('profile_verification_failed')
        names = {p.get('name') for p in live['profiles'] if isinstance(p,dict) and isinstance(p.get('name'),str)}
        profiles = []
        selected_profiles = profile_names(cfg) if name == 'default' else [(name,home)]
        for child, childhome in selected_profiles:
            if child not in names: continue
            _, _, childtoken, _, external = settings(childhome)
            if not childtoken: continue
            path = '/v1/models' if child == 'default' else '/p/' + child + '/v1/models'
            code, models = request(public['port'],childtoken,path)
            if code == 200 and isinstance(models,dict) and isinstance(models.get('data'),list): profiles.append({'name':child,'token':childtoken})
        return {'prepared': {'baseUrl':'http://127.0.0.1:' + str(public['port']), 'token':token, 'profiles':profiles}}
    else: fail('invalid_host_operation')
    return {'ok':True}

def entry(action, candidate_id):
    try: print(json.dumps(main(action,candidate_id)))
    except Failure as error: print(json.dumps({'error':str(error)}))
    except Exception: print(json.dumps({'error':'host_operation_failed'}))
`;
