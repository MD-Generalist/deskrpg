"use client";
/**
 * 채널 크론 화면 (R15–R19, R26, R31/R32).
 *
 * - 채널 모드: 그 채널 active NPC 프로필들의 크론 합집합 + NPC 필터·검색.
 * - 단일 NPC 모드(`npc` 지정, NPC 대화창의 크론 탭): 그 NPC 것만, 필터 없음.
 *
 * 낙관적 갱신은 없다 — 조작이 성공하면 재조회하고, 채널 소켓의 `cron:event` 가 오면
 * 재조회한다(R26). "지금 실행" 은 202 를 받으면 토스트만 띄운다(R19). 브라우저는 Hermes 를
 * 직접 부르지 않는다 — 전부 `cron-api.ts` 의 `/api/channels/...` 다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutTemplate, Pause, Pencil, Play, Plus, RefreshCw, Trash2, X, Zap } from "lucide-react";
import type { Socket } from "socket.io-client";

import { useLocale, useT } from "@/lib/i18n";
import type { CronRun } from "@/lib/hermes/deskrpg-plugin-types";
import GateChecklistModal from "@/components/gateway/GateChecklistModal";
import { classifyGateFailure, isSetupBlocker, type GateBlocker } from "@/lib/gate-failure";

import { cronApi, classifyCronError, isCronApiError, type CronJobView } from "./cron-api";
import {
  formatLocalDateTime,
  jobScheduleDisplay,
  parseIsoMs,
  readOnlyReason,
  relativeTime,
  stateDotClass,
} from "./cron-schedule";
import { CronErrorNotice, TimezoneLabel } from "./cron-notices";
import CronEditorDialog, { type CronEditorSubmit } from "./CronEditorDialog";
import BlueprintGallery from "./BlueprintGallery";

export type CronPanelNpc = { npcId: string; npcName: string };

/** 채널 소켓에서 필요한 것만 — `on`/`off`. socket.io 의 `Socket` 이 그대로 들어간다. */
export type CronEventSource = {
  on(event: string, handler: (payload: unknown) => void): unknown;
  off(event: string, handler: (payload: unknown) => void): unknown;
};
// `Socket` 이 위 모양에 맞는지 컴파일 시점에 고정한다 — 배선 쪽이 소켓을 그대로 넘긴다.
type AssertSocketFits = Socket extends CronEventSource ? true : never;
const _socketFits: AssertSocketFits = true;
void _socketFits;

export const CRON_SOCKET_EVENT = "cron:event";

export interface CronPanelProps {
  channelId: string;
  /** 채널의 active NPC — 필터·담당 NPC 후보. 단일 모드에서는 `npc` 하나면 된다. */
  npcs: CronPanelNpc[];
  /** 단일 NPC 모드: 이 NPC 의 크론만 보이고 NPC 필터가 없다. */
  npc?: CronPanelNpc | null;
  /** 채널 소켓. `cron:event` 를 받으면 재조회한다. 없으면 수동 새로고침만. */
  socket?: CronEventSource | null;
  /** 토스트 — 없으면 패널 안에 잠깐 띄운다. */
  onToast?: (message: string) => void;
  /** 있으면 헤더에 닫기 버튼이 생긴다(모달로 띄울 때). */
  onClose?: () => void;
  className?: string;
  /** 열자마자 이 잡을 골라 실행 이력 탭을 편다 — 방 알림의 "이력 열기"(R30). 마운트 시에만 읽는다. */
  initialJobId?: string | null;
}

type DetailTab = "detail" | "runs";

const TOAST_MS = 4000;

