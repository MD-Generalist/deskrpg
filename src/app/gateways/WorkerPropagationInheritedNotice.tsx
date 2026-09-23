"use client";

/**
 * 플러그인 갱신이 워커 전파를 **켠 채로 이어받았을 때** 한 번 보이는 줄.
 *
 * 옛 플러그인(0.16.0 전)은 직원 프로필마다 링크를 만들어 두었다. 0.16.0 부터 전파는 기본 꺼짐이라,
 * 갱신이 그 흔적을 보고 운영자 설정을 켜 둔다(`startPluginUpdate`, 잡의 `workerPropagationInherited`).
 * 여기서는 그 사실을 알리고 [끄기] 로 되돌릴 길을 준다 — 끄면 새 직원에게만 적용하지 않고, 이미 있는
 * 링크는 플러그인이 지우지 않는다.
 */
import { useState } from "react";

import { useT } from "@/lib/i18n";
import { withHeaderErrorCode } from "@/lib/i18n/error-codes";

export type TurnOffResult = { ok: true } | { ok: false; errorCode: string };

/** `POST /api/gateways/:id/plugin/worker-propagation` `{ enabled: false }`. 실제로 꺼졌다고 답해야 성공이다. */
export async function disableWorkerPropagationRequest(
  gatewayId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnOffResult> {
  const res = await fetchImpl(
    `/api/gateways/${encodeURIComponent(gatewayId)}/plugin/worker-propagation`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    },
  );
  const body = withHeaderErrorCode(await res.json().catch(() => ({})), res.headers) as {
    propagation?: unknown;
    errorCode?: unknown;
  };
  const errorCode = typeof body.errorCode === "string" ? body.errorCode : null;
  if (!res.ok) return { ok: false, errorCode: errorCode ?? `http_${res.status}` };
  // 루트 .env 의 환경변수가 켜 두었으면 설정을 꺼도 여전히 enabled 다 — 꺼졌다고 말하지 않는다.
  if (body.propagation !== "disabled")
    return { ok: false, errorCode: errorCode ?? "propagation_still_enabled" };
  return { ok: true };
}

export default function WorkerPropagationInheritedNotice({
  turnOff,
  onChanged,
}: {
  turnOff: () => Promise<TurnOffResult>;
  /** 끈 뒤 게이트웨이 목록(전파 상태)을 다시 읽게 한다. */
  onChanged: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await turnOff();
      if (res.ok) {
        setDone(true);
        onChanged();
      } else setError(res.errorCode);
    } catch {
      setError("request_failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <p
      className="-mt-3 mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted"
      data-worker-propagation-inherited=""
    >
      {done ? (
        <span className="text-success">{t("hermes.pluginUpdate.workerPropagationTurnedOff")}</span>
      ) : (
        <>
          <span>{t("hermes.pluginUpdate.workerPropagationInherited")}</span>
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className="rounded-md bg-surface-raised px-2 py-0.5 text-[11px] font-medium hover:brightness-110 disabled:opacity-60"
          >
            {t("hermes.pluginUpdate.workerPropagationTurnOff")}
          </button>
        </>
      )}
      {error && (
        <span className="text-danger">
          {t("hermes.pluginUpdate.workerPropagationTurnOffFailed", { code: error })}
        </span>
      )}
    </p>
  );
}
