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

/**
 * 호출 한 번의 결과. `signature` 는 **그 시점 그 직원의 관찰 가능한 상태**다(아래 참조).
 *
 * - `sent` — 쏘았고 아직 거절을 받지 않았다. 같은 보고를 두 번 쏘는 것을 막는 낙관적 표시다.
 * - `rejected` — 거절됐다. 그 직원의 상태가 **그대로인 동안은** 다시 쏘지 않는다.
 */
export type ReportAttempt = {
  messageId: string;
  outcome: "sent" | "rejected";
  signature: string;
};

/**
 * 재시도 신호가 되는 직원 상태. 모션 스냅샷의 `phase` 와 "주인이 나인가" 를 합친다.
 *
 * 시간 기반 재시도를 쓰지 않는 이유: 회의가 한 시간이면 그동안 호출이 계속 헛나간다.
 * 상태가 바뀌는 순간이 곧 "이제 될지도 모른다" 는 유일한 근거다.
 */
export function npcSignature(
  phase: string | undefined,
  ownerSocketId: string | undefined,
  mySocketId: string | undefined,
): string {
  const owner = !ownerSocketId ? "none" : ownerSocketId === mySocketId ? "mine" : "other";
  return `${phase ?? "unknown"}:${owner}`;
}

/**
 * 지금 보고하러 직원을 부르면 안 되는가.
 *
 * 대화창·칸반·크론 모달이 열려 있으면 끼어들지 않는다. **회의실에 있는 동안에도** 부르지
 * 않는다 — 자동 보고 호출은 직원을 내 호출에 묶고, 묶인 직원은 회의 집결이 원위치를 캡처하지
 * 못해 "참가자를 찾을 수 없습니다" 로 집결이 깨진다. 밀린 보고가 있으면 회의를 시작할 수
 * 없었다(스테이징 실측). 어느 경우든 큐는 그대로 남고, 막힌 이유가 사라지면 이어진다.
 */
export function reportCallBlocked(input: {
  dialogOpen: boolean;
  kanbanOpen: boolean;
  cronOpen: boolean;
  inMeeting: boolean;
}): boolean {
  return input.dialogOpen || input.kanbanOpen || input.cronOpen || input.inMeeting;
}

export function decideReportCall(input: {
  queue: readonly ReportItem[];
  /** 지금 보고하러 오는 중이거나 말하는 중인 NPC. */
  activeNpcId: string | null;
  /** 이 보고들에 무엇을 했고 어떻게 됐는지. */
  attempts: readonly ReportAttempt[];
  /** 지금 각 직원의 상태 서명. 거절 당시와 다르면 다시 부를 수 있다. */
  signatures: Readonly<Record<string, string>>;
  /** 지금 부르면 안 되는가(`reportCallBlocked`). 큐는 그대로 남는다. */
  blocked: boolean;
}): ReportItem | null {
  if (input.blocked) return null;
  const callable = (item: ReportItem): boolean => {
    const attempt = input.attempts.find((a) => a.messageId === item.messageId);
    if (!attempt) return true;
    // 결과를 기다리는 중이면 다시 쏘지 않는다.
    if (attempt.outcome === "sent") return false;
    // 거절 — 그 직원의 상태가 바뀌었을 때만 다시 후보가 된다.
    return (input.signatures[item.npcId] ?? "unknown:none") !== attempt.signature;
  };
  const active = nextReporter(input.queue, input.activeNpcId);
  // 보고 중인 직원이 있으면 그 사람이 우선이다.
  if (input.activeNpcId && active && active.npcId === input.activeNpcId)
    return callable(active) ? active : null;
  // 맨 앞이 막아도 큐 전체가 멈추면 안 된다(head-of-line blocking). 다음 후보로 넘어간다.
  return input.queue.find(callable) ?? null;
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
