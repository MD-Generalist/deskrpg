"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { getLocalizedErrorMessage } from "@/lib/i18n/error-codes";
import { useT, useLocale } from "@/lib/i18n";
import { resolvePluginStatusFromCache, type PluginStatus } from "@/lib/hermes/plugin-capability";

import {
  partitionRegistrationResults,
  toDiscoveryRows,
  toProbeStatus,
  type DiscoveryRow,
  type ProbeStatus,
} from "./discovery-rows";
import type { CharacterAppearance } from "@/game/three/office-appearance";

import NpcHireWizard from "./NpcHireWizard";
import ProfileAppearanceEditor from "./ProfileAppearanceEditor";
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
  autoOpenCreate?: boolean;
  initialAppearanceProfile?: string | null;
  /** 프로필이 실제로 하나 생겼을 때만 부른다(닫기·삭제는 해당 없음). */
  onCreated?: () => void;
}

export default function HermesProfileList({
  gatewayId,
  canRegister,
  autoOpenCreate = false,
  initialAppearanceProfile,
  onCreated,
}: HermesProfileListProps) {
  const t = useT();
  const { locale } = useLocale();
  const ko = locale === "ko";

  const [profiles, setProfiles] = useState<HermesProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 수정 중인 프로필. 행 안에서 펼쳐 고친다 — 잘못 넣은 토큰을 화면에서 손댈 방법이
  // 아예 없었다(만들 수만 있고 고칠 수도 지울 수도 없었다).
  const [editingId, setEditingId] = useState("");
  const [editToken, setEditToken] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [busyId, setBusyId] = useState("");
  /** 외형 편집기를 펼친 프로필. 편집기는 훅을 쓰므로 자식 컴포넌트로 마운트한다. */
  const [appearanceId, setAppearanceId] = useState("");
  const [savedAppearanceId, setSavedAppearanceId] = useState("");
  useEffect(() => {
    if (!canRegister || !initialAppearanceProfile || savedAppearanceId) return;
    const profile = profiles.find((row) => row.profileName === initialAppearanceProfile);
    if (profile) setAppearanceId(profile.id);
  }, [canRegister, initialAppearanceProfile, profiles, savedAppearanceId]);

  const [profileName, setProfileName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [token, setToken] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  const [testingId, setTestingId] = useState<string | null>(null);
  const [testErrors, setTestErrors] = useState<Record<string, string>>({});

  const [discovery, setDiscovery] = useState<{
    available: boolean;
    optedIn: boolean;
    rows: DiscoveryRow[];
  } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [probeStatus, setProbeStatus] = useState<ProbeStatus>("idle");
  const [registering, setRegistering] = useState(false);
  /** "인격" 버튼이 지정한 프로필 — 마법사를 그 프로필의 ②단계로 바로 연다. */
  const [wizardProfile, setWizardProfile] = useState<string | null>(null);
  const [registerFailures, setRegisterFailures] = useState<{ name: string; errorCode: string }[]>(
    [],
  );
  const [registerError, setRegisterError] = useState("");
  const [optInError, setOptInError] = useState("");
  const [optingIn, setOptingIn] = useState(false);

  // 고용 마법사 — 최종 리뷰 I-1: Task 4 가 만든 캐시(pluginStatus/pluginCheckedAt)를
  // 먼저 읽는다. `resolvePluginStatusFromCache` 가 신선하다고 판단하면 그 값을 그대로
  // 쓰고, 오래됐거나 없으면 그때만 `/test` 를 쏜다(원격 왕복 2회, 최대 10초) — 예전엔
  // 이 화면을 열 때마다(마법사를 열지 않아도) 무조건 다시 찔렀다.
  const [pluginStatus, setPluginStatus] = useState<PluginStatus>("unknown");
  // `?new=1` 은 "지금 새 인격을 만들러 왔다" 는 뜻이다 — 소유자가 아니면 마법사
  // 자체가 없으므로 열지 않는다.
  const [wizardOpen, setWizardOpen] = useState(autoOpenCreate && canRegister);

  const reprobePlugin = useCallback(async () => {
    try {
      const res = await fetch(`/api/gateways/${gatewayId}/test`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      const status = (data as { plugin?: { status?: unknown } })?.plugin?.status;
      return typeof status === "string" ? (status as PluginStatus) : "unknown";
    } catch {
      return "unknown" as PluginStatus;
    }
  }, [gatewayId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/gateways");
        const data = await res.json().catch(() => ({}));
        const rows = Array.isArray((data as { gateways?: unknown }).gateways)
          ? (data as { gateways: unknown[] }).gateways
          : [];
        const mine = rows.find(
          (g): g is { pluginStatus: string | null; pluginCheckedAt: string | Date | null } =>
            !!g && typeof g === "object" && (g as { id?: unknown }).id === gatewayId,
        );
        const cached = resolvePluginStatusFromCache({
          pluginStatus: mine?.pluginStatus ?? null,
          pluginCheckedAt: mine?.pluginCheckedAt ?? null,
          now: new Date(),
        });
        if (cancelled) return;
        if (!cached.needsReprobe) {
          setPluginStatus(cached.status);
          return;
        }
      } catch {
        // 목록 조회 자체가 실패해도 재프로브로 폴백한다 — 아래에서 그대로 진행.
      }
      const status = await reprobePlugin();
      if (!cancelled) setPluginStatus(status);
    })();
    return () => {
      cancelled = true;
    };
  }, [gatewayId, reprobePlugin]);

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

  const startEdit = (profile: HermesProfileRow) => {
    setEditingId(profile.id);
    setEditToken("");
    setEditDisplayName(profile.displayName ?? "");
    setError("");
  };

  const handleSaveEdit = async (profileId: string) => {
    setBusyId(profileId);
    setError("");
    try {
      const body: Record<string, unknown> = { displayName: editDisplayName };
      // 빈 칸은 아예 보내지 않는다 — 게이트웨이 수정과 같은 규약이고, 빈 문자열로
      // 자격증명을 지우는 사고를 막는다.
      if (editToken.trim()) body.token = editToken.trim();
      const res = await fetch(`/api/gateways/${gatewayId}/profiles/${profileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw data;
      setEditingId("");
      setEditToken("");
      await loadProfiles();
    } catch (err) {
      setError(getLocalizedErrorMessage(t, err, "common.error"));
    } finally {
      setBusyId("");
    }
  };

  const handleDelete = async (profile: HermesProfileRow) => {
    // 프로필 삭제는 해고다 — 그 프로필의 NPC 자리가 CASCADE 로 함께 사라진다.
    // 몇 자리가 몇 채널에서 없어지는지 **묻기 전에** 서버에서 세어 온다. 개수를
    // 모른 채 누르는 확인은 사실상 확인이 아니다.
    let npcs = 0;
    let channels = 0;
    setBusyId(profile.id);
    try {
      const res = await fetch(`/api/gateways/${gatewayId}/profiles/${profile.id}`);
      const data = await res.json().catch(() => ({}));
      const usage = (data as { usage?: { npcs?: unknown; channels?: unknown } }).usage;
      if (res.ok && usage) {
        npcs = Number(usage.npcs ?? 0);
        channels = Number(usage.channels ?? 0);
      }
    } catch {
      // 수치를 못 읽어도 삭제 자체는 막지 않는다 — 0 으로 물어본다.
    } finally {
      setBusyId("");
    }

    if (
      !window.confirm(
        t("gateway.profile.deleteConfirmWithUsage", {
          name: profile.profileName,
          npcs: String(npcs),
          channels: String(channels),
        }),
      )
    ) {
      return;
    }

    setBusyId(profile.id);
    setError("");
    try {
      const res = await fetch(`/api/gateways/${gatewayId}/profiles/${profile.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw data;
      // 서버 필드는 `deletedNpcs`/`channels` 다. 예전 이름(`unboundNpcs`)을 읽고 있어
      // 이 알림은 늘 0 으로 계산돼 조용히 사라졌다 — NPC 가 지워졌다는 사실이
      // 화면에 한 번도 뜨지 않았다.
      const deletedNpcs = Number((data as { deletedNpcs?: unknown }).deletedNpcs ?? 0);
      const lostChannels = Number((data as { channels?: unknown }).channels ?? 0);
      // 알림은 **재조회 뒤에** 세운다 — `loadProfiles` 가 맨 앞에서 `setError("")` 를
      // 하므로, 먼저 세우면 그 자리에서 지워진다(예전 코드가 그랬다).
      await loadProfiles();
      if (deletedNpcs > 0) {
        setError(
          t("gateway.profile.deletedNpcs", {
            npcs: String(deletedNpcs),
            channels: String(lostChannels),
          }),
        );
      }
    } catch (err) {
      setError(getLocalizedErrorMessage(t, err, "common.error"));
    } finally {
      setBusyId("");
    }
  };

  const handleTest = async (profileId: string) => {
    setTestingId(profileId);
    setTestErrors((prev) => {
      const next = { ...prev };
      delete next[profileId];
      return next;
    });
    try {
      const res = await fetch(`/api/gateways/${gatewayId}/profiles/${profileId}/test`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      setProfiles((prev) =>
        prev.map((profile) =>
          profile.id === profileId
            ? { ...profile, lastValidationStatus: data.status ?? null }
            : profile,
        ),
      );
      if (data.status && data.status !== "valid" && data.error) {
        setTestErrors((prev) => ({ ...prev, [profileId]: String(data.error) }));
      }
    } catch {
      setTestErrors((prev) => ({ ...prev, [profileId]: t("errors.connectionFailed") }));
    } finally {
      setTestingId(null);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("gateway.profile.title")}</h2>
        {canRegister && (
          // I-3: 열려 있을 때는 이 버튼을 비활성화한다. 이전엔 토글(prev => !prev)이라
          // 열린 채로 한 번 더 누르면 마법사의 "프로필이 남습니다" 확인 없이 그대로
          // 언마운트됐다 — 닫는 유일한 경로는 이제 마법사 자신의 "닫기"(내부에서
          // requestClose 가 확인을 거친다)뿐이다.
          <button
            type="button"
            disabled={wizardOpen}
            onClick={() => setWizardOpen(true)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {t("hermes.wizard.openButton")}
          </button>
        )}
      </div>

      {wizardOpen && (
        <div className="mb-4">
          <NpcHireWizard
            gatewayId={gatewayId}
            pluginStatus={pluginStatus}
            existingProfiles={profiles.map((p) => p.profileName)}
            initialProfile={wizardProfile}
            localDiscovery={!!discovery?.available && !!discovery?.optedIn}
            onDone={() => {
              setWizardOpen(false);
              setWizardProfile(null);
              // 마법사의 `onDone` 은 "만들었다" 가 아니라 "끝났다" 다 — 그냥 닫아도,
              // 만든 프로필을 도로 지워도 같은 콜백이 온다. 목록이 실제로 늘었을
              // 때만 생성으로 친다(안 그러면 닫기만 해도 화면이 튕겨 나간다).
              const before = profiles.length;
              void loadProfiles().then((rows) => {
                if (rows.length > before) onCreated?.();
              });
            }}
          />
        </div>
      )}

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
                  <div>
                    <p className="font-medium text-text">
                      {profile.displayName || profile.profileName}
                    </p>
                    <p className="text-xs text-text-muted">{profile.profileName}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PROFILE_STATUS_BADGE_CLASS[tone]}`}
                    >
                      {t(key)}
                    </span>
                    {canRegister && pluginStatus === "plugin_ready" && (
                      <button
                        type="button"
                        onClick={() => {
                          setWizardProfile(profile.profileName);
                          setWizardOpen(true);
                        }}
                        className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised/80"
                      >
                        {t("gateway.profile.persona")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleTest(profile.id)}
                      disabled={testingId === profile.id}
                      className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised/80 disabled:opacity-60"
                    >
                      {testingId === profile.id ? t("gateway.testing") : t("gateway.profile.test")}
                    </button>
                    {canRegister && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            editingId === profile.id ? setEditingId("") : startEdit(profile)
                          }
                          className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised/80"
                        >
                          {t("gateway.profile.edit")}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setAppearanceId((prev) => (prev === profile.id ? "" : profile.id))
                          }
                          className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised/80"
                        >
                          {t("gateway.profile.appearance")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(profile)}
                          disabled={busyId === profile.id}
                          className="rounded bg-danger/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-danger disabled:opacity-60"
                        >
                          {t("gateway.profile.delete")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {editingId === profile.id && (
                  <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                    {/* 표시 이름이 비면 프로필 이름이 그대로 표시된다 — 그 폴백을
                        placeholder 로 눈에 보이게 한다. */}
                    <input
                      value={editDisplayName}
                      onChange={(e) => setEditDisplayName(e.target.value)}
                      placeholder={profile.profileName}
                      className="w-full rounded bg-surface-raised px-3 py-2 text-sm"
                    />
                    <input
                      type="password"
                      value={editToken}
                      onChange={(e) => setEditToken(e.target.value)}
                      placeholder={t("gateway.profile.newTokenPlaceholder")}
                      className="w-full rounded bg-surface-raised px-3 py-2 text-sm"
                    />
                    <p className="text-xs text-text-muted">{t("gateway.profile.tokenKeepHint")}</p>
                    <button
                      type="button"
                      onClick={() => void handleSaveEdit(profile.id)}
                      disabled={busyId === profile.id}
                      className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      {t("gateway.profile.save")}
                    </button>
                  </div>
                )}
                {canRegister && appearanceId === profile.id && (
                  <ProfileAppearanceEditor
                    gatewayId={gatewayId}
                    profileId={profile.id}
                    initialAppearance={profile.appearance ?? null}
                    onSaved={() => {
                      setAppearanceId("");
                      setSavedAppearanceId(profile.id);
                      void loadProfiles();
                    }}
                  />
                )}
                {savedAppearanceId === profile.id && (
                  <p role="status" className="mt-3 text-sm text-text-secondary">
                    {ko ? "프로필 외형을 저장했습니다. " : "Profile appearance saved. "}
                    <Link href="/channels" className="text-primary underline">
                      {ko ? "채널에서 NPC 배치하기" : "Place this NPC in a channel"}
                    </Link>
                  </p>
                )}
                {testErrors[profile.id] && (
                  <p className="mt-1 text-xs text-danger">{testErrors[profile.id]}</p>
                )}
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

          <h3 className="text-sm font-semibold">{t("gateway.profile.addTitle")}</h3>
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
      ) : (
        <p className="border-t border-border pt-4 text-sm text-text-muted">
          {t("gateway.profile.ownerOnly")}
        </p>
      )}
    </section>
  );
}
