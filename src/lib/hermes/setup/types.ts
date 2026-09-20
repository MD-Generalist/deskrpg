export type SetupMode = "local" | "ssh" | "url";
export type SetupCandidate = {
  id: string;
  label: string;
  version: string;
  service: string;
  pluginInstalled: boolean;
  pluginEnabled: boolean;
  /** plugin.yaml 의 version. 설치돼 있지 않거나 매니페스트가 버전을 적지 않으면 null. */
  pluginVersion: string | null;
  port: number;
  hasToken: boolean;
  /** config.yaml 의 최상위 timezone. 비어 있으면 null — 그때만 마법사가 채워 준다. */
  timezone: string | null;
  warning?: string;
  /** 탐색 시점의 게이트웨이 상태. 중지돼 있으면 연결이 시작시킨다. */
  gatewayState?: "running" | "stopped" | "profile_gateways";
  /** 이 게이트웨이가 /p/<이름>/ 으로 싣는 프로필(default 제외). */
  profiles?: string[];
  /** default 가 멈춘 채 따로 떠 있는 프로필 게이트웨이 — 먼저 멈춰야 연결할 수 있다. */
  profileGateways?: string[];
};
export type SetupInspection = {
  candidate: SetupCandidate;
  pluginStatus: "plugin_ready" | "plugin_absent" | "plugin_unauthorized" | "unknown";
  changes: string[];
  profiles?: { name: string; hasToken: boolean; canProvision?: boolean }[];
};
export type SetupJob = {
  id: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  steps: string[];
  error?: string;
  gatewayId?: string;
  /** 실패가 아닌 경고 코드. 잡이 성공해도 남는다(profile_not_served, model_provider_required). */
  warnings?: string[];
  /** install-hermes 가 실행한 설치 스크립트의 sha256(소문자 hex 64자). 비밀이 아니라 감사 기록이다. */
  installerDigest?: string;
  /**
   * 마지막으로 관측한 설치 이정표 코드(`deps`·`clone`·`venv`·`node_modules`·`skills`·`done`).
   * 설치 출력의 원문이 아니라 미리 정한 코드 하나다.
   */
  progress?: string;
  /** 설치 전 검사에서 빠진 시스템 패키지 코드(curl·git·cxx). 화면이 설치 명령을 만든다. */
  missingPackages?: string[];
  /** 그 서버의 패키지 관리자(apt·dnf·pacman·macos). 모르면 없음. */
  packageManager?: string;
  /**
   * 성공한 단계 이름. `steps` 는 "시도한 것" 이라 성공 여부를 모른다 — 재개가 이 목록을 읽는다.
   * 재개 잡은 앞선 잡의 목록을 그대로 물려받고 시작한다.
   * 화면이 보는 "건너뜀" 은 `completed` 에 있으면서 `steps` 에 없는 단계다.
   */
  completed?: string[];
};
/** 모델 자격 증명 확인 결과. 판정이 애매하면 언제나 `unknown` 이고 설정을 실패시키지 않는다. */
export type SetupModelState = "ready" | "missing" | "unknown";
export type SetupCapabilities = {
  local: boolean;
  ssh: boolean;
  hostLabel: string;
  sshHosts: { id: string; label: string }[];
  /** 로컬이 열려 있고, 여기 Hermes 가 없고, 설치 스위치가 꺼지지 않았는가. */
  canInstallHermes: boolean;
  /** SSH 대상에 설치해도 되는가(호스트별 Hermes 유무는 탐색이 알려 준다). */
  canInstallHermesSsh?: boolean;
  /** 이 서버 사용자 홈에 Hermes 가 설치돼 있는가. */
  localHermesFound?: boolean;
  /** 로컬을 못 여는 이유. 열려 있으면 null. */
  localReason?:
    "not_admin" | "disabled" | "unsupported_platform" | "container_without_hermes" | null;
  /** SSH 를 못 여는 이유. 열려 있으면 null(등록된 호스트가 없어도 열린다 — 화면에서 등록한다). */
  sshReason?: "not_admin" | "disabled" | "ssh_missing" | null;
};
/** Server-only secrets must never be serialized into setup responses. */
export type PreparedHost = {
  baseUrl: string;
  token: string;
  profiles: { name: string; token: string }[];
  /** 실패가 아닌 경고 코드. 서버가 잡에 그대로 싣는다. */
  warnings?: string[];
};
export type SetupProvisionRequest = {
  createProfile?: { name: string; description?: string };
  provisionKeys?: string[];
};
export type HostTarget = { mode: "local" | "ssh"; hostId?: string };
export type CommandResult = { stdout: string; stderr: string; code: number };
export type HostExecutor = (
  command: string,
  args: string[],
  /** `env` 는 argv 로 보낼 수 없는 값(Windows PowerShell 런처의 페이로드)을 자식 프로세스 환경에 얹는다. */
  options?: {
    input?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    env?: Record<string, string>;
  },
) => Promise<CommandResult>;
