"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Search } from "lucide-react";

import { useT } from "@/lib/i18n";
import type { HubPreview, HubSearchResult } from "@/lib/hermes/plugin-client-types";

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

/**
 * Hub 검색·직접 URL 로 스킬을 설치한다. 결과 → 미리보기(스캔 판정·신뢰 등급·실행 코드 포함 여부) → 설치 → 진행.
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
  const [preview, setPreview] = useState<HubPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const job = useSkillJob(api, { intervalMs: pollIntervalMs });
  const reported = useRef(false);

  // 모드가 바뀌면 앞 모드의 결과·미리보기를 버린다.
  useEffect(() => {
    setQ("");
    setResults(null);
    setPreview(null);
    setError(null);
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

  const guard = async (action: () => Promise<void>) => {
    setLoading(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(skillErrorText(t, e));
    } finally {
      setLoading(false);
    }
  };
  const open = (identifier: string) =>
    guard(async () => {
      setConfirmed(false);
      setPreview(await api.hubPreview(identifier));
    });
  const go = () =>
    guard(async () => {
      const value = q.trim();
      if (!value) return;
      if (mode === "hub") {
        setPreview(null);
        setResults(await api.hubSearch(value));
      } else {
        await open(value);
      }
    });
  const install = async () => {
    if (!preview) return;
    await job.start("hub", () => api.hubInstall(preview.identifier, preview.policy === "ask"));
  };

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
          disabled={loading}
          className="flex items-center gap-1 rounded px-3 py-1 text-primary hover:bg-surface-raised disabled:opacity-50"
        >
          <Search className="h-3.5 w-3.5" />
          {mode === "hub" ? t("skills.hub.search") : t("skills.hub.preview")}
        </button>
      </form>
      {error && <p className="text-xs text-danger">{error}</p>}
      {mode === "hub" && results && (
        <ul className="flex max-w-xl flex-col gap-1">
          {results.length === 0 && <li className="text-text-dim">{t("skills.hub.noResults")}</li>}
          {results.map((r) => (
            <li key={r.identifier}>
              <button
                type="button"
                data-hub={r.identifier}
                onClick={() => void open(r.identifier)}
                className={`w-full rounded px-2 py-1 text-left hover:bg-surface-raised ${
                  preview?.identifier === r.identifier ? "text-primary" : "text-text"
                }`}
              >
                {r.name}{" "}
                <span className="text-xs text-text-muted">
                  · {r.source} · {r.trustLevel}
                </span>
                {r.description && (
                  <span className="block truncate text-xs text-text-dim">{r.description}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {preview && (
        <section className="rounded border border-border bg-surface p-3">
          <h4 className="font-semibold text-text">{preview.name}</h4>
          {preview.description && <p className="text-xs text-text-muted">{preview.description}</p>}
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
          {job.state !== "idle" && (
            <div data-job-state={job.state} className="mt-2 text-xs text-text">
              {t(`skills.job.${job.state}`)}
              {job.state === "failed" && job.job?.outputTail && (
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-surface-raised p-2 text-text-muted">
                  {job.job.outputTail}
                </pre>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
