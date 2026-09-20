import { isWindows } from "./platform";

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

/**
 * 파이썬 구동기 앞의 sh 런처. 시스템 python3 가 없어도 Hermes 를 찾고 설치할 수 있게 한다(2026-09-19 단테 결정).
 *
 * 인자: $1 = run | install, $2 = 파이썬 코드, $3 = (run) 파이썬이 하나도 없을 때 그대로 찍을 JSON.
 * 고르는 순서: Hermes venv 파이썬 → 시스템 python3 → (install 만) uv 로 사용자 홈에 파이썬을 받는다.
 * uv 는 Hermes 설치 스크립트가 스스로 쓰는 자리(`~/.hermes/bin/uv`)에 둔다 — 설치 스크립트가 그 uv 를 재사용한다.
 * sudo 는 쓰지 않는다. 받은 설치 스크립트의 출력은 버리고 미리 정한 코드로만 실패를 알린다.
 * Hermes 설치 스크립트가 curl 을 요구하므로 여기서도 curl 만 쓴다.
 */
export const HOST_LAUNCHER = String.raw`
mode=$1
code=$2
# 설치 전에 sudo 가 필요한 시스템 패키지를 본다. root 이거나 비밀번호 없는 sudo 면 설치 스크립트가 스스로 깐다.
# 아니면 여기서 멈춘다 — 몇 분 받다가 중간에 실패하는 대신 관리자에게 명령 한 줄을 보여 준다(system-packages.ts).
if [ "$mode" = install ]; then
  miss=""
  command -v curl >/dev/null 2>&1 || miss="$miss curl"
  { command -v git >/dev/null 2>&1 && git --version >/dev/null 2>&1; } || miss="$miss git"
  command -v g++ >/dev/null 2>&1 || command -v clang++ >/dev/null 2>&1 || miss="$miss cxx"
  if [ -n "$miss" ] && [ "$(id -u)" != 0 ] && ! sudo -n true >/dev/null 2>&1; then
    if [ "$(uname -s)" = Darwin ]; then distro=macos
    else distro=$( (. /etc/os-release >/dev/null 2>&1 && printf '%s' "$ID") | tr -cd 'a-z0-9_-' | cut -c1-32); fi
    printf '{"error": "system_packages_missing", "packages": "%s", "distro": "%s"}' "$miss" "$distro"
    exit 0
  fi
fi
for p in "$HOME/.hermes/hermes-agent/venv/bin/python" "$HOME/.hermes/hermes-agent/.venv/bin/python"; do
  if [ -x "$p" ]; then exec "$p" -c "$code"; fi
done
if command -v python3 >/dev/null 2>&1; then exec python3 -c "$code"; fi
if [ "$mode" != install ]; then printf '%s' "$3"; exit 0; fi
fail() { printf '{"error": "%s"}' "$1"; exit 0; }
[ -n "$HOME" ] && [ -d "$HOME" ] || fail unsafe_host_path
root="$HOME/.hermes"
if [ -L "$root" ] || { [ -e "$root" ] && [ ! -d "$root" ]; }; then fail unsafe_host_path; fi
command -v curl >/dev/null 2>&1 || fail curl_missing
mkdir -p "$root/bin" || fail python_bootstrap_failed
uv="$root/bin/uv"
if [ ! -x "$uv" ]; then
  tmp=$(mktemp "$root/.deskrpg-uv-install.XXXXXX") || fail python_bootstrap_failed
  if ! curl -fsSL --proto '=https' --tlsv1.2 https://astral.sh/uv/install.sh -o "$tmp"; then rm -f "$tmp"; fail hermes_installer_unavailable; fi
  UV_UNMANAGED_INSTALL="$root/bin" UV_NO_MODIFY_PATH=1 sh "$tmp" >/dev/null 2>&1
  rm -f "$tmp"
  [ -x "$uv" ] || fail python_bootstrap_failed
fi
"$uv" python install 3.12 >/dev/null 2>&1 || fail python_bootstrap_failed
py=$("$uv" python find 3.12 2>/dev/null) || fail python_bootstrap_failed
[ -x "$py" ] || fail python_bootstrap_failed
exec "$py" -c "$code"
`;

