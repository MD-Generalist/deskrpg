"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, Monitor, Server, Terminal } from "lucide-react";
import { useLocale, useT } from "../../lib/i18n";
import type {
  SetupCapabilities,
  SetupCandidate,
  SetupInspection,
  SetupJob,
} from "../../lib/hermes/setup/types";
import {
  setupCopy,
  setupError,
  setupStep,
  setupHostError,
  setupWarning,
  setupProgress,
  isSetupWarningBlocking,
} from "./setup-copy";
import { PLUGIN_PIN_SHORT, PLUGIN_VERSION } from "../../lib/hermes/setup/pin";

const API = "/api/gateways/setup";
// 고정 커밋·버전은 손으로 베끼지 않는다 — pin.ts 가 정본이고 pin.test.ts 가 호스트 스크립트와 대조한다.
const PINNED_PLUGIN_COMMIT = PLUGIN_PIN_SHORT;
const PINNED_PLUGIN_VERSION = PLUGIN_VERSION;
const button =
  "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50";
const secondary =
  "rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface-raised disabled:opacity-50";
const input =
  "w-full rounded border border-border bg-bg px-3 py-2 text-text focus:outline-none focus:border-primary";
type Screen = "choice" | "remote" | "ssh" | "discover" | "review" | "job" | "url" | "success";
// 계약 2 가 더한 필드들. types.ts 는 호스트 담당이 소유하므로 여기서는 넓혀서만 읽는다.
// 계약 3 이 더한 progress/completed 도 같은 이유로 여기서 넓혀 읽는다.
type WizardJob = SetupJob & {
  warnings?: string[];
  installerDigest?: string;
  progress?: string;
  completed?: string[];
};
// 재개해도 상태가 바뀔 수 있어 언제나 다시 도는 단계다 — "건너뜀" 으로 그리지 않는다.
const ALWAYS_RERUN = new Set(["verifying_gateway", "checking_model"]);
type ModelState = "ready" | "missing" | "unknown";
type WizardCapabilities = SetupCapabilities & { canInstallHermes?: boolean };
// 계약: ^[a-z0-9][a-z0-9_-]{0,63}$ — 서버가 다시 검증하지만 화면에서 먼저 안내한다.
const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PROFILE_DESCRIPTION_MAX = 200;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export default function GatewaySetupWizard({
  onConnected,
}: {
  onConnected: (gatewayId: string) => void;
}) {
  const { locale } = useLocale();
  const t = useT();
  const c = setupCopy[locale];
  const errorMessage = (code: unknown) => setupHostError(locale, code) ?? setupError(c, code);
  const [cap, setCap] = useState<WizardCapabilities | null>(null);
  const [screen, setScreen] = useState<Screen>("choice");
  const [mode, setMode] = useState<"local" | "ssh">("local");
  const [hostId, setHostId] = useState("");
  const [candidates, setCandidates] = useState<SetupCandidate[]>([]);
  const [inspection, setInspection] = useState<SetupInspection | null>(null);
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);
  const [job, setJob] = useState<WizardJob | null>(null);
  // 잡이 성공해도 남는 경고다 — 실패와 섞지 않고 성공 화면까지 들고 간다.
  const [warnings, setWarnings] = useState<string[]>([]);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileDescription, setNewProfileDescription] = useState("");
  const [provisionKeys, setProvisionKeys] = useState<string[]>([]);
  // 서버에서 외부 스크립트를 돌리는 일이라 기본은 꺼짐이다(시간대 제안과 다르다).
  const [installConsent, setInstallConsent] = useState(false);
  const [installerDigest, setInstallerDigest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [errorCode, setErrorCode] = useState<unknown>(null);
  // 명시적으로 확인한 모델 상태. null 이면 아직 확인하지 않았다는 뜻이라 기존 경고 규칙을 따른다.
  const [modelState, setModelState] = useState<ModelState | null>(null);
  const [modelChecking, setModelChecking] = useState(false);
  // 마지막으로 연결을 시도한 후보와 prepare 본문 — 다시 확인과 이어서 실행이 쓴다.
  const [lastCandidateId, setLastCandidateId] = useState<string | null>(null);
  const [lastPrepare, setLastPrepare] = useState<Record<string, unknown> | null>(null);
  // 이어서 실행할 때 건너뛰기로 한 단계들(요청 시점의 completed).
  const [skippedSteps, setSkippedSteps] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<{ gatewayId: string; pluginStatus: string } | null>(null);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [displayName, setDisplayName] = useState("");
  // Read once: the browser's own zone is the only time-zone source the wizard has.
  const [browserTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
      return "";
    }
  });
  const [sendTimezone, setSendTimezone] = useState(true);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);

  async function request<T>(body?: object, suffix = "", signal?: AbortSignal): Promise<T> {
    const res = await fetch(
      API + suffix,
      body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal,
          }
        : { signal },
    );
    const data = await res.json();
    if (!res.ok) throw { errorCode: data.errorCode ?? "setup_failed" };
    return data;
  }
  useEffect(() => {
    const abort = new AbortController();
    request<WizardCapabilities>(undefined, "", abort.signal)
      .then(setCap)
      .catch(() => {
        if (!abort.signal.aborted) setErrorCode("setup_failed");
      });
    return () => {
      abort.abort();
      controller.current?.abort();
      // This counter invalidates pending requests; it is not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
    };
  }, []);

  function navigate(next: Screen) {
    generation.current++;
    controller.current?.abort();
    setBusy(false);
    setErrorCode(null);
    setScreen(next);
    setToken("");
  }
  async function run<T>(job: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void) {
    const epoch = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setErrorCode(null);
    try {
      const value = await job(abort.signal);
      if (epoch === generation.current) apply(value);
    } catch (error) {
      if (epoch === generation.current && !abort.signal.aborted)
        setErrorCode((error as { errorCode?: string })?.errorCode ?? "setup_failed");
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  }
  function discover(targetMode = mode) {
    setMode(targetMode);
    setScreen("discover");
    setCandidates([]);
    setInspection(null);
    setJob(null);
    setNewProfileName("");
    setNewProfileDescription("");
    setProvisionKeys([]);
    setModelState(null);
    setSkippedSteps([]);
    void run(
      (signal) =>
        request<{ candidates: SetupCandidate[] }>(
          { action: "discover", mode: targetMode, ...(targetMode === "ssh" ? { hostId } : {}) },
          "",
          signal,
        ),
      (data) => setCandidates(data.candidates),
    );
  }
  const target = { mode, ...(mode === "ssh" ? { hostId } : {}) };
  function inspect(candidateId: string) {
    void run(
      (signal) =>
        request<SetupInspection>({ action: "inspect", ...target, candidateId }, "", signal),
      (data) => {
        setInspection(data);
        setLastCandidateId(candidateId);
        setProvisionKeys([]);
        setSelectedProfiles(
          (data.profiles ?? [])
            .filter((profile) => profile.hasToken || profile.canProvision)
            .map((profile) => profile.name),
        );
        setScreen("review");
      },
    );
  }
  function acceptJob(next: WizardJob) {
    setJob(next);
    setWarnings(strings(next.warnings));
    if (typeof next.installerDigest === "string" && next.installerDigest)
      setInstallerDigest(next.installerDigest);
    if (next.status !== "running") setCancelling(false);
    if (next.status !== "succeeded") return;
    if (next.gatewayId) {
      setResult({ gatewayId: next.gatewayId, pluginStatus: "plugin_ready" });
      setScreen("success");
      return;
    }
    // 게이트웨이 없이 끝난 잡은 설치만 한 잡이다. 잡 화면에 끝났다고 알리고,
    // 이어 가는 것은 사용자가 "다시 확인" 으로 고른다(자동 재검색은 폴링 효과를 재생성한다).
    setInstallConsent(false);
  }
  useEffect(() => {
    if (screen !== "job" || job?.status !== "running") return;
    const abort = new AbortController();
    const epoch = generation.current;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await request<{ job: WizardJob }>(
          undefined,
          `?job=${encodeURIComponent(job.id)}`,
          abort.signal,
        );
        if (!abort.signal.aborted && epoch === generation.current) {
          setErrorCode(null);
          acceptJob(data.job);
        }
      } catch (error) {
        if (!abort.signal.aborted && epoch === generation.current)
          setErrorCode((error as { errorCode?: string }).errorCode ?? "setup_failed");
      }
      if (!abort.signal.aborted) timer = setTimeout(poll, 1200);
    };
    timer = setTimeout(poll, 500);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [screen, job?.id, job?.status]);

  // 설치는 3~6분 걸린다. 초를 세어 주지 않으면 화면이 멈춘 것처럼 보인다.
  const installingHermes =
    screen === "job" && job?.status === "running" && job.steps.at(-1) === "installing_hermes";
  useEffect(() => {
    if (!installingHermes) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    // 단계가 끝나거나 화면을 떠나면 반드시 멈춘다 — 남으면 매초 리렌더가 샌다.
    return () => clearInterval(timer);
  }, [installingHermes]);

  // 잡을 만들지 않는 즉시 응답이다. 폴링하지 않고 판정만 받아 경고를 갱신한다.
  function checkModel(candidateId: string) {
    const epoch = generation.current;
    const abort = new AbortController();
    setModelChecking(true);
    void request<{ model?: string }>(
      { action: "check-model", ...target, candidateId },
      "",
      abort.signal,
    )
      .then((data) => {
        if (epoch !== generation.current || abort.signal.aborted) return;
        const next = data.model;
        setModelState(
          next === "ready" || next === "missing" || next === "unknown" ? next : "unknown",
        );
      })
      .catch((error) => {
        if (epoch !== generation.current || abort.signal.aborted) return;
        setErrorCode((error as { errorCode?: string })?.errorCode ?? "setup_failed");
      })
      .finally(() => {
        if (epoch === generation.current) setModelChecking(false);
      });
  }

  // prepare 본문을 들고 있어야 실패한 뒤 같은 요청에 resumeFrom 만 얹어 이어 갈 수 있다.
  function submitPrepare(body: Record<string, unknown>, resumeFrom?: string) {
    if (!resumeFrom) {
      setLastPrepare(body);
      setSkippedSteps([]);
    }
    void run(
      (signal) =>
        request<{ job: WizardJob }>(resumeFrom ? { ...body, resumeFrom } : body, "", signal),
      ({ job: next }) => {
        setScreen("job");
        acceptJob(next);
      },
    );
  }

  const card = (
    label: string,
    help: string,
    Icon: typeof Monitor,
    action: () => void,
    disabled = false,
  ) => (
    <button
      type="button"
      disabled={disabled}
      onClick={action}
      className="flex min-h-36 flex-col items-start gap-3 rounded-xl border border-border bg-bg p-5 text-left transition hover:border-primary hover:bg-primary/5 disabled:opacity-50"
    >
      <Icon aria-hidden="true" className="text-primary" size={28} />
      <span className="font-semibold">{label}</span>
      <span className="text-sm text-text-muted">{help}</span>
    </button>
  );
  const blockingWarning = inspection && isSetupWarningBlocking(inspection.candidate.warning);
  // Offer a zone only when the host has none and the browser actually knows one; never overwrite.
  const timezoneOffer =
    inspection && !inspection.candidate.timezone && browserTimezone ? browserTimezone : null;
  const changeText = (change: string) =>
    change === "installing_service"
      ? t("hermes.wizard.review.serviceInstall")
      : change === "updating_plugin"
        ? t("hermes.wizard.review.pluginUpdate", { version: PINNED_PLUGIN_VERSION })
        : change === "setting_timezone" && (inspection?.candidate.timezone || browserTimezone)
          ? t("hermes.wizard.review.timezone", {
              timezone: inspection?.candidate.timezone || browserTimezone,
            })
          : setupStep(c, change);
  // 설치는 로컬 대상에서만, 그리고 운영자가 게이트를 켰을 때만 제안한다.
  const installOffered = mode === "local" && !busy && !candidates.length;
  const canInstallHermes = cap?.canInstallHermes === true;
  const trimmedProfileName = newProfileName.trim();
  const profileNameValid = !trimmedProfileName || PROFILE_NAME.test(trimmedProfileName);
  // 확인이 경고를 이긴다: ready 면 지우고, missing 이면 (없더라도) 붙인다. unknown 은 기존 규칙 그대로.
  const effectiveWarnings =
    modelState === "ready"
      ? warnings.filter((code) => code !== "model_provider_required")
      : modelState === "missing" && !warnings.includes("model_provider_required")
        ? [...warnings, "model_provider_required"]
        : warnings;
  const modelNote =
    modelState === "unknown"
      ? t("hermes.wizard.model.unknown")
      : modelState === "ready"
        ? t("hermes.wizard.model.ready")
        : null;
  const modelRecheck = lastCandidateId ? (
    <div className="space-y-2">
      {modelNote && (
        <p
          role="status"
          className="rounded-lg border border-border bg-bg p-3 text-sm text-text-muted"
        >
          {modelNote}
        </p>
      )}
      <button
        type="button"
        className={secondary}
        disabled={modelChecking}
        onClick={() => checkModel(lastCandidateId)}
      >
        {modelChecking ? t("hermes.wizard.model.checking") : t("hermes.wizard.model.recheck")}
      </button>
    </div>
  ) : null;
  const warningBanner = effectiveWarnings.length ? (
    <div className="space-y-2">
      {effectiveWarnings.map((code) => {
        const message = setupWarning(locale, code);
        return message ? (
          <p
            key={code}
            role="status"
            className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm text-text"
          >
            {message}
          </p>
        ) : null;
      })}
    </div>
  ) : null;
  const digestLine = installerDigest ? (
    <p className="break-all text-xs text-text-muted">
      {t("hermes.wizard.install.digest", { digest: installerDigest })}
    </p>
  ) : null;
  const pluginLabel =
    inspection &&
    (inspection.pluginStatus === "plugin_unauthorized"
      ? c.unauthorized
      : inspection.pluginStatus === "plugin_ready"
        ? c.ready
        : !inspection.candidate.pluginInstalled
          ? c.pluginAbsent
          : !inspection.candidate.pluginEnabled
            ? c.disabled
            : inspection.candidate.warning === "gateway_unreachable"
              ? c.unreachable
              : ["pending_restart", "plugin_pending_restart"].includes(
                    inspection.candidate.warning ?? "",
                  )
                ? c.pending
                : c.unknown);

  return (
    <section className="rounded-xl border border-border bg-surface p-5" aria-label={c.title}>
      <h2 className="text-xl font-semibold">{c.title}</h2>
      {screen !== "choice" && screen !== "job" && screen !== "success" && (
        <button
          type="button"
          className={`${secondary} mt-4`}
          disabled={busy && (screen === "review" || screen === "url")}
          onClick={() =>
            navigate(
              screen === "remote" ||
                ((screen === "discover" || screen === "review") && mode === "local")
                ? "choice"
                : "remote",
            )
          }
        >
          {c.back}
        </button>
      )}
      {errorCode != null && (
        <p role="alert" className="mt-4 rounded-lg border border-danger/30 p-3 text-sm text-danger">
          {errorMessage(errorCode)}
        </p>
      )}
      {screen === "choice" && (
        <>
          <p className="my-4 text-text-muted">{c.intro}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {card(c.local, c.localHelp, Monitor, () => discover("local"), !cap?.local)}
            {card(c.remote, c.remoteHelp, Globe, () => navigate("remote"))}
          </div>
          {cap && !cap.local && <p className="mt-3 text-sm text-text-muted">{c.unavailable}</p>}
          {!cap && !errorCode && (
            <p role="status" className="mt-3">
              {c.loading}
            </p>
          )}
        </>
      )}
      {screen === "remote" && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {card(c.ssh, c.sshHelp, Terminal, () => navigate("ssh"), !cap?.ssh)}
          {card(c.url, c.urlHelp, Server, () => navigate("url"))}
        </div>
      )}
      {screen === "ssh" && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-text-muted">{c.sshHelp}</p>
          <label className="block text-sm font-semibold">
            {c.host}
            <select
              value={hostId}
              onChange={(e) => setHostId(e.target.value)}
              className={`${input} mt-2`}
            >
              <option value="">{c.chooseHost}</option>
              {cap?.sshHosts.map((host) => (
                <option key={host.id} value={host.id}>
                  {host.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className={button}
            disabled={!hostId || !cap?.ssh}
            onClick={() => discover("ssh")}
          >
            {c.discover}
          </button>
        </div>
      )}
      {screen === "discover" && (
        <div className="mt-4 space-y-4">
          {mode === "local" && (
            <p className="text-sm text-text-muted">
              {c.localHelp} {cap?.hostLabel}
            </p>
          )}
          {busy ? (
            <p role="status">{c.discovering}</p>
          ) : (
            <>
              {!candidates.length && <p>{c.empty}</p>}
              {installOffered &&
                (canInstallHermes ? (
                  <article className="rounded-lg border border-primary/40 bg-bg p-4">
                    <h3 className="font-semibold">{t("hermes.wizard.install.title")}</h3>
                    <p className="mt-1 text-sm text-text-muted">
                      {t("hermes.wizard.install.body")}
                    </p>
                    <label className="mt-3 flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="install-consent"
                        className="mt-1 accent-primary"
                        checked={installConsent}
                        onChange={(event) => setInstallConsent(event.target.checked)}
                      />
                      <span>{t("hermes.wizard.install.consent")}</span>
                    </label>
                    <button
                      className={`${button} mt-3`}
                      disabled={busy || !installConsent}
                      onClick={() =>
                        void run(
                          (signal) =>
                            request<{ job: WizardJob }>(
                              { action: "install-hermes", ...target },
                              "",
                              signal,
                            ),
                          ({ job: next }) => {
                            setScreen("job");
                            acceptJob(next);
                          },
                        )
                      }
                    >
                      {t("hermes.wizard.install.start")}
                    </button>
                  </article>
                ) : (
                  <div className="rounded-lg border border-border bg-bg p-4 text-sm text-text-muted">
                    <p>{t("hermes.wizard.install.unavailable")}</p>
                    <pre className="mt-3 overflow-x-auto rounded bg-surface-raised p-3 text-xs text-text">
                      {t("hermes.wizard.install.enableCommand")}
                    </pre>
                    <p className="mt-2">{t("hermes.wizard.install.enableHint")}</p>
                  </div>
                ))}
              {digestLine}
              {candidates.map((candidate) => (
                <article key={candidate.id} className="rounded-lg border border-border bg-bg p-4">
                  <h3 className="font-semibold">{candidate.label}</h3>
                  <p className="mt-1 text-sm text-text-muted">
                    Hermes {candidate.version} · {c.service}: {candidate.service} · {candidate.port}
                    {candidate.pluginVersion
                      ? ` · ${c.pluginVersion} ${candidate.pluginVersion}`
                      : ""}
                  </p>
                  <button
                    className={`${button} mt-3`}
                    disabled={busy}
                    onClick={() => inspect(candidate.id)}
                  >
                    {c.inspect}
                  </button>
                </article>
              ))}
              <button className={secondary} onClick={() => discover()}>
                {c.retry}
              </button>
            </>
          )}
        </div>
      )}
      {screen === "review" && inspection && (
        <div className="mt-4 space-y-4">
          <h3 className="font-semibold">{c.review}</h3>
          <p>{inspection.candidate.label}</p>
          <p className="text-sm">
            {c.service}: <strong>{inspection.candidate.service}</strong>
          </p>
          {inspection.candidate.pluginVersion && (
            <p className="text-xs text-text-muted">
              {c.pluginVersion}: {inspection.candidate.pluginVersion}
            </p>
          )}
          <p className="text-xs text-text-muted">
            {c.pluginRevision}: {PINNED_PLUGIN_COMMIT} ({PINNED_PLUGIN_VERSION})
          </p>
          <p role="status" className="rounded-lg bg-bg p-3 text-sm">
            {pluginLabel}
          </p>
          {blockingWarning && (
            <p role="alert" className="rounded-lg border border-danger/30 p-3 text-sm text-danger">
              {errorMessage(inspection.candidate.warning)}
            </p>
          )}
          <fieldset disabled={busy} className="space-y-3 rounded-lg border border-border p-4">
            <legend className="px-1 text-sm font-semibold">{c.selectProfiles}</legend>
            {(inspection.profiles ?? []).map((profile) => (
              <div key={profile.name} className="space-y-2">
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    name="profile"
                    className="mt-1 accent-primary"
                    disabled={!profile.hasToken && !profile.canProvision}
                    checked={selectedProfiles.includes(profile.name)}
                    onChange={(event) =>
                      setSelectedProfiles((current) =>
                        event.target.checked
                          ? [...current, profile.name]
                          : current.filter((name) => name !== profile.name),
                      )
                    }
                  />
                  <span>
                    <span className="font-medium">{profile.name}</span>
                    {!profile.hasToken && (
                      <span className="mt-1 block text-xs text-text-muted">
                        {profile.canProvision ? c.profileProvisionToken : c.profileNeedsToken}
                      </span>
                    )}
                  </span>
                </label>
                {/* 가져오기와 역할이 다르다: 이 체크는 키가 없는 프로필에 키를 새로 발급한다. */}
                {profile.canProvision && (
                  <div className="ml-7">
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="provision"
                        className="mt-1 accent-primary"
                        checked={provisionKeys.includes(profile.name)}
                        onChange={(event) =>
                          setProvisionKeys((current) =>
                            event.target.checked
                              ? [...current, profile.name]
                              : current.filter((name) => name !== profile.name),
                          )
                        }
                      />
                      <span>{t("hermes.wizard.profile.provisionLabel")}</span>
                    </label>
                    <p className="mt-1 text-xs text-text-muted">
                      {t("hermes.wizard.profile.provisionHint")}
                    </p>
                  </div>
                )}
              </div>
            ))}
            <p className="text-sm" aria-live="polite">
              {c.selectedProfiles}: {selectedProfiles.length}
            </p>
            {selectedProfiles.length === 0 && (
              <p className="text-sm text-text-muted">{c.noSelectedProfiles}</p>
            )}
          </fieldset>
          <fieldset disabled={busy} className="space-y-3 rounded-lg border border-border p-4">
            <legend className="px-1 text-sm font-semibold">
              {t("hermes.wizard.profile.newTitle")}
            </legend>
            <label className="block text-sm font-semibold">
              {t("hermes.wizard.profile.nameLabel")}
              <input
                className={`${input} mt-1`}
                type="text"
                name="new-profile-name"
                autoComplete="off"
                maxLength={64}
                value={newProfileName}
                onChange={(event) => setNewProfileName(event.target.value)}
              />
            </label>
            <p className="text-xs text-text-muted">{t("hermes.wizard.profile.nameHint")}</p>
            {!profileNameValid && (
              <p role="alert" className="text-xs text-danger">
                {t("hermes.wizard.error.profileNameInvalid")}
              </p>
            )}
            <label className="block text-sm font-semibold">
              {t("hermes.wizard.profile.descriptionLabel")}
              <input
                className={`${input} mt-1`}
                type="text"
                name="new-profile-description"
                autoComplete="off"
                maxLength={PROFILE_DESCRIPTION_MAX}
                value={newProfileDescription}
                onChange={(event) => setNewProfileDescription(event.target.value)}
              />
            </label>
            <p className="text-xs text-text-muted">{t("hermes.wizard.profile.descriptionHint")}</p>
          </fieldset>
          <h4 className="font-semibold">{c.changes}</h4>
          {inspection.changes.length || timezoneOffer ? (
            <ul className="list-inside list-disc text-sm">
              {inspection.changes
                .filter((change) => !(change === "setting_timezone" && timezoneOffer))
                .map((change, index) => (
                  <li key={index}>{changeText(change)}</li>
                ))}
              {timezoneOffer && (
                <li>
                  {t("hermes.wizard.review.timezone", { timezone: timezoneOffer })}
                  <label className="mt-1 flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1 accent-primary"
                      disabled={busy}
                      checked={sendTimezone}
                      onChange={(event) => setSendTimezone(event.target.checked)}
                    />
                    <span>{c.reviewTimezoneToggle}</span>
                  </label>
                </li>
              )}
            </ul>
          ) : (
            <p className="text-sm">{c.noChanges}</p>
          )}
          <button
            className={button}
            disabled={
              busy ||
              !profileNameValid ||
              !!blockingWarning ||
              inspection.pluginStatus === "plugin_unauthorized"
            }
            onClick={() =>
              submitPrepare({
                action: "prepare",
                ...target,
                candidateId: inspection.candidate.id,
                profiles: selectedProfiles,
                ...(timezoneOffer && sendTimezone ? { timezone: timezoneOffer } : {}),
                ...(trimmedProfileName
                  ? {
                      createProfile: {
                        name: trimmedProfileName,
                        ...(newProfileDescription.trim()
                          ? { description: newProfileDescription.trim() }
                          : {}),
                      },
                    }
                  : {}),
                ...(provisionKeys.length ? { provisionKeys } : {}),
              })
            }
          >
            {busy ? c.loading : inspection.changes.length || timezoneOffer ? c.prepare : c.verify}
          </button>
          <button
            className={`${secondary} ml-2`}
            disabled={busy}
            onClick={() => inspect(inspection.candidate.id)}
          >
            {c.retry}
          </button>
        </div>
      )}
      {screen === "job" && job && (
        <div className="mt-4 space-y-4">
          <h3 role="status" className="font-semibold">
            {job.status === "running"
              ? c.running
              : job.status === "cancelled"
                ? c.cancelled
                : job.status === "succeeded"
                  ? t("hermes.wizard.install.done")
                  : c.failed}
          </h3>
          <ol className="list-inside list-decimal space-y-2 text-sm" aria-live="polite">
            {job.steps.map((step, index) => (
              <li key={index}>
                {setupStep(c, step)}
                {skippedSteps.includes(step) && !ALWAYS_RERUN.has(step)
                  ? ` (${t("hermes.wizard.resume.skipped")})`
                  : ""}
              </li>
            ))}
          </ol>
          {/* 모르는 이정표 코드는 undefined 로 와서 아무것도 그리지 않는다. */}
          {setupProgress(locale, job.progress) && (
            <p className="text-sm text-text-muted" aria-live="polite">
              {setupProgress(locale, job.progress)}
            </p>
          )}
          {installingHermes && (
            <p className="text-sm text-text-muted" aria-live="polite">
              {t("hermes.wizard.progress.elapsed", { seconds: String(elapsed) })}
            </p>
          )}
          {job.status === "failed" && strings(job.completed).length > 0 && (
            <div className="rounded-lg border border-border bg-bg p-3">
              <h4 className="text-sm font-semibold">{t("hermes.wizard.resume.title")}</h4>
              <ul className="mt-1 list-inside list-disc text-sm text-text-muted">
                {strings(job.completed).map((step, index) => (
                  <li key={index}>{setupStep(c, step)}</li>
                ))}
              </ul>
            </div>
          )}
          {warningBanner}
          {digestLine}
          {job.error && (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(job.error)}
            </p>
          )}
          {job.status === "running" ? (
            <>
              <p className="text-xs text-text-muted">{c.cancelHelp}</p>
              <button
                className={secondary}
                disabled={cancelling}
                onClick={() => {
                  setCancelling(true);
                  const epoch = generation.current;
                  const abort = new AbortController();
                  controller.current = abort;
                  void request<{ job: WizardJob }>(
                    { action: "cancel", jobId: job.id },
                    "",
                    abort.signal,
                  )
                    .then(({ job: next }) => {
                      if (epoch === generation.current && !abort.signal.aborted) acceptJob(next);
                    })
                    .catch((error) => {
                      if (epoch !== generation.current || abort.signal.aborted) return;
                      setCancelling(false);
                      setErrorCode(error.errorCode ?? "setup_failed");
                    });
                }}
              >
                {cancelling ? c.cancelling : c.cancel}
              </button>
            </>
          ) : (
            <div className="space-y-3">
              <div>
                {job.status === "failed" && lastPrepare && (
                  <button
                    className={`${button} mr-2`}
                    disabled={busy}
                    onClick={() => {
                      setSkippedSteps(strings(job.completed));
                      submitPrepare(lastPrepare, job.id);
                    }}
                  >
                    {t("hermes.wizard.resume.button")}
                  </button>
                )}
                <button className={button} onClick={() => discover()}>
                  {c.retry}
                </button>
              </div>
              {modelRecheck}
            </div>
          )}
        </div>
      )}
      {screen === "url" && (
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              (signal) =>
                request<{ gatewayId: string; pluginStatus: string }>(
                  {
                    action: "connect-url",
                    url: url.trim(),
                    token: token.trim(),
                    displayName: displayName.trim(),
                  },
                  "",
                  signal,
                ),
              (data) => {
                setToken("");
                setResult(data);
                setScreen("success");
              },
            );
          }}
        >
          {[
            [c.name, displayName, setDisplayName, "text"],
            [c.address, url, setUrl, "url"],
            [c.token, token, setToken, "password"],
          ].map(([label, value, setter, type]) => (
            <label key={String(label)} className="block text-sm font-semibold">
              {String(label)}
              <input
                className={`${input} mt-1`}
                type={String(type)}
                value={String(value)}
                required
                autoComplete={type === "password" ? "new-password" : "off"}
                onChange={(event) => (setter as (value: string) => void)(event.target.value)}
              />
            </label>
          ))}
          <button
            className={button}
            disabled={busy || !displayName.trim() || !url.trim() || !token.trim()}
          >
            {busy ? c.loading : c.connect}
          </button>
        </form>
      )}
      {screen === "success" && result && (
        <div className="mt-4 space-y-4">
          {warningBanner}
          {modelRecheck}
          {digestLine}
          {result.pluginStatus === "plugin_ready" ? (
            <>
              <p role="status">{c.connected}</p>
              <a
                className={`${button} inline-block`}
                href={`/profiles?gateway=${encodeURIComponent(result.gatewayId)}`}
                onClick={() => onConnected(result.gatewayId)}
              >
                {c.profiles}
              </a>
            </>
          ) : (
            <>
              <p role="status">
                {result.pluginStatus === "plugin_absent"
                  ? c.absent
                  : result.pluginStatus === "plugin_unauthorized"
                    ? c.unauthorized
                    : c.unknown}
              </p>
              <button className={button} disabled={!cap?.ssh} onClick={() => navigate("ssh")}>
                {c.installSsh}
              </button>
              <a
                className="ml-3 text-sm font-semibold text-primary underline"
                href="https://github.com/dandacompany/deskrpg-hermes-plugin#readme"
                target="_blank"
                rel="noreferrer"
              >
                {c.guide}
              </a>
              {!cap?.ssh && <p className="text-sm text-text-muted">{c.unavailable}</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
