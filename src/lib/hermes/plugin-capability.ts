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