/**
 * `HOST_LAUNCHER` 의 Windows 짝. 하는 일은 같다 — 파이썬을 골라 본문을 `-c` 로 넘긴다.
 *
 * 인자: $args[0] = run | install, $args[1] = 파이썬 코드, $args[2] = (run) 파이썬이 하나도 없을 때 찍을 JSON.
 * 고르는 순서: Hermes venv 파이썬 → PATH 의 python → (install 만) uv 로 받은 파이썬.
 * POSIX 판과 달리 시스템 패키지 사전 점검이 없다 — install.ps1 이 PortableGit·uv·Python·Node 를
 * 스스로 받으므로 sudo 도 패키지 관리자도 필요 없다(상류 scripts/install.ps1 확인).
 * Windows venv 의 파이썬은 `Scripts\python.exe` 다(상류 gateway_windows.py:1457,1475).
 */
export const HOST_LAUNCHER_PS = String.raw`
$ErrorActionPreference = 'Stop'
$mode = $args[0]
$code = $args[1]
$none = $args[2]
function Fail($c) { [Console]::Out.Write('{"error": "' + $c + '"}'); exit 0 }
function Run($exe) { & $exe -c $code; exit $LASTEXITCODE }
$home2 = $env:USERPROFILE
if (-not $home2 -or -not (Test-Path -LiteralPath $home2 -PathType Container)) { Fail 'unsafe_host_path' }
# 상류 hermes_constants.py:51-57 과 같은 판정이다. Windows 기본 홈은 ~/.hermes 가 아니다.
$base = $env:LOCALAPPDATA
if (-not $base) { $base = Join-Path (Join-Path $home2 'AppData') 'Local' }
$root = Join-Path $base 'hermes'
foreach ($f in @('venv', '.venv')) {
  $p = Join-Path (Join-Path (Join-Path $root 'hermes-agent') $f) 'Scripts\python.exe'
  if (Test-Path -LiteralPath $p -PathType Leaf) { Run $p }
}
$sys = Get-Command python -ErrorAction SilentlyContinue
if ($sys) { Run $sys.Source }
if ($mode -ne 'install') { [Console]::Out.Write($none); exit 0 }
$item = Get-Item -LiteralPath $root -ErrorAction SilentlyContinue
if ($item -and (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $item.PSIsContainer)) { Fail 'unsafe_host_path' }
New-Item -ItemType Directory -Force -Path (Join-Path $root 'bin') | Out-Null
$uv = Join-Path $root 'bin\uv.exe'
if (-not (Test-Path -LiteralPath $uv -PathType Leaf)) {
  $tmp = Join-Path $root ('.deskrpg-uv-install.' + [Guid]::NewGuid().ToString('N') + '.ps1')
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri 'https://astral.sh/uv/install.ps1' -OutFile $tmp
  } catch { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue; Fail 'hermes_installer_unavailable' }
  $env:UV_UNMANAGED_INSTALL = Join-Path $root 'bin'
  $env:UV_NO_MODIFY_PATH = '1'
  & powershell -NoProfile -ExecutionPolicy Bypass -File $tmp *> $null
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path -LiteralPath $uv -PathType Leaf)) { Fail 'python_bootstrap_failed' }
}
& $uv python install 3.12 *> $null
if ($LASTEXITCODE -ne 0) { Fail 'python_bootstrap_failed' }
$py = (& $uv python find 3.12 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $py -or -not (Test-Path -LiteralPath $py -PathType Leaf)) { Fail 'python_bootstrap_failed' }
Run $py
`;

/** 호스트에서 파이썬 런처를 띄울 명령. 셸은 플랫폼마다 다르고 인자 순서는 같다. */
export function hostLaunch(
  platform: string,
  mode: "run" | "install",
  code: string,
  none = "",
): { command: string; args: string[] } {
  if (isWindows(platform))
    return {
      command: "powershell",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        HOST_LAUNCHER_PS,
        mode,
        code,
        none,
      ],
    };
  return { command: "sh", args: ["-c", HOST_LAUNCHER, "deskrpg", mode, code, none] };
}

/**
 * Hermes 설치 전용 스크립트. 설치가 없을 때 돌아야 하므로 HOST_BOOTSTRAP(=Hermes venv 파이썬)을
 * 거치지 않고 HOST_LAUNCHER 가 고른 파이썬(시스템 python3, 없으면 uv 로 받은 파이썬)에서 실행된다. 표준 라이브러리만 쓴다.
 * 설치 스크립트는 파이프가 아니라 임시 파일로 내려받아 sha256 지문을 남기고 `bash <파일>` 로 실행한다.
 * 설치 출력은 저장도 반환도 하지 않는다 — 실패 분류용 마지막 8KiB 만 메모리에 둔다.
 */
