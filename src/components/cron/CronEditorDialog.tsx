"use client";
/**
 * 크론 생성·수정 폼 (R17/R18).
 *
 * 항목: 담당 NPC(생성 때만 고를 수 있다) · 이름 · 프롬프트 · 주기 프리셋(+직접 입력) ·
 * 배달처(체크박스 → 콤마 문자열) · 모델(`provider:model`). 저장은 부모가 한다 —
 * 이 컴포넌트는 본문만 만들어 `onSubmit` 으로 넘기고, 낙관적 갱신은 없다(R26).
 */
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import { useT } from "@/lib/i18n";
import type { CronDeliveryTarget } from "@/lib/hermes/deskrpg-plugin-types";
import GateChecklistModal from "@/components/gateway/GateChecklistModal";
import { classifyGateFailure, isSetupBlocker, type GateBlocker } from "@/lib/gate-failure";

import { cronApi, classifyCronError, isCronApiError, type CronJobView } from "./cron-api";
import {
  SCHEDULE_PRESETS,
  composeDeliver,
  exprForPreset,
  formatModelSpec,
  jobScheduleExpr,
  parseDeliver,
  parseModelSpec,
  scheduleOptionForExpr,
  type SchedulePresetValue,
} from "./cron-schedule";
import { CronErrorNotice, TimezoneLabel } from "./cron-notices";

export type CronEditorNpc = { npcId: string; npcName: string };

/** 저장 본문 — `npcId` 는 생성에만 실린다(수정은 담당 NPC 를 못 바꾼다). */
export type CronEditorSubmit = {
  npcId: string;
  name: string;
  prompt: string;
  schedule: string;
  deliver: string;
  model: string | null;
  provider: string | null;
};

interface CronEditorDialogProps {
  channelId: string;
  /** 담당 NPC 후보. 수정 모드에서는 `job.npcId` 로 고정된다. */
  npcs: CronEditorNpc[];
  /** 생성 시 미리 고를 NPC(단일 NPC 모드). */
  defaultNpcId?: string | null;
  job?: CronJobView | null;
  timezone: string | null;
  onSubmit: (input: CronEditorSubmit) => Promise<void>;
  onClose: () => void;
}

