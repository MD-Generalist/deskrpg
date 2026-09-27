"use client";

import Link from "next/link";

import { CopyCommand } from "@/components/CopyCommand";
import { MoreDetails } from "@/components/MoreDetails";
import { PINNED_PLUGIN_SETUP_COMMAND } from "@/lib/hermes/plugin-install-command";
import type { PluginStatus } from "@/lib/hermes/plugin-capability";
import { useT } from "@/lib/i18n";

/**
 * Why persona and AI model editing is locked on this gateway, and what fixes it — on the page, since
 * a tooltip never shows on touch screens. Each cause needs a different fix (a key swap, an install,
 * a URL check), and none of them is the employee's own connection test.
 */
export default function PluginLockNotice({
  status,
  gatewayId,
  rechecking,
  onRecheck,
}: {
  status: Exclude<PluginStatus, "plugin_ready">;
  gatewayId: string;
  rechecking: boolean;
  onRecheck(): void;
}) {
  const t = useT();
  const gatewayHref = `/gateways?gateway=${encodeURIComponent(gatewayId)}`;
  return (
    <div
      data-plugin-lock={status}
      className="space-y-2 rounded-xl border border-npc/40 bg-npc/10 p-4 text-sm"
    >
      <p data-headline className="font-semibold text-npc-dark">
        {t("profiles.detail.lock.title")}
      </p>
      <p className="text-text">{t(`profiles.detail.lock.${status}`)}</p>
      {status === "plugin_absent" ? (
        <CopyCommand command={PINNED_PLUGIN_SETUP_COMMAND} />
      ) : (
        <Link
          href={gatewayHref}
          className="inline-block font-semibold text-primary hover:underline"
        >
          {t("profiles.detail.lock.openGateway")}
        </Link>
      )}
      <MoreDetails className="text-xs">
        <p>{t(`profiles.detail.lock.details.${status}`)}</p>
      </MoreDetails>
      <div className="flex flex-wrap items-center gap-2 border-t border-npc/20 pt-2">
        <span className="min-w-0 flex-1 text-xs text-text-muted">
          {t("profiles.detail.lock.recheckHint")}
        </span>
        <button
          type="button"
          data-action="gateway-recheck"
          onClick={onRecheck}
          disabled={rechecking}
          className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised/80 disabled:opacity-60"
        >
          {rechecking ? t("profiles.detail.pluginRechecking") : t("profiles.detail.pluginRecheck")}
        </button>
      </div>
    </div>
  );
}
