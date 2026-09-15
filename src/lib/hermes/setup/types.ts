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
};
export type SetupCapabilities = {
  local: boolean;
  ssh: boolean;
  hostLabel: string;
  sshHosts: { id: string; label: string }[];
};
/** Server-only secrets must never be serialized into setup responses. */
export type PreparedHost = {
  baseUrl: string;
  token: string;
  profiles: { name: string; token: string }[];
};
export type HostTarget = { mode: "local" | "ssh"; hostId?: string };
export type CommandResult = { stdout: string; stderr: string; code: number };
export type HostExecutor = (
  command: string,
  args: string[],
  options?: { input?: string; timeoutMs?: number; signal?: AbortSignal },
) => Promise<CommandResult>;
