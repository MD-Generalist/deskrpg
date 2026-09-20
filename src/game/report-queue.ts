/**
 * 보고 큐 — 사무실 방 알림에서 "누가 찾아와 말해야 하는가" 를 뽑는다.
 *
 * 서버가 아니라 **보는 브라우저**가 주체다. `npc:call` 은 `targetPlayerId: socket.id` 로
 * 대상을 정하는 소켓 핸들러라(`src/server/npc-coordination.ts`) 자동화 사건에는 걸어갈
 * 대상이 없다. 그래서 알림을 받은 브라우저가 스스로 기존 호출을 쏜다 — 아무도 접속해
 * 있지 않으면 이동이 생략되고 알림만 방에 남는 것이 옳은 동작이다.
 *
 * 순수 함수만 둔다. 이 파일은 클라이언트 번들에 들어가므로 `node:*`·`@/db` 를 쓰지 않는다.
 */
import type { RoomMessage, RoomNotice } from "@/lib/chat-rooms-policy";

export type ReportKind = "card_review" | "card_blocked" | "card_done" | "cron_failed";

export type ReportItem = {
  messageId: string;
  npcId: string;
  npcName: string;
  kind: ReportKind;
  /** 카드 보고만 값이 있다. 크론 실패는 열 카드가 없다. */
  cardId: string | null;
  boardSlug: string | null;
  /** 크론 실패만 값이 있다 — 이 보고를 열 곳은 카드가 아니라 크론 이력이다. */
  jobId: string | null;
  cardTitle: string;
  createdAt: string;
};

/** 보고가 되는 알림만 골라 종류를 정한다. 성공한 크론과 일반 메시지는 보고가 아니다. */
function reportKindOf(notice: RoomNotice | null | undefined): ReportKind | null {
  if (!notice) return null;
  if (
    notice.kind === "card_review" ||
    notice.kind === "card_blocked" ||
    notice.kind === "card_done"
  )
    return notice.kind;
  if (notice.kind === "cron_result" && notice.status === "error") return "cron_failed";
  return null;
}

/**
 * 아직 확인하지 않은 보고를 발생 순서대로.
 *
 * - `acknowledgedAt` 은 마지막으로 확인한 알림의 `createdAt`. 그 시점 자체도 확인된 것으로 본다.
 * - 맵에 없는 NPC 는 뺀다 — 걸어올 주체가 없다.
 * - 담당 NPC 가 잠들어 시스템 메시지로 대체된 알림(`senderId === null`)도 뺀다. 알림은 방에
 *   남아 있으니 사용자가 놓치지는 않는다.
 */
export function pendingReports(
  messages: readonly RoomMessage[],
  acknowledgedAt: string | null,
  presentNpcIds: readonly string[],
): ReportItem[] {
  const present = new Set(presentNpcIds);
  const items: ReportItem[] = [];
  for (const message of messages) {
    const kind = reportKindOf(message.notice);
    if (!kind) continue;
    const npcId = message.senderId;
    if (!npcId || !present.has(npcId)) continue;
    if (acknowledgedAt && message.createdAt <= acknowledgedAt) continue;
    const notice = message.notice as Extract<RoomNotice, { npcName: string }>;
    const isCard = kind !== "cron_failed";
    items.push({
      messageId: message.id,
      npcId,
      npcName: notice.npcName || message.senderName,
      kind,
      cardId: isCard ? ((notice as { cardId: string }).cardId ?? null) : null,
      boardSlug: isCard ? ((notice as { boardSlug: string }).boardSlug ?? null) : null,
      jobId: isCard ? null : ((notice as { jobId: string }).jobId ?? null),
      cardTitle: isCard
        ? (notice as { cardTitle: string }).cardTitle
        : (notice as { jobName: string }).jobName,
      createdAt: message.createdAt,
    });
  }
  return items.sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.messageId.localeCompare(b.messageId)
      : a.createdAt < b.createdAt
        ? -1
        : 1,
  );
}

/**
 * 지금 걸어와야 하는 한 명. 한 번에 한 명이라, 이미 보고 중인 NPC 가 큐에 남아 있으면
 * 그 사람을 계속 돌려준다 — 도중에 순번을 바꿔 캐릭터가 갈팡질팡하지 않게 한다.
 */
export function nextReporter(
  queue: readonly ReportItem[],
  activeNpcId: string | null,
): ReportItem | null {
  if (queue.length === 0) return null;
  if (activeNpcId) {
    const active = queue.find((item) => item.npcId === activeNpcId);
    if (active) return active;
  }
  return queue[0];
}
