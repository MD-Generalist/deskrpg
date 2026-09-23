"use client";
/**
 * 칸반·크론으로 한 일의 결과물이 쌓이지 않는 직원 — 게이트웨이 화면의 한 줄(소유자에게만 버튼).
 *
 * 워커와 크론은 직원 프로필 홈으로 뜨는데 그 홈에 플러그인이 없으면 결과 파일이 하나도 안 쌓인다
 * (`src/lib/hermes/worker-plugin.ts`). 플러그인 버전 줄 바로 아래에 두어, 플러그인을 갱신하면 이 줄이
 * 그때 나타나고 [적용] 을 따로 누르게 한다 — "갱신" 이 직원들의 설정 파일까지 몰래 바꾸지 않게.
 *
 * 플러그인 0.16.0 부터 이 "직원 홈에 플러그인 두기"(워커 전파)는 운영자가 켜야 한다(기본 꺼짐).
 * 꺼져 있으면(`propagation === "disabled"`, 또는 [적용] 이 409 `worker_propagation_disabled`)
 * 날것의 코드 대신 무엇이 안 되는지와 켜는 방법을 보인다. 켜는 길은 둘이다 — DeskRPG 가 호스트 설정을
 * 바꿀 수 있으면 [설정에서 켜기](`enablePropagation`), 아니면 운영자가 돌릴 명령을 복사하게 한다.
 *
 * 적용 결과는 목록을 다시 불러와 경고가 사라진 뒤에도 남긴다(`result` 상태) — 그래야 "크론은 재시작이
 * 필요할 수 있다" 는 안내를 사용자가 읽는다.
 */
import { useState } from "react";

import { CopyCommand } from "@/components/CopyCommand";
import { useT } from "@/lib/i18n";
import {
  WORKER_PROPAGATION_DISABLED,
  WORKER_PROPAGATION_ENABLE_COMMAND,
  WORKER_PROPAGATION_ENV,
  type WorkerPropagation,
} from "@/lib/hermes/deskrpg-plugin-types";
import type { WorkerPluginResult, WorkerPluginWarning } from "@/lib/hermes/worker-plugin";

export type WorkerPluginApplyResponse =
  { ok: true; results: WorkerPluginResult[] } | { ok: false; errorCode: string };

/**
 * [설정에서 켜기] 결과. 켜졌으면 `ok: true` — 이어진 적용이 실패했으면 `applyErrorCode` 를 싣는다.
 * 호스트 단계에서 못 켰으면 `ok: false`(명령 복사로 떨어진다).
 */
export type WorkerPropagationEnableResponse =
  | { ok: true; results?: WorkerPluginResult[]; applyErrorCode?: string }
  | { ok: false; errorCode: string };

/** DeskRPG 가 명령을 돌릴 수 없는 호스트 — 실패가 아니라 "직접 켜세요" 로 안내한다. */
const UNSUPPORTED_HOST = "plugin_update_unsupported_host";

type Result =
  | { kind: "applied"; failures: { profile: string; error: string }[] }
  | { kind: "error"; code: string }
  | { kind: "propagationDisabled" };

type EnableState =
  | { kind: "idle" }
  | { kind: "enabled" }
  | { kind: "applyFailed"; code: string }
  | { kind: "failed"; code: string };

