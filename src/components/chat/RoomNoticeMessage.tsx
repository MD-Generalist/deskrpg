"use client";
/**
 * 구조화 알림 한 줄(R29·R30). 서버는 로케일을 모른 채 `notice` 만 싣고, 문장은 여기서 보는
 * 사람의 언어로 만든다.
 *
 * - `card_done` / `card_blocked` / `card_review`: 카드 제목 중심 문장 + "카드 열기"(칸반 모달을 그 카드로).
 * - `cron_result`: "크론 결과 · {jobName}" 헤더(실패 배지) + 본문 그대로 + "이력 열기".
 * - `card_proposal`: 제안 본문 + 선택 버튼 둘(해소 전) / 결정 결과(해소 후). `content` 는
 *   제목과 같으므로 다시 그리지 않는다.
 * - 모르는 kind: `content` 폴백 — 알림 자체를 삼키지 않는다.
 *
 * 발신자 이름은 `notice.npcName`(없으면 senderName) 을 쓴다. system 메시지의 `content` 앞에는
 * 서버가 NPC 이름을 붙여 두지만(R22) 문장은 notice 로 만드니 그 접두는 쓰지 않는다.
 */
import type { RoomMessage, RoomNotice } from "@/lib/chat-rooms-policy";
import { useT } from "@/lib/i18n";

import MarkdownContent from "../ui/MarkdownContent";
import CardProposalNotice from "./CardProposalNotice";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** 카드 알림의 본문 문장. 순수 함수 — 테스트가 로케일별로 고정한다. */
export function cardNoticeText(
  notice: Extract<RoomNotice, { kind: "card_done" | "card_blocked" | "card_review" }>,
  t: Translate,
): string {
  const key =
    notice.kind === "card_done"
      ? "notice.cardDone"
      : notice.kind === "card_review"
        ? "notice.cardReview"
        : "notice.cardBlocked";
  return t(key, { title: notice.cardTitle });
}

/**
 * 여기서 문장을 만들 수 있는 kind 인지 — 아니면 `content` 폴백으로 간다.
 * 지원 목록을 `Extract` 로 양성적으로 적는다: 새 kind 가 유니온에 들어와도 여기서 빠지면
 * 자동으로 폴백이 되고, `Exclude` 예외가 kind 마다 쌓이지 않는다.
 */
export function isKnownNotice(notice: RoomNotice | null | undefined): notice is Extract<
  RoomNotice,
  {
    kind:
      | "card_done"
      | "card_blocked"
      | "card_review"
      | "approval_requested"
      | "cron_result"
      | "card_proposal"
      | "meeting_outcome";
  }
> {
  return (
    !!notice &&
    (notice.kind === "card_done" ||
      notice.kind === "card_blocked" ||
      notice.kind === "card_review" ||
      notice.kind === "approval_requested" ||
      notice.kind === "cron_result" ||
      notice.kind === "card_proposal" ||
      notice.kind === "meeting_outcome")
  );
}

export interface RoomNoticeMessageProps {
  message: RoomMessage;
  onOpenCard?: (cardId: string, boardSlug: string) => void;
  onOpenCronJob?: (jobId: string) => void;
  onOpenApproval?: (approvalId: string) => void;
  /** 회의 결과 알림 — 그 회의의 회의록(후속 업무 등록 화면)을 연다. 없으면 버튼이 없다. */
  onOpenMinutes?: (minutesId: string) => void;
  /** 제안 알림의 선택. 없으면 제안은 버튼 없이 본문만 보인다(읽기 전용). */
  onResolveProposal?: (proposalId: string, choice: "card" | "inline") => void;
  /** 그 제안이 지금 서버 호출 중인지. */
  proposalPending?: boolean;
  /** 그 제안의 마지막 실패 이유(코드). 버튼은 그대로 남는다. */
  proposalError?: string | null;
}

