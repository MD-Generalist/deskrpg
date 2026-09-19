/**
 * Hermes 설치에 필요한데 sudo 없이는 깔 수 없는 시스템 패키지 — curl·git·C++ 컴파일러.
 *
 * Hermes 설치 스크립트(install.sh)는 Python·uv·Node 는 사용자 홈에 스스로 받지만, git 과 C++ 컴파일러는
 * 패키지 관리자로 깔려 한다(`check_git`·`check_cxx_compiler`, `set -e` 라 없으면 멈춘다). root 이거나
 * 비밀번호 없는 sudo 가 있으면 스스로 깔고, 아니면 여기서 미리 멈추고 관리자에게 명령 한 줄을 보여 준다.
 * DeskRPG 는 sudo 비밀번호를 받지 않는다.
 *
 * 잡에는 코드(`curl`·`git`·`cxx`)와 패키지 관리자 이름만 남는다. 명령 문자열은 화면이 이 표로 만든다.
 * 클라이언트도 import 한다 — node 모듈을 쓰지 않는다.
 */
export const SYSTEM_PACKAGES = ["curl", "git", "cxx"] as const;
export type SystemPackage = (typeof SYSTEM_PACKAGES)[number];
export type PackageManager = "apt" | "dnf" | "pacman" | "macos";

const MANAGERS: Record<string, PackageManager> = {
  debian: "apt",
  ubuntu: "apt",
  linuxmint: "apt",
  pop: "apt",
  raspbian: "apt",
  fedora: "dnf",
  rhel: "dnf",
  centos: "dnf",
  rocky: "dnf",
  almalinux: "dnf",
  amzn: "dnf",
  arch: "pacman",
  manjaro: "pacman",
  endeavouros: "pacman",
  macos: "macos",
};

/** `/etc/os-release` 의 ID(macOS 는 "macos") → 패키지 관리자. 모르는 배포판은 null. */
export function packageManagerFor(distro: unknown): PackageManager | null {
  return typeof distro === "string" ? (MANAGERS[distro] ?? null) : null;
}

export function parseSystemPackages(value: unknown): SystemPackage[] {
  const words = typeof value === "string" ? value.trim().split(/\s+/) : [];
  return SYSTEM_PACKAGES.filter((p) => words.includes(p));
}

const NAMES: Record<Exclude<PackageManager, "macos">, Record<SystemPackage, string>> = {
  apt: { curl: "curl", git: "git", cxx: "build-essential" },
  dnf: { curl: "curl", git: "git", cxx: "gcc-c++" },
  pacman: { curl: "curl", git: "git", cxx: "base-devel" },
};

/** 관리자가 대상 서버에서 한 번 실행할 명령. 모르는 배포판이면 null(화면은 패키지 이름만 보인다). */
export function systemPackagesCommand(
  manager: PackageManager | null,
  packages: readonly SystemPackage[],
): string | null {
  if (!manager || !packages.length) return null;
  // macOS 는 Command Line Tools 가 git 과 clang 을 함께 준다. curl 은 기본으로 있다.
  if (manager === "macos") return "xcode-select --install";
  const names = packages.map((p) => NAMES[manager][p]).join(" ");
  if (manager === "apt") return `sudo apt-get update && sudo apt-get install -y ${names}`;
  if (manager === "dnf") return `sudo dnf install -y ${names}`;
  return `sudo pacman -S --needed ${names}`;
}
