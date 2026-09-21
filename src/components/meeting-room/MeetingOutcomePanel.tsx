"use client";

/**
 * 회의 결과(결정·후속 업무)와 "프로젝트로 등록할까요?" 제안.
 *
 * 여기서 보이는 후속 업무는 **초안**이다 — 등록을 누르기 전에는 Hermes 에 아무것도 없다.
 * 해소 여부는 이 컴포넌트가 숨기는 것이 아니라 `registered` 를 읽어 그린다. 새로고침해도,
 * 회의록에서 다시 열어도 같은 모습이다.
 */
import { useState } from "react";

import { useT } from "@/lib/i18n";
import type { MeetingOutcome, MeetingSummaryStatus } from "@/lib/meeting-outcome";
import {
  createOutcomeDraft,
  draftToRegistration,
  updateDraftItem,
  type OutcomeRegistration,
} from "@/lib/meeting-outcome-draft";

export type MeetingOutcomeRegistered = {
  boardSlug: string;
  tenant: string | null;
  taskIds: string[];
};

export type MeetingOutcomePanelProps = {
  outcome: MeetingOutcome | null;
  summaryStatus: MeetingSummaryStatus;
  /** 담당으로 고를 수 있는 채널 직원. */
  npcs: Array<{ id: string; name: string }>;
  /** 회의 주재자·채널 소유자만 등록하고 요약을 다시 시킬 수 있다. */
  canRegister: boolean;
  /**
   * 연결된 플러그인이 카드를 승인 대기로 만들 수 있는가(`initial_status` capability).
   * 못 하면 등록은 늘 실패한다 — 눌렀다가 오류를 보는 것보다 버튼을 그리지 않고 이유를 말한다.
   */
  registerSupported: boolean;
  registered: MeetingOutcomeRegistered | null;
  onRegister: (body: OutcomeRegistration) => Promise<void>;
  onRetrySummary: () => Promise<void>;
  /** "등록하지 않음" — 회의 종료 화면만 넘긴다(누르면 오피스로 돌아갈 준비를 한다). 보관함에서는 없다. */
  onDecline?: () => void;
};

