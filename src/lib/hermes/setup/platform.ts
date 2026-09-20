/**
 * 플랫폼에 따라 달라지는 질의를 한곳에 모은다. 전부 순수 함수이고 `platform` 을 인자로 받는다 —
 * 맥에서 돌리는 테스트가 win32 경로를 그대로 지나갈 수 있어야 한다.
 */
import path from "node:path";

/** PATHEXT 가 비어 있는 Windows 에서 쓸 기본 확장자. cmd.exe 의 기본값 중 실행 파일만 남겼다. */
export const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

export function isWindows(platform: string): boolean {
  return platform === "win32";
}

/** ssh 설정에서 "아무것도 읽지 않는다" 를 뜻하는 경로. Windows 에 `/dev/null` 은 없다. */
export function nullDevicePath(platform: string): string {
  return isWindows(platform) ? "NUL" : "/dev/null";
}

/**
 * PATH 위에 그 명령이 있는가.
 *
 * Windows 실측(WinServer, 2026-09-20): 바이너리는 `ssh.exe` 라 확장자 없이 찾으면 언제나 실패한다.
 * `hasCommand(ssh)=false` / `hasCommand(ssh.exe)=true` 였고, 그래서 SSH 모드가 화면에서 사라졌다.
 */
export function hasCommandIn(
  command: string,
  env: { PATH?: string; PATHEXT?: string },
  platform: string,
  access: (candidate: string) => boolean,
): boolean {
  const pathDelimiter = isWindows(platform) ? ";" : ":";
  const separator = isWindows(platform) ? "\\" : "/";
  const directories = (env.PATH ?? "").split(pathDelimiter).filter(Boolean);
  // 확장자 없는 이름을 먼저 본다 — 비 win32 는 이 하나가 전부다.
  const suffixes = [""];
  if (isWindows(platform)) {
    for (const raw of (env.PATHEXT || DEFAULT_PATHEXT).split(";")) {
      const suffix = raw.trim();
      if (suffix) {
        // 소문자 버전을 먼저 시도한다
        suffixes.push(suffix.toLowerCase());
        // 원본과 다른 대소문자는 추가로 시도한다
        if (suffix !== suffix.toLowerCase()) {
          suffixes.push(suffix);
        }
      }
    }
  }
  return directories.some((directory) =>
    suffixes.some((suffix) => {
      try {
        const trailing = directory.endsWith(separator) ? "" : separator;
        const candidate = directory + trailing + command + suffix;
        return access(candidate);
      } catch {
        return false;
      }
    }),
  );
}

/**
 * Hermes 홈. 상류 `hermes_constants.py` 의 `_get_platform_default_hermes_home()` 과 같은 판정이다.
 * Windows 는 `%LOCALAPPDATA%\hermes`, 그 밖은 `~/.hermes` 다. 이 규칙은 호스트에서 도는
 * Python 본문(HOST_BOOTSTRAP·HOST_INSTALLER·HOST_HELPER)과 PowerShell 런처에도 같은 모양으로
 * 들어 있다 — 한 곳을 고치면 나머지도 함께 고친다.
 */
export function hermesRootPath(
  platform: string,
  env: { LOCALAPPDATA?: string },
  home: string,
): string {
  if (!isWindows(platform)) return path.join(home, ".hermes");
  const base = (env.LOCALAPPDATA ?? "").trim() || path.join(home, "AppData", "Local");
  return path.join(base, "hermes");
}

/** venv 안에서 파이썬이 있는 자리. Windows 는 `Scripts\python.exe` (상류 gateway_windows.py:1457,1475). */
export function venvPythonPath(platform: string, venvDir: string): string {
  return isWindows(platform)
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}
