"use client";
import { useCallback, useEffect, useState } from "react";

import { useT } from "@/lib/i18n";
import type { ArchivedSkill } from "@/lib/hermes/plugin-client-types";

import { skillErrorText } from "./skill-error-text";
import type { SkillsApi } from "./skills-api";

export type SkillArchivePaneProps = {
  api: SkillsApi;
  canManage: boolean;
  /** The employee's Hermes profile — named in the CLI line for purging. */
  profileName?: string | null;
  /** A restore changed the list (installed count / archive count). */
  onChanged(): void;
};

/**
 * Archive pane — restores archived local skills. Upstream Hermes only purges archived skills in bulk, so
 * permanent deletion is left to its dashboard or CLI, which the pane names.
 */
export default function SkillArchivePane({
  api,
  canManage,
  profileName,
  onChanged,
}: SkillArchivePaneProps) {
  const t = useT();
  const [rows, setRows] = useState<ArchivedSkill[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.listArchived());
    } catch (e) {
      setError(skillErrorText(t, e));
    }
  }, [api, t]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      onChanged();
    } catch (e) {
      setError(skillErrorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5 text-sm">
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      {rows?.length === 0 && <p className="text-text-dim">{t("skills.archiveEmpty")}</p>}
      {rows && rows.length > 0 && (
        <p data-purge-hint className="mb-3 max-w-2xl text-xs text-text-muted">
          {t("skills.purge.elsewhere")}{" "}
          <code className="rounded bg-surface-raised px-1">
            hermes -p {profileName || "<profile>"} curator purge
          </code>
        </p>
      )}
      <ul className="max-w-2xl divide-y divide-border">
        {rows?.map((r) => (
          <li key={r.name} className="flex flex-wrap items-center gap-3 py-2">
            <span className="min-w-0 flex-1 truncate text-text">{r.name}</span>
            {r.archivedAt && (
              <span className="text-xs text-text-muted">{r.archivedAt.slice(0, 10)}</span>
            )}
            {canManage && (
              <button
                type="button"
                data-action="restore"
                disabled={busy}
                onClick={() => void run(() => api.restore(r.name))}
                className="text-primary disabled:opacity-50"
              >
                {t("skills.restore")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
