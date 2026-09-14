"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, Monitor, Server, Terminal } from "lucide-react";
import { useLocale } from "../../lib/i18n";
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
  isSetupWarningBlocking,
} from "./setup-copy";

const API = "/api/gateways/setup";
const button =
  "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50";
const secondary =
  "rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface-raised disabled:opacity-50";
const input =
  "w-full rounded border border-border bg-bg px-3 py-2 text-text focus:outline-none focus:border-primary";
type Screen = "choice" | "remote" | "ssh" | "discover" | "review" | "job" | "url" | "success";

export default function GatewaySetupWizard({
  onConnected,
}: {
  onConnected: (gatewayId: string) => void;
}) {
  const { locale } = useLocale();
  const c = setupCopy[locale];
  const errorMessage = (code: unknown) => setupHostError(locale, code) ?? setupError(c, code);
  const [cap, setCap] = useState<SetupCapabilities | null>(null);
  const [screen, setScreen] = useState<Screen>("choice");
  const [mode, setMode] = useState<"local" | "ssh">("local");
  const [hostId, setHostId] = useState("");
  const [candidates, setCandidates] = useState<SetupCandidate[]>([]);
  const [inspection, setInspection] = useState<SetupInspection | null>(null);
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);
  const [job, setJob] = useState<SetupJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [errorCode, setErrorCode] = useState<unknown>(null);
  const [result, setResult] = useState<{ gatewayId: string; pluginStatus: string } | null>(null);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [displayName, setDisplayName] = useState("");
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
    request<SetupCapabilities>(undefined, "", abort.signal)
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
        setSelectedProfiles(
          (data.profiles ?? [])
            .filter((profile) => profile.hasToken || profile.canProvision)
            .map((profile) => profile.name),
        );
        setScreen("review");
      },
    );
  }
  function acceptJob(next: SetupJob) {
    setJob(next);
    if (next.status !== "running") setCancelling(false);
    if (next.status === "succeeded" && next.gatewayId) {
      setResult({ gatewayId: next.gatewayId, pluginStatus: "plugin_ready" });
      setScreen("success");
    }
  }
  useEffect(() => {
    if (screen !== "job" || job?.status !== "running") return;
    const abort = new AbortController();
    const epoch = generation.current;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await request<{ job: SetupJob }>(
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
              {candidates.map((candidate) => (
                <article key={candidate.id} className="rounded-lg border border-border bg-bg p-4">
                  <h3 className="font-semibold">{candidate.label}</h3>
                  <p className="mt-1 text-sm text-text-muted">
                    Hermes {candidate.version} · {c.service}: {candidate.service} · {candidate.port}
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
          <p className="text-xs text-text-muted">{c.pluginRevision}: 9e200eb1d241</p>
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
              <label key={profile.name} className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
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
            ))}
            <p className="text-sm" aria-live="polite">
              {c.selectedProfiles}: {selectedProfiles.length}
            </p>
            {selectedProfiles.length === 0 && (
              <p className="text-sm text-text-muted">{c.noSelectedProfiles}</p>
            )}
          </fieldset>
          <h4 className="font-semibold">{c.changes}</h4>
          {inspection.changes.length ? (
            <ul className="list-inside list-disc text-sm">
              {inspection.changes.map((change, index) => (
                <li key={index}>{setupStep(c, change)}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">{c.noChanges}</p>
          )}
          <button
            className={button}
            disabled={
              busy || !!blockingWarning || inspection.pluginStatus === "plugin_unauthorized"
            }
            onClick={() =>
              void run(
                (signal) =>
                  request<{ job: SetupJob }>(
                    {
                      action: "prepare",
                      ...target,
                      candidateId: inspection.candidate.id,
                      profiles: selectedProfiles,
                    },
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
            {busy ? c.loading : inspection.changes.length ? c.prepare : c.verify}
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
                : c.failed}
          </h3>
          <ol className="list-inside list-decimal space-y-2 text-sm" aria-live="polite">
            {job.steps.map((step, index) => (
              <li key={index}>{setupStep(c, step)}</li>
            ))}
          </ol>
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
                  void request<{ job: SetupJob }>(
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
            <button className={button} onClick={() => discover()}>
              {c.retry}
            </button>
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
