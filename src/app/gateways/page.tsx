"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import LocaleSwitcher from "@/components/LocaleSwitcher";
import LogoutButton from "@/components/LogoutButton";
import GatewaySetupWizard from "@/components/gateway/GatewaySetupWizard";
import { nextSelectedGatewayId } from "./gateway-selection";
import GatewayOnboardingGuide from "@/components/gateway/GatewayOnboardingGuide";
import GatewayStatusCard, { type GatewayStatus } from "@/components/gateway/GatewayStatusCard";
import DiagnosticsPanel from "@/components/gateway/DiagnosticsPanel";
import { getLocalizedErrorMessage, withHeaderErrorCode } from "@/lib/i18n/error-codes";
import { useT, useLocale } from "@/lib/i18n";

import { planGatewayDelete } from "./gateway-delete-plan";
import { backLinkTarget } from "./return-target";
import { employeesHref } from "@/components/workspace-navigation";

type GatewayRow = {
  id: string;
  displayName: string;
  baseUrl: string;
  ownerUserId?: string;
  canEditCredentials?: boolean;
  shareRole?: string | null;
  isOwner?: boolean;
  lastValidatedAt?: string | null;
  lastValidationStatus?: string | null;
  lastValidationError?: string | null;
  /** Hermes 대시보드 공개 주소 — 플러그인 0.7.1 이 알려 주고, 소유자에게만 내려온다. */
  dashboardUrl?: string | null;
};

type GatewayShare = {
  id?: string;
  userId: string;
  loginId: string;
  nickname: string | null;
  role: string;
  createdAt?: string;
};

/** 게이트웨이 연결 테스트 결과. 예전 이름은 PairingState 였지만 페어링(OpenClaw 디바이스
 * 승인)은 사라졌고 남은 것은 연결 테스트 상태뿐이다. */
/** 삭제를 막고 있는 채널. 서버가 409 와 함께 실어 보낸다. */
type BlockingChannel = {
  channelId: string;
  channelName: string;
  canUnbind: boolean;
  npcCount: number;
  meetingMinutesCount: number;
};

type GatewayTestState = {
  status: GatewayStatus;
  error?: string | null;
};

const EMPTY_TEST_STATE: GatewayTestState = { status: "idle" };

export default function GatewayManagementPage() {
  const t = useT();
  return (
    <Suspense
      fallback={
        <div className="theme-web min-h-screen flex items-center justify-center bg-bg text-text">
          {t("common.loading")}
        </div>
      }
    >
      <GatewayManagementPageInner />
    </Suspense>
  );
}

