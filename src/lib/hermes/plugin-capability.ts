/**
 * `deskrpg-hermes-plugin` 이 이 게이트웨이에 설치돼 있는가.
 *
 * 401 과 404 를 **반드시 구분한다.** 사용자가 할 일이 정반대이기 때문이다 —
 * 401 은 "이 게이트웨이 레코드의 토큰이 default 키가 아니다"(키 교체),
 * 404 는 "게이트웨이 머신에 플러그인이 없다"(설치). 한 덩어리로 뭉치면
 * 어느 쪽도 고칠 수 없다.
 *
 * 모르는 응답은 `unknown` 으로 접고 기능을 **켜지 않는다**. 능력을 낙관적으로
 * 가정하면 사용자가 마법사를 열었다가 중간에 실패한다.
 *
 * 이 파일은 **클라이언트 컴포넌트에서 직접 import 된다**(`HermesProfileList.tsx`,
 * 최종 리뷰 I-1 — `resolvePluginStatusFromCache` 를 브라우저에서 쓴다). 그래서
 * `@/db`(및 그것이 끌어오는 `pg`/`better-sqlite3` 같은 Node-only 모듈)를 이 파일에
 * import 하면 안 된다 — 실제로 한 번 그렇게 했다가 브라우저 번들이 깨졌다(`Module
 * not found: Can't resolve 'dns'/'fs'/'net'/'tls'`). DB 를 만지는
 * `buildPluginCacheUpdate` 는 그래서 `plugin-cache-update.ts`(서버 전용)로 뽑았다.
 */

import type { PluginInfo } from "./deskrpg-plugin-types";

export type PluginStatus = "plugin_ready" | "plugin_unauthorized" | "plugin_absent" | "unknown";

export type PluginCapability = { status: PluginStatus; version: string | null };

/**
 * 판정 + 자동화 계약 블록. `PluginCapability` 에 `info` 를 얹지 않고 따로 둔 것은 게이트웨이
 * 테스트 라우트가 `probeDeskrpgPlugin` 결과를 **응답 본문으로 그대로** 내보내기 때문이다 —
 * 필드를 하나 더하면 그 라우트의 JSON 계약이 바뀐다. `info` 는 200 판정일 때만 채워진다.
 */
export type PluginProbe = { capability: PluginCapability; info: PluginInfo | null };

const PLUGIN_NAME = "deskrpg";
const DEFAULT_TIMEOUT_MS = 10000;

export function classifyPluginProbe(input: { status: number; body: unknown }): PluginCapability {
  if (input.status === 401 || input.status === 403) {
    return { status: "plugin_unauthorized", version: null };
  }
  if (input.status === 404) return { status: "plugin_absent", version: null };
  if (input.status !== 200) return { status: "unknown", version: null };

  const body = input.body;
  if (typeof body !== "object" || body === null) return { status: "unknown", version: null };
  const record = body as Record<string, unknown>;
  if (record.plugin !== PLUGIN_NAME) return { status: "unknown", version: null };

  const version = typeof record.version === "string" ? record.version : null;
  return { status: "plugin_ready", version };
}

/** `classifyPluginProbe` 와 같은 판정에 계약 블록을 곁들인다. 200 이 아니면 `info` 는 null. */
export function classifyPluginProbeWithInfo(input: { status: number; body: unknown }): PluginProbe {
  const capability = classifyPluginProbe(input);
  return {
    capability,
    info: capability.status === "plugin_ready" ? parsePluginInfo(input.body) : null,
  };
}

// ---------------------------------------------------------------------------
// 자동화 계약(v0.6.0+) — info 파싱과 게이트. 전부 순수 함수다(브라우저에서도 돈다).
// ---------------------------------------------------------------------------

/** 자동화(칸반·크론·이벤트)가 요구하는 최소 플러그인 버전. */
export const AUTOMATION_MIN_VERSION = "0.6.0";

/** 자동화가 요구하는 capability 세 가지. 하나라도 없으면 기능을 켜지 않는다. */
export const AUTOMATION_CAPABILITIES = ["kanban", "cron", "events"] as const;

/**
 * `/deskrpg/info` 본문을 `PluginInfo` 로 접는다. `plugin`/`version` 이 없으면 우리
 * 플러그인이 아니므로 null. 0.6.0 이전 본문은 `capabilities`/`timezone`/`kanban` 이
 * 없다 — 그것을 실패로 보지 않고 빈 값으로 채운다. 계약 판정은 `meetsAutomationContract`
 * 가 따로 한다(파서는 모양만, 게이트는 의미만).
 */
export function parsePluginInfo(body: unknown): PluginInfo | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (record.plugin !== PLUGIN_NAME) return null;
  if (typeof record.version !== "string") return null;

  const capabilities = Array.isArray(record.capabilities)
    ? record.capabilities.filter((c): c is string => typeof c === "string")
    : [];
  const kanbanRecord =
    typeof record.kanban === "object" && record.kanban !== null
      ? (record.kanban as Record<string, unknown>)
      : {};

  return {
    plugin: PLUGIN_NAME,
    version: record.version,
    capabilities,
    timezone: typeof record.timezone === "string" ? record.timezone : null,
    kanban: {
      dispatcher_present: kanbanRecord.dispatcher_present === true,
      attachments: kanbanRecord.attachments === true,
    },
  };
}

