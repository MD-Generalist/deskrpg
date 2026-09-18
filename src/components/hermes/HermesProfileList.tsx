"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { getLocalizedErrorMessage } from "@/lib/i18n/error-codes";
import { useT } from "@/lib/i18n";

import {
  partitionRegistrationResults,
  toDiscoveryRows,
  toProbeStatus,
  type DiscoveryRow,
  type ProbeStatus,
} from "./discovery-rows";
import type { CharacterAppearance } from "@/game/three/office-appearance";

import { employeeDetailHref, hirePageHref } from "@/app/profiles/hire-navigation";
import RosterAvatar from "../RosterAvatar";
import { profileStatusLabel } from "./profile-status";
import { PROFILE_STATUS_BADGE_CLASS } from "./profile-status-style";

type HermesProfileRow = {
  id: string;
  profileName: string;
  displayName: string | null;
  lastValidationStatus: string | null;
  /** 외형은 프로필이 정본이다 — 편집기를 이 값에서 열어야 한다. */
  appearance?: CharacterAppearance | null;
};

interface HermesProfileListProps {
  gatewayId: string;
  /** Registering a profile requires gateway ownership; a shared-access user can only view + test. */
  canRegister: boolean;
  /** `?new=1` 로 들어왔을 때 고용 마법사를 바로 연다. */
  /** 게임 화면에서 들어왔을 때 돌아갈 자리. 채용 페이지 링크에 그대로 실어 보낸다. */
  returnTo?: string | null;
  /** 프로필이 실제로 하나 생겼을 때만 부른다(닫기·삭제는 해당 없음). */
  onCreated?: () => void;
}

