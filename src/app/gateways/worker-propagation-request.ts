/**
 * [설정에서 켜기] 요청 — `POST /api/gateways/:id/plugin/worker-propagation` `{ enabled: true }`.
 *
 * 응답 세 갈래를 `WorkerPluginLine` 이 쓰는 모양으로 접는다.
 * - 200 `{ propagation: "enabled", results? }` → 켰고(적용까지 됐으면 결과를 싣는다) `ok: true`.
 * - 200 `{ propagation: "enabled", errorCode }`(헤더에도 코드) → 켰지만 적용 단계가 실패 — `applyErrorCode`.
 * - 4xx `{ errorCode }` → 호스트 단계에서 못 켰다(`plugin_update_unsupported_host` 면 명령 복사로 떨어진다).
 * 200 인데 켜졌다고 말하지 않으면 켜진 것으로 보지 않는다.
 */
import { withHeaderErrorCode } from "@/lib/i18n/error-codes";

import type { WorkerPropagationEnableResponse } from "./WorkerPluginLine";

export async function enableWorkerPropagationRequest(
  gatewayId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WorkerPropagationEnableResponse> {
  const res = await fetchImpl(
    `/api/gateways/${encodeURIComponent(gatewayId)}/plugin/worker-propagation`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    },
  );
  const body = withHeaderErrorCode(await res.json().catch(() => ({})), res.headers) as {
    propagation?: unknown;
    results?: unknown;
    errorCode?: unknown;
  };
  const errorCode = typeof body.errorCode === "string" ? body.errorCode : null;
  if (!res.ok) return { ok: false, errorCode: errorCode ?? `http_${res.status}` };
  if (body.propagation !== "enabled") {
    return { ok: false, errorCode: errorCode ?? "propagation_not_enabled" };
  }
  if (errorCode) return { ok: true, applyErrorCode: errorCode };
  return Array.isArray(body.results)
    ? {
        ok: true,
        results: body.results as NonNullable<
          Extract<WorkerPropagationEnableResponse, { ok: true }>["results"]
        >,
      }
    : { ok: true };
}
