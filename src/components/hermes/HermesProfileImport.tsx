"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { employeeDetailHref } from "@/app/profiles/hire-navigation";
import { MoreDetails } from "@/components/MoreDetails";
import { useT } from "@/lib/i18n";
import { getLocalizedErrorMessage } from "@/lib/i18n/error-codes";

type Importable = { name: string; description: string };

/** Why the list could not be read, grouped by what the owner can do about it. */
type FailureKind = "owner-key" | "plugin" | "offline" | "other";

const FAILURE_KINDS: Record<string, FailureKind> = {
  // Hermes refused the key: the gateway was registered with a profile key or an old key.
  gateway_auth_failed: "owner-key",
  unauthorized: "owner-key",
  plugin_update_required: "plugin",
  plugin_upgrade_required: "plugin",
  malformed_response: "plugin",
  unreachable: "offline",
  timeout: "offline",
};

const FAILURE_KEYS: Record<FailureKind, string> = {
  "owner-key": "ownerKey",
  plugin: "plugin",
  offline: "offline",
  other: "other",
};

type Listing =
  { state: "loading" } | { state: "loaded" } | { state: "failed"; kind: FailureKind; code: string };

/**
 * Profiles that already live in this gateway's Hermes but are not employees yet — made on the
 * host with `hermes profile create`, or before DeskRPG connected. One click issues the profile a
 * key (the plugin, owner key), stores it, and clocks the employee in. A profile that already has a
 * key is only re-keyed after the owner confirms, because that cuts off whatever used the old key.
 * Rendered for the gateway owner only.
 */
export default function HermesProfileImport({
  gatewayId,
  onImported,
}: {
  gatewayId: string;
  onImported: () => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<Importable[]>([]);
  const [listing, setListing] = useState<Listing>({ state: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [needsRotate, setNeedsRotate] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    let code = "connection_failed";
    try {
      const res = await fetch(`/api/gateways/${gatewayId}/plugin/profiles/importable`);
      const data = await res.json().catch(() => ({}));
      if (!data.errorCode && res.ok && Array.isArray(data.profiles)) {
        setRows(data.profiles);
        setListing({ state: "loaded" });
        return;
      }
      code = typeof data.errorCode === "string" ? data.errorCode : "malformed_response";
    } catch {
      // The DeskRPG server itself was not reached; keep the generic code.
    }
    setRows([]);
    setListing({ state: "failed", kind: FAILURE_KINDS[code] ?? "other", code });
  }, [gatewayId]);

  useEffect(() => {
    void load();
  }, [load]);

  const importProfile = async (name: string, rotate: boolean) => {
    setBusy(name);
    setError("");
    setDone(null);
    try {
      const res = await fetch(
        `/api/gateways/${gatewayId}/plugin/profiles/${encodeURIComponent(name)}/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rotate ? { rotate: true } : {}),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (data.errorCode || !res.ok) {
        setNeedsRotate(data.errorCode === "key_exists" ? name : null);
        setError(getLocalizedErrorMessage(t, data, "common.error"));
        return;
      }
      setNeedsRotate(null);
      setDone(name);
      setRows((prev) => prev.filter((row) => row.name !== name));
      onImported();
    } catch (err) {
      setError(getLocalizedErrorMessage(t, err, "errors.connectionFailed"));
    } finally {
      setBusy(null);
    }
  };

  if (listing.state === "loading") return null;

  const failureKey = listing.state === "failed" ? FAILURE_KEYS[listing.kind] : null;

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <h3 className="text-sm font-semibold">{t("gateway.profile.import.title")}</h3>
      {listing.state === "failed" ? (
        <div
          data-import-failure={listing.kind}
          role="status"
          className="space-y-2 rounded-lg border border-border bg-bg p-3 text-xs"
        >
          <p className="text-text">{t(`gateway.profile.import.failure.${failureKey}`)}</p>
          <MoreDetails>
            <p>{t(`gateway.profile.import.failure.${failureKey}Details`)}</p>
            <p data-import-failure-code="">
              {t("gateway.profile.import.failure.code", { code: listing.code })}
            </p>
          </MoreDetails>
          <button
            type="button"
            data-import-reload=""
            onClick={() => void load()}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised"
          >
            {t("gateway.profile.import.reload")}
          </button>
        </div>
      ) : rows.length === 0 && !done ? (
        <p data-import-empty="" className="text-xs text-text-muted">
          {t("gateway.profile.import.empty")}
        </p>
      ) : (
        <>
          <p className="text-xs text-text-muted">{t("gateway.profile.import.hint")}</p>
          <p data-import-key-note="" className="text-xs text-text-muted">
            {t("gateway.profile.import.keyNote")}
          </p>
          <MoreDetails className="text-xs">
            <p data-import-key-details="">{t("gateway.profile.import.keyDetails")}</p>
          </MoreDetails>
        </>
      )}
      {rows.map((row) => (
        <div
          key={row.name}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{row.name}</p>
            {row.description && (
              <p className="truncate text-xs text-text-muted">{row.description}</p>
            )}
          </div>
          {needsRotate === row.name ? (
            <button
              type="button"
              data-import-rotate={row.name}
              disabled={busy !== null}
              onClick={() => void importProfile(row.name, true)}
              className="rounded-lg border border-danger/50 px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger-bg disabled:opacity-50"
            >
              {t("gateway.profile.import.rotate")}
            </button>
          ) : (
            <button
              type="button"
              data-import-profile={row.name}
              disabled={busy !== null}
              onClick={() => void importProfile(row.name, false)}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {busy === row.name
                ? t("gateway.profile.import.importing")
                : t("gateway.profile.import.button")}
            </button>
          )}
        </div>
      ))}
      {error && <p className="text-xs text-danger">{error}</p>}
      {done && (
        <p className="text-xs text-success" role="status">
          {t("gateway.profile.import.done", { name: done })}{" "}
          <Link href={employeeDetailHref(gatewayId, done)} className="underline">
            {t("gateway.profile.import.setup")}
          </Link>
        </p>
      )}
    </div>
  );
}