export default function CronPanel({
  channelId,
  npcs,
  npc = null,
  socket = null,
  onToast,
  onClose,
  className = "",
  initialJobId = null,
}: CronPanelProps) {
  const t = useT();
  const { locale } = useLocale();
  const single = !!npc;
  const npcCandidates = useMemo(() => (npc ? [npc] : npcs), [npc, npcs]);

  const [jobs, setJobs] = useState<CronJobView[] | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [partialErrors, setPartialErrors] = useState<
    Array<{ npcId: string; code: string; message: string }>
  >([]);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const [filterNpcId, setFilterNpcId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialJobId);
  const [detailTab, setDetailTab] = useState<DetailTab>(initialJobId ? "runs" : "detail");
  const [runs, setRuns] = useState<CronRun[] | null>(null);
  const [runsError, setRunsError] = useState<unknown>(null);
  const [editor, setEditor] = useState<{ job: CronJobView | null } | null>(null);
  const [gallery, setGallery] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [inlineToast, setInlineToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [checklistBlocker, setChecklistBlocker] = useState<GateBlocker | null>(null);

  const toast = useCallback(
    (message: string) => {
      if (onToast) {
        onToast(message);
        return;
      }
      setInlineToast(message);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setInlineToast(null), TOAST_MS);
    },
    [onToast],
  );
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  // ---- 조회 (R26: 조작 뒤·사건 뒤 재조회) ---------------------------------
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await cronApi.listJobs(channelId, npc?.npcId ?? null);
      setJobs(res.jobs);
      setTimezone(res.timezone ?? null);
      setPartialErrors(res.errors ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err);
      setJobs((current) => current ?? []);
    } finally {
      setLoading(false);
    }
  }, [channelId, npc?.npcId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!socket) return;
    const handler = (payload: unknown) => {
      const p = payload as { channelId?: string } | null;
      if (p && typeof p.channelId === "string" && p.channelId !== channelId) return;
      void reload();
    };
    socket.on(CRON_SOCKET_EVENT, handler);
    return () => {
      socket.off(CRON_SOCKET_EVENT, handler);
    };
  }, [socket, channelId, reload]);

  // ---- 1초 틱 — 다음 실행까지 카운트다운 (R18) -------------------------------
  const hasCountdown = useMemo(
    () => (jobs ?? []).some((job) => parseIsoMs(job.next_run_at) !== null),
    [jobs],
  );
  useEffect(() => {
    if (!hasCountdown) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasCountdown]);

  // ---- 필터·검색 (R15) --------------------------------------------------------
  const visibleJobs = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (jobs ?? []).filter((job) => {
      if (!single && filterNpcId && job.npcId !== filterNpcId) return false;
      if (!needle) return true;
      return (
        job.name.toLowerCase().includes(needle) ||
        job.prompt.toLowerCase().includes(needle) ||
        job.npcName.toLowerCase().includes(needle)
      );
    });
  }, [jobs, single, filterNpcId, search]);

  const selected = useMemo(
    () => (jobs ?? []).find((job) => job.id === selectedId) ?? null,
    [jobs, selectedId],
  );

  // ---- 실행 이력 탭 --------------------------------------------------------
  useEffect(() => {
    if (!selected || detailTab !== "runs") return;
    let cancelled = false;
    setRuns(null);
    setRunsError(null);
    cronApi
      .listRuns(channelId, selected.id, selected.npcId)
      .then((res) => {
        if (!cancelled) setRuns(res.runs);
      })
      .catch((err) => {
        if (!cancelled) {
          setRuns([]);
          setRunsError(err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, selected, detailTab]);

  // ---- 조작 (R16: editable 일 때만) -----------------------------------------
  const runAction = useCallback(
    async (job: CronJobView, action: "pause" | "resume" | "run" | "delete") => {
      if (!job.editable || busy) return;
      setBusy(job.id);
      setActionError(null);
      try {
        switch (action) {
          case "pause":
            await cronApi.pauseJob(channelId, job.id, job.npcId);
            toast(t("cron.toast.paused", { name: job.name }));
            await reload();
            break;
          case "resume":
            await cronApi.resumeJob(channelId, job.id, job.npcId);
            toast(t("cron.toast.resumed", { name: job.name }));
            await reload();
            break;
          case "run":
            // R19: 202 만 받고 끝. 결과는 cron:event → 재조회.
            await cronApi.runJob(channelId, job.id, job.npcId);
            toast(t("cron.toast.runQueued", { name: job.name }));
            break;
          case "delete":
            await cronApi.deleteJob(channelId, job.id, job.npcId);
            toast(t("cron.toast.deleted", { name: job.name }));
            setSelectedId(null);
            await reload();
            break;
        }
      } catch (err) {
        setActionError(err);
      } finally {
        setBusy(null);
        setConfirmDeleteId(null);
      }
    },
    [busy, channelId, reload, t, toast],
  );

  const submitEditor = useCallback(
    async (input: CronEditorSubmit) => {
      const editing = editor?.job ?? null;
      if (editing) {
        await cronApi.updateJob(channelId, editing.id, editing.npcId, {
          name: input.name,
          prompt: input.prompt,
          schedule: input.schedule,
          deliver: input.deliver,
          model: input.model,
          provider: input.provider,
        });
        toast(t("cron.toast.updated", { name: input.name }));
      } else {
        await cronApi.createJob(channelId, {
          npcId: input.npcId,
          name: input.name,
          prompt: input.prompt,
          schedule: input.schedule,
          deliver: input.deliver,
          ...(input.model ? { model: input.model } : {}),
          ...(input.provider ? { provider: input.provider } : {}),
        });
        toast(t("cron.toast.created", { name: input.name }));
      }
      setEditor(null);
      await reload();
    },
    [channelId, editor, reload, t, toast],
  );

  const readOnlyText = (job: CronJobView): string | null => {
    const reason = readOnlyReason(job);
    return reason ? t(`cron.readOnly.${reason}`) : null;
  };

  // 배너는 `CronErrorNotice` 가 그대로 그린다 — 여기서는 그 옆에 체크리스트를 여는 버튼만
  // 붙인다. `isSetupBlocker` 가 참인 넷(gateway_not_bound·plugin_absent·plugin_unauthorized·
  // plugin_upgrade_required)일 때만 보인다 — 평범한 500·네트워크 오류에 "설정이 더 필요하다"고
  // 말하면 거짓 신호가 된다. `CronEditorDialog`·`BlueprintGallery` 의 배달처 프리로드와 같은 기준.
  const gateChecklistTrigger = (err: unknown) => {
    if (!isCronApiError(err)) return null;
    const minVersion =
      typeof err.details.minVersion === "string" ? err.details.minVersion : undefined;
    const blocker = classifyGateFailure({
      status: err.status,
      code: err.code,
      message: err.message,
      minVersion,
    });
    if (!isSetupBlocker(blocker)) return null;
    return (
      <button
        type="button"
        onClick={() => setChecklistBlocker(blocker)}
        className="ml-2 underline text-xs text-text-muted"
      >
        {t("gateChecklist.whatIsNeeded")}
      </button>
    );
  };

  const iconBtn =
    "inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-surface hover:bg-surface-raised text-text disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div
      data-testid="cron-panel"
      className={`flex flex-col min-h-0 h-full bg-bg text-text ${className}`}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-surface/80">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-sm font-bold">{t("cron.title")}</span>
          <TimezoneLabel timezone={timezone} />
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={iconBtn}
            onClick={() => void reload()}
            disabled={loading}
            title={t("cron.refresh")}
            aria-label={t("cron.refresh")}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            className={iconBtn}
            onClick={() => setGallery(true)}
            disabled={npcCandidates.length === 0}
          >
            <LayoutTemplate className="w-3.5 h-3.5" />
            {t("cron.gallery")}
          </button>
          <button
            type="button"
            data-testid="cron-new"
            className={`${iconBtn} bg-primary text-white hover:bg-primary`}
            onClick={() => setEditor({ job: null })}
            disabled={npcCandidates.length === 0}
          >
            <Plus className="w-3.5 h-3.5" />
            {t("cron.new")}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="ml-1 text-text-muted hover:text-text"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 필터·검색 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        {!single && (
          <select
            data-testid="cron-filter-npc"
            className="px-2 py-1 bg-surface border border-border rounded text-xs text-text"
            value={filterNpcId}
            onChange={(e) => setFilterNpcId(e.target.value)}
          >
            <option value="">{t("cron.filter.allNpcs")}</option>
            {npcs.map((candidate) => (
              <option key={candidate.npcId} value={candidate.npcId}>
                {candidate.npcName}
              </option>
            ))}
          </select>
        )}
        <input
          data-testid="cron-search"
          className="flex-1 min-w-0 px-2 py-1 bg-surface border border-border rounded text-xs text-text"
          placeholder={t("cron.search.placeholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {inlineToast && (
        <div
          role="status"
          data-testid="cron-toast"
          className="mx-3 mt-2 px-3 py-1.5 rounded bg-surface-raised text-xs text-text"
        >
          {inlineToast}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2">
        {loadError !== null && (
          <div>
            <CronErrorNotice notice={classifyCronError(loadError)} />
            {gateChecklistTrigger(loadError)}
          </div>
        )}
        {partialErrors.length > 0 && (
          <div
            data-testid="cron-partial-errors"
            className="p-2 rounded border border-amber-600/50 bg-amber-900/10 text-[11px] text-text-muted"
          >
            <p>{t("cron.error.partial", { count: partialErrors.length })}</p>
            <ul className="mt-1 font-mono">
              {partialErrors.map((err) => (
                <li key={err.npcId}>
                  {npcCandidates.find((c) => c.npcId === err.npcId)?.npcName ?? err.npcId} —{" "}
                  {err.code}: {err.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 목록 */}
        {jobs === null ? (
          <p className="text-sm text-text-dim py-4 text-center">{t("common.loading")}</p>
        ) : visibleJobs.length === 0 ? (
          loadError === null && (
            <p className="text-sm text-text-dim py-4 text-center">{t("cron.empty")}</p>
          )
        ) : (
          <ul role="list" className="space-y-1">
            {visibleJobs.map((job) => {
              const next = parseIsoMs(job.next_run_at);
              const active = job.id === selectedId;
              return (
                <li key={`${job.npcId}:${job.id}`} role="listitem" data-testid="cron-row">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(active ? null : job.id);
                      setDetailTab("detail");
                      setActionError(null);
                      setConfirmDeleteId(null);
                    }}
                    aria-pressed={active}
                    className={`w-full text-left px-3 py-2 rounded-lg border ${
                      active
                        ? "bg-surface-raised border-primary/60"
                        : "bg-surface border-border hover:bg-surface-raised"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        data-testid="cron-state-dot"
                        data-state={job.state}
                        title={t(`cron.state.${job.state}`)}
                        className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${stateDotClass(job.state)}`}
                      />
                      <span className="text-sm font-medium truncate flex-1">{job.name}</span>
                      {!single && (
                        <span className="text-[11px] text-npc flex-shrink-0">{job.npcName}</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5 text-[11px] text-text-muted">
                      <span className="truncate">{jobScheduleDisplay(job)}</span>
                      <span data-testid="cron-countdown" className="flex-shrink-0">
                        {job.state === "paused" ||
                        job.state === "disabled" ||
                        job.state === "completed"
                          ? t(`cron.state.${job.state}`)
                          : next !== null
                            ? relativeTime(next, nowMs, locale)
                            : t("cron.noNextRun")}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 상세 서랍 */}
      {selected && (
        <div
          data-testid="cron-detail"
          className="border-t border-border bg-surface/60 max-h-[45%] flex flex-col min-h-0"
        >
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
            <div className="flex gap-1">
              {(["detail", "runs"] as DetailTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  data-testid={`cron-tab-${tab}`}
                  onClick={() => setDetailTab(tab)}
                  className={`px-2 py-0.5 text-xs rounded ${
                    detailTab === tab ? "bg-surface-raised text-text" : "text-text-muted"
                  }`}
                >
                  {tab === "detail" ? t("cron.detail.title") : t("cron.runs.title")}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                data-testid="cron-action-edit"
                className={iconBtn}
                disabled={!selected.editable || busy === selected.id}
                title={readOnlyText(selected) ?? t("common.edit")}
                onClick={() => setEditor({ job: selected })}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              {selected.state === "paused" ? (
                <button
                  type="button"
                  data-testid="cron-action-resume"
                  className={iconBtn}
                  disabled={!selected.editable || busy === selected.id}
                  title={readOnlyText(selected) ?? t("cron.action.resume")}
                  onClick={() => void runAction(selected, "resume")}
                >
                  <Play className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="cron-action-pause"
                  className={iconBtn}
                  disabled={!selected.editable || busy === selected.id}
                  title={readOnlyText(selected) ?? t("cron.action.pause")}
                  onClick={() => void runAction(selected, "pause")}
                >
                  <Pause className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                data-testid="cron-action-run"
                className={iconBtn}
                disabled={!selected.editable || busy === selected.id}
                title={readOnlyText(selected) ?? t("cron.action.run")}
                onClick={() => void runAction(selected, "run")}
              >
                <Zap className="w-3.5 h-3.5" />
                {t("cron.action.run")}
              </button>
              <button
                type="button"
                data-testid="cron-action-delete"
                className={`${iconBtn} ${confirmDeleteId === selected.id ? "bg-red-700/70 text-white" : "text-danger"}`}
                disabled={!selected.editable || busy === selected.id}
                title={readOnlyText(selected) ?? t("common.delete")}
                onClick={() => {
                  if (confirmDeleteId === selected.id) void runAction(selected, "delete");
                  else setConfirmDeleteId(selected.id);
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {confirmDeleteId === selected.id ? t("cron.action.confirmDelete") : null}
              </button>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                aria-label={t("common.close")}
                className="ml-1 text-text-muted hover:text-text"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-xs space-y-2">
            {readOnlyText(selected) && (
              <p data-testid="cron-readonly-reason" className="text-text-muted italic">
                {readOnlyText(selected)}
              </p>
            )}
            {actionError !== null && (
              <div>
                <CronErrorNotice notice={classifyCronError(actionError)} />
                {gateChecklistTrigger(actionError)}
              </div>
            )}

            {detailTab === "detail" ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-text-muted">{t("cron.field.npc")}</dt>
                <dd className="text-npc">{selected.npcName}</dd>
                <dt className="text-text-muted">{t("cron.field.schedule")}</dt>
                <dd>
                  {jobScheduleDisplay(selected)}{" "}
                  <span className="text-text-dim">
                    <TimezoneLabel timezone={timezone} />
                  </span>
                </dd>
                <dt className="text-text-muted">{t("cron.nextRun")}</dt>
                <dd>
                  {formatLocalDateTime(selected.next_run_at, locale)}
                  {parseIsoMs(selected.next_run_at) !== null && (
                    <span className="ml-1 text-text-dim">
                      ({relativeTime(parseIsoMs(selected.next_run_at)!, nowMs, locale)})
                    </span>
                  )}
                </dd>
                <dt className="text-text-muted">{t("cron.lastRun")}</dt>
                <dd>
                  {formatLocalDateTime(selected.last_run_at, locale)}
                  {selected.last_status && (
                    <span className="ml-1 text-text-dim">({selected.last_status})</span>
                  )}
                </dd>
                {selected.last_error && (
                  <>
                    <dt className="text-text-muted">{t("cron.lastError")}</dt>
                    <dd className="text-danger break-all">{selected.last_error}</dd>
                  </>
                )}
                <dt className="text-text-muted">{t("cron.field.deliver")}</dt>
                <dd className="font-mono">{selected.deliver ?? "local"}</dd>
                <dt className="text-text-muted">{t("cron.field.model")}</dt>
                <dd className="font-mono">
                  {selected.model
                    ? `${selected.provider ? `${selected.provider}:` : ""}${selected.model}`
                    : t("cron.modelDefault")}
                </dd>
                <dt className="text-text-muted">{t("cron.field.prompt")}</dt>
                <dd className="whitespace-pre-wrap break-words">{selected.prompt}</dd>
              </dl>
            ) : runs === null && runsError === null ? (
              <p className="text-text-dim">{t("common.loading")}</p>
            ) : runsError !== null ? (
              <div>
                <CronErrorNotice notice={classifyCronError(runsError)} />
                {gateChecklistTrigger(runsError)}
              </div>
            ) : runs && runs.length === 0 ? (
              <p className="text-text-dim">{t("cron.runs.empty")}</p>
            ) : (
              <ul role="list" className="space-y-1">
                {(runs ?? []).map((run) => (
                  <li
                    key={run.id}
                    role="listitem"
                    data-testid="cron-run"
                    className="p-2 rounded bg-surface border border-border"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px]">
                        {formatLocalDateTime(run.started_at, locale)}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          run.status === "error"
                            ? "bg-danger/10 text-danger"
                            : "bg-surface-raised text-text-muted"
                        }`}
                      >
                        {run.status}
                      </span>
                    </div>
                    {(run.summary || run.result_text) && (
                      <p className="mt-1 text-text-muted whitespace-pre-wrap break-words line-clamp-4">
                        {run.summary || run.result_text}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {editor && (
        <CronEditorDialog
          channelId={channelId}
          npcs={npcCandidates}
          defaultNpcId={npc?.npcId ?? (filterNpcId || null)}
          job={editor.job}
          timezone={timezone}
          onSubmit={submitEditor}
          onClose={() => setEditor(null)}
        />
      )}
      {gallery && (
        <BlueprintGallery
          channelId={channelId}
          npcs={npcCandidates}
          defaultNpcId={npc?.npcId ?? (filterNpcId || null)}
          onCreated={(job) => {
            setGallery(false);
            toast(t("cron.toast.created", { name: job.name }));
            void reload();
          }}
          onClose={() => setGallery(false)}
        />
      )}
      <GateChecklistModal blocker={checklistBlocker} onClose={() => setChecklistBlocker(null)} />
    </div>
  );
}