export default function HermesProfileList({
  gatewayId,
  canRegister,
  returnTo = null,
  onCreated,
}: HermesProfileListProps) {
  const t = useT();

  const [profiles, setProfiles] = useState<HermesProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [profileName, setProfileName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [token, setToken] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  const [discovery, setDiscovery] = useState<{
    available: boolean;
    optedIn: boolean;
    rows: DiscoveryRow[];
  } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [probeStatus, setProbeStatus] = useState<ProbeStatus>("idle");
  const [registering, setRegistering] = useState(false);
  /** "인격" 버튼이 지정한 프로필 — 마법사를 그 프로필의 ②단계로 바로 연다. */
  const [registerFailures, setRegisterFailures] = useState<{ name: string; errorCode: string }[]>(
    [],
  );
  const [registerError, setRegisterError] = useState("");
  const [optInError, setOptInError] = useState("");
  const [optingIn, setOptingIn] = useState(false);

  const loadProfiles = useCallback(async (): Promise<HermesProfileRow[]> => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/gateways/${gatewayId}/profiles`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw data;
      const rows: HermesProfileRow[] = Array.isArray(data.profiles) ? data.profiles : [];
      setProfiles(rows);
      return rows;
    } catch (nextError) {
      setError(getLocalizedErrorMessage(t, nextError, "common.error"));
      setProfiles([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [gatewayId, t]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/gateways/${gatewayId}/local-discovery`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setDiscovery({
          available: !!d.available,
          optedIn: !!d.optedIn,
          rows: toDiscoveryRows(d.candidates ?? []),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [gatewayId]);

  const handleAdd = async () => {
    setAdding(true);
    setAddError("");
    try {
      const res = await fetch(`/api/gateways/${gatewayId}/profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileName: profileName.trim(),
          token: token.trim(),
          displayName: displayName.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw data;
      setProfileName("");
      setDisplayName("");
      setToken("");
      await loadProfiles();
      onCreated?.();
    } catch (nextError) {
      setAddError(getLocalizedErrorMessage(t, nextError, "common.error"));
    } finally {
      setAdding(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("gateway.profile.title")}</h2>
        {canRegister && (
          // 마법사는 `/profiles/new` 한 페이지가 전담한다 — 목록 화면은 링크만 갖는다
          // (docs/standards.md "1기능 1페이지"). 예전에는 이 버튼이 목록 위에 4단계를 펼쳤다.
          <Link
            href={hirePageHref(gatewayId, { returnTo })}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
          >
            {t("hermes.wizard.openButton")}
          </Link>
        )}
      </div>

      {error && <p className="mb-3 text-sm text-danger">{error}</p>}

      {loading ? (
        <p className="text-sm text-text-muted">{t("common.loading")}</p>
      ) : profiles.length === 0 ? (
        <p className="text-sm text-text-muted">{t("gateway.profile.empty")}</p>
      ) : (
        <div className="mb-4 space-y-2">
          {profiles.map((profile) => {
            const { tone, key } = profileStatusLabel(profile.lastValidationStatus);
            return (
              <div key={profile.id} className="rounded-lg bg-bg px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <RosterAvatar appearance={profile.appearance ?? null} />
                    <div>
                      <p className="font-medium text-text">
                        {profile.displayName || profile.profileName}
                      </p>
                      <p className="text-xs text-text-muted">{profile.profileName}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PROFILE_STATUS_BADGE_CLASS[tone]}`}
                    >
                      {t(key)}
                    </span>
                    {/* 이 직원을 고치는 곳은 상세 페이지 하나다 — 목록에 편집기를 펼치지 않는다
                        (docs/standards.md "1기능 1페이지"). */}
                    <Link
                      href={employeeDetailHref(gatewayId, profile.profileName)}
                      className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised/80"
                    >
                      {t("gateway.profile.manage")}
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canRegister ? (
        <div className="space-y-3 border-t border-border pt-4">
          {discovery?.available && !discovery.optedIn && (
            <div className="space-y-1">
              <button
                type="button"
                disabled={optingIn}
                onClick={async () => {
                  setOptingIn(true);
                  setOptInError("");
                  try {
                    const res = await fetch(`/api/gateways/${gatewayId}/local-discovery`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "opt-in" }),
                    });
                    if (!res.ok) throw await res.json().catch(() => ({}));
                    const d = await fetch(`/api/gateways/${gatewayId}/local-discovery`).then((r) =>
                      r.json(),
                    );
                    setDiscovery({
                      available: !!d.available,
                      optedIn: !!d.optedIn,
                      rows: toDiscoveryRows(d.candidates ?? []),
                    });
                  } catch {
                    setOptInError(t("errors.connectionFailed"));
                  } finally {
                    setOptingIn(false);
                  }
                }}
                className="rounded-lg bg-surface-raised px-4 py-2 text-sm font-semibold hover:bg-surface-raised/80 disabled:opacity-60"
              >
                {optingIn ? t("common.loading") : t("hermes.discovery.optIn")}
              </button>
              {optInError && <p className="text-xs text-danger">{optInError}</p>}
            </div>
          )}

          {discovery?.optedIn && discovery.rows.length === 0 && (
            <p className="text-sm text-text-muted">{t("hermes.discovery.empty")}</p>
          )}

          {discovery?.optedIn && discovery.rows.length > 0 && (
            <div className="space-y-2 rounded-lg bg-bg p-3">
              {/* 제목이 없으면 등록 목록과 "프로필 추가" 폼 사이에 정체불명의
                  체크박스 뭉치로 보인다 — 이게 이 머신에서 찾아온 것임을 말해 준다. */}
              <p className="text-sm font-semibold text-text">{t("hermes.discovery.listTitle")}</p>
              {discovery.rows.map((row) => (
                <label key={row.name} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={!row.selectable}
                    checked={selected.includes(row.name)}
                    onChange={(e) =>
                      setSelected((prev) =>
                        e.target.checked ? [...prev, row.name] : prev.filter((n) => n !== row.name),
                      )
                    }
                  />
                  <span>{row.name}</span>
                  {row.reason !== "ok" && (
                    <span className="text-xs text-text-muted">
                      {t(`hermes.discovery.reason.${row.reason}`)}
                    </span>
                  )}
                </label>
              ))}
              {registerFailures.length > 0 && (
                <ul className="space-y-1">
                  {registerFailures.map((f) => (
                    <li key={f.name} className="text-xs text-danger">
                      {f.name}: {t(`hermes.discovery.error.${f.errorCode}`)}
                    </li>
                  ))}
                </ul>
              )}
              {registerError && <p className="text-xs text-danger">{registerError}</p>}
              <button
                type="button"
                disabled={!selected.length || registering}
                onClick={async () => {
                  setRegistering(true);
                  setRegisterError("");
                  setRegisterFailures([]);
                  try {
                    const res = await fetch(`/api/gateways/${gatewayId}/local-discovery`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ profiles: selected }),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) throw data;
                    const { nextSelected, failures } = partitionRegistrationResults(
                      Array.isArray(data.results) ? data.results : [],
                    );
                    setSelected(nextSelected);
                    setRegisterFailures(failures);
                    await loadProfiles();
                  } catch {
                    setRegisterError(t("errors.connectionFailed"));
                  } finally {
                    setRegistering(false);
                  }
                }}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
              >
                {registering ? t("common.loading") : t("hermes.discovery.registerSelected")}
              </button>
            </div>
          )}

          {/* 새 직원은 "+ 새 직원 고용" 마법사로 만든다. 이 폼은 Hermes 에 **이미 있는** 원격
              프로필을 토큰으로 등록하는 유일한 길이라 지우지 않고 접어 둔다 — 처음 쓰는 사람이
              "프로필 추가" 를 채용으로 오해해 토큰을 찾다 막히지 않게 한다. */}
          <details className="rounded border border-border px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold">
              {t("gateway.profile.addTitle")}
            </summary>
            <div className="mt-3 space-y-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <input
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  onBlur={async () => {
                    if (!profileName.trim()) {
                      setProbeStatus("idle");
                      return;
                    }
                    const r = await fetch(`/api/gateways/${gatewayId}/profiles/probe`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ profileName }),
                    })
                      .then((x) => x.json())
                      .catch(() => ({ status: "unknown" }));
                    setProbeStatus(toProbeStatus(r.status));
                  }}
                  placeholder={t("gateway.profile.profileNamePlaceholder")}
                  className="rounded border border-border bg-bg px-3 py-2 text-text text-sm focus:outline-none focus:border-indigo-500"
                />
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t("gateway.profile.displayName")}
                  className="rounded border border-border bg-bg px-3 py-2 text-text text-sm focus:outline-none focus:border-indigo-500"
                />
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={t("gateway.profile.tokenPlaceholder")}
                  className="rounded border border-border bg-bg px-3 py-2 text-text text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>
              {probeStatus !== "idle" && (
                <p className="text-xs text-text-muted">{t(`hermes.probe.${probeStatus}`)}</p>
              )}
              {addError && <p className="text-sm text-danger">{addError}</p>}
              <button
                type="button"
                onClick={() => void handleAdd()}
                disabled={adding || !profileName.trim() || !token.trim()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
              >
                {adding ? t("common.loading") : t("gateway.profile.add")}
              </button>
            </div>
          </details>
        </div>
      ) : (
        <p className="border-t border-border pt-4 text-sm text-text-muted">
          {t("gateway.profile.ownerOnly")}
        </p>
      )}
    </section>
  );
}
