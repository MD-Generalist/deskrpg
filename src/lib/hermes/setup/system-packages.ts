/**
 * System packages the Hermes install requires but will not install itself — curl, git and (Linux) libatomic.
 *
 * The current install script (install.sh `stage_prerequisites`) only checks for git and curl and stops if either is
 * missing; it fetches Python, uv and Node into the user's home itself and needs no compiler, but that Node links
 * libatomic.so.1, which minimal Linux images lack and the script does not check. As root or with
 * passwordless sudo the launcher installs them with the package manager; otherwise we stop early and show the admin a
 * one-line command. DeskRPG does not take sudo passwords.
 *
 * `cxx` stays in the list only so a job recorded by an older DeskRPG still renders; nothing reports it any more.
 * The job keeps only codes and the package manager name. The command string is built by the screen from this table.
 * The client imports this too — no node modules are used.
 */
export const SYSTEM_PACKAGES = ["curl", "git", "libatomic", "cxx"] as const;
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

/** ID from `/etc/os-release` ("macos" for macOS) → package manager. null for unknown distros. */
export function packageManagerFor(distro: unknown): PackageManager | null {
  return typeof distro === "string" ? (MANAGERS[distro] ?? null) : null;
}

export function parseSystemPackages(value: unknown): SystemPackage[] {
  const words = typeof value === "string" ? value.trim().split(/\s+/) : [];
  return SYSTEM_PACKAGES.filter((p) => words.includes(p));
}

const NAMES: Record<Exclude<PackageManager, "macos">, Record<SystemPackage, string>> = {
  apt: { curl: "curl", git: "git", libatomic: "libatomic1", cxx: "build-essential" },
  dnf: { curl: "curl", git: "git", libatomic: "libatomic", cxx: "gcc-c++" },
  pacman: { curl: "curl", git: "git", libatomic: "gcc-libs", cxx: "base-devel" },
};

/** Command the admin runs once on the target server. null for unknown distros (the screen shows only package
 * names). */
export function systemPackagesCommand(
  manager: PackageManager | null,
  packages: readonly SystemPackage[],
): string | null {
  if (!manager || !packages.length) return null;
  // On macOS the Command Line Tools provide both git and clang. curl is there by default.
  if (manager === "macos") return "xcode-select --install";
  const names = packages.map((p) => NAMES[manager][p]).join(" ");
  if (manager === "apt") return `sudo apt-get update && sudo apt-get install -y ${names}`;
  if (manager === "dnf") return `sudo dnf install -y ${names}`;
  return `sudo pacman -S --needed ${names}`;
}
