"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import GroupAccessPanel from "@/components/admin/GroupAccessPanel";
import { useT } from "@/lib/i18n";
import { getLocalizedErrorMessage } from "@/lib/i18n/error-codes";
import type { GroupMemberRole } from "@/lib/rbac/constants";

type GroupRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isDefault: boolean;
  createdBy: string | null;
  role?: GroupMemberRole;
  canCreateChannel?: boolean;
  canManageMembers?: boolean;
  canManagePermissions?: boolean;
  canApproveJoinRequests?: boolean;
  canManageGroup?: boolean;
};

export default function AdminGroupsPage() {
  const t = useT();

  return (
    <Suspense
      fallback={
        <div className="theme-web min-h-screen flex items-center justify-center bg-bg text-text">
          {t("common.loading")}
        </div>
      }
    >
      <AdminGroupsPageInner />
    </Suspense>
  );
}

function AdminGroupsPageInner() {
  const t = useT();
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const manageableGroups = useMemo(() => groups.filter((group) => group.canManageGroup), [groups]);

  useEffect(() => {
    fetch("/api/groups")
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw data;
        }
        return data;
      })
      .then((data) => {
        const nextGroups: GroupRow[] = Array.isArray(data.groups) ? data.groups : [];
        setGroups(nextGroups);
        setIsSystemAdmin(data.isSystemAdmin === true);
        const nextManageableGroups = nextGroups.filter((group) => group.canManageGroup);
        setSelectedGroupId(nextManageableGroups[0]?.id ?? "");
        setLoading(false);
      })
      .catch((nextError) => {
        setError(getLocalizedErrorMessage(t, nextError, "common.error"));
        setLoading(false);
      });
  }, [t]);

  const selectedGroup = useMemo(
    () => manageableGroups.find((group) => group.id === selectedGroupId) ?? null,
    [manageableGroups, selectedGroupId],
  );

  if (loading) {
    return (
      <div className="theme-web min-h-screen flex items-center justify-center bg-bg text-text">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="theme-web workspace-page">
      <div className="workspace-page-inner">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">{t("admin.groups.title")}</h1>
            <p className="mt-1 text-text-muted">{t("admin.groups.subtitle")}</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/channels"
              className="rounded-lg bg-surface-raised px-4 py-2 text-sm font-medium hover:bg-surface-raised/80"
            >
              {t("admin.groups.backToChannels")}
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-danger/40 bg-surface px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        {manageableGroups.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface px-6 py-10 text-center text-text-muted">
            {t("admin.groups.empty")}
          </div>
        ) : (
          selectedGroup && (
            <GroupAccessPanel
              groupId={selectedGroup.id}
              groupName={selectedGroup.name}
              canManageMembers={selectedGroup.canManageMembers ?? false}
              canManagePermissions={selectedGroup.canManagePermissions ?? false}
              canApproveJoinRequests={selectedGroup.canApproveJoinRequests ?? false}
              canResetPasswords={isSystemAdmin}
              groupSwitcher={
                manageableGroups.length > 1 ? (
                  <select
                    aria-label={t("admin.groups.manage")}
                    value={selectedGroupId}
                    onChange={(event) => setSelectedGroupId(event.target.value)}
                    className="min-w-0 max-w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm"
                  >
                    {manageableGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                ) : null
              }
            />
          )
        )}
      </div>
    </div>
  );
}