/**
 * 숫자 세 자리만 비교한다. 앞의 `v` 와 `-rc.1` 같은 프리릴리스 꼬리는 무시한다 —
 * 플러그인 버전은 우리가 발행하므로 프리릴리스 순서까지 가릴 일이 없고, 정밀 semver
 * 라이브러리를 브라우저 번들에 끌어올 이유도 없다. 파싱 불가면 null.
 *
 * 문자열 비교(`"0.10.0" < "0.6.0"` 이 참)를 쓰면 안 되는 자리라 따로 둔다.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function parseSemver(value: string): [number, number, number] | null {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

export type AutomationContractVerdict =
  | { ok: true; minVersion: string }
  | {
      ok: false;
      minVersion: string;
      reason: "no_info" | "invalid_version" | "version_below_minimum" | "missing_capability";
      missing?: string[];
    };

/**
 * 이 플러그인으로 자동화(칸반·크론·이벤트)를 켜도 되는가.
 *
 * 버전 ≥ 0.6.0 **그리고** capability 세 가지가 모두 있어야 한다. 둘 중 하나만 보면
 * 틀린다 — 0.6.0 을 달고도 빌드 옵션에 따라 kanban 이 빠질 수 있고, 반대로 capability
 * 는 다 있어도 이벤트 커서 의미가 0.6.0 에서 바뀌었다. 거절 이유를 갈라 주는 것은
 * 화면이 "업그레이드하세요" 와 "플러그인 설정에서 events 를 켜세요" 를 구분해야 해서다.
 */
export function meetsAutomationContract(info: PluginInfo | null): AutomationContractVerdict {
  const minVersion = AUTOMATION_MIN_VERSION;
  if (!info) return { ok: false, minVersion, reason: "no_info" };

  const cmp = compareSemver(info.version, minVersion);
  if (cmp === null) return { ok: false, minVersion, reason: "invalid_version" };
  if (cmp < 0) return { ok: false, minVersion, reason: "version_below_minimum" };

  const missing = AUTOMATION_CAPABILITIES.filter((c) => !info.capabilities.includes(c));
  if (missing.length > 0) return { ok: false, minVersion, reason: "missing_capability", missing };

  return { ok: true, minVersion };
}

/** 캐시된 판정을 다시 확인할 주기. 플러그인은 나중에 설치될 수 있으므로 영구 캐시는 틀린다. */
const REPROBE_AFTER_MS = 60 * 60 * 1000;

/**
 * `checkedAt` 은 SQLite 에서는 ISO 문자열로, PostgreSQL 에서는 `timestamp(withTimezone)`
 * 컬럼이라 drizzle 이 `Date` 객체로 읽어준다 — 두 방언을 다 받는다.
 */
export function shouldReprobePlugin(input: {
  checkedAt: string | Date | null;
  now: Date;
}): boolean {
  if (!input.checkedAt) return true;
  const at =
    input.checkedAt instanceof Date ? input.checkedAt.getTime() : Date.parse(input.checkedAt);
  if (Number.isNaN(at)) return true;
  return input.now.getTime() - at >= REPROBE_AFTER_MS;
}

/**
 * 최종 리뷰 I-1: `shouldReprobePlugin` 을 정의만 하고 아무도 부르지 않아서 Task 4·9 의
 * 산출물(캐시 컬럼 3개, 이 함수)이 전부 죽어 있었다 — `HermesProfileList` 가 화면
 * 진입마다 무조건 `/test`(원격 왕복 2회, 플러그인 프로브만 타임아웃 10초)를 다시 쳤다.
 *
 * 이 함수가 "캐시를 쓸지 다시 찌를지"의 판정을 순수 함수로 뽑아 고정한다 — 캐시가
 * 신선하고 값이 있으면 그 값을 그대로 쓰고, 오래됐거나(또는 아예 없으면) 재프로브가
 * 필요하다고 말한다. 호출부(`HermesProfileList`)는 이 결과에 따라 `/test` 를 부를지
 * 말지만 결정하면 된다.
 */
export function resolvePluginStatusFromCache(input: {
  pluginStatus: string | null;
  pluginCheckedAt: string | Date | null;
  now: Date;
}): { status: PluginStatus; needsReprobe: boolean } {
  const stale = shouldReprobePlugin({ checkedAt: input.pluginCheckedAt, now: input.now });
  if (!stale && isPluginStatus(input.pluginStatus)) {
    return { status: input.pluginStatus, needsReprobe: false };
  }
  return { status: "unknown", needsReprobe: true };
}

function isPluginStatus(value: string | null): value is PluginStatus {
  return (
    value === "plugin_ready" ||
    value === "plugin_unauthorized" ||
    value === "plugin_absent" ||
    value === "unknown"
  );
}

type ProbeInput = {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** `GET /deskrpg/info` 한 번. 도달 실패·타임아웃·중단은 null — 호출자는 판정만 원한다. */
async function fetchPluginInfo(
  input: ProbeInput,
): Promise<{ status: number; body: unknown } | null> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = input.baseUrl.replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    // 프리픽스 없는 경로다 — `/deskrpg/info` 는 default 스코프이므로
    // `/p/<name>/` 을 붙이면 프로필 키를 요구하게 되어 401 이 난다.
    const res = await fetchImpl(`${base}/deskrpg/info`, {
      method: "GET",
      headers: { authorization: `Bearer ${input.token}` },
      signal: controller.signal,
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeDeskrpgPlugin(input: ProbeInput): Promise<PluginCapability> {
  const raw = await fetchPluginInfo(input);
  return raw ? classifyPluginProbe(raw) : { status: "unknown", version: null };
}

/** `probeDeskrpgPlugin` + 계약 블록. 자동화 캐시(`plugin_info_json`)를 채우는 쪽이 쓴다. */
export async function probeDeskrpgPluginWithInfo(input: ProbeInput): Promise<PluginProbe> {
  const raw = await fetchPluginInfo(input);
  return raw
    ? classifyPluginProbeWithInfo(raw)
    : { capability: { status: "unknown", version: null }, info: null };
}
