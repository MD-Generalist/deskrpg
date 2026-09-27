"use client";
/**
 * Kanban workers that cannot start on this gateway — one line on the gateway screen (owner only; see
 * `src/lib/hermes/worker-launch.ts`).
 *
 * On the upstream PM runtime, Hermes starts each worker with a command that cannot import Hermes unless the gateway
 * service sets `HERMES_BIN`, so every card is given up without running. DeskRPG does not change the host's service
 * here: it says what is wrong and gives the command to run on the gateway host, then [다시 확인].
 */
import { useState } from "react";

import { CopyCommand } from "@/components/CopyCommand";
import { useT } from "@/lib/i18n";
import {
  WORKER_LAUNCH_DROP_IN,
  workerLaunchFixCommand,
  type WorkerLaunchWarning,
} from "@/lib/hermes/worker-launch";

export default function WorkerLaunchLine({
  warning,
  isOwner,
  onRecheck,
}: {
  warning: WorkerLaunchWarning | null;
  isOwner: boolean;
  /** Recheck the gateway and reread plugin info. */
  onRecheck?: () => Promise<void> | void;
}) {
  const t = useT();
  const [rechecking, setRechecking] = useState(false);
  if (!warning || !isOwner) return null;

  const command = workerLaunchFixCommand(warning.launcher);
  const recheck = async () => {
    if (!onRecheck) return;
    setRechecking(true);
    try {
      await onRecheck();
    } finally {
      setRechecking(false);
    }
  };

  return (
    <div
      className="-mt-3 mb-4 space-y-1.5 rounded-lg border border-border bg-surface p-2.5 text-xs text-text-muted"
      data-worker-launch={warning.reason}
    >
      <p className="font-semibold text-npc-dark">{t("gateways.workerLaunch.blocked")}</p>
      <p>
        {warning.reason === "hermes_bin_missing"
          ? t("gateways.workerLaunch.missing", { path: warning.hermesBin ?? "" })
          : t("gateways.workerLaunch.unset")}
      </p>
      {command ? (
        <>
          <p>{t("gateways.workerLaunch.command", { file: WORKER_LAUNCH_DROP_IN })}</p>
          <CopyCommand command={command} />
        </>
      ) : (
        <p>{t("gateways.workerLaunch.noLauncher")}</p>
      )}
      {onRecheck && (
        <button
          type="button"
          data-action="worker-launch-recheck"
          onClick={() => void recheck()}
          disabled={rechecking}
          className="rounded-md bg-surface-raised px-2 py-0.5 text-[11px] font-medium hover:brightness-110 disabled:opacity-60"
        >
          {rechecking ? t("gateways.workerPlugin.rechecking") : t("gateways.workerPlugin.recheck")}
        </button>
      )}
    </div>
  );
}
