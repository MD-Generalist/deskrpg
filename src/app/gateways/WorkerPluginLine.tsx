"use client";
/**
 * 칸반·크론으로 한 일의 결과물이 쌓이지 않는 직원 — 게이트웨이 화면의 한 줄(소유자에게만 버튼).
 *
 * 워커와 크론은 직원 프로필 홈으로 뜨는데 그 홈에 플러그인이 없으면 결과 파일이 하나도 안 쌓인다
 * (`src/lib/hermes/worker-plugin.ts`). 플러그인 버전 줄 바로 아래에 두어, 플러그인을 갱신하면 이 줄이
 * 그때 나타나고 [적용] 을 따로 누르게 한다 — "갱신" 이 직원들의 설정 파일까지 몰래 바꾸지 않게.
 *
 * 적용 결과는 목록을 다시 불러와 경고가 사라진 뒤에도 남긴다(`result` 상태) — 그래야 "크론은 재시작이
 * 필요할 수 있다" 는 안내를 사용자가 읽는다.
 */
import { useState } from "react";

import { useT } from "@/lib/i18n";
import type { WorkerPluginResult, WorkerPluginWarning } from "@/lib/hermes/worker-plugin";

export type WorkerPluginApplyResponse =
  { ok: true; results: WorkerPluginResult[] } | { ok: false; errorCode: string };

type Result =
  | { kind: "applied"; failures: { profile: string; error: string }[] }
  | { kind: "error"; code: string };

export default function WorkerPluginLine({
  warning,
  isOwner,
  apply,
  onApplied,
}: {
  warning: WorkerPluginWarning | null;
  isOwner: boolean;
  apply: () => Promise<WorkerPluginApplyResponse>;
  onApplied: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  if (!warning && !result) return null;

  const reason = (code: string) =>
    code === "config_unreadable"
      ? t("gateways.workerPlugin.reasonConfigUnreadable")
      : code === "not_found"
        ? t("gateways.workerPlugin.reasonNotFound")
        : t("gateways.workerPlugin.reasonOther", { code });

  const run = async () => {
    setBusy(true);
    try {
      const res = await apply();
      if (!res.ok) {
        setResult({ kind: "error", code: res.errorCode });
        return;
      }
      const failures = res.results.filter(
        (r): r is { profile: string; error: string } => "error" in r,
      );
      setResult({ kind: "applied", failures });
      onApplied();
    } catch {
      setResult({ kind: "error", code: "request_failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="-mt-3 mb-4 text-xs text-text-muted" data-worker-plugin-line="">
      {warning && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-npc-dark">
            {t("gateways.workerPlugin.missing", {
              count: warning.fixable.length,
              names: warning.fixable.join(", "),
            })}
          </span>
          {isOwner && (
            <>
              <button
                type="button"
                onClick={() => void run()}
                disabled={busy}
                className="rounded-md bg-surface-raised px-2 py-0.5 text-[11px] font-medium hover:brightness-110 disabled:opacity-60"
              >
                {busy ? t("gateways.workerPlugin.applying") : t("gateways.workerPlugin.apply")}
              </button>
              <span>{t("gateways.workerPlugin.whatChanges")}</span>
            </>
          )}
        </p>
      )}
      {warning && warning.disabledByOperator.length > 0 && (
        <p className="text-text-dim">
          {t("gateways.workerPlugin.disabledByOperator", {
            names: warning.disabledByOperator.join(", "),
          })}
        </p>
      )}
      {result?.kind === "applied" && (
        <p className="text-success" data-worker-plugin-result="applied">
          {t("gateways.workerPlugin.applied")}
        </p>
      )}
      {result?.kind === "applied" &&
        result.failures.map((f) => (
          <p key={f.profile} className="text-danger" data-worker-plugin-failure={f.profile}>
            {t("gateways.workerPlugin.failed", { name: f.profile, reason: reason(f.error) })}
          </p>
        ))}
      {result?.kind === "error" && (
        <p className="text-danger" data-worker-plugin-result="error">
          {t("gateways.workerPlugin.requestFailed", { code: result.code })}
        </p>
      )}
    </div>
  );
}
