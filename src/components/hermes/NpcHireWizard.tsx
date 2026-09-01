"use client";

/**
 * NPC 고용 마법사 — ①프로필 ②인격 ③설정 ④배치.
 *
 * 능력에 따라 단계가 눈에 보이게 줄어든다(`availableSteps`) — 잠긴 단계도 회색으로
 * 남고 이유를 보여준다, 숨기지 않는다.
 *
 * 이 마법사는 게이트웨이 관리 화면(`HermesProfileList` → `/gateways`)에서 연다.
 * 그 화면에는 **채널이 없다** — `NpcHireModal` 은 `channelId` 를 필수로 받는
 * 맵 배치 컴포넌트라 여기서 직접 열 수 없다(판정 G, 파일 스코프 제약과 겹쳐 실제로도
 * 불가능하다). 그래서 ④ 배치는 여기서 재구현하지 않고, ①에서 등록한 프로필이
 * `hermesProfiles` 테이블에 이미 저장돼 있다는 사실(POST 라우트가 그 자리에서
 * `registerHermesProfile` 을 부른다)에 기대어 "채널로 가서 기존 NPC 고용 흐름에서
 * 이 프로필을 선택하라" 는 안내로 마무리한다. 상세 사유는 task-10-report.md 참조.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { useT } from "@/lib/i18n";
import { getLocalizedErrorMessage, withHeaderErrorCode } from "@/lib/i18n/error-codes";
import { isCreatableProfileName } from "@/lib/hermes/creatable-profile-name";
import type { PluginStatus } from "@/lib/hermes/plugin-capability";

import {
  availableSteps,
  classifyServingCheck,
  identityDecision,
  nextStep,
  type StepAvailability,
  type WizardStep,
} from "./hire-wizard-steps";
import { getWizardErrorMessage } from "./wizard-error-codes";

// ---------------------------------------------------------------------------
// Types mirroring the proxy routes' response shapes (Task 5·6·7)
// ---------------------------------------------------------------------------

type ProvisionedProfile = {
  name: string;
  keyIssued: boolean;
  keyError?: string;
  keyStored: boolean;
  keyStoredError?: string;
};

type IdentityPayload = {
  body: string | null;
  isDefaultTemplate: boolean | null;
  revision: string | null;
  unreadable?: boolean;
};

type ProxyFailure = {
  errorCode?: string;
  error?: string;
  shellCommand?: string | null;
  upstreamStatus?: number | null;
};

interface NpcHireWizardProps {
  gatewayId: string;
  pluginStatus: PluginStatus;
  localDiscovery: boolean;
  onDone: () => void;
}

function extractErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const code = (payload as { errorCode?: unknown }).errorCode;
  return typeof code === "string" ? code : null;
}

/** 프록시 4종이 실패 응답에 함께 싣는 원 업스트림 상태 코드. 없으면 null(예: 네트워크 실패). */
function extractUpstreamStatus(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const status = (payload as { upstreamStatus?: unknown }).upstreamStatus;
  return typeof status === "number" ? status : null;
}