function GatewayManagementPageInner() {
  const t = useT();
  const { locale } = useLocale();
  // 사무실(채널 화면)에서 "인격을 하나 더 만들자"로 넘어온 왕복. `gateway` 는 어느
  // 게이트웨이를 열지, `new=1` 은 만들기 화면을 바로 펼칠지, `returnTo` 는 만든 뒤
  // 어디로 돌아갈지를 말한다. `returnTo` 는 그대로 믿지 않는다 — safeReturnTo 가
  // 같은 오리진 경로만 통과시킨다(열린 리다이렉트).
  const searchParams = useSearchParams();
  const requestedGatewayId = searchParams.get("gateway") ?? "";
  const autoOpenCreate = searchParams.get("new") === "1";
  const returnToParam = searchParams.get("returnTo");
  const returnTo = backLinkTarget(returnToParam);

  const [gateways, setGateways] = useState<GatewayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedGatewayId, setSelectedGatewayId] = useState(requestedGatewayId);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testingGatewayId, setTestingGatewayId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  const [shares, setShares] = useState<GatewayShare[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [shareLoginId, setShareLoginId] = useState("");
  const [shareSaving, setShareSaving] = useState(false);
  const [shareError, setShareError] = useState("");

  const [testStates, setTestStates] = useState<Record<string, GatewayTestState>>({});
  const [blockingChannels, setBlockingChannels] = useState<BlockingChannel[]>([]);
  const [unbinding, setUnbinding] = useState("");

  const loadGateways = useCallback(
    async (options: { autoSelect?: boolean } = {}) => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/gateways");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw data;
        }
        const nextGateways = Array.isArray(data.gateways) ? data.gateways : [];
        setGateways(nextGateways);
        setSelectedGatewayId((current) => nextSelectedGatewayId(current, nextGateways, options));
      } catch (nextError) {
        setError(getLocalizedErrorMessage(t, nextError, "common.error"));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void loadGateways();
  }, [loadGateways]);

  const selectedGateway = useMemo(
    () => gateways.find((gateway) => gateway.id === selectedGatewayId) ?? null,
    [gateways, selectedGatewayId],
  );

  useEffect(() => {
    if (!selectedGateway) {
      setFormMode("create");
      setDisplayName("");
      setBaseUrl("");
      setToken("");
      setShares([]);
      setShareError("");
      return;
    }

    setFormMode(selectedGateway.isOwner ? "edit" : "create");
    setDisplayName(selectedGateway.displayName || "");
    setBaseUrl(selectedGateway.baseUrl || "");
    setToken("");
  }, [selectedGateway]);

  const loadShares = useCallback(
    async (gatewayId: string) => {
      setSharesLoading(true);
      setShareError("");
      try {
        const res = await fetch(`/api/gateways/${gatewayId}/shares`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw data;
        }
        setShares(Array.isArray(data.shares) ? data.shares : []);
      } catch (nextError) {
        setShareError(getLocalizedErrorMessage(t, nextError, "common.error"));
        setShares([]);
      } finally {
        setSharesLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (!selectedGateway?.isOwner) {
      setShares([]);
      return;
    }
    void loadShares(selectedGateway.id);
  }, [loadShares, selectedGateway]);

  const handleUpdate = async () => {
    if (!selectedGateway) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const body: Record<string, unknown> = {
        displayName,
        url: baseUrl,
      };
      if (token.trim()) body.token = token.trim();

      const res = await fetch(`/api/gateways/${selectedGateway.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw data;
      }
      await loadGateways();
      setToken("");
      setNotice(t("gateways.saved"));
    } catch (nextError) {
      setError(getLocalizedErrorMessage(t, nextError, "common.error"));
    } finally {
      setSaving(false);
    }
  };

  const handleUnbindChannel = async (channel: BlockingChannel) => {
    if (!window.confirm(t("gateways.unbindConfirm", { name: channel.channelName }))) return;
    setUnbinding(channel.channelId);
    setError("");
    try {
      // 해제는 더 이상 지우는 것이 아니라 재우는 것이다 — NPC 는 자리를 기억한 채
      // 퇴근하고 회의록은 그대로 남는다. 그래서 예전의 confirmNpcReset=1 도 없앴다
      // (서버가 그 확인을 요구하지 않는데도 붙어 있던 유물이다).
      const res = await fetch(`/api/channels/${channel.channelId}/gateway`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw data;
      setBlockingChannels((prev) => prev.filter((c) => c.channelId !== channel.channelId));
      setNotice(t("gateways.unbound", { name: channel.channelName }));
    } catch (nextError) {
      setError(getLocalizedErrorMessage(t, nextError, "common.error"));
    } finally {
      setUnbinding("");
    }
  };

  /** 이 게이트웨이의 프로필들이 데리고 있는 NPC 자리·채널 수를 합산한다. */
  const sumGatewayUsage = async (gatewayId: string) => {
    const res = await fetch(`/api/gateways/${gatewayId}/profiles`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw data;
    const rows: { id: string }[] = Array.isArray(data.profiles) ? data.profiles : [];
    const usages = await Promise.all(
      rows.map(async (row) => {
        const usageRes = await fetch(`/api/gateways/${gatewayId}/profiles/${row.id}`);
        const usageData = await usageRes.json().catch(() => ({}));
        const usage = (usageData as { usage?: { npcs?: unknown; channels?: unknown } }).usage;
        return usageRes.ok && usage
          ? { npcs: Number(usage.npcs ?? 0), channels: Number(usage.channels ?? 0) }
          : { npcs: 0, channels: 0 };
      }),
    );
    return {
      profiles: rows.length,
      npcs: usages.reduce((sum, u) => sum + u.npcs, 0),
      channels: usages.reduce((sum, u) => sum + u.channels, 0),
    };
  };

  const handleDelete = async () => {
    if (!selectedGateway) return;
    // 게이트웨이 삭제는 프로필 → NPC → 태스크까지 연쇄한다. 무엇이 얼마나
    // 사라지는지 말하지 않는 확인은 확인이 아니다 — 수치를 먼저 세어 문구에 넣는다.
    let usage = { profiles: 0, npcs: 0, channels: 0 };
    try {
      usage = await sumGatewayUsage(selectedGateway.id);
    } catch {
      // 수치를 못 읽어도 삭제를 막지는 않는다 — 0 으로 물어본다.
    }
    const plan = planGatewayDelete(usage);
    if (plan.blocked) {
      // 서버가 409 로 거절할 삭제다. 확인을 띄우면 사용자는 일어나지 않을 일에
      // 동의하게 된다 — 묻지 말고 먼저 해야 할 일을 말한다.
      setError(t("gateways.deleteBlockedByChannels"));
      setNotice("");
      return;
    }
    if (
      !window.confirm(
        t("gateways.deleteConfirmWithUsage", {
          profiles: String(plan.profiles),
          npcs: String(plan.npcs),
        }),
      )
    ) {
      return;
    }
    setDeleting(true);
    setError("");
    setNotice("");
    setBlockingChannels([]);
    try {
      const res = await fetch(`/api/gateways/${selectedGateway.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw data;
      }
      setTestStates((prev) => {
        const next = { ...prev };
        delete next[selectedGateway.id];
        return next;
      });
      await loadGateways();
      setDisplayName("");
      setBaseUrl("");
      setToken("");
      setNotice(t("gateways.deleted"));
    } catch (nextError) {
      setError(getLocalizedErrorMessage(t, nextError, "common.error"));
      // 막고 있는 채널을 그 자리에서 풀 수 있게 목록을 띄운다 — 채널 화면까지
      // 찾아가게 만드는 왕복이 이 화면의 가장 큰 마찰이었다.
      const blocked = (nextError as { channels?: BlockingChannel[] })?.channels;
      if (Array.isArray(blocked)) setBlockingChannels(blocked);
    } finally {
      setDeleting(false);
    }
  };

  const handleTest = async (gatewayId: string) => {
    setTestingGatewayId(gatewayId);
    setTestStates((prev) => ({
      ...prev,
      [gatewayId]: EMPTY_TEST_STATE,
    }));
    try {
      const res = await fetch(`/api/gateways/${gatewayId}/test`, { method: "POST" });
      // 본문이 사라져도 헤더의 코드로 진단을 살린다(위 withHeaderErrorCode 주석 참조).
      const data = withHeaderErrorCode(await res.json().catch(() => ({})), res.headers);
      // 프로브 실패는 200 + { ok: false } 로 온다(라우트의 PROBE_RESULT_INIT 주석 참조).
      // res.ok 로 판정하면 실패를 성공으로 읽는다.
      const succeeded = res.ok && (data as { ok?: unknown } | null)?.ok !== false;
      if (succeeded) {
        setTestStates((prev) => ({
          ...prev,
          [gatewayId]: { status: "connected" },
        }));
        await loadGateways();
      } else {
        setTestStates((prev) => ({
          ...prev,
          [gatewayId]: {
            status: "error",
            error: getLocalizedErrorMessage(t, data, "errors.connectionFailed"),
          },
        }));
      }
    } catch (err) {
      // 여기는 응답이 아예 오지 않은 경우다(브라우저가 요청을 끊었거나 네트워크가 죽었거나).
      // 폴백 문구만 띄우면 서버가 보낸 진단과 구분되지 않아, 어느 층에서 끊겼는지 알 수
      // 없다 — 실제로 그 구분이 안 돼 한참을 헤맸다. 원인을 함께 보여준다.
      const detail = err instanceof Error ? err.message : String(err);
      setTestStates((prev) => ({
        ...prev,
        [gatewayId]: {
          status: "error",
          error: `${t("errors.connectionFailed")} (${detail})`,
        },
      }));
    } finally {
      setTestingGatewayId(null);
    }
  };

  const handleAddShare = async () => {
    if (!selectedGateway?.isOwner || !shareLoginId.trim()) return;
    setShareSaving(true);
    setShareError("");
    try {
      const res = await fetch(`/api/gateways/${selectedGateway.id}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: shareLoginId.trim(), role: "use" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw data;
      }
      setShareLoginId("");
      await loadShares(selectedGateway.id);
    } catch (nextError) {
      setShareError(getLocalizedErrorMessage(t, nextError, "common.error"));
    } finally {
      setShareSaving(false);
    }
  };

  const handleRemoveShare = async (userId: string) => {
    if (!selectedGateway?.isOwner) return;
    setShareSaving(true);
    setShareError("");
    try {
      const res = await fetch(`/api/gateways/${selectedGateway.id}/shares`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw data;
      }
      await loadShares(selectedGateway.id);
    } catch (nextError) {
      setShareError(getLocalizedErrorMessage(t, nextError, "common.error"));
    } finally {
      setShareSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="theme-web min-h-screen flex items-center justify-center bg-bg text-text">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="theme-web min-h-screen bg-bg px-8 py-8 text-text">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">{t("gateways.title")}</h1>
            <p className="mt-1 text-text-muted">{t("gateways.subtitle")}</p>
          </div>
          <div className="flex items-center gap-3">
            {returnTo && (
              <Link
                href={returnTo}
                className="rounded-lg bg-surface-raised px-4 py-2 text-sm font-medium hover:bg-surface-raised/80"
              >
                {t("gateways.backToOffice")}
              </Link>
            )}
            <Link
              href="/channels"
              className="rounded-lg bg-surface-raised px-4 py-2 text-sm font-medium hover:bg-surface-raised/80"
            >
              {t("gateways.backToChannels")}
            </Link>
            <LogoutButton />
            <LocaleSwitcher />
          </div>
        </div>

        <section className="mb-6 rounded-xl border border-border bg-surface p-5">
          <p className="text-xs font-semibold tracking-wide text-text-muted">
            {locale === "ko"
              ? "01 연결 → 02 직원 등록·로그인 → 03 내 캐릭터 → 04 사무실 만들기"
              : "01 Connect → 02 Hire and sign in → 03 My character → 04 Create an office"}
          </p>
          <p className="mt-2 text-sm text-text-muted">
            {locale === "ko"
              ? "왼쪽 메뉴 순서가 곧 진행 순서입니다. 여기서 Hermes 게이트웨이를 연결하면, 직원 화면에서 직원을 만들고 그 직원으로 모델에 로그인합니다. Hermes 는 직원마다 따로 로그인합니다."
              : "The sidebar order is the setup order. Connect your Hermes gateway here, then hire employees and sign each one in — Hermes signs in per employee."}
          </p>
          {selectedGateway && (
            <Link
              href={`/profiles?gateway=${encodeURIComponent(selectedGateway.id)}`}
              className="mt-3 inline-block font-semibold text-primary"
            >
              {locale === "ko" ? "이 게이트웨이의 NPC 보기 →" : "View this gateway’s NPCs →"}
            </Link>
          )}
        </section>

        {gateways.length === 0 && <GatewayOnboardingGuide />}

        {error && (
          <div className="mb-6 rounded-lg border border-danger/40 bg-surface px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}
        {blockingChannels.length > 0 && (
          <div className="mb-6 rounded-lg border border-danger/40 bg-surface px-4 py-3 text-sm">
            <p className="mb-3 text-text-muted">{t("gateways.unbindHint")}</p>
            <ul className="space-y-2">
              {blockingChannels.map((channel) => (
                <li key={channel.channelId} className="flex items-center justify-between gap-4">
                  <span>
                    <span className="font-medium">{channel.channelName}</span>
                    <span className="ml-2 text-text-muted">
                      {t("gateways.unbindLoses", {
                        npcs: String(channel.npcCount),
                        minutes: String(channel.meetingMinutesCount),
                      })}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={!channel.canUnbind || unbinding === channel.channelId}
                    onClick={() => void handleUnbindChannel(channel)}
                    title={channel.canUnbind ? undefined : t("gateways.unbindNotOwner")}
                    className="shrink-0 rounded-lg bg-surface-raised px-3 py-1.5 text-sm font-medium hover:bg-surface-raised/80 disabled:opacity-50"
                  >
                    {t("gateways.unbind")}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {notice && (
          <div className="mb-6 rounded-lg border border-emerald-400/30 bg-surface px-4 py-3 text-sm text-emerald-700">
            {notice}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t("gateways.listTitle")}</h2>
              <button
                type="button"
                onClick={() => {
                  setSelectedGatewayId("");
                  setFormMode("create");
                  setDisplayName("");
                  setBaseUrl("");
                  setToken("");
                  setShares([]);
                  setError("");
                  setNotice("");
                }}
                className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover"
              >
                {t("gateways.new")}
              </button>
            </div>
            <div className="space-y-2">
              {gateways.length === 0 ? (
                <div className="rounded-lg bg-bg px-3 py-4 text-sm text-text-muted">
                  <p>{t("gateways.empty")}</p>
                  <p className="mt-1">{t("gateways.emptyHint")}</p>
                </div>
              ) : (
                gateways.map((gateway) => (
                  <button
                    key={gateway.id}
                    type="button"
                    onClick={() => setSelectedGatewayId(gateway.id)}
                    className={`w-full rounded-lg px-3 py-3 text-left transition ${
                      selectedGatewayId === gateway.id
                        ? "bg-primary-muted text-primary-light ring-1 ring-primary-light"
                        : "bg-bg hover:bg-surface-raised"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{gateway.displayName}</span>
                      <span className="text-[11px] text-text-muted">
                        {gateway.isOwner ? t("gateways.owner") : t("gateways.shared")}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-text-muted">{gateway.baseUrl}</p>
                    <p className="mt-1 text-xs text-text-muted">
                      {gateway.lastValidationStatus === "valid"
                        ? t("gateways.statusValid")
                        : gateway.lastValidationStatus === "pairing_required"
                          ? t("gateways.statusPairing")
                          : gateway.lastValidationStatus
                            ? t("gateways.statusUnknown")
                            : t("gateways.statusUntested")}
                    </p>
                  </button>
                ))
              )}
            </div>
          </aside>

          <main className="space-y-6">
            {!selectedGateway ? (
              <GatewaySetupWizard
                onConnected={(gatewayId) => {
                  setSelectedGatewayId(gatewayId);
                  void loadGateways();
                }}
                onSaved={() => void loadGateways({ autoSelect: false })}
              />
            ) : (
              <section className="rounded-xl border border-border bg-surface p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">
                      {formMode === "create" ? t("gateways.createTitle") : t("gateways.editTitle")}
                    </h2>
                    <p className="mt-1 text-sm text-text-muted">
                      {formMode === "create" ? t("gateways.createHelp") : t("gateways.editHelp")}
                    </p>
                  </div>
                  {selectedGateway && (
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedGateway.isOwner && selectedGateway.dashboardUrl && (
                        <a
                          href={selectedGateway.dashboardUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg bg-surface-raised px-4 py-2 text-sm font-medium hover:bg-surface-raised/80"
                        >
                          {t("gateways.openDashboard")} ↗
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleTest(selectedGateway.id)}
                        disabled={testingGatewayId === selectedGateway.id}
                        className="rounded-lg bg-surface-raised px-4 py-2 text-sm font-medium hover:bg-surface-raised/80 disabled:opacity-60"
                      >
                        {testingGatewayId === selectedGateway.id
                          ? t("gateway.testing")
                          : t("gateway.testConnection")}
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-text-secondary">
                      {t("gateways.displayName")}
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      disabled={!!selectedGateway && !selectedGateway.isOwner}
                      className="w-full rounded border border-border bg-bg px-3 py-2 text-text focus:outline-none focus:border-primary disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-text-secondary">
                      {t("settings.gatewayUrl")}
                    </label>
                    <input
                      type="text"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      disabled={!!selectedGateway && !selectedGateway.isOwner}
                      className="w-full rounded border border-border bg-bg px-3 py-2 text-text focus:outline-none focus:border-primary disabled:opacity-60"
                      placeholder={t("settings.gatewayUrlPlaceholder")}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-text-secondary">
                      {formMode === "create"
                        ? t("settings.gatewayToken")
                        : t("gateways.rotateToken")}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type={showToken ? "text" : "password"}
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        disabled={!!selectedGateway && !selectedGateway.isOwner}
                        className="flex-1 rounded border border-border bg-bg px-3 py-2 text-text focus:outline-none focus:border-primary disabled:opacity-60"
                        placeholder={t("settings.gatewayTokenPlaceholder")}
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken((prev) => !prev)}
                        className="rounded bg-surface-raised px-3 py-2 text-sm text-text hover:bg-surface-raised/80"
                      >
                        {showToken ? t("common.hide") : t("common.show")}
                      </button>
                    </div>
                    {formMode === "edit" && (
                      <p className="mt-1 text-xs text-text-muted">
                        {t("gateways.rotateTokenHint")}
                      </p>
                    )}
                  </div>
                </div>

                {selectedGateway && testStates[selectedGateway.id] && (
                  <GatewayStatusCard
                    className="mt-4"
                    status={testStates[selectedGateway.id]?.status ?? "idle"}
                    error={testStates[selectedGateway.id]?.error}
                    detail={
                      testStates[selectedGateway.id]?.status === "connected"
                        ? t("gateways.testSuccess")
                        : undefined
                    }
                  />
                )}

                <div className="mt-5 flex gap-3">
                  <>
                    <button
                      type="button"
                      onClick={() => void handleUpdate()}
                      disabled={
                        saving ||
                        !selectedGateway?.isOwner ||
                        !displayName.trim() ||
                        !baseUrl.trim()
                      }
                      className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                    >
                      {saving ? t("common.loading") : t("common.save")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete()}
                      disabled={deleting || !selectedGateway?.isOwner}
                      className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
                    >
                      {deleting ? t("common.loading") : t("common.delete")}
                    </button>
                  </>
                </div>
              </section>
            )}

            {selectedGateway && (
              // 직원(Hermes 프로필) 관리는 `/profiles` 한 곳에서만 한다 — 이 화면은 "연결" 까지다.
              // 예전에는 같은 목록이 두 화면에 똑같이 떠서 어디서 관리하는지가 흐려졌다.
              <section className="rounded-xl border border-border bg-surface p-5">
                <h2 className="text-lg font-semibold">{t("gateways.employeesTitle")}</h2>
                <p className="mt-1 text-sm text-text-muted">{t("gateways.employeesHint")}</p>
                <Link
                  href={employeesHref(selectedGateway.id, {
                    create: autoOpenCreate,
                    returnTo: returnTo ?? undefined,
                  })}
                  className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
                >
                  {t("gateways.employeesOpen")}
                </Link>
              </section>
            )}

            <section className="rounded-xl border border-border bg-surface p-5">
              <div className="mb-4">
                <h2 className="text-lg font-semibold">{t("gateways.shareTitle")}</h2>
                <p className="mt-1 text-sm text-text-muted">{t("gateways.shareHelp")}</p>
              </div>

              {!selectedGateway ? (
                <p className="text-sm text-text-muted">{t("gateways.selectGatewayFirst")}</p>
              ) : !selectedGateway.isOwner ? (
                <p className="text-sm text-text-muted">{t("gateways.shareOwnerOnly")}</p>
              ) : (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={shareLoginId}
                      onChange={(e) => setShareLoginId(e.target.value)}
                      className="flex-1 rounded border border-border bg-bg px-3 py-2 text-text focus:outline-none focus:border-primary"
                      placeholder={t("gateways.shareLoginId")}
                    />
                    <button
                      type="button"
                      onClick={() => void handleAddShare()}
                      disabled={shareSaving || !shareLoginId.trim()}
                      className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                    >
                      {shareSaving ? t("common.loading") : t("gateways.shareAdd")}
                    </button>
                  </div>
                  {shareError && <p className="text-sm text-danger">{shareError}</p>}
                  {sharesLoading ? (
                    <p className="text-sm text-text-muted">{t("common.loading")}</p>
                  ) : shares.length === 0 ? (
                    <p className="text-sm text-text-muted">{t("gateways.shareEmpty")}</p>
                  ) : (
                    <div className="space-y-2">
                      {shares.map((share) => (
                        <div
                          key={share.userId}
                          className="flex items-center justify-between rounded-lg bg-bg px-3 py-3"
                        >
                          <div>
                            <p className="font-medium text-text">
                              {share.nickname || share.loginId}
                            </p>
                            <p className="text-xs text-text-muted">{share.loginId}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleRemoveShare(share.userId)}
                            disabled={shareSaving}
                            className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-60"
                          >
                            {t("common.delete")}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* 관리자에게만 보이는 진단. 권한이 없으면 스스로 사라진다. */}
            <DiagnosticsPanel />
          </main>
        </div>
      </div>
    </div>
  );
}
