"use client";
/**
 * 구조화 알림 한 줄(R29·R30). 서버는 로케일을 모른 채 `notice` 만 싣고, 문장은 여기서 보는
 * 사람의 언어로 만든다.
 *
 * - `card_done` / `card_blocked` / `card_review`: 카드 제목 중심 문장 + "카드 열기"(칸반 모달을 그 카드로).
 * - `cron_result`: "크론 결과 · {jobName}" 헤더(실패 배지) + 본문 그대로 + "이력 열기".
 * - 모르는 kind: `content` 폴백 — 알림 자체를 삼키지 않는다.
 *
 * 발신자 이름은 `notice.npcName`(없으면 senderName) 을 쓴다. system 메시지의 `content` 앞에는
 * 서버가 NPC 이름을 붙여 두지만(R22) 문장은 notice 로 만드니 그 접두는 쓰지 않는다.
 */
import type { RoomMessage, RoomNotice } from "@/lib/chat-rooms-policy";
import { useT } from "@/lib/i18n";

import MarkdownContent from "../ui/MarkdownContent";

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

/** 알려진 kind 인지 — 아니면 `content` 폴백으로 간다. */
export function isKnownNotice(notice: RoomNotice | null | undefined): notice is RoomNotice {
  return (
    !!notice &&
    (notice.kind === "card_done" ||
      notice.kind === "card_blocked" ||
      notice.kind === "card_review" ||
      notice.kind === "cron_result")
  );
}

export interface RoomNoticeMessageProps {
  message: RoomMessage;
  onOpenCard?: (cardId: string, boardSlug: string) => void;
  onOpenCronJob?: (jobId: string) => void;
}

export default function RoomNoticeMessage({
  message,
  onOpenCard,
  onOpenCronJob,
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