export default function NpcHireWizard({
  gatewayId,
  pluginStatus,
  localDiscovery,
  onDone,
}: NpcHireWizardProps) {
  const t = useT();

  const steps = useMemo(
    () => availableSteps(pluginStatus, localDiscovery),
    [pluginStatus, localDiscovery],
  );
  const stepByName = useMemo(
    () => Object.fromEntries(steps.map((s) => [s.step, s])) as Record<WizardStep, StepAvailability>,
    [steps],
  );

  const firstEnabled = steps.find((s) => s.enabled)?.step ?? "placement";
  const [current, setCurrent] = useState<WizardStep>(firstEnabled);

  // --- Step ① profile ---
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [created, setCreated] = useState<ProvisionedProfile | null>(null);
  const [serving, setServing] = useState<
    "idle" | "checking" | "served" | "key_rejected" | "not_served" | "error"
  >("idle");
  const [servingError, setServingError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteShellCommand, setDeleteShellCommand] = useState<string | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const nameTrimmed = name.trim();
  const nameValid = nameTrimmed.length > 0 && isCreatableProfileName(nameTrimmed);

  // --- Step ② identity ---
  const [identityPayload, setIdentityPayload] = useState<IdentityPayload | null>(null);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identityError, setIdentityError] = useState("");
  const [identityMode, setIdentityMode] = useState<"keep" | "new" | "load" | null>(null);
  const [identityBody, setIdentityBody] = useState("");
  const [identitySaving, setIdentitySaving] = useState(false);
  const [identityConflict, setIdentityConflict] = useState(false);

  // --- Step ③ config ---
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState("");
  const [configLocked, setConfigLocked] = useState(false);
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("");
  const [toolsetsText, setToolsetsText] = useState("");
  const [configSaving, setConfigSaving] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  const profileBase = created
    ? `/api/gateways/${gatewayId}/plugin/profiles/${encodeURIComponent(created.name)}`
    : null;

  // --- Step ① actions ---

  const handleCreate = useCallback(async () => {
    if (!nameValid) return;
    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch(`/api/gateways/${gatewayId}/plugin/profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameTrimmed }),
      });
      const data = withHeaderErrorCode(await res.json().catch(() => ({})), res.headers);
      const code = extractErrorCode(data);
      if (code) {
        setCreateError(getWizardErrorMessage(t, code));
        return;
      }
      if (!res.ok) {
        setCreateError(getLocalizedErrorMessage(t, data, "common.error"));
        return;
      }
      const profile = data as ProvisionedProfile;
      setCreated(profile);

      // keyStored 가 false 면 어느 쪽이든 프로필 토큰이 DeskRPG 에 없다 —
      // 인격·설정 단계는 그 토큰이 있어야 부를 수 있으므로 서빙 확인을 건너뛴다.
      if (!profile.keyStored) {
        setServing("idle");
        return;
      }

      setServing("checking");
      setServingError("");
      const idRes = await fetch(
        `/api/gateways/${gatewayId}/plugin/profiles/${encodeURIComponent(profile.name)}/identity`,
      );
      const idData = withHeaderErrorCode(await idRes.json().catch(() => ({})), idRes.headers);
      const idCode = extractErrorCode(idData);
      // 판정 I: served_profiles 스냅샷을 쓰지 않는다 — 방금 만든 프로필을 실제로
      // 호출해 판정한다. 수정 라운드 1: 프록시가 이제 `upstreamStatus` 를 함께
      // 실어 보내므로, 401(키 문제)과 404(allowlist 로 서빙 안 함)를 가른다 —
      // 둘 다 `plugin_error` 로 뭉쳐지던 문제(리뷰 지적)를 여기서 고친다.
      const verdict = classifyServingCheck({
        errorCode: idCode,
        upstreamStatus: extractUpstreamStatus(idData),
      });
      if (verdict === "served") {
        setServing("served");
        setIdentityPayload(idData as IdentityPayload);
      } else if (verdict === "key_rejected") {
        setServing("key_rejected");
      } else if (verdict === "not_served") {
        setServing("not_served");
      } else {
        setServing("error");
        setServingError(getWizardErrorMessage(t, idCode));
      }
    } catch {
      setCreateError(t("errors.connectionFailed"));
    } finally {
      setCreating(false);
    }
  }, [gatewayId, nameTrimmed, nameValid, t]);

  const handleDeleteCreated = useCallback(async () => {
    if (!created) return;
    setDeleting(true);
    setDeleteError("");
    setDeleteShellCommand(null);
    try {
      const res = await fetch(
        `/api/gateways/${gatewayId}/plugin/profiles/${encodeURIComponent(created.name)}`,
        { method: "DELETE" },
      );
      const data = withHeaderErrorCode(
        await res.json().catch(() => ({})),
        res.headers,
      ) as ProxyFailure;
      const code = extractErrorCode(data);
      if (code) {
        setDeleteError(getWizardErrorMessage(t, code));
        if (data.shellCommand) setDeleteShellCommand(data.shellCommand);
        return;
      }
      if (!res.ok) {
        setDeleteError(getLocalizedErrorMessage(t, data, "common.error"));
        return;
      }
      // 지웠으니 처음부터 다시 — 마법사를 닫는다.
      setCreated(null);
      setShowCloseConfirm(false);
      onDone();
    } catch {
      setDeleteError(t("errors.connectionFailed"));
    } finally {
      setDeleting(false);
    }
  }, [created, gatewayId, onDone, t]);

  // --- Step ② actions ---

  const loadIdentity = useCallback(async () => {
    if (!profileBase) return;
    setIdentityLoading(true);
    setIdentityError("");
    setIdentityConflict(false);
    try {
      const res = await fetch(`${profileBase}/identity`);
      const data = withHeaderErrorCode(await res.json().catch(() => ({})), res.headers);
      const code = extractErrorCode(data);
      if (code) {
        setIdentityError(getWizardErrorMessage(t, code));
        setIdentityPayload(null);
        return;
      }
      const payload = data as IdentityPayload;
      setIdentityPayload(payload);
      const decision = identityDecision(payload);
      if (decision === "edit_fresh") {
        setIdentityMode("new");
        setIdentityBody("");
      } else if (decision === "ask_overwrite") {
        setIdentityMode(null);
        setIdentityBody(payload.body ?? "");
      } else {
        // blocked — 편집기를 열지 않는다.
        setIdentityMode(null);
      }
    } catch {
      setIdentityError(t("errors.connectionFailed"));
    } finally {
      setIdentityLoading(false);
    }
  }, [profileBase, t]);

  useEffect(() => {
    if (current === "identity" && !identityPayload && !identityLoading) {
      void loadIdentity();
    }
  }, [current, identityPayload, identityLoading, loadIdentity]);

  const handleSaveIdentity = useCallback(async () => {
    if (!profileBase || !identityPayload) return;
    setIdentitySaving(true);
    setIdentityError("");
    setIdentityConflict(false);
    try {
      const res = await fetch(`${profileBase}/identity`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: identityBody, ifRevision: identityPayload.revision ?? "" }),
      });
      const data = withHeaderErrorCode(await res.json().catch(() => ({})), res.headers);
      const code = extractErrorCode(data);
      if (code === "revision_conflict") {
        setIdentityConflict(true);
        await loadIdentity();
        return;
      }
      if (code) {
        setIdentityError(getWizardErrorMessage(t, code));
        return;
      }
      if (!res.ok) {
        setIdentityError(getLocalizedErrorMessage(t, data, "common.error"));
        return;
      }
      const saved = data as { revision: string };
      setIdentityPayload((prev) => (prev ? { ...prev, revision: saved.revision } : prev));
    } catch {
      setIdentityError(t("errors.connectionFailed"));
    } finally {
      setIdentitySaving(false);
    }
  }, [identityBody, identityPayload, loadIdentity, profileBase, t]);

  // --- Step ③ actions ---

  const loadConfig = useCallback(async () => {
    if (!profileBase) return;
    setConfigLoading(true);
    setConfigError("");
    setConfigLocked(false);
    try {
      const res = await fetch(`${profileBase}/config`);
      const data = withHeaderErrorCode(await res.json().catch(() => ({})), res.headers);
      const code = extractErrorCode(data);
      if (code) {
        // "unreadable"(200 분기)·"config_unreadable"(409) 둘 다 폼을 잠근다 — 빈
        // 폼으로 저장하면 기존 설정을 지운다.
        if (code === "unreadable" || code === "config_unreadable") {
          setConfigLocked(true);
        }
        setConfigError(getWizardErrorMessage(t, code));
        return;
      }
      const record = data as Record<string, unknown>;
      setModel(typeof record.model === "string" ? record.model : "");
      setProvider(typeof record.provider === "string" ? record.provider : "");
      const toolsets = record.toolsets;
      setToolsetsText(
        Array.isArray(toolsets) ? toolsets.filter((x) => typeof x === "string").join(", ") : "",
      );
    } catch {
      setConfigError(t("errors.connectionFailed"));
    } finally {
      setConfigLoading(false);
    }
  }, [profileBase, t]);

  useEffect(() => {
    if (
      current === "config" &&
      !configLoading &&
      !model &&
      !provider &&
      !toolsetsText &&
      !configError
    ) {
      void loadConfig();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const handleSaveConfig = useCallback(async () => {
    if (!profileBase) return;
    setConfigSaving(true);
    setConfigError("");
    setConfigSaved(false);
    try {
      const patch: Record<string, unknown> = {};
      if (model.trim()) patch.model = model.trim();
      if (provider.trim()) patch.provider = provider.trim();
      const toolsets = toolsetsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (toolsets.length > 0) patch.toolsets = toolsets;

      const res = await fetch(`${profileBase}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = withHeaderErrorCode(await res.json().catch(() => ({})), res.headers);
      const code = extractErrorCode(data);
      if (code) {
        setConfigError(getWizardErrorMessage(t, code));
        return;
      }
      if (!res.ok) {
        setConfigError(getLocalizedErrorMessage(t, data, "common.error"));
        return;
      }
      setConfigSaved(true);
    } catch {
      setConfigError(t("errors.connectionFailed"));
    } finally {
      setConfigSaving(false);
    }
  }, [model, profileBase, provider, t, toolsetsText]);

  // --- Navigation ---

  const goNext = useCallback(() => {
    const next = nextStep(current, steps);
    if (next) setCurrent(next);
  }, [current, steps]);

  const requestClose = useCallback(() => {
    if (created && !showCloseConfirm) {
      setShowCloseConfirm(true);
      return;
    }
    onDone();
  }, [created, onDone, showCloseConfirm]);

  // ---------------------------------------------------------------------------

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("hermes.wizard.title")}</h2>
        <button
          type="button"
          onClick={requestClose}
          className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised/80"
        >
          {t("hermes.wizard.close")}
        </button>
      </div>

      {/* 잠긴 단계도 회색으로 남긴다 — 사라지면 사용자는 그런 기능이 있는 줄도 모른다. */}
      <div className="mb-5 flex flex-wrap gap-2">
        {steps.map((s) => (
          <button
            key={s.step}
            type="button"
            disabled={!s.enabled}
            onClick={() => s.enabled && setCurrent(s.step)}
            title={s.lockedReason ? t(s.lockedReason) : undefined}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              current === s.step
                ? "border-primary bg-primary/10 text-primary"
                : s.enabled
                  ? "border-border bg-surface-raised text-text hover:bg-surface-raised/80"
                  : "border-border/60 bg-surface-raised/40 text-text-muted"
            }`}
          >
            {t(`hermes.wizard.step.${s.step}`)}
          </button>
        ))}
      </div>
      {!stepByName[current]?.enabled && stepByName[current]?.lockedReason && (
        <p className="mb-4 text-sm text-text-muted">
          {t(stepByName[current].lockedReason as string)}
        </p>
      )}

      {showCloseConfirm && created && (
        <div className="mb-4 space-y-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3">
          <p className="text-sm font-semibold text-amber-300">
            {t("hermes.wizard.closeConfirmTitle")}
          </p>
          <p className="text-sm text-text-muted">
            {t("hermes.wizard.closeConfirmBody", { name: created.name })}
          </p>
          {deleteError && <p className="text-xs text-danger">{deleteError}</p>}
          {deleteShellCommand && (
            <pre className="overflow-x-auto rounded bg-bg px-3 py-2 text-xs text-text">
              {deleteShellCommand}
            </pre>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={deleting}
              onClick={() => void handleDeleteCreated()}
              className="rounded bg-danger/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-danger disabled:opacity-60"
            >
              {deleting ? t("common.loading") : t("hermes.wizard.closeConfirmDelete")}
            </button>
            <button
              type="button"
              onClick={onDone}
              className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised/80"
            >
              {t("hermes.wizard.closeConfirmKeep")}
            </button>
            <button
              type="button"
              onClick={() => setShowCloseConfirm(false)}
              className="rounded px-3 py-1.5 text-xs font-semibold text-text-muted hover:text-text"
            >
              {t("hermes.wizard.back")}
            </button>
          </div>
        </div>
      )}

      {!showCloseConfirm && current === "profile" && stepByName.profile?.enabled && (
        <div className="space-y-3">
          {pluginStatus !== "plugin_ready" ? (
            <p className="text-sm text-text-muted">{t("hermes.wizard.profile.needsPlugin")}</p>
          ) : !created ? (
            <>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("hermes.wizard.profile.namePlaceholder")}
                className="w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
              <p className="text-xs text-text-muted">{t("hermes.wizard.profile.nameHint")}</p>
              {nameTrimmed.length > 0 && !nameValid && (
                <p className="text-xs text-danger">{t("hermes.wizard.profile.nameInvalid")}</p>
              )}
              {createError && <p className="text-sm text-danger">{createError}</p>}
              <button
                type="button"
                disabled={!nameValid || creating}
                onClick={() => void handleCreate()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
              >
                {creating ? t("hermes.wizard.profile.creating") : t("hermes.wizard.profile.create")}
              </button>
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-text">
                {t("hermes.wizard.profile.created", { name: created.name })}
              </p>

              {!created.keyIssued && (
                <div className="space-y-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3">
                  <p className="text-sm font-semibold text-amber-300">
                    {t("hermes.wizard.profile.keyIssuedFalseTitle")}
                  </p>
                  {created.keyError && (
                    <p className="text-xs text-text-muted">{created.keyError}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => void handleDeleteCreated()}
                      className="rounded bg-danger/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-danger disabled:opacity-60"
                    >
                      {t("hermes.wizard.profile.deleteAndRetry")}
                    </button>
                    <button
                      type="button"
                      onClick={onDone}
                      className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised/80"
                    >
                      {t("hermes.wizard.profile.enterKeyInShell")}
                    </button>
                  </div>
                </div>
              )}

              {created.keyIssued && !created.keyStored && (
                <div className="space-y-2 rounded-lg border border-danger/40 bg-danger/10 p-3">
                  <p className="text-sm font-semibold text-danger">
                    {t("hermes.wizard.profile.keyStoredFalseTitle")}
                  </p>
                  {created.keyStoredError && (
                    <p className="text-xs text-text-muted">{created.keyStoredError}</p>
                  )}
                </div>
              )}

              {created.keyStored && (
                <>
                  {serving === "checking" && (
                    <p className="text-sm text-text-muted">
                      {t("hermes.wizard.profile.verifying")}
                    </p>
                  )}
                  {serving === "served" && (
                    <p className="text-sm text-emerald-300">{t("hermes.wizard.profile.served")}</p>
                  )}
                  {serving === "key_rejected" && (
                    <p className="text-sm text-danger">{t("hermes.wizard.profile.keyRejected")}</p>
                  )}
                  {serving === "not_served" && (
                    <p className="text-sm text-danger">{t("hermes.wizard.profile.notServed")}</p>
                  )}
                  {serving === "error" && <p className="text-sm text-danger">{servingError}</p>}
                  {serving === "served" && (
                    <button
                      type="button"
                      onClick={goNext}
                      className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
                    >
                      {t("hermes.wizard.profile.continue")}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {!showCloseConfirm && current === "identity" && stepByName.identity?.enabled && (
        <div className="space-y-3">
          {identityLoading ? (
            <p className="text-sm text-text-muted">{t("hermes.wizard.identity.loading")}</p>
          ) : identityError ? (
            <p className="text-sm text-danger">{identityError}</p>
          ) : identityPayload?.unreadable ||
            identityDecision(identityPayload ?? { isDefaultTemplate: null }) === "blocked" ? (
            <p className="text-sm text-danger">{t("hermes.wizard.identity.blocked")}</p>
          ) : identityMode === null && identityPayload ? (
            <div className="space-y-2">
              <p className="text-sm text-text">{t("hermes.wizard.identity.askOverwriteTitle")}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setIdentityMode("keep")}
                  className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised/80"
                >
                  {t("hermes.wizard.identity.keepExisting")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIdentityMode("new");
                    setIdentityBody("");
                  }}
                  className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised/80"
                >
                  {t("hermes.wizard.identity.writeNew")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIdentityMode("load");
                    setIdentityBody(identityPayload.body ?? "");
                  }}
                  className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised/80"
                >
                  {t("hermes.wizard.identity.loadForEdit")}
                </button>
              </div>
            </div>
          ) : identityMode === "keep" ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-text-muted">{t("hermes.wizard.identity.skip")}</p>
              <button
                type="button"
                onClick={goNext}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
              >
                {t("hermes.wizard.next")}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {identityConflict && (
                <p className="text-sm text-amber-300">{t("hermes.wizard.identity.conflict")}</p>
              )}
              <textarea
                value={identityBody}
                onChange={(e) => setIdentityBody(e.target.value)}
                placeholder={t("hermes.wizard.identity.placeholder")}
                rows={8}
                className="w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={identitySaving}
                  onClick={() => void handleSaveIdentity()}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                >
                  {identitySaving
                    ? t("hermes.wizard.identity.saving")
                    : t("hermes.wizard.identity.save")}
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  className="rounded bg-surface-raised px-4 py-2 text-sm font-semibold hover:bg-surface-raised/80"
                >
                  {t("hermes.wizard.next")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!showCloseConfirm && current === "config" && stepByName.config?.enabled && (
        <div className="space-y-3">
          {configLoading ? (
            <p className="text-sm text-text-muted">{t("hermes.wizard.config.loading")}</p>
          ) : configLocked ? (
            <p className="text-sm text-danger">{t("hermes.wizard.config.locked")}</p>
          ) : (
            <>
              {configError && !configLocked && <p className="text-sm text-danger">{configError}</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={t("hermes.wizard.config.model")}
                  className="rounded border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
                <input
                  type="text"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  placeholder={t("hermes.wizard.config.provider")}
                  className="rounded border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
              <input
                type="text"
                value={toolsetsText}
                onChange={(e) => setToolsetsText(e.target.value)}
                placeholder={t("hermes.wizard.config.toolsets")}
                className="w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
              <p className="text-xs text-text-muted">{t("hermes.wizard.config.toolsetsHint")}</p>
              {configSaved && (
                <p className="text-xs text-emerald-300">{t("hermes.wizard.config.saved")}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={configSaving}
                  onClick={() => void handleSaveConfig()}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                >
                  {configSaving ? t("hermes.wizard.config.saving") : t("hermes.wizard.config.save")}
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  className="rounded bg-surface-raised px-4 py-2 text-sm font-semibold hover:bg-surface-raised/80"
                >
                  {t("hermes.wizard.next")}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!showCloseConfirm && current === "placement" && stepByName.placement?.enabled && (
        <div className="space-y-3">
          <p className="text-sm text-text">
            {created ? t("hermes.wizard.placement.ready", { name: created.name }) : ""}
          </p>
          <p className="text-sm text-text-muted">{t("hermes.wizard.placement.guide")}</p>
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
          >
            {t("hermes.wizard.placement.done")}
          </button>
        </div>
      )}
    </div>
  );
}