export const HOST_INSTALLER = String.raw`
import hashlib, json, os, pathlib, subprocess, sys, tempfile, threading, urllib.request
INSTALLER_URL = 'https://hermes-agent.nousresearch.com/install.sh'
MAX_INSTALLER_BYTES = 1048576
INSTALL_TIMEOUT = 580
TAIL = 8192
MAX_LINE = 4096
# 표에 적힌 표시만 본다. 순서가 곧 우선순위이고, 한 줄은 첫 일치 하나로만 접힌다.
# 표시 문자열은 설치 스크립트의 실제 출력에서 골랐다(install.sh 의 log_info 원문 대조).
# 처음엔 'clone' 을 literal 로 봤는데 git 은 'Cloning into ...' 을 찍어 한 번도 걸리지 않았다.
MILESTONE_RULES = (
    ('deps', lambda text: 'installing managed uv' in text or 'installing dependencies' in text or 'installing git' in text),
    ('clone', lambda text: 'clon' in text or 'fetching repository' in text),
    ('venv', lambda text: 'creating virtual environment' in text or 'virtual environment' in text),
    ('node_modules', lambda text: 'node.js dependencies' in text or 'npm install' in text or 'desktop workspace dependencies' in text),
    ('skills', lambda text: 'bundled skills' in text or 'skills to' in text),
    ('done', lambda text: 'installation complete' in text),
)
milestones = []
def note(line):
    # 줄 내용은 어디에도 남기지 않는다 — 미리 정한 코드로만 접어 올린다.
    if not line: return
    text = line.decode('utf-8', errors='replace').lower()
    for code, matches in MILESTONE_RULES:
        if matches(text):
            if code not in milestones: milestones.append(code)
            return
def out(value):
    sys.stdout.write(json.dumps(value))
    raise SystemExit(0)
try:
    ROOT = pathlib.Path.home() / '.hermes'
    INSTALL = ROOT / 'hermes-agent'
    if ROOT.is_symlink() or (ROOT.exists() and not ROOT.is_dir()): out({'error': 'unsafe_host_path'})
    # 업그레이드·재설치는 이 경로의 범위가 아니다. 이미 있으면 절대 손대지 않는다.
    if INSTALL.exists() or INSTALL.is_symlink(): out({'error': 'hermes_already_installed'})
    ROOT.mkdir(parents=True, exist_ok=True)
    import fcntl
    fd = os.open(str(ROOT / '.deskrpg-setup.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        out({'error': 'host_busy'})
    lock = os.fdopen(fd, 'w')
    # 잠금을 잡은 뒤 한 번 더 본다 — 경쟁하던 다른 설치가 방금 끝났을 수 있다.
    if INSTALL.exists() or INSTALL.is_symlink(): out({'error': 'hermes_already_installed'})
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(INSTALLER_URL, timeout=30) as response:
            body = response.read(MAX_INSTALLER_BYTES + 1)
    except Exception:
        out({'error': 'hermes_installer_unavailable'})
    if not body or len(body) > MAX_INSTALLER_BYTES: out({'error': 'hermes_installer_unavailable'})
    digest = hashlib.sha256(body).hexdigest()
    handle, script = tempfile.mkstemp(prefix='.deskrpg-hermes-install-', suffix='.sh', dir=str(ROOT))
    try:
        with os.fdopen(handle, 'wb') as stream:
            stream.write(body); stream.flush(); os.fsync(stream.fileno())
        env = {**os.environ, 'HERMES_HOME': str(ROOT), 'PYTHONDONTWRITEBYTECODE': '1'}
        child = subprocess.Popen(['bash', script, '--skip-browser', '--skip-setup'], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, cwd=str(ROOT), pass_fds=(lock.fileno(),))
        watchdog = threading.Timer(INSTALL_TIMEOUT, child.kill)
        watchdog.start()
        tail = b''
        buffered = b''
        try:
            while True:
                chunk = child.stdout.read(65536)
                if not chunk: break
                # 읽고 버린다. 정상 설치의 출력은 256KiB 를 넘기므로 상한을 두지 않고 꼬리만 남긴다.
                tail = (tail + chunk)[-TAIL:]
                pieces = (buffered + chunk).split(b'\n')
                # 개행이 없는 출력이 메모리를 밀어내지 않도록 남는 조각도 잘라 둔다.
                buffered = pieces.pop()[-MAX_LINE:]
                for piece in pieces: note(piece[-MAX_LINE:])
            note(buffered)
            code = child.wait()
        finally:
            watchdog.cancel()
            child.stdout.close()
    finally:
        try: os.unlink(script)
        except OSError: pass
    if code != 0:
        diagnostic = tail.decode('utf-8', errors='replace').lower()
        if 'could not resolve host' in diagnostic or 'failed to connect' in diagnostic or 'connection refused' in diagnostic:
            out({'error': 'hermes_installer_unavailable'})
        # git 은 설치 스크립트가 sudo 로 깔아 보려다 실패하면 이 문장을 남긴다(install.sh check_git 원문).
        if 'could not install git automatically' in diagnostic: out({'error': 'git_missing'})
        out({'error': 'hermes_install_failed'})
    python = next((INSTALL / folder / 'bin' / 'python' for folder in ('venv', '.venv') if (INSTALL / folder / 'bin' / 'python').is_file()), None)
    if python is None: out({'error': 'hermes_install_failed'})
    probe = subprocess.run([str(python), '-m', 'hermes_cli.main', '--version'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=str(INSTALL), env={**os.environ, 'HERMES_HOME': str(ROOT), 'PYTHONDONTWRITEBYTECODE': '1'}, timeout=120)
    if probe.returncode: out({'error': 'hermes_install_failed'})
    out({'ok': True, 'installerDigest': digest, 'milestones': milestones})
except SystemExit:
    raise
except Exception:
    sys.stdout.write(json.dumps({'error': 'host_operation_failed'}))
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
# 모델 제공자 이름의 모양만 본다(실측 값: 'openai-codex'). 모양이 아니면 판정하지 않고 unknown 이다.
PROVIDER = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$')
RESERVED = {'hermes','test','tmp','root','sudo'}
# 마법사가 새로 만들거나 키를 발급할 수 있는 이름에서 제외한다. 'default' 는 configure 가 다룬다.
RESERVED_PROFILE = RESERVED | {'default'}
PIN = '02991b63714a12b2f7c4bb618d063ef23e7c1a78'
PLUGIN_VERSION = '0.10.1'
HERMES_MIN = '0.21.1'
SOURCE = 'https://github.com/dandacompany/deskrpg-hermes-plugin'
TIMEZONE = re.compile(r'^[A-Za-z][A-Za-z0-9_+\-]*(/[A-Za-z0-9_+\-.]+)*$')
LOCK = None
PORT_MIN = 8642
PORT_MAX = 8699
class Failure(Exception): pass
def fail(code): raise Failure(code)
def version_parts(value):
    parts = []
    for chunk in str(value or '').split('.'):
        match = re.match(r'^\d+', chunk)
        if not match: break
        parts.append(int(match.group(0)))
    return parts
def version_below(value, minimum):
    # Unreadable, absent or non-numeric versions never block; only a confidently lower number does.
    if not isinstance(value, str) or not value or value == 'unknown': return False
    left, right = version_parts(value), version_parts(minimum)
    if not left: return False
    size = max(len(left), len(right))
    return tuple(left + [0] * (size - len(left))) < tuple(right + [0] * (size - len(right)))
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
    versions = {}
    directory = home / 'plugins'
    if directory.is_symlink(): fail('unsafe_host_path')
    if directory.exists():
        for child in directory.iterdir():
            if child.is_symlink(): continue
            manifest = child / 'plugin.yaml'
            if manifest.is_file():
                data = yaml.safe_load(read(manifest)) or {}
                if isinstance(data, dict) and data.get('name') == 'deskrpg':
                    manifests.append(child.name)
                    installed_version = data.get('version')
                    versions[child.name] = installed_version if isinstance(installed_version, str) else None
    if len(manifests) > 1: fail('plugin_identity_ambiguous')
    plugins = mapping(cfg.get('plugins'))
    names = {'deskrpg', *manifests}
    enabled = plugins.get('enabled') or []
    disabled = plugins.get('disabled') or []
    if not isinstance(enabled, list) or not isinstance(disabled, list): fail('invalid_host_config')
    return bool(manifests), bool(names.intersection(enabled)) and not bool(names.intersection(disabled)), manifests[0] if manifests else 'deskrpg', versions.get(manifests[0]) if manifests else None

def candidate(name, home):
    cfg, env, token, port, external = settings(home)
    owner = identity(name, home)
    installed, enabled, plugin_name, plugin_version = plugin(home, cfg)
    match = re.search(r'^version\s*=\s*"([^"]+)"', read(INSTALL / 'pyproject.toml'), re.M)
    zone = cfg.get('timezone')
    zone = zone.strip() if isinstance(zone, str) else ''
    public = {'id': owner['id'], 'label': 'Hermes ' + name, 'version': match.group(1) if match else 'unknown', 'service': owner['service'], 'pluginInstalled': installed, 'pluginEnabled': enabled, 'pluginVersion': plugin_version, 'hasToken': bool(token), 'port': port, 'timezone': zone or None}
    # A version we cannot read warns but never blocks; a version we can read and that is too low does block.
    warning = owner['warning'] or ('external_secret_provider' if external else None) or ('hermes_version_unknown' if public['version'] == 'unknown' else None)
    if warning: public['warning'] = warning
    return public, owner, cfg, token, plugin_name

def select(candidate_id):
    # 게이트웨이는 default 하나다. 프로필은 그 게이트웨이가 /p/<이름>/ 으로 싣는다 —
    # 프로필 폴더를 따로 게이트웨이로 고르는 길은 두지 않는다(유닛도 포트도 없는 후보가 된다).
    item = candidate('default', ROOT)
    if item[0]['id'] == candidate_id: return 'default', ROOT, item
    fail('candidate_changed')

def port_listening(port):
    # 여는지만 본다. 키는 보내지 않는다 — 누가 여는지는 연결 단계의 assert_port_owned 가 가린다.
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=0.5): return True
    except OSError: return False

def gateway_state(public, owner, cfg):
    """running / stopped / profile_gateways(따로 떠 있는 프로필 게이트웨이 이름들)."""
    if owner['pid'] or port_listening(public['port']): return 'running', []
    others = []
    for child, childhome in profile_names(cfg):
        if child == 'default': continue
        running = bool(identity(child, childhome)['pid'])
        if not running and (childhome / 'gateway.pid').exists():
            try:
                from hermes_cli.gateway import get_running_pid
                running = bool(get_running_pid(childhome / 'gateway.pid', cleanup_stale=False))
            except Exception: running = False
        if running: others.append(child)
    return ('profile_gateways', others) if others else ('stopped', [])

def discover():
    public, owner, cfg, token, plugin_name = candidate('default', ROOT)
    state, others = gateway_state(public, owner, cfg)
    result = {**public, 'gatewayState': state, 'profiles': [n for n, h in profile_names(cfg) if n != 'default']}
    if others: result['profileGateways'] = others
    return {'candidates': [result]}

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

def port_free(port):
    # 남의 리스너는 절대 건드리지 않는다. 바인드가 되는지만 보고 곧바로 닫는다.
    sock = socket.socket()
    try:
        sock.bind(('127.0.0.1', port))
        return True
    except OSError: return False
    finally: sock.close()
def suggest_port(current):
    # 이 홈의 다른 프로필이 쓰는 포트와 지금 열려 있는 포트를 피해 가장 작은 빈 포트를 고른다.
    # 하나도 못 고르면 None 이다 — 제안 없이 오류만 나가고 흐름은 그대로다.
    used = {current}
    for unused_name, childhome in homes():
        try: used.add(settings(childhome)[3])
        except Exception: pass
    for port in range(PORT_MIN, PORT_MAX + 1):
        if port not in used and port_free(port): return port
    return None

def allowlist(cfg):
    gateway = mapping(cfg.get('gateway'))
    allow = cfg.get('multiplex_profile_allowlist', gateway.get('multiplex_profile_allowlist'))
    if allow is not None and (not isinstance(allow,list) or any(not isinstance(n,str) or not NAME.fullmatch(n) for n in allow)): fail('invalid_host_config')
    return allow
def profile_names(cfg):
    allow = allowlist(cfg)
    return [(name,home) for name,home in homes() if name == 'default' or allow is None or name in allow]

def needs_service(owner):
    # 유닛이 없는 호스트를 알아보는 유일한 규칙이다. service 이름으로 판정하면 안 된다 —
    # 리눅스 분기는 유닛 파일이 없어도 'hermes-gateway.service' 라는 이름을 먼저 채우므로
    # service == 'manual' 은 macOS 에서만 참이 된다(실측: 새 설치에서 등록 단계가 통째로 빠졌다).
    # identity_mismatch/ambiguous 는 남의 유닛이거나 손댄 유닛이라는 뜻이므로 덮어쓰지 않는다.
    return not owner['command'] and owner['warning'] == 'managed_service_required'

def preflight(name, home, item):
    public, owner, cfg, token, plugin_name = item
    if version_below(public['version'], HERMES_MIN): fail('hermes_version_unsupported')
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

def bounded(argv, env):
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
    return code, output

def main(action, candidate_id=None, option=None):
    global LOCK
    if ROOT.is_symlink(): fail('unsafe_host_path')
    if action in ('install','configure','restart','install-service','set-timezone','set-port','create-profile','provision-key'):
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
        return discover()
    name, home, item = select(candidate_id)
    public, owner, cfg, token, plugin_name = item
    if action == 'check-model':
        # 자격 증명이 있는지만 본다. 어떤 결과도 설정을 실패시키지 않는다 — 애매하면 unknown 이다.
        block = cfg.get('model')
        provider = block.get('provider') if isinstance(block, dict) else None
        if not isinstance(provider, str) or not provider.strip(): provider = cfg.get('provider')
        provider = provider.strip() if isinstance(provider, str) else ''
        if not provider or not PROVIDER.fullmatch(provider): return {'ok': True, 'model': 'unknown'}
        try:
            auth = run([sys.executable, '-m', 'hermes_cli.main', 'auth', 'status', provider], timeout=45, env={**os.environ, 'HERMES_HOME': str(home)})
        except Exception:
            return {'ok': True, 'model': 'unknown'}
        # 실측 출력은 한 줄이다: 'openai-codex: logged in'. 원문은 저장도 반환도 하지 않는다.
        # 이름을 probe 로 두면 모듈 함수 probe() 가 main 안에서 지역 변수로 가려진다(실측: 테스트 6건 실패).
        if auth.returncode == 0 and 'logged in' in (auth.stdout or '').lower():
            return {'ok': True, 'model': 'ready'}
        return {'ok': True, 'model': 'missing'}
    if action == 'set-port':
        # 운영자가 화면에서 명시적으로 수락한 포트만 여기까지 온다. 소유권 판정은 건드리지 않는다 —
        # 이 프로필의 .env 만 고치고, 실제 적용은 이어지는 restart 단계가 한다.
        try: value = int(option) if isinstance(option, str) and option.strip() else 0
        except (ValueError, TypeError): fail('invalid_host_operation')
        if not 1024 <= value <= 65535: fail('invalid_host_operation')
        old = read(home / '.env')
        kept = [line for line in old.splitlines() if not re.match(r'^\s*(export\s+)?API_SERVER_PORT\s*=', line)]
        body = '\n'.join(kept).rstrip('\n')
        try: atomic(home / '.env', (body + '\n' if body else '') + 'API_SERVER_PORT=' + str(value) + '\n')
        except Failure: raise
        except Exception: fail('port_write_failed')
        if settings(home)[3] != value: fail('port_write_failed')
        return {'ok': True, 'port': value}
    if action == 'inspect':
        try: listening = assert_port_owned(public, owner)
        except Failure as conflict:
            # 충돌일 때만 대안을 하나 얹는다. 못 고르면 그대로 오류만 나간다.
            if str(conflict) == 'port_conflict':
                suggestion = suggest_port(public['port'])
                if suggestion is not None: conflict.suggestion = suggestion
            raise
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
        if needs_service(owner): changes.append('installing_service')
        if not public['pluginInstalled']: changes.append('installing_plugin')
        elif version_below(public['pluginVersion'], PLUGIN_VERSION): changes.append('updating_plugin')
        elif not public['pluginEnabled']: changes.append('enabling_plugin')
        gateway = mapping(cfg.get('gateway'))
        # A replaced plugin or a freshly registered unit only takes effect after the gateway restarts.
        if status != 'plugin_ready' or (name == 'default' and not cfg.get('multiplex_profiles',gateway.get('multiplex_profiles',False))) or 'updating_plugin' in changes or 'installing_service' in changes:
            changes.extend(['configuring_api','restarting_gateway','verifying_gateway'])
        available = profile_names(cfg) if name == 'default' else [(name,home)]
        profiles = []
        for child,childhome in available:
            child_settings = settings(childhome)
            metadata = {'name':child, 'hasToken':bool(child_settings[2])}
            # 형제 프로필도 채운다: 키가 없고 외부 비밀 제공자를 쓰지 않으면 발급할 수 있다.
            if preparation_safe and not child_settings[2] and not child_settings[4]:
                metadata['canProvision'] = True
            profiles.append(metadata)
        return {'candidate': public, 'pluginStatus': status, 'changes': changes, 'profiles':profiles}
    if action == 'install-service':
        # A host without a unit can never pass preflight's managed-service gate, so the rescue runs
        # before it. Hermes writes the unit itself — DeskRPG never authors one, because only a
        # Hermes-authored unit can pass the identity check that authorizes a restart later.
        if version_below(public['version'], HERMES_MIN): fail('hermes_version_unsupported')
        if not needs_service(owner): return {'ok': True}
        assert_port_owned(public, owner)
        env = {**os.environ, 'HERMES_HOME': str(home)}
        if bounded([sys.executable, '-m', 'hermes_cli.main', '--profile', name, 'gateway', 'install'], env)[0]:
            fail('service_install_failed')
        fresh = identity(name, home)
        if needs_service(fresh): fail('service_install_failed')
        # 후보 id 는 서비스 정의의 해시를 포함한다. 유닛을 막 만들었으므로 id 가 바뀌었다 —
        # 새 id 를 돌려주지 않으면 이어지는 모든 단계가 candidate_changed 로 죽는다(실측).
        return {'ok': True, 'candidateId': fresh['id']}
    if action == 'create-profile':
        # 프로필을 늘리는 것은 리스너 소유자(default)만 한다.
        if name != 'default': fail('profile_provision_forbidden')
        if version_below(public['version'], HERMES_MIN): fail('hermes_version_unsupported')
        try: request_body = json.loads(option) if isinstance(option, str) and option else None
        except Exception: fail('profile_name_invalid')
        if not isinstance(request_body, dict): fail('profile_name_invalid')
        new_name = request_body.get('name')
        description = request_body.get('description')
        if not isinstance(new_name, str) or not NAME.fullmatch(new_name) or new_name in RESERVED_PROFILE: fail('profile_name_invalid')
        if description is not None and (not isinstance(description, str) or len(description) > 200 or re.search(r'[\r\n\x00]', description)): fail('profile_name_invalid')
        if (ROOT / 'profiles').is_symlink(): fail('unsafe_host_path')
        target = ROOT / 'profiles' / new_name
        if target.exists() or target.is_symlink() or any(child == new_name for child,_ in homes()): fail('profile_exists')
        if bounded([sys.executable, '-m', 'hermes_cli.main', 'profile', 'create', new_name] + (['--description', description] if description else []), {**os.environ, 'HERMES_HOME': str(ROOT)})[0]:
            fail('profile_create_failed')
        # 명령이 0 으로 끝나도 디스크에 생겼는지 직접 본다.
        if not target.is_dir() or target.is_symlink(): fail('profile_create_failed')
        allowed = allowlist(config(home))
        result = {'ok': True, 'profile': new_name}
        # 허용 목록은 운영자의 것이다 — 고치지 않고 서빙되지 않는다는 사실만 알린다.
        if isinstance(allowed, list) and new_name not in allowed: result['warning'] = 'profile_not_served'
        return result
    if action == 'provision-key':
        target_name = option if isinstance(option, str) else ''
        if not target_name or not NAME.fullmatch(target_name) or target_name in RESERVED_PROFILE: fail('profile_name_invalid')
        if name != 'default': fail('profile_provision_forbidden')
        target_home = next((h for child,h in homes() if child == target_name), None)
        if target_home is None: fail('candidate_changed')
        child_token, child_external = settings(target_home)[2], settings(target_home)[4]
        # 외부 비밀 제공자를 쓰는 프로필은 제공자 설정을 건드리지 않고 그대로 둔다.
        if child_external: fail('profile_provision_forbidden')
        if child_token:
            if len(child_token) < 16 or '\n' in child_token or '\r' in child_token: fail('api_key_invalid')
            # 이미 있으면 회전하지 않는다. 아무것도 하지 않고 성공이다.
            return {'ok': True, 'provisioned': False, 'profile': target_name}
        old = read(target_home / '.env')
        try: atomic(target_home / '.env', old.rstrip('\n') + '\nAPI_SERVER_KEY=' + secrets.token_hex(32) + '\n')
        except Failure: raise
        except Exception: fail('profile_key_failed')
        if not settings(target_home)[2]: fail('profile_key_failed')
        return {'ok': True, 'provisioned': True, 'profile': target_name}
    preflight(name,home,item)
    if action == 'install':
        env = {**os.environ, 'HERMES_HOME': str(home)}
        argv = [sys.executable, '-m', 'hermes_cli.main', '--profile', name, 'plugins']
        updating = False
        if not public['pluginInstalled']: argv += ['install', SOURCE, '--ref', PIN, '--enable']
        elif version_below(public['pluginVersion'], PLUGIN_VERSION):
            # --force removes the stale copy and reinstalls the pinned ref. It is not a scan bypass:
            # a blocked security scan still fails with plugin_security_review_required below.
            updating = True
            argv += ['install', SOURCE, '--ref', PIN, '--force', '--enable']
        elif not public['pluginEnabled']: argv += ['enable', plugin_name]
        else: return {'ok': True}
        code, output = bounded(argv, env)
        failure_code = 'plugin_update_failed' if updating else 'plugin_install_failed'
        if code:
            diagnostic = output.decode('utf-8', errors='replace').lower()
            if 'blocked' in diagnostic and ('security' in diagnostic or 'scan' in diagnostic):
                fail('plugin_security_review_required')
            if 'repository not found' in diagnostic or 'could not resolve host' in diagnostic:
                fail('plugin_source_unavailable')
            fail(failure_code)
        installed, enabled, unused, installed_version = plugin(home,config(home))
        if not installed or not enabled: fail(failure_code)
        if updating and version_below(installed_version, PLUGIN_VERSION): fail('plugin_update_failed')
    elif action == 'set-timezone':
        value = option if isinstance(option, str) else ''
        if not value or len(value) > 64 or not TIMEZONE.fullmatch(value): fail('timezone_invalid')
        # 모양만 보면 'Asia/../Seoul' 이 통과한다 — zoneinfo 가 거부할 값을 설정에 남기지 않는다.
        if any(part in ('.','..') for part in value.split('/')): fail('timezone_invalid')
        fresh = config(home)
        existing = fresh.get('timezone')
        # Only ever fill an empty slot. An operator's own timezone is never overwritten.
        if isinstance(existing, str) and existing.strip(): return {'ok': True}
        if existing is not None and not isinstance(existing, str): fail('invalid_host_config')
        fresh['timezone'] = value
        try: atomic(home / 'config.yaml', yaml.safe_dump(fresh, sort_keys=False, allow_unicode=True))
        except Failure: raise
        except Exception: fail('timezone_write_failed')
        if config(home).get('timezone') != value: fail('timezone_write_failed')
    elif action == 'configure':
        # Preserve existing config shapes while setting the effective merged API block.
        # gateway 키가 있으나 값이 비어 있으면 setdefault 는 None 을 돌려준다 — 새로 설치한
        # Hermes 의 config.yaml 이 정확히 그 모양이라 여기서 TypeError 로 죽었다(실측).
        gateway_block = mapping(cfg.get('gateway'))
        cfg['gateway'] = gateway_block
        if name == 'default':
            gateway_block['multiplex_profiles'] = True
            if 'multiplex_profiles' in cfg: cfg['multiplex_profiles'] = True
        api = mapping(gateway_block.get('api_server'))
        api['enabled'] = True
        gateway_block['api_server'] = api
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
        warnings = []
        selected_profiles = profile_names(cfg) if name == 'default' else [(name,home)]
        for child, childhome in selected_profiles:
            if child not in names: continue
            _, _, childtoken, _, external = settings(childhome)
            if not childtoken: continue
            path = '/v1/models' if child == 'default' else '/p/' + child + '/v1/models'
            code, models = request(public['port'],childtoken,path)
            if code == 200 and isinstance(models,dict) and isinstance(models.get('data'),list):
                profiles.append({'name':child,'token':childtoken})
                # 설치는 모델 자격 증명을 만들지 않는다. 빈 목록은 실패가 아니라 사람이 할 일이다.
                if child == name and not models['data'] and 'model_provider_required' not in warnings: warnings.append('model_provider_required')
        return {'prepared': {'baseUrl':'http://127.0.0.1:' + str(public['port']), 'token':token, 'profiles':profiles}, 'warnings': warnings}
    else: fail('invalid_host_operation')
    return {'ok':True}

def entry(action, candidate_id, option=None):
    try: print(json.dumps(main(action,candidate_id,option)))
    except Failure as error:
        body = {'error': str(error)}
        suggestion = getattr(error, 'suggestion', None)
        # 코드 하나와 숫자 하나뿐이다. 호스트의 어떤 원문도 여기에 실리지 않는다.
        if isinstance(suggestion, int) and not isinstance(suggestion, bool): body['suggestedPort'] = suggestion
        print(json.dumps(body))
    except Exception: print(json.dumps({'error':'host_operation_failed'}))
`;