export default function CronEditorDialog({
  channelId,
  npcs,
  defaultNpcId = null,
  job = null,
  timezone,
  onSubmit,
  onClose,
}: CronEditorDialogProps) {
  const t = useT();
  const editing = !!job;

  const initialExpr = job ? jobScheduleExpr(job) : "";
  const initialPreset = job ? scheduleOptionForExpr(initialExpr).value : "daily";

  const [npcId, setNpcId] = useState<string>(job?.npcId ?? defaultNpcId ?? npcs[0]?.npcId ?? "");
  const [name, setName] = useState(job?.name ?? "");
  const [prompt, setPrompt] = useState(job?.prompt ?? "");
  const [preset, setPreset] = useState<SchedulePresetValue>(initialPreset);
  const [customExpr, setCustomExpr] = useState(initialPreset === "custom" ? initialExpr : "");
  const [deliverIds, setDeliverIds] = useState<string[]>(() => parseDeliver(job?.deliver));
  const [modelSpec, setModelSpec] = useState(
    job ? formatModelSpec(job.provider ?? null, job.model ?? null) : "",
  );
  const [targets, setTargets] = useState<CronDeliveryTarget[]>([]);
  const [targetsBlocker, setTargetsBlocker] = useState<GateBlocker | null>(null);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // 배달처 목록은 담당 NPC 의 프로필 것이다 — NPC 가 바뀌면 다시 받는다.
  useEffect(() => {
    if (!npcId) return;
    let cancelled = false;
    setTargetsBlocker(null);
    cronApi
      .listDeliveryTargets(channelId, npcId)
      .then((res) => {
        if (!cancelled) {
          setTargets(res.targets);
          setTargetsBlocker(null);
        }
      })
      .catch((err: unknown) => {
        // 목록을 못 받아도 local 은 항상 고를 수 있다 — 폼을 막지 않는다.
        if (cancelled) return;
        setTargets([]);
        // 다만 "배달처가 없다"와 "게이트에 막혔다"는 다른 일이다. 전에는 구분 없이 삼켰다.
        // 평범한 500·네트워크 오류까지 "설정이 더 필요하다"고 말하면 거짓 신호다 —
        // `isSetupBlocker` 로 걸러진 넷(gateway_not_bound·plugin_absent·plugin_unauthorized·
        // plugin_upgrade_required)만 체크리스트로 띄운다.
        if (isCronApiError(err)) {
          const blocker = classifyGateFailure({
            status: err.status,
            code: err.code,
            message: err.message,
            minVersion:
              typeof err.details.minVersion === "string" ? err.details.minVersion : undefined,
          });
          if (isSetupBlocker(blocker)) setTargetsBlocker(blocker);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, npcId]);

  // 서버 목록에 없는 id(저장된 값, local) 도 체크박스로 남긴다 — 편집 중 사라지면 안 된다.
  const targetRows = useMemo(() => {
    const known = new Map(targets.map((target) => [target.id, target]));
    const ids = new Set<string>(["local", ...known.keys(), ...deliverIds]);
    return Array.from(ids).map((id) => ({ id, target: known.get(id) ?? null }));
  }, [targets, deliverIds]);

  const schedule = preset === "custom" ? customExpr.trim() : (exprForPreset(preset) ?? "");
  const canSubmit = !!npcId && prompt.trim().length > 0 && schedule.length > 0 && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    const { provider, model } = parseModelSpec(modelSpec);
    try {
      await onSubmit({
        npcId,
        name: name.trim() || prompt.trim().slice(0, 40),
        prompt: prompt.trim(),
        schedule,
        deliver: composeDeliver(deliverIds),
        model,
        provider,
      });
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const toggleDeliver = (id: string) => {
    setDeliverIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  };

  const titleId = "cron-editor-title";
  const inputClass =
    "w-full px-3 py-2 bg-surface border border-border rounded text-sm text-text focus:outline-none focus:border-primary";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-bg border border-border rounded-xl shadow-2xl w-[90vw] max-w-[560px] max-h-[85dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 id={titleId} className="text-sm font-bold">
            {editing ? t("cron.editor.editTitle") : t("cron.editor.createTitle")}
          </h2>
          <button onClick={onClose} aria-label={t("common.close")} className="text-text-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form
          className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="block text-xs text-text-muted">
            {t("cron.field.npc")}
            <select
              data-testid="cron-npc"
              className={`${inputClass} mt-1`}
              value={npcId}
              disabled={editing}
              onChange={(e) => setNpcId(e.target.value)}
              required
            >
              {!npcId && <option value="">—</option>}
              {(editing && job ? [{ npcId: job.npcId, npcName: job.npcName }] : npcs).map((npc) => (
                <option key={npc.npcId} value={npc.npcId}>
                  {npc.npcName}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs text-text-muted">
            {t("cron.field.name")}
            <input
              data-testid="cron-name"
              className={`${inputClass} mt-1`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="block text-xs text-text-muted">
            {t("cron.field.prompt")}
            <textarea
              data-testid="cron-prompt"
              className={`${inputClass} mt-1 min-h-[96px]`}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              required
            />
          </label>

          <div className="text-xs text-text-muted">
            <div className="flex items-center justify-between">
              <span>{t("cron.field.schedule")}</span>
              <TimezoneLabel timezone={timezone} />
            </div>
            <select
              data-testid="cron-preset"
              className={`${inputClass} mt-1`}
              value={preset}
              onChange={(e) => setPreset(e.target.value as SchedulePresetValue)}
            >
              {SCHEDULE_PRESETS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(`cron.preset.${option.value}`)}
                </option>
              ))}
            </select>
            {preset === "custom" && (
              <input
                data-testid="cron-custom-expr"
                className={`${inputClass} mt-2 font-mono`}
                value={customExpr}
                placeholder={t("cron.field.customExpr")}
                onChange={(e) => setCustomExpr(e.target.value)}
              />
            )}
          </div>

          <fieldset className="text-xs text-text-muted">
            <legend>{t("cron.field.deliver")}</legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {targetRows.map(({ id, target }) => (
                <label key={id} className="inline-flex items-center gap-1.5 text-text">
                  <input
                    type="checkbox"
                    data-testid={`cron-deliver-${id}`}
                    checked={deliverIds.includes(id)}
                    onChange={() => toggleDeliver(id)}
                  />
                  <span>
                    {id === "local" ? t("cron.deliver.local") : (target?.name ?? id)}
                    {target && id !== "local" && !target.home_target_set && (
                      <span className="ml-1 text-text-dim">({t("cron.deliver.needsHome")})</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
            {targetsBlocker && (
              <button
                type="button"
                onClick={() => setChecklistOpen(true)}
                className="mt-1 text-xs text-text-muted underline"
              >
                {t("gateChecklist.whatIsNeeded")}
              </button>
            )}
          </fieldset>

          <label className="block text-xs text-text-muted">
            {t("cron.field.model")}
            <input
              data-testid="cron-model"
              className={`${inputClass} mt-1 font-mono`}
              value={modelSpec}
              placeholder={t("cron.field.modelHint")}
              onChange={(e) => setModelSpec(e.target.value)}
            />
          </label>

          {error !== null && <CronErrorNotice notice={classifyCronError(error)} />}
        </form>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded bg-surface hover:bg-surface-raised text-text"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            data-testid="cron-submit"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="px-3 py-1.5 text-sm rounded bg-primary text-white font-semibold disabled:opacity-50"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
      <GateChecklistModal
        blocker={checklistOpen ? targetsBlocker : null}
        onClose={() => setChecklistOpen(false)}
      />
    </div>
  );
}
