"use client";

import { useCallback, useEffect, useState } from "react";

import { MoreDetails } from "@/components/MoreDetails";
import { setupCopy, setupError, setupHostError } from "@/components/gateway/setup-copy";
import { useLocale, useT } from "@/lib/i18n";
import type { RestartBlockedReason } from "@/lib/hermes/setup/restart-support";

/** What to run by hand when DeskRPG cannot restart the gateway itself (upstream `hermes gateway start`). */
const FALLBACK_COMMAND = "hermes gateway start";

export type GatewayRestartSupportView =
  | { canRestart: true; command: string }
  | { canRestart: false; reason: RestartBlockedReason; command: string };

export type GatewayRestartApi = {
  support(gatewayId: string): Promise<GatewayRestartSupportView>;
  /** Starts the restart job; throws the error code when refused. */
  start(gatewayId: string): Promise<string>;
  job(jobId: string): Promise<{ status: string; error?: string }>;
};

async function json(res: Response) {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export const gatewayRestartApi: GatewayRestartApi = {
  async support(gatewayId) {
    const res = await fetch(`/api/gateways/${encodeURIComponent(gatewayId)}/restart`);
    const body = await json(res);
    if (!res.ok) throw body.errorCode ?? "setup_failed";
    return body as GatewayRestartSupportView;
  },
  async start(gatewayId) {
    const res = await fetch(`/api/gateways/${encodeURIComponent(gatewayId)}/restart`, {
      method: "POST",
    });
    const body = await json(res);
    if (!res.ok || typeof body.jobId !== "string") throw body.errorCode ?? "setup_failed";
    return body.jobId;
  },
  async job(jobId) {
    const res = await fetch(`/api/gateways/setup?job=${encodeURIComponent(jobId)}`);
    const body = await json(res);
    const job = body.job as { status?: string; error?: string } | undefined;
    if (!res.ok || !job?.status) throw body.errorCode ?? "setup_failed";
    return { status: job.status, error: job.error };
  },
};

type State = "idle" | "running" | "succeeded" | "failed";

/**
 * Shown while the gateway does not answer: what happened, and either [다시 시작] (Hermes' own restart on its host,
 * for the owner who may run host setup) or the command to run on the computer where Hermes is installed. DeskRPG
 * never restarts on its own — a gateway someone stopped on purpose stays stopped until a person asks.
 */
export default function GatewayRestartNotice({
  gatewayId,
  api = gatewayRestartApi,
  pollMs = 1500,
}: {
  gatewayId: string;
  api?: GatewayRestartApi;
  pollMs?: number;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [support, setSupport] = useState<GatewayRestartSupportView | null>(null);
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .support(gatewayId)
      .then((value) => alive && setSupport(value))
      // Not knowing is not a reason to hide the way out — fall back to the instructions.
      .catch(
        () =>
          alive &&
          setSupport({ canRestart: false, reason: "no_host_access", command: FALLBACK_COMMAND }),
      );
    return () => {
      alive = false;
    };
  }, [api, gatewayId]);

  const restart = useCallback(async () => {
    setState("running");
    setError(null);
    try {
      const jobId = await api.start(gatewayId);
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        const job = await api.job(jobId);
        if (job.status === "succeeded") break;
        if (job.status === "failed" || job.status === "cancelled")
          throw job.error ?? "setup_failed";
      }
      setState("succeeded");
    } catch (code) {
      setError(typeof code === "string" ? code : "setup_failed");
      setState("failed");
    }
  }, [api, gatewayId, pollMs]);

  if (!support) return null;
  const reason = support.canRestart ? undefined : support.reason;
  const errorText = error
    ? (setupHostError(locale, error) ?? setupError(setupCopy[locale], error))
    : null;

  return (
    <div
      role="status"
      data-gateway-restart
      data-restart-state={state}
      data-restart-reason={reason}
      data-restart-error={error ?? undefined}
      className="max-w-xs space-y-2 rounded-md border border-danger/30 bg-surface p-3 text-sm shadow-lg"
    >
      <p>{t("gateway.restart.stopped")}</p>
      {support.canRestart ? (
        state === "succeeded" ? (
          <p className="text-success">{t("gateway.restart.succeeded")}</p>
        ) : (
          <>
            <p className="text-text-muted">
              {state === "running"
                ? t("gateway.restart.running")
                : t("gateway.restart.pressToRestart")}
            </p>
            {errorText && (
              <p data-restart-error-text className="text-danger">
                {errorText}
              </p>
            )}
            <button
              type="button"
              data-restart-button
              disabled={state === "running"}
              onClick={() => void restart()}
              className="rounded-md bg-primary px-3 py-1 text-caption font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
            >
              {t("gateway.restart.button")}
            </button>
          </>
        )
      ) : reason === "not_owner" ? (
        <p className="text-text-muted">{t("gateway.restart.askOwner")}</p>
      ) : (
        <>
          <p className="text-text-muted">{t("gateway.restart.runCommand")}</p>
          <MoreDetails className="text-xs">
            <code data-restart-command className="block rounded bg-surface-raised px-2 py-1">
              {support.command}
            </code>
          </MoreDetails>
        </>
      )}
    </div>
  );
}
