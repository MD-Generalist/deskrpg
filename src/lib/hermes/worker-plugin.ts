/**
 * 칸반 워커·크론에서 플러그인이 안 뜨는 직원 — 판정과 적용.
 *
 * 워커는 `hermes -p <담당 프로필>` 로, 크론은 그 프로필 홈으로 뜨는데 Hermes 는 플러그인을
 * **로드하는 홈의** `plugins/`·`config.yaml` 에서만 찾는다. 루트(게이트웨이)에만 설치돼 있으면
 * 채팅에는 결과물이 쌓이는데 칸반·크론이 만든 결과 파일은 하나도 안 쌓인다 — 오류도 로그도 없다.
 * 플러그인 0.12.0 이 `/deskrpg/info` 의 `worker_plugin.missing` 으로 그 직원을 보고하고,
 * `POST /deskrpg/worker-plugin` 으로 고친다(프로필마다 링크와 활성화 항목, 백업을 남긴다).
 *
 * 화면은 이것을 **보이게** 할 뿐 몰래 고치지 않는다. 운영자가 `plugins.disabled` 에 넣은 직원은
 * 플러그인이 켜지 않으므로 고칠 대상으로 세지 않는다.
 *
 * 전부 순수 함수이거나 의존성을 주입받는다(브라우저 번들에도 들어간다 — `@/db` 를 끌어오지 않는다).
 */
import type { PluginInfo, WorkerPluginGap, WorkerPluginReport } from "./deskrpg-plugin-types";

export const WORKER_PLUGIN_CAPABILITY = "worker_plugin";

function parseGap(value: unknown): WorkerPluginGap | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.profile !== "string" || r.profile === "") return null;
  return {
    profile: r.profile,
    link: typeof r.link === "string" ? r.link : "missing",
    enabled: r.enabled === true,
    disabled: r.disabled === true,
  };
}

/**
 * `info.worker_plugin` 을 접는다. **`undefined` 와 `null` 을 구분한다** — 옛 플러그인에는 필드가
 * 없고(`undefined`), 새 플러그인이 판정에 실패하면 `null` 을 싣는다. 둘 다 경고를 띄우지 않지만
 * "모른다" 를 "전부 된다" 로 바꾸지는 않는다.
 */
export function parseWorkerPluginReport(value: unknown): WorkerPluginReport | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return null;
  const missing = (value as Record<string, unknown>).missing;
  if (!Array.isArray(missing)) return null;
  return {
    missing: missing.map(parseGap).filter((g): g is WorkerPluginGap => g !== null),
  };
}

export type WorkerPluginWarning = {
  /** 버튼으로 고칠 수 있는 직원(프로필 이름). */
  fixable: string[];
  /** 운영자가 `plugins.disabled` 로 끈 직원 — 버튼이 켜지 않는다. 알리기만 한다. */
  disabledByOperator: string[];
};

/** 경고 줄을 띄울지. 고칠 직원이 하나도 없으면 `null`(줄 자체가 없다). */
export function workerPluginWarning(info: PluginInfo | null): WorkerPluginWarning | null {
  if (!info || !info.capabilities.includes(WORKER_PLUGIN_CAPABILITY)) return null;
  const report = info.worker_plugin;
  if (!report) return null;
  const fixable = report.missing.filter((g) => !g.disabled).map((g) => g.profile);
  if (fixable.length === 0) return null;
  const disabledByOperator = report.missing.filter((g) => g.disabled).map((g) => g.profile);
  return { fixable, disabledByOperator };
}

export type WorkerPluginResult =
  { profile: string; link: string; enabled: string } | { profile: string; error: string };

type EnsureResponse =
  | { ok: true; data: { results: WorkerPluginResult[] } }
  | { ok: false; status: number; failure: { code: string } };

export type ApplyWorkerPluginDeps = {
  /** 플러그인 `POST /deskrpg/worker-plugin`(소유자 키). */
  ensure(): Promise<EnsureResponse>;
  /** 플러그인 정보를 다시 읽어 `plugin_info_json` 캐시를 채운다. */
  refreshCache(): Promise<void>;
};

export type ApplyWorkerPluginOutcome =
  { ok: true; results: WorkerPluginResult[] } | { ok: false; errorCode: string };

/**
 * 적용하고 **반드시** 캐시를 다시 채운다. 캐시는 최대 1시간 낡으므로(`shouldReprobePlugin`),
 * 다시 채우지 않으면 적용했는데도 경고가 남는다. 호출이 실패해도 다시 채운다 — 일부 직원은 이미
 * 바뀌었을 수 있고, 화면이 낡은 목록을 들고 있으면 안 된다. 캐시 갱신 실패는 적용 결과를 가리지
 * 않는다(다음 연결 테스트가 채운다).
 */
export async function applyWorkerPlugin(
  deps: ApplyWorkerPluginDeps,
): Promise<ApplyWorkerPluginOutcome> {
  const res = await deps.ensure();
  try {
    await deps.refreshCache();
  } catch {
    // 적용 결과가 정본이다. 캐시는 다음 프로브가 채운다.
  }
  if (!res.ok) return { ok: false, errorCode: res.failure.code };
  return { ok: true, results: res.data.results };
}
