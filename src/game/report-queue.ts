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
  /** 알림 본문(로케일 무관 폴백 — 카드 제목·결과 본문). 보고 대화창 맨 위 요약에 쓴다. */
  summary: string;
  createdAt: string;
};

/**
 * 무엇을 확인했는가. 확인은 **보고 한 건 단위**다(`ids`).
 *
 * 예전에는 마지막으로 확인한 알림의 `createdAt` 하나(워터마크)만 두어, 뒤의 보고를 확인하면
 * 그 앞에 있던 **다른 직원의** 보고까지 오지도 않은 채 확인됐다. `through` 는 그때 저장된
 * 옛 값을 읽기 위한 하위 호환이다 — 그 시각 이전은 확인된 것으로 본다. 새로 쓰지 않는다.
 */
export type ReportAck = { through: string | null; ids: readonly string[] };

export const EMPTY_REPORT_ACK: ReportAck = { through: null, ids: [] };

/** 저장된 id 상한. 오래된 것부터 버린다 — 버려진 보고는 방 알림이 오래돼 큐에서도 밀려난 뒤다. */
const MAX_ACK_IDS = 500;

/** 브라우저에 저장된 값을 읽는다. 옛 문자열 워터마크와 새 JSON 을 둘 다 받는다. */
export function parseReportAck(raw: string | null): ReportAck {
  if (!raw) return EMPTY_REPORT_ACK;
  if (!raw.startsWith("{")) return { through: raw, ids: [] };
  try {
    const value = JSON.parse(raw) as { through?: unknown; ids?: unknown };
    return {
      through: typeof value.through === "string" ? value.through : null,
      ids: Array.isArray(value.ids)
        ? value.ids.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return EMPTY_REPORT_ACK;
  }
}

export function serializeReportAck(ack: ReportAck): string {
  return JSON.stringify({ through: ack.through, ids: ack.ids });
}

/** 이 보고 한 건만 확인한다. 다른 보고는 건드리지 않는다. */
export function acknowledgeReport(ack: ReportAck, messageId: string): ReportAck {
  if (ack.ids.includes(messageId)) return ack;
  return { through: ack.through, ids: [...ack.ids, messageId].slice(-MAX_ACK_IDS) };
}

export function isReportAcknowledged(
  ack: ReportAck,
  message: { id: string; createdAt: string },
): boolean {
  return ack.ids.includes(message.id) || (ack.through !== null && message.createdAt <= ack.through);
}

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
 * - 확인한 보고(`ReportAck`)는 뺀다. 건 단위이며, 옛 워터마크 이전도 확인된 것으로 본다.
 * - 맵에 없는 NPC 는 뺀다 — 걸어올 주체가 없다.
 * - 담당 NPC 가 잠들어 시스템 메시지로 대체된 알림(`senderId === null`)도 뺀다. 알림은 방에
 *   남아 있으니 사용자가 놓치지는 않는다.
 */
export function pendingReports(
  messages: readonly RoomMessage[],
  acknowledged: ReportAck,
  presentNpcIds: readonly string[],
): ReportItem[] {
  const present = new Set(presentNpcIds);
  const items: ReportItem[] = [];
  for (const message of messages) {
    const kind = reportKindOf(message.notice);
    if (!kind) continue;
    const npcId = message.senderId;
    if (!npcId || !present.has(npcId)) continue;
    if (isReportAcknowledged(acknowledged, message)) continue;
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
      summary: message.content,
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
