import { classifyGateFailure } from "@/lib/gate-failure";
import { PLUGIN_INSTALL_COMMAND as SHARED_PLUGIN_INSTALL_COMMAND } from "@/lib/hermes/plugin-install-command";
/**
 * 브라우저 → `/api/channels/:id/cron/**` 호출. 하드 게이트: 브라우저는 Hermes 를 직접
 * 부르지 않는다 — 여기 있는 URL 만 쓴다. 인증은 다른 채널 API 와 같이 세션 쿠키다
 * (`ChannelSettingsModal` 의 `fetch` 와 같은 규약, 헤더 없음).
 *
 * 실패는 전부 `CronApiError` 로 던진다 — 서버의 `{code, message}` 본문(`cronError`)을
 * 그대로 싣고, 428/409 같은 특수 처리는 화면(`describeCronError`)이 결정한다.
 */

import type {
  AutomationBlueprint,
  CronDeliveryTarget,
  CronJob,
  CronRun,
  UpdateCronJobBody,
} from "@/lib/hermes/deskrpg-plugin-types";

/** 목록·상세 응답에 실리는 작업 — 서버의 `EnrichedCronJob` 와 같은 모양(브라우저용 사본). */
export type CronJobView = CronJob & {
  npcId: string;
  npcName: string;
  origin: { channelId: string; createdByUserId: string | null } | null;
  editable: boolean;
};

export type CronListResponse = {
  jobs: CronJobView[];
  timezone: string | null;
  errors?: Array<{ npcId: string; code: string; message: string }>;
};

export type CronRunsResponse = { runs: CronRun[]; limit: number };

export type CreateCronJobInput = {
  npcId: string;
  name: string;
  prompt: string;
  schedule: string;
  deliver: string;
  model?: string;
  provider?: string;
};

export type InstantiateBlueprintInput = {
  npcId: string;
  blueprint: string;
  values: Record<string, string>;
};

export class CronApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown>) {
    super(message);
    this.name = "CronApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isCronApiError(err: unknown): err is CronApiError {
  return err instanceof CronApiError;
}

async function readBody(res: Response): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await res.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (err) {
    throw new CronApiError(0, "unreachable", err instanceof Error ? err.message : String(err), {});
  }
  const body = await readBody(res);
  if (!res.ok) {
    const code = typeof body.code === "string" ? body.code : `http_${res.status}`;
    const message = typeof body.message === "string" ? body.message : res.statusText;
    throw new CronApiError(res.status, code, message, body);
  }
  return body as T;
}

function base(channelId: string): string {
  return `/api/channels/${encodeURIComponent(channelId)}/cron`;
}

function withNpc(path: string, npcId: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ npcId, ...(extra ?? {}) });
  return `${path}?${params.toString()}`;
}

export const cronApi = {
  listJobs(channelId: string, npcId?: string | null): Promise<CronListResponse> {
    const path = `${base(channelId)}/jobs`;
    return request(npcId ? withNpc(path, npcId) : path);
  },

  getJob(channelId: string, jobId: string, npcId: string) {
    return request<{ job: CronJobView; timezone: string | null }>(
      withNpc(`${base(channelId)}/jobs/${encodeURIComponent(jobId)}`, npcId),
    );
  },

  listRuns(channelId: string, jobId: string, npcId: string, limit = 20) {
    return request<CronRunsResponse>(
      withNpc(`${base(channelId)}/jobs/${encodeURIComponent(jobId)}/runs`, npcId, {
        limit: String(limit),
      }),
    );
  },

  createJob(channelId: string, input: CreateCronJobInput) {
    return request<{ job: CronJobView }>(`${base(channelId)}/jobs`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  updateJob(
    channelId: string,
    jobId: string,
    npcId: string,
    updates: UpdateCronJobBody["updates"],
  ) {
    return request<{ job: CronJobView }>(`${base(channelId)}/jobs/${encodeURIComponent(jobId)}`, {
      method: "PUT",
      body: JSON.stringify({ npcId, updates }),
    });
  },

  pauseJob(channelId: string, jobId: string, npcId: string) {
    return request<{ job: CronJobView }>(
      `${base(channelId)}/jobs/${encodeURIComponent(jobId)}/pause`,
      { method: "POST", body: JSON.stringify({ npcId }) },
    );
  },

  resumeJob(channelId: string, jobId: string, npcId: string) {
    return request<{ job: CronJobView }>(
      `${base(channelId)}/jobs/${encodeURIComponent(jobId)}/resume`,
      { method: "POST", body: JSON.stringify({ npcId }) },
    );
  },

  /** R19 — 202 로 바로 돌아온다. 결과는 `cron:event` 와 실행 이력으로 본다. */
  runJob(channelId: string, jobId: string, npcId: string) {
    return request<{ accepted: boolean }>(
      `${base(channelId)}/jobs/${encodeURIComponent(jobId)}/run`,
      { method: "POST", body: JSON.stringify({ npcId }) },
    );
  },

  deleteJob(channelId: string, jobId: string, npcId: string) {
    return request<{ ok: boolean }>(
      withNpc(`${base(channelId)}/jobs/${encodeURIComponent(jobId)}`, npcId),
      { method: "DELETE" },
    );
  },

  listDeliveryTargets(channelId: string, npcId: string) {
    return request<{ targets: CronDeliveryTarget[] }>(
      withNpc(`${base(channelId)}/delivery-targets`, npcId),
    );
  },

  listBlueprints(channelId: string, npcId: string) {
    return request<{ blueprints: AutomationBlueprint[] }>(
      withNpc(`${base(channelId)}/blueprints`, npcId),
    );
  },

  instantiateBlueprint(channelId: string, input: InstantiateBlueprintInput) {
    return request<{ job: CronJobView }>(`${base(channelId)}/blueprints/instantiate`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};

// ---------------------------------------------------------------------------
// 오류 → 화면 문구 (R31/R32)
// ---------------------------------------------------------------------------

/** R31 안내에 넣는 설치 명령. 최소 버전은 서버 응답의 `minVersion` 이 우선한다. */
/** 정본은 `@/lib/hermes/plugin-install-command` 다 — 여기서는 기존 import 경로를 지킨다. */
export const PLUGIN_INSTALL_COMMAND = SHARED_PLUGIN_INSTALL_COMMAND;
export const PLUGIN_MIN_VERSION = "0.6.0";

export type CronErrorNotice =
  | { kind: "upgrade"; minVersion: string; command: string }
  | { kind: "gateway" }
  | { kind: "other"; code: string; message: string; status: number };

/** 오류를 세 부류로 접는다 — 업그레이드 안내 / 게이트웨이 연결 안내 / 코드·메시지 그대로. */
export function classifyCronError(err: unknown): CronErrorNotice {
  if (isCronApiError(err)) {
    const minVersion =
      typeof err.details.minVersion === "string" ? err.details.minVersion : undefined;
    const blocker = classifyGateFailure({
      status: err.status,
      code: err.code,
      message: err.message,
      minVersion,
    });
    if (blocker.kind === "plugin_upgrade_required") {
      return { kind: "upgrade", minVersion: blocker.minVersion, command: blocker.command };
    }
    if (blocker.kind === "gateway_not_bound") return { kind: "gateway" };
    return { kind: "other", code: err.code, message: err.message, status: err.status };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { kind: "other", code: "unknown", message, status: 0 };
}
