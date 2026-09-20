/**
 * 연결 마법사가 로컬·SSH 를 열 수 있는지와 **못 여는 이유**를 판정한다.
 *
 * 예전에는 불리언만 돌려줘 화면이 "호스트 접근이 허용되지 않습니다" 한 문장만 보였다 — 스위치가 꺼졌는지,
 * 관리자가 아닌지, ssh·Hermes 가 없는지 알 수 없었다. 판정은 실제로 없는 것을 말한다:
 * Docker 라서 막는 것이 아니라, 컨테이너 안에 Hermes 가 없고 거기 설치해도 재배포 때 사라지기 때문에 막는다.
 */
import type { SetupCapabilities } from "./types";

export type LocalReason =
  "not_admin" | "disabled" | "unsupported_platform" | "container_without_hermes";
export type SshReason = "not_admin" | "disabled" | "ssh_missing";

export type CapabilityProbe = {
  role: string | undefined;
  /** 운영자 스위치(DESKRPG_HOST_SETUP_ENABLED=0)로 꺼졌는가. */
  switchedOff: boolean;
  installAllowed: boolean;
  platform: string;
  hasSsh: boolean;
  /** win32 에서만 본다 — 호스트 명령을 띄울 PowerShell 이 있는가. */
  hasPowershell: boolean;
  inContainer: boolean;
  /** 이 서버 사용자 홈에 Hermes 가 설치돼 있는가. */
  localHermesFound: boolean;
  hostLabel: string;
  sshHosts: { id: string; label: string }[];
};

export function describeCapabilities(p: CapabilityProbe): SetupCapabilities {
  const gate: LocalReason | null =
    p.role !== "system_admin" ? "not_admin" : p.switchedOff ? "disabled" : null;
  let localReason: LocalReason | null = gate;
  // 예전에는 win32 자체를 막았다. Hermes 가 Windows 를 정식 지원하게 되면서(install.ps1,
  // hermes_cli/gateway_windows.py) 막을 이유가 없어졌다. 이제 없는 것은 PowerShell 뿐이다.
  if (!localReason && p.platform === "win32" && !p.hasPowershell)
    localReason = "unsupported_platform";
  // python3 는 이유가 아니다 — 없으면 설치가 uv 로 사용자 홈에 파이썬을 받는다(HOST_LAUNCHER).
  // 컨테이너 안에 Hermes 가 있으면(이미지에 넣었다면) 그대로 쓴다. 없으면 설치를 권하지 않는다 —
  // 컨테이너는 재배포 때 새로 만들어지고, 호스트에서 도는 Hermes 와도 별개다.
  if (!localReason && p.inContainer && !p.localHermesFound)
    localReason = "container_without_hermes";
  const sshReason: SshReason | null = gate ?? (p.hasSsh ? null : "ssh_missing");
  const local = localReason === null;
  return {
    local,
    ssh: sshReason === null,
    hostLabel: local || sshReason === null ? p.hostLabel : "",
    sshHosts: sshReason === null ? p.sshHosts : [],
    localHermesFound: p.localHermesFound,
    canInstallHermes: local && !p.localHermesFound && p.installAllowed,
    canInstallHermesSsh: sshReason === null && p.installAllowed,
    localReason,
    sshReason,
  };
}