export default function WorkerPluginLine({
  warning,
  propagation,
  isOwner,
  apply,
  onApplied,
  enablePropagation,
  onRecheck,
}: {
  warning: WorkerPluginWarning | null;
  /** 0.16.0 워커 전파 상태. `null`/`undefined` 는 모름(옛 플러그인·공유 행) — 지금처럼 동작한다. */
  propagation?: WorkerPropagation | null;
  isOwner: boolean;
  apply: () => Promise<WorkerPluginApplyResponse>;
  onApplied: () => void;
  /** DeskRPG 가 호스트 설정으로 워커 전파를 켠다. 없으면 [설정에서 켜기] 대신 명령만 보인다. */
  enablePropagation?: () => Promise<WorkerPropagationEnableResponse>;
  /** 게이트웨이를 다시 점검해 플러그인 정보를 새로 읽는다(명령을 돌린 뒤의 [다시 확인]). */
  onRecheck?: () => Promise<void> | void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [enableState, setEnableState] = useState<EnableState>({ kind: "idle" });
  const [rechecking, setRechecking] = useState(false);

  const propagationOff =
    enableState.kind !== "enabled" &&
    enableState.kind !== "applyFailed" &&
    (propagation === "disabled" || result?.kind === "propagationDisabled");

  if (!warning && !result && !propagationOff && enableState.kind === "idle") return null;

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
        setResult(
          res.errorCode === WORKER_PROPAGATION_DISABLED
            ? { kind: "propagationDisabled" }
            : { kind: "error", code: res.errorCode },
        );
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

  const enable = async () => {
    if (!enablePropagation) return;
    setEnabling(true);
    try {
      const res = await enablePropagation();
      if (!res.ok) {
        setEnableState({ kind: "failed", code: res.errorCode });
        return;
      }
      setResult(null);
      setEnableState(
        res.applyErrorCode
          ? { kind: "applyFailed", code: res.applyErrorCode }
          : { kind: "enabled" },
      );
      onApplied();
    } catch {
      setEnableState({ kind: "failed", code: "request_failed" });
    } finally {
      setEnabling(false);
    }
  };

  const recheck = async () => {
    if (!onRecheck) return;
    setRechecking(true);
    try {
      await onRecheck();
    } finally {
      setRechecking(false);
    }
  };

  // [설정에서 켜기] 가 없거나 그 길이 막혔으면 운영자가 직접 돌릴 명령을 보인다.
  const showCommand = !enablePropagation || enableState.kind === "failed";
  const buttonClass =
    "rounded-md bg-surface-raised px-2 py-0.5 text-[11px] font-medium hover:brightness-110 disabled:opacity-60";

  return (
    <div className="-mt-3 mb-4 space-y-1 text-xs text-text-muted" data-worker-plugin-line="">
      {warning && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-npc-dark">
            {t("gateways.workerPlugin.missing", {
              count: warning.fixable.length,
              names: warning.fixable.join(", "),
            })}
          </span>
          {/* 전파가 꺼져 있으면 [적용] 은 409 로 끝난다 — 켜는 방법을 대신 보인다. */}
          {isOwner && !propagationOff && (
            <>
              <button
                type="button"
                onClick={() => void run()}
                disabled={busy}
                className={buttonClass}
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
      {propagationOff && (
        <div
          className="space-y-1.5 rounded-lg border border-border bg-surface p-2.5"
          data-worker-propagation="disabled"
        >
          <p className="font-semibold text-npc-dark">{t("gateways.workerPlugin.propagationOff")}</p>
          <p>{t("gateways.workerPlugin.propagationWhat")}</p>
          {!isOwner ? (
            <p className="text-text-dim">{t("gateways.workerPlugin.propagationOwnerOnly")}</p>
          ) : (
            <>
              {enablePropagation && enableState.kind !== "failed" && (
                <button
                  type="button"
                  data-action="worker-propagation-enable"
                  onClick={() => void enable()}
                  disabled={enabling}
                  className={buttonClass}
                >
                  {enabling
                    ? t("gateways.workerPlugin.enabling")
                    : t("gateways.workerPlugin.enableInSettings")}
                </button>
              )}
              {enableState.kind === "failed" && (
                <p className="text-danger" data-worker-propagation-result="failed">
                  {enableState.code === UNSUPPORTED_HOST
                    ? t("gateways.workerPlugin.propagationUnsupportedHost")
                    : t("gateways.workerPlugin.propagationEnableFailed", {
                        code: enableState.code,
                      })}
                </p>
              )}
              {showCommand && (
                <>
                  <p>{t("gateways.workerPlugin.propagationCommand")}</p>
                  <CopyCommand command={WORKER_PROPAGATION_ENABLE_COMMAND} />
                  <p className="text-text-dim">
                    {t("gateways.workerPlugin.propagationEnv", { env: WORKER_PROPAGATION_ENV })}
                  </p>
                  {onRecheck && (
                    <button
                      type="button"
                      data-action="worker-propagation-recheck"
                      onClick={() => void recheck()}
                      disabled={rechecking}
                      className={buttonClass}
                    >
                      {rechecking
                        ? t("gateways.workerPlugin.rechecking")
                        : t("gateways.workerPlugin.recheck")}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
      {enableState.kind === "enabled" && (
        <p className="text-success" data-worker-propagation-result="enabled">
          {t("gateways.workerPlugin.propagationEnabled")}
        </p>
      )}
      {enableState.kind === "applyFailed" && (
        <p className="text-danger" data-worker-propagation-result="apply-failed">
          {t("gateways.workerPlugin.propagationApplyFailed", { code: enableState.code })}
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
