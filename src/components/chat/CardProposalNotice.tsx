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
  /** 이 화면에서 제안을 처리할 수 없다(핸들러 미배선). `pending`(요청 중)과 다른 상태다. */
  unavailable?: boolean;
  /** 서버가 거절한 이유(코드). 있으면 보이고 버튼은 그대로 둔다. */
  error: string | null;
}

export default function CardProposalNotice({
  notice,
  onResolve,
  pending,
  unavailable = false,
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
        // 완료 조건은 본문이 아니다 — 라벨을 붙여 가른다(카드 본문의 `## Acceptance` 절과 같은 구분).
        <div className="text-caption text-text-muted mt-0.5" data-testid="card-proposal-acceptance">
          <span className="font-semibold">{t("notice.cardProposal.acceptanceLabel")}</span>{" "}
          <span className="whitespace-pre-wrap break-words">{notice.acceptance}</span>
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
              {/* 409 는 "왜" 가 중요하다 — 알림 쓰기가 실패해 미결로 남은 제안을 다시 누른
                  경우다. 코드만 보이면 사용자는 무엇을 해야 할지 모른다. */}
              {error === "already_resolved"
                ? t("notice.cardProposal.alreadyResolved")
                : t("notice.cardProposal.failed", { reason: error })}
            </div>
          )}
          {unavailable && (
            // 버튼을 비활성으로만 두면 로딩처럼 보여 사용자가 영영 기다린다 — 이유를 말한다.
            <div
              className="text-caption text-text-muted mt-1"
              data-testid="card-proposal-unavailable"
            >
              {t("notice.cardProposal.unavailable")}
            </div>
          )}
          <div className="flex gap-1.5 flex-wrap mt-1">
            <button
              type="button"
              disabled={pending || unavailable}
              onClick={() => onResolve("card")}
              className="px-2 py-1 rounded text-caption font-semibold bg-primary text-white disabled:opacity-50"
            >
              {t("notice.cardProposal.registerCard")}
            </button>
            <button
              type="button"
              disabled={pending || unavailable}
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
