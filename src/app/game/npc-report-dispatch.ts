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
  const next = nextReporter(input.queue, input.activeNpcId);
  if (!next) return null;
  return input.calledMessageIds.includes(next.messageId) ? null : next;
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
