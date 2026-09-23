"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Search } from "lucide-react";

import { useT } from "@/lib/i18n";
import type { HubPreview, HubSearchResult } from "@/lib/hermes/plugin-client-types";

import { sortHubResults } from "./hub-results";
import { skillErrorText } from "./skill-error-text";
import type { SkillsApi } from "./skills-api";
import { useSkillJob } from "./use-skill-job";

export type SkillAddPaneProps = {
  api: SkillsApi;
  mode: "hub" | "url";
  /** 설치 작업이 끝났다(성공·실패·결과 불명) — 목록을 다시 읽는다. */
  onInstalled(): void;
  /** 작업 폴링 간격(ms). 테스트에서 줄인다. */
  pollIntervalMs?: number;
};

/** 고른 항목의 미리보기 요청 상태. 성공하면 `preview` 로 옮기고 이것은 비운다. */
type Pending = { identifier: string; error: string | null };

/**
 * Hub 검색·직접 URL 로 스킬을 설치한다. 결과(왼쪽, 신뢰 등급 순) → 미리보기(오른쪽 — 스캔 판정·신뢰 등급·실행 코드 포함 여부)
 * → 설치 → 진행. 좁은 화면에서는 미리보기가 목록 위로 오고, 열릴 때 화면 안으로 스크롤한다.
 * 미리보기는 수 초 걸린다(플러그인이 저장소를 받아 스캔한다) — 불러오는 중을 보이고, 그사이 다른 항목을 누르면 앞 응답은 버린다.
 * Hermes 가 막는 조합(`policy: block`)은 설치 버튼을 그리지 않고, 주의(`ask`)는 확인을 받은 뒤 `force` 로 보낸다.
 */
