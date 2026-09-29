"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { employeeDetailHref } from "@/app/profiles/hire-navigation";
import { MoreDetails } from "@/components/MoreDetails";
import { useT } from "@/lib/i18n";
import { getLocalizedErrorMessage } from "@/lib/i18n/error-codes";

type Importable = { name: string; description: string };

/** Why the list could not be read, grouped by what the owner can do about it. */
type FailureKind = "owner-key" | "plugin" | "plugin-off" | "offline" | "other";

const FAILURE_KINDS: Record<string, FailureKind> = {
  // Hermes refused the key: the gateway was registered with a profile key or an old key.
  gateway_auth_failed: "owner-key",
  unauthorized: "owner-key",
  plugin_update_required: "plugin",
  plugin_not_loaded: "plugin-off",
  plugin_upgrade_required: "plugin",
  malformed_response: "plugin",
  unreachable: "offline",
  timeout: "offline",
};

/** `busy` while the bulk import runs — a sentinel no profile name can take (names are lowercase). */
const ALL = "*all";

const FAILURE_KEYS: Record<FailureKind, string> = {
  "owner-key": "ownerKey",
  plugin: "plugin",
  "plugin-off": "pluginOff",
  offline: "offline",
  other: "other",
};

type BulkResult =
  | { name: string; status: "imported"; attendedChannels: number }
  | { name: string; status: "key_exists" }
  | { name: string; status: "failed"; errorCode: string }
  | { name: string; status: "not_tried" };

type Summary = { imported: number; keyed: number; failed: number; notTried: number };

/** The section's anchor — the setup wizard links here when the gateway has profiles to import. */
export const IMPORT_ANCHOR = "profile-import";

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
  // Profiles that already have a key: never re-keyed in bulk, only one by one after the owner agrees.
  const [keyed, setKeyed] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
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

  const loaded = listing.state === "loaded";
  useEffect(() => {
    if (loaded && window.location.hash === `#${IMPORT_ANCHOR}`) {
      document.getElementById(IMPORT_ANCHOR)?.scrollIntoView?.({ block: "start" });
    }
  }, [loaded]);

  const importProfile = async (name: string, rotate: boolean) => {
    setBusy(name);
    setError("");
    setDone(null);
    setSummary(null);
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
        if (data.errorCode === "key_exists") moveToKeyed([name]);
        setError(getLocalizedErrorMessage(t, data, "common.error"));
        return;
      }
      setDone(name);
      setRows((prev) => prev.filter((row) => row.name !== name));
      setKeyed((prev) => prev.filter((n) => n !== name));
      setRowErrors(({ [name]: _cleared, ...rest }) => rest);
      onImported();
    } catch (err) {
      setError(getLocalizedErrorMessage(t, err, "errors.connectionFailed"));
    } finally {
      setBusy(null);
    }
  };

  const moveToKeyed = (names: string[]) => {
    setKeyed((prev) => [...prev, ...names.filter((n) => !prev.includes(n))]);
    setRows((prev) => prev.filter((row) => !names.includes(row.name)));
  };

  const chosen = rows.filter((row) => !excluded.has(row.name)).map((row) => row.name);

  const importAll = async () => {
    setBusy(ALL);
    setError("");
    setDone(null);
    setSummary(null);
    try {
      const res = await fetch(`/api/gateways/${gatewayId}/plugin/profiles/importable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: chosen }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.errorCode || !res.ok || !Array.isArray(data.results)) {
        setError(getLocalizedErrorMessage(t, data, "common.error"));
        return;
      }
      const results = data.results as BulkResult[];
      const named = (status: BulkResult["status"]) =>
        results.filter((r) => r.status === status).map((r) => r.name);
      const imported = named("imported");
      setRows((prev) => prev.filter((row) => !imported.includes(row.name)));
      moveToKeyed(named("key_exists"));
      const errors: Record<string, string> = {};
      for (const r of results) {
        if (r.status === "failed") errors[r.name] = getLocalizedErrorMessage(t, r, "common.error");
      }
      setRowErrors(errors);
      setSummary({
        imported: imported.length,
        keyed: named("key_exists").length,
        failed: named("failed").length,
        notTried: named("not_tried").length,
      });
      if (imported.length > 0) onImported();
    } catch (err) {
      setError(getLocalizedErrorMessage(t, err, "errors.connectionFailed"));
    } finally {
      setBusy(null);
    }
  };

  const toggle = (name: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  if (listing.state === "loading") return null;

  const failureKey = listing.state === "failed" ? FAILURE_KEYS[listing.kind] : null;

  return (
    <div id={IMPORT_ANCHOR} className="space-y-2 border-t border-border pt-4">
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
      ) : rows.length === 0 && keyed.length === 0 && !done && !summary ? (
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
      {rows.length > 1 && (
        <button
          type="button"
          data-import-all=""
          disabled={busy !== null || chosen.length === 0}
          onClick={() => void importAll()}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {busy === ALL
            ? t("gateway.profile.import.importingAll")
            : t("gateway.profile.import.all", { count: chosen.length })}
        </button>
      )}
      {rows.map((row) => (
        <div
          key={row.name}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2"
        >
          {rows.length > 1 && (
            <input
              type="checkbox"
              data-import-select={row.name}
              aria-label={t("gateway.profile.import.select", { name: row.name })}
              checked={!excluded.has(row.name)}
              disabled={busy !== null}
              onChange={() => toggle(row.name)}
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{row.name}</p>
            {row.description && (
              <p className="truncate text-xs text-text-muted">{row.description}</p>
            )}
            {rowErrors[row.name] && (
              <p data-import-row-error={row.name} className="text-xs text-danger">
                {rowErrors[row.name]}
              </p>
            )}
          </div>
          <button
            type="button"
            data-import-profile={row.name}
            disabled={busy !== null}
            onClick={() => void importProfile(row.name, false)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised disabled:opacity-50"
          >
            {busy === row.name
              ? t("gateway.profile.import.importing")
              : t("gateway.profile.import.button")}
          </button>
        </div>
      ))}
      {summary && (
        <div data-import-summary="" role="status" className="space-y-1 text-xs">
          {summary.imported > 0 && (
            <p className="text-success">
              {t("gateway.profile.import.summary.imported", { count: summary.imported })}
            </p>
          )}
          {summary.keyed > 0 && (
            <p>{t("gateway.profile.import.summary.keyed", { count: summary.keyed })}</p>
          )}
          {summary.failed > 0 && (
            <p className="text-danger">
              {t("gateway.profile.import.summary.failed", { count: summary.failed })}
            </p>
          )}
          {summary.notTried > 0 && (
            <p className="text-danger">
              {t("gateway.profile.import.summary.notTried", { count: summary.notTried })}
            </p>
          )}
        </div>
      )}
      {keyed.length > 0 && (
        <div data-import-keyed="" className="space-y-2 rounded-lg border border-border bg-bg p-3">
          <p className="text-xs font-semibold">{t("gateway.profile.import.keyed.title")}</p>
          <p className="text-xs text-text-muted">{t("gateway.profile.import.keyed.hint")}</p>
          {keyed.map((name) => (
            <div key={name} className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 text-sm font-medium">{name}</p>
              <button
                type="button"
                data-import-rotate={name}
                disabled={busy !== null}
                onClick={() => void importProfile(name, true)}
                className="rounded-lg border border-danger/50 px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger-bg disabled:opacity-50"
              >
                {busy === name
                  ? t("gateway.profile.import.importing")
                  : t("gateway.profile.import.rotate")}
              </button>
            </div>
          ))}
        </div>
      )}
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
