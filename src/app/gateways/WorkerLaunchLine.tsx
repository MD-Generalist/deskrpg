"use client";
/**
 * Kanban workers that cannot start on this gateway — one line on the gateway screen (owner only; see
 * `src/lib/hermes/worker-launch.ts`).
 *
 * On the upstream PM runtime, Hermes starts each worker with a command that cannot import Hermes unless the gateway
 * service sets `HERMES_BIN`, so every card is given up without running. DeskRPG does not change the host's service
 * here: it says what is wrong and gives the command for the gateway host's OS (read from the launcher path), then
 * [다시 확인].
 */
import { useState } from "react";

import { CopyCommand } from "@/components/CopyCommand";
import { MoreDetails } from "@/components/MoreDetails";
import { useT } from "@/lib/i18n";
import { workerLaunchFix, type WorkerLaunchWarning } from "@/lib/hermes/worker-launch";

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

  const fix = workerLaunchFix(warning.launcher);
  const command = fix?.command ?? null;
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
      data-worker-launch-host={fix?.host}
    >
      <p data-headline className="font-semibold text-npc-dark">
        {t("gateways.workerLaunch.blocked")}
      </p>
      {command ? (
        <>
          <p>{t("gateways.workerLaunch.action")}</p>
          <CopyCommand command={command} />
        </>
      ) : (
        <p>{t("gateways.workerLaunch.noLauncherAction")}</p>
      )}
      <MoreDetails>
        <p>
          {warning.reason === "hermes_bin_missing"
            ? t("gateways.workerLaunch.missing", { path: warning.hermesBin ?? "" })
            : t("gateways.workerLaunch.unset")}
        </p>
        <p>
          {!fix
            ? t("gateways.workerLaunch.noLauncher")
            : fix.host === "windows"
              ? t("gateways.workerLaunch.windows", {
                  file: fix.file,
                  launcher: warning.launcher ?? "",
                })
              : t(
                  fix.host === "macos"
                    ? "gateways.workerLaunch.commandMac"
                    : "gateways.workerLaunch.command",
                  { file: fix.file },
                )}
        </p>
      </MoreDetails>
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