export default function SkillAddPane({
  api,
  mode,
  onInstalled,
  pollIntervalMs,
}: SkillAddPaneProps) {
  const t = useT();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<HubSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [preview, setPreview] = useState<HubPreview | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [installedFor, setInstalledFor] = useState<string | null>(null);
  const job = useSkillJob(api, { intervalMs: pollIntervalMs });
  const reported = useRef(false);
  const previewSeq = useRef(0);
  const previewRef = useRef<HTMLElement | null>(null);

  // 모드가 바뀌면 앞 모드의 결과·미리보기를 버린다(늦게 올 미리보기도).
  useEffect(() => {
    previewSeq.current += 1;
    setQ("");
    setResults(null);
    setPreview(null);
    setPending(null);
    setSearchError(null);
  }, [mode]);

  // 작업이 끝나면(성공·실패·결과 불명) 한 번만 목록을 다시 읽게 한다.
  useEffect(() => {
    if (job.state === "running") reported.current = false;
    else if (
      !reported.current &&
      (job.state === "succeeded" || job.state === "failed" || job.state === "unknown")
    ) {
      reported.current = true;
      onInstalled();
    }
  }, [job.state, onInstalled]);

  // 미리보기(또는 그 로딩)가 시작되면 그 칸을 보이게 한다 — 긴 결과 목록 아래에 묻히지 않게.
  const focusKey = pending?.identifier ?? preview?.identifier ?? null;
  useEffect(() => {
    if (focusKey) previewRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [focusKey]);

  const open = async (identifier: string) => {
    const seq = ++previewSeq.current;
    setPending({ identifier, error: null });
    setPreview(null);
    setConfirmed(false);
    try {
      const next = await api.hubPreview(identifier);
      if (seq !== previewSeq.current) return;
      setPreview(next);
      setPending(null);
    } catch (e) {
      if (seq !== previewSeq.current) return;
      setPending({ identifier, error: skillErrorText(t, e) });
    }
  };
  const go = async () => {
    const value = q.trim();
    if (!value) return;
    if (mode === "url") {
      await open(value);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const found = await api.hubSearch(value);
      setResults(sortHubResults(found));
    } catch (e) {
      setSearchError(skillErrorText(t, e));
    } finally {
      setSearching(false);
    }
  };
  const install = async () => {
    if (!preview) return;
    setInstalledFor(preview.identifier);
    await job.start("hub", () => api.hubInstall(preview.identifier, preview.policy === "ask"));
  };

  const selected = pending?.identifier ?? preview?.identifier ?? null;
  const showJob = job.state !== "idle" && preview !== null && installedFor === preview.identifier;

  const previewPane = (
    <section
      ref={previewRef}
      data-pane="hub-preview"
      className="order-1 min-w-0 scroll-mt-2 self-start rounded border border-border bg-surface p-3 lg:sticky lg:top-0 lg:order-2"
    >
      {pending && !pending.error && (
        <p
          data-preview-state="loading"
          className="flex items-center gap-1.5 text-xs text-text-muted"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("skills.hub.loadingPreview")}
        </p>
      )}
      {pending?.error && (
        <div data-preview-state="error" className="text-xs">
          <p className="text-danger">{pending.error}</p>
          <button
            type="button"
            data-action="preview-retry"
            onClick={() => void open(pending.identifier)}
            className="mt-1 text-primary"
          >
            {t("skills.hub.retry")}
          </button>
        </div>
      )}
      {!pending && !preview && (
        <p className="text-xs text-text-dim">{t("skills.hub.pickResult")}</p>
      )}
      {preview && (
        <>
          <h4 className="font-semibold text-text">{preview.name}</h4>
          <p className="break-all font-mono text-[11px] text-text-dim">{preview.identifier}</p>
          {preview.description && (
            <p className="mt-1 text-xs text-text-muted">{preview.description}</p>
          )}
          <p className="mt-1 text-xs text-text-muted">
            {t("skills.hub.verdict", { verdict: preview.verdict, trust: preview.trustLevel })}
          </p>
          {preview.hasScripts && (
            <p className="mt-1 flex items-center gap-1 text-xs text-danger">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t("skills.hub.hasScripts")}
            </p>
          )}
          <p className="mt-1 break-words text-xs text-text-dim">{preview.files.join(" · ")}</p>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-raised p-2 text-xs text-text">
            {preview.skillMd}
          </pre>
          {preview.policy === "block" && (
            <p className="mt-2 text-xs text-danger">
              {t("skills.hub.blocked", { reason: preview.policyReason || preview.verdict })}
            </p>
          )}
          {preview.policy === "ask" && (
            <label className="mt-2 flex items-center gap-2 text-xs text-text">
              <input
                type="checkbox"
                data-action="caution-confirm"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              {t("skills.hub.cautionConfirm")}
            </label>
          )}
          {preview.policy !== "block" && (
            <button
              type="button"
              data-action="install"
              disabled={(preview.policy === "ask" && !confirmed) || job.state === "running"}
              onClick={() => void install()}
              className="mt-2 rounded bg-primary px-3 py-1 text-white disabled:opacity-50"
            >
              {t("skills.hub.install")}
            </button>
          )}
          {showJob && (
            <div data-job-state={job.state} className="mt-2 text-xs text-text">
              {t(`skills.job.${job.state}`)}
              {job.state === "failed" && job.job?.outputTail && (
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-surface-raised p-2 text-text-muted">
                  {job.job.outputTail}
                </pre>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );

  return (
    <div className="flex flex-col gap-3 text-sm">
      <form
        className="flex max-w-xl gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          name="hub-query"
          aria-label={mode === "hub" ? t("skills.add.hub") : t("skills.add.url")}
          placeholder={mode === "hub" ? t("skills.add.hub") : "https://…"}
          className="min-w-0 flex-1 rounded bg-surface-raised px-2 py-1 text-text"
        />
        <button
          type="submit"
          data-action="hub-go"
          disabled={searching}
          className="flex items-center gap-1 rounded px-3 py-1 text-primary hover:bg-surface-raised disabled:opacity-50"
        >
          {searching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
          {mode === "hub" ? t("skills.hub.search") : t("skills.hub.preview")}
        </button>
      </form>
      {searchError && <p className="text-xs text-danger">{searchError}</p>}
      {mode === "hub"
        ? results && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <ul className="order-2 flex max-h-[60dvh] min-w-0 flex-col gap-1 overflow-y-auto lg:order-1">
                {results.length === 0 && (
                  <li className="text-text-dim">{t("skills.hub.noResults")}</li>
                )}
                {results.map((r) => (
                  <li key={r.identifier}>
                    <button
                      type="button"
                      data-hub={r.identifier}
                      aria-pressed={selected === r.identifier}
                      onClick={() => void open(r.identifier)}
                      className={`w-full rounded px-2 py-1 text-left hover:bg-surface-raised ${
                        selected === r.identifier ? "bg-surface-raised text-primary" : "text-text"
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {r.name}
                        <span className="text-xs text-text-muted">
                          · {r.source} · {r.trustLevel}
                        </span>
                        {pending?.identifier === r.identifier && !pending.error && (
                          <Loader2 className="h-3 w-3 animate-spin text-text-muted" />
                        )}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-text-dim">
                        {r.identifier}
                      </span>
                      {r.description && (
                        <span className="block truncate text-xs text-text-dim">
                          {r.description}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {previewPane}
            </div>
          )
        : (pending || preview) && <div className="max-w-2xl">{previewPane}</div>}
    </div>
  );
}