export default function RoomNoticeMessage({
  message,
  onOpenCard,
  onOpenCronJob,
  onOpenApproval,
  onOpenMinutes,
  onResolveProposal,
  proposalPending = false,
  proposalError = null,
}: RoomNoticeMessageProps) {
  const t = useT();
  const notice = message.notice ?? null;
  const name = (notice && "npcName" in notice && notice.npcName) || message.senderName;

  if (!isKnownNotice(notice)) {
    // 알 수 없는 kind — 일반 NPC/시스템 줄처럼 content 만.
    return (
      <div className="flex justify-start" data-room-notice="unknown">
        <div className="max-w-[85%] px-3 py-2 rounded-lg text-body bg-surface-raised text-text-secondary">
          {name && <div className="text-caption font-semibold text-npc mb-0.5">{name}</div>}
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        </div>
      </div>
    );
  }

  const linkClass = "text-caption font-semibold text-primary hover:underline";

  if (notice.kind === "card_proposal") {
    return (
      <div className="flex justify-start" data-room-notice={notice.kind}>
        <div className="max-w-[85%] w-full px-3 py-2 rounded-lg text-body bg-surface-raised text-text-secondary border border-border">
          {name && <div className="text-caption font-semibold text-npc mb-0.5">{name}</div>}
          <CardProposalNotice
            notice={notice}
            onResolve={(choice) => onResolveProposal?.(notice.proposalId, choice)}
            pending={proposalPending}
            unavailable={!onResolveProposal}
            error={proposalError}
          />
        </div>
      </div>
    );
  }

  if (notice.kind === "cron_result") {
    const failed = notice.status === "error";
    return (
      <div
        className="flex justify-start"
        data-room-notice={notice.kind}
        data-status={notice.status}
      >
        <div className="max-w-[85%] w-full px-3 py-2 rounded-lg text-body bg-surface-raised text-text-secondary border border-border">
          {name && <div className="text-caption font-semibold text-npc mb-0.5">{name}</div>}
          <div className="flex items-center gap-1.5 flex-wrap text-caption text-text-muted mb-1">
            <span className="font-semibold">
              {t("notice.cronResult", { jobName: notice.jobName })}
            </span>
            {failed && (
              <span
                data-testid="notice-cron-failed"
                className="px-1.5 py-0.5 rounded bg-danger-bg text-danger font-semibold"
              >
                {t("notice.cronFailed")}
              </span>
            )}
          </div>
          <MarkdownContent content={message.content} />
          {onOpenCronJob && (
            <button
              type="button"
              className={`${linkClass} mt-1`}
              onClick={() => onOpenCronJob(notice.jobId)}
            >
              {t("notice.openHistory")}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (notice.kind === "meeting_outcome") {
    // 등록되면 같은 줄이 결과를 말한다. 렌더러가 `resolved` 를 읽어서이지 클라이언트가 숨기는 것이 아니다.
    const registered = notice.resolved;
    return (
      <div className="flex justify-start" data-room-notice={notice.kind}>
        <div className="max-w-[85%] px-3 py-2 rounded-lg text-body bg-surface-raised text-text-secondary border border-border">
          <div className="break-words">
            {t(notice.recommended ? "notice.meetingOutcome.recommended" : "notice.meetingOutcome", {
              topic: notice.topic,
              count: notice.followUpCount,
            })}
          </div>
          {registered && (
            <div className="text-caption text-text-muted mt-1" data-meeting-outcome-resolved>
              {t("notice.meetingOutcome.registered", { count: registered.taskCount })}
            </div>
          )}
          {onOpenMinutes && (
            <button
              type="button"
              data-meeting-outcome-open={registered ? "view" : "register"}
              className={`${linkClass} mt-1`}
              onClick={() => onOpenMinutes(notice.minutesId)}
            >
              {t(registered ? "notice.meetingOutcome.view" : "notice.meetingOutcome.register")}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (notice.kind === "approval_requested") {
    // 결정되면 버튼 대신 결과를 그린다. **렌더러가 해소 상태를 읽어서**이지 클라이언트가
    // 숨기는 것이 아니다 — 새로고침해도, 다른 탭에서도 같다.
    return (
      <div className="flex justify-start" data-room-notice={notice.kind}>
        <div className="max-w-[85%] px-3 py-2 rounded-lg text-body bg-surface-raised text-text-secondary border border-border">
          {name && <div className="text-caption font-semibold text-npc mb-0.5">{name}</div>}
          <div className="break-words">
            {t("notice.approvalRequested", {
              title: notice.title,
              count: notice.targetCount,
            })}
          </div>
          {notice.resolved ? (
            <div className="text-caption text-text-muted mt-1" data-approval-resolved>
              {t(`notice.approval.${notice.resolved.decision}`)}
            </div>
          ) : (
            onOpenApproval && (
              <button
                type="button"
                className={`${linkClass} mt-1`}
                onClick={() => onOpenApproval(notice.approvalId)}
              >
                {t("notice.openApproval")}
              </button>
            )
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start" data-room-notice={notice.kind}>
      <div className="max-w-[85%] px-3 py-2 rounded-lg text-body bg-surface-raised text-text-secondary border border-border">
        {name && <div className="text-caption font-semibold text-npc mb-0.5">{name}</div>}
        <div className="break-words">{cardNoticeText(notice, t)}</div>
        {onOpenCard && (
          <button
            type="button"
            className={`${linkClass} mt-1`}
            onClick={() => onOpenCard(notice.cardId, notice.boardSlug)}
          >
            {t("notice.openCard")}
          </button>
        )}
      </div>
    </div>
  );
}
