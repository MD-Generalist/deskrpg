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

export type PluginStatus = "plugin_ready" | "plugin_unauthorized" | "plugin_absent" | "unknown";

export type PluginCapability = { status: PluginStatus; version: string | null };

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

export async function probeDeskrpgPlugin(input: {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<PluginCapability> {
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
    return classifyPluginProbe({ status: res.status, body });
  } catch {
    // 도달 실패·타임아웃·중단. 호출자는 판정만 원하지 예외를 원하지 않는다.
    return { status: "unknown", version: null };
  } finally {
    clearTimeout(timer);
  }
}