export default function MeetingOutcomePanel({
  outcome,
  summaryStatus,
  npcs,
  canRegister,
  registerSupported,
  registered,
  onRegister,
  onRetrySummary,
  onDecline,
}: MeetingOutcomePanelProps) {
  const t = useT();
  const [draft, setDraft] = useState(() =>
    createOutcomeDraft(outcome ?? { decisions: [], followUps: [], project: null }),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      // 거절을 조용히 삼키지 않는다 — 이유를 보이고 버튼을 남긴다.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (summaryStatus === "failed" || !outcome) {
    if (summaryStatus !== "failed") return null;
    return (
      <div className="bg-surface rounded-lg p-4 border border-npc-dark/40 space-y-2" data-outcome>
        <p className="text-caption text-text-secondary">{t("meeting.outcome.summaryFailed")}</p>
        {canRegister && (
          <button
            type="button"
            data-outcome-retry
            disabled={busy}
            onClick={() => void run(onRetrySummary)}
            className="px-3 py-1.5 rounded text-caption font-semibold bg-surface-raised text-text-secondary border border-border disabled:opacity-50"
          >
            {busy ? t("meeting.outcome.retrying") : t("meeting.outcome.retry")}
          </button>
        )}
        {error && (
          <p className="text-caption text-danger" data-outcome-error>
            {error}
          </p>
        )}
      </div>
    );
  }

  const registration = draftToRegistration(draft);
  const declineButton = onDecline && (
    <button
      type="button"
      data-outcome-decline
      disabled={busy}
      onClick={onDecline}
      className="w-full px-3 py-1.5 rounded text-caption font-semibold bg-surface-raised text-text-secondary border border-border disabled:opacity-50"
    >
      {t("meeting.outcome.decline")}
    </button>
  );
  const hasFollowUps = outcome.followUps.length > 0;
  if (outcome.decisions.length === 0 && !hasFollowUps) return null;

  return (
    <div className="bg-surface rounded-lg p-4 border border-border space-y-3" data-outcome>
      {outcome.decisions.length > 0 && (
        <div className="space-y-1">
          <p className="text-caption text-text-dim font-medium">{t("meeting.outcome.decisions")}</p>
          <ul className="space-y-0.5">
            {outcome.decisions.map((decision, index) => (
              <li key={index} className="text-caption text-text-secondary flex items-start gap-1.5">
                <span className="text-info mt-0.5">•</span>
                <span>{decision}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasFollowUps && (
        <div className="space-y-2">
          <p className="text-caption text-text-dim font-medium">
            {t("meeting.outcome.followUps", { count: outcome.followUps.length })}
          </p>
          {outcome.project?.recommended && !registered && (
            <p className="text-caption text-info" data-outcome-recommended>
              {t("meeting.outcome.recommended")}
              {outcome.project.reason ? ` — ${outcome.project.reason}` : ""}
            </p>
          )}
          <ul className="space-y-1.5">
            {draft.items.map((item) => {
              const source = outcome.followUps[item.index];
              const locked = Boolean(registered) || !canRegister || !registerSupported;
              return (
                <li
                  key={item.index}
                  data-outcome-item
                  className="rounded border border-border bg-surface-raised/40 px-2 py-1.5 space-y-1"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={item.selected}
                      disabled={locked}
                      aria-label={t("meeting.outcome.include")}
                      onChange={(event) =>
                        setDraft((prev) =>
                          updateDraftItem(prev, item.index, { selected: event.target.checked }),
                        )
                      }
                    />
                    <input
                      type="text"
                      value={item.title}
                      disabled={locked}
                      aria-label={t("meeting.outcome.title")}
                      onChange={(event) =>
                        setDraft((prev) =>
                          updateDraftItem(prev, item.index, { title: event.target.value }),
                        )
                      }
                      className="flex-1 min-w-0 bg-transparent text-caption text-text border-b border-transparent focus:border-border outline-none"
                    />
                    <select
                      value={item.npcId ?? ""}
                      disabled={locked}
                      aria-label={t("meeting.outcome.assignee")}
                      onChange={(event) =>
                        setDraft((prev) =>
                          updateDraftItem(prev, item.index, { npcId: event.target.value || null }),
                        )
                      }
                      className="shrink-0 max-w-[40%] bg-surface text-caption text-text-secondary border border-border rounded px-1 py-0.5"
                    >
                      <option value="">{t("meeting.outcome.unassigned")}</option>
                      {npcs.map((npc) => (
                        <option key={npc.id} value={npc.id}>
                          {npc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {source.summary && (
                    <p className="text-micro text-text-muted pl-6">{source.summary}</p>
                  )}
                  {/* 모델이 쓴 담당이 참석자로 풀리지 않았으면 그 이름을 그대로 보여 준다 — 사람이 고른다. */}
                  {!source.assigneeNpcId && source.assigneeName && (
                    <p className="text-micro text-text-dim pl-6">
                      {t("meeting.outcome.suggestedAssignee", { name: source.assigneeName })}
                    </p>
                  )}
                  {item.after.length > 0 && (
                    <p className="text-micro text-text-dim pl-6">
                      {t("meeting.outcome.after", {
                        titles: item.after
                          .map((target) => draft.items.find((d) => d.index === target)?.title)
                          .filter(Boolean)
                          .join(", "),
                      })}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {registered ? (
            <p className="text-caption text-success" data-outcome-registered>
              {t("meeting.outcome.registered", { count: registered.taskIds.length })}
            </p>
          ) : canRegister && !registerSupported ? (
            <div className="space-y-2">
              <p className="text-caption text-npc-dark" data-outcome-upgrade>
                {t("meeting.outcome.pluginUpgradeRequired")}
              </p>
              {declineButton}
            </div>
          ) : (
            canRegister && (
              <div className="space-y-2">
                <label className="block space-y-1">
                  <span className="text-micro text-text-muted">
                    {t("meeting.outcome.subproject")}
                  </span>
                  <input
                    type="text"
                    data-outcome-subproject
                    value={draft.subprojectName}
                    placeholder={t("meeting.outcome.subprojectPlaceholder")}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, subprojectName: event.target.value }))
                    }
                    className="w-full bg-surface text-caption text-text border border-border rounded px-2 py-1"
                  />
                </label>
                <button
                  type="button"
                  data-outcome-register
                  disabled={busy || registration.items.length === 0}
                  onClick={() => void run(() => onRegister(registration))}
                  className="w-full px-3 py-2 rounded text-caption font-semibold bg-primary hover:bg-primary-hover text-white disabled:bg-surface-raised disabled:text-text-dim disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {busy
                    ? t("meeting.outcome.registering")
                    : t("meeting.outcome.register", { count: registration.items.length })}
                </button>
                <p className="text-micro text-text-muted">{t("meeting.outcome.registerHint")}</p>
                {declineButton}
              </div>
            )
          )}
          {error && (
            <p className="text-caption text-danger" data-outcome-error>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
