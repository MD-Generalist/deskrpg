"use client";
/**
 * NPC 가 올린 업무 카드 제안 한 줄. 아직 카드가 아니다 — 사용자가 여기서
 * `이슈카드등록`·`여기서 처리` 중 하나를 고르고, 고른 결과가 `notice.resolved` 로 남는다.
 *
 * 버튼 유무의 정본은 `notice.resolved` 하나다. 클라이언트가 눌린 것을 기억해 숨기는 것이
 * 아니라 알림 자체가 해소 상태를 들고 있어서, 새로고침해도 다른 탭에서도 같게 보인다.
 * `error` 는 버튼을 지우지 않는다 — 서버가 거절했으면 이유를 보이고 다시 고르게 둔다.
 */
import type { RoomNotice } from "@/lib/chat-rooms-policy";
import { useT } from "@/lib/i18n";

export type CardProposal = Extract<RoomNotice, { kind: "card_proposal" }>;

export interface CardProposalNoticeProps {
  notice: CardProposal;
  /** 사용자의 선택. 서버 호출·낙관 갱신은 호출자 몫이다. */
  onResolve: (choice: "card" | "inline") => void;
  /** 호출이 도는 중 — 버튼은 남기되 비활성. 중복 방지의 정본은 서버의 409 다. */
  pending: boolean;
  /** 서버가 거절한 이유(코드). 있으면 보이고 버튼은 그대로 둔다. */
  error: string | null;
}

export default function CardProposalNotice({
  notice,
  onResolve,
  pending,
  error,
}: CardProposalNoticeProps) {
  const t = useT();
  const resolved = notice.resolved;

  return (
    <div
      className="flex flex-col gap-1"
      data-testid="card-proposal"
      data-proposal-id={notice.proposalId}
    >
      <div className="text-caption font-semibold text-text-muted">
        {t("notice.cardProposal.title")}
      </div>
      <div className="font-semibold break-words">{notice.title}</div>
      {notice.summary && (
        <div className="text-body text-text-secondary whitespace-pre-wrap break-words">
          {notice.summary}
        </div>
      )}
      {notice.body && (
        <div className="text-caption text-text-muted whitespace-pre-wrap break-words">
          {notice.body}
        </div>
      )}
      {notice.acceptance && (
        <div className="text-caption text-text-muted whitespace-pre-wrap break-words">
          {notice.acceptance}
        </div>
      )}

      {resolved ? (
        <div
          className="text-caption font-semibold text-text-muted mt-1"
          data-testid="card-proposal-resolved"
          data-choice={resolved.choice}
        >
          {resolved.choice === "card"
            ? t("notice.cardProposal.registered")
            : t("notice.cardProposal.handledHere")}
          {resolved.choice === "card" && resolved.taskId ? ` · ${resolved.taskId}` : ""}
        </div>
      ) : (
        <>
          {error && (
            <div
              className="text-caption text-danger bg-danger-bg rounded px-1.5 py-0.5 mt-1 break-words"
              data-testid="card-proposal-error"
            >
              {t("notice.cardProposal.failed", { reason: error })}
            </div>
          )}
          <div className="flex gap-1.5 flex-wrap mt-1">
            <button
              type="button"
              disabled={pending}
              onClick={() => onResolve("card")}
              className="px-2 py-1 rounded text-caption font-semibold bg-primary text-white disabled:opacity-50"
            >
              {t("notice.cardProposal.registerCard")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => onResolve("inline")}
              className="px-2 py-1 rounded text-caption font-semibold bg-surface-raised text-text-secondary border border-border disabled:opacity-50"
            >
              {t("notice.cardProposal.handleHere")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
