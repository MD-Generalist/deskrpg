/**
 * 보고 호출 판정 — "지금 누구를 부를 것인가" 하나만 답한다.
 *
 * 호출 자체는 기존 `npc:call` 을 그대로 쓴다(새 이벤트를 만들지 않는다). 여기서는 언제
 * 쏘지 **않을지**가 본질이다 — 대화 중에 끼어들지 않고, 걸어오는 중에 다시 부르지 않는다.
 */
import type { RoomMessage, RoomSummary } from "@/lib/chat-rooms-policy";

import { nextReporter, pendingReports, type ReportItem } from "@/game/report-queue";

/**
 * 방 상태와 로스터에서 이번 채널의 보고 큐를 뽑는다. 화면이 갖고 있는 모양 그대로 받아
 * 컴포넌트 안에 판정이 남지 않게 한다 — 사무실 방이 아직 없으면 빈 큐다.
 */
export function reportsForChannel(input: {
  rooms: readonly RoomSummary[];
  messages: Readonly<Record<string, RoomMessage[]>>;
  npcs: readonly { id: string; active: boolean }[];
  acknowledgedAt: string | null;
}): ReportItem[] {
  const officeId = input.rooms.find((room) => room.kind === "office")?.id ?? null;
  if (!officeId) return [];
  return pendingReports(
    input.messages[officeId] ?? [],
    input.acknowledgedAt,
    input.npcs.filter((npc) => npc.active).map((npc) => npc.id),
  );
}

/**
 * 이 보고를 열면 어디로 가는가. 카드 보고는 칸반, 크론 실패는 크론 이력이다.
 *
 * 컴포넌트 안에서 `cardId ?? ""` 로 얼버무렸다가 크론 실패 보고가 **어떤 방법으로도
 * 확인되지 않아** 배지가 영구히 남았다. 갈라지는 지점을 여기 두고 테스트로 고정한다.
 */
export function reportTarget(
  item: ReportItem,
): { kind: "card"; cardId: string } | { kind: "cron"; jobId: string } | null {
  if (item.jobId) return { kind: "cron", jobId: item.jobId };
  if (item.cardId) return { kind: "card", cardId: item.cardId };
  return null;
}

export function decideReportCall(input: {
  queue: readonly ReportItem[];
  /** 지금 보고하러 오는 중이거나 말하는 중인 NPC. */
  activeNpcId: string | null;
  /** 이미 호출을 쏜 보고들. 재호출을 막는다. */
  calledMessageIds: readonly string[];
  /** 대화창·칸반·크론 모달이 열려 있으면 끼어들지 않는다. 큐는 그대로 남는다. */
  blocked: boolean;
}): ReportItem | null {
  if (input.blocked) return null;
  const active = nextReporter(input.queue, input.activeNpcId);
  // 보고 중인 직원이 있으면 그 사람이 우선이다. 이미 불렀으면 걸어오는 중이니 재호출하지 않는다.
  if (input.activeNpcId && active && active.npcId === input.activeNpcId)
    return input.calledMessageIds.includes(active.messageId) ? null : active;
  // 맨 앞이 거절됐다고 큐 전체가 멈추면 안 된다 — 회의 중인 직원 하나가 나머지 보고를
  // 영영 막는다(head-of-line blocking). 이미 호출한 것은 건너뛰고 다음 후보를 고른다.
  return input.queue.find((item) => !input.calledMessageIds.includes(item.messageId)) ?? null;
}

/**
 * 확인 지점을 이 보고까지 밀어 준다. 이미 더 뒤까지 확인했으면 되돌리지 않는다 —
 * 오래된 알림을 눌렀다고 새 보고가 되살아나면 안 된다.
 */
export function acknowledgedThrough(current: string | null, item: ReportItem): string {
  return current && current >= item.createdAt ? current : item.createdAt;
}

/**
 * 확인 지점을 담아 두는 브라우저 저장 키. 서버 읽은 지점 스키마를 건드리지 않으려는 선택이라,
 * 대가로 기기마다 배지가 다를 수 있다. 읽은 지점이 정리되면 그 값으로 갈아끼운다.
 */
export function reportAckKey(channelId: string): string {
  return `deskrpg.reportAck.${channelId}`;
}
