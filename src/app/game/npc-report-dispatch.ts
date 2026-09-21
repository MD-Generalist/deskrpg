/**
 * 보고 호출 판정 — "지금 누구를 부를 것인가" 하나만 답한다.
 *
 * 호출 자체는 기존 `npc:call` 을 그대로 쓴다(새 이벤트를 만들지 않는다). 여기서는 언제
 * 쏘지 **않을지**가 본질이다 — 대화 중에 끼어들지 않고, 걸어오는 중에 다시 부르지 않는다.
 */
import type { RoomMessage, RoomSummary } from "@/lib/chat-rooms-policy";

import { pendingReports, type ReportAck, type ReportItem } from "@/game/report-queue";

/**
 * 방 상태와 로스터에서 이번 채널의 보고 큐를 뽑는다. 화면이 갖고 있는 모양 그대로 받아
 * 컴포넌트 안에 판정이 남지 않게 한다 — 사무실 방이 아직 없으면 빈 큐다.
 */
export function reportsForChannel(input: {
  rooms: readonly RoomSummary[];
  messages: Readonly<Record<string, RoomMessage[]>>;
  npcs: readonly { id: string; active: boolean }[];
  acknowledged: ReportAck;
}): ReportItem[] {
  const officeId = input.rooms.find((room) => room.kind === "office")?.id ?? null;
  if (!officeId) return [];
  return pendingReports(
    input.messages[officeId] ?? [],
    input.acknowledged,
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
 * - `dismissed` — 직원이 와서 대화창까지 열렸는데 사용자가 확인하지 않고 닫았다. 한동안
 *   다시 부르지 않는다(`reviveDismissedReports` 가 되살린다). 배지와 보고 목록에는 남는다.
 */
export type ReportAttempt = {
  messageId: string;
  outcome: "sent" | "rejected" | "dismissed";
  signature: string;
  /** 보낸 호출로 직원이 실제로 내 것이 된 적이 있는가. 그 뒤에 잃어야 "빼앗겼다" 로 본다. */
  acquired?: boolean;
  /** 도착 신호를 놓쳐 이쪽에서 대화창을 대신 열었는가. 한 번만 연다. */
  opened?: boolean;
  /** `dismissed` 가 된 시각(ms). 되살릴 때를 가른다. */
  dismissedAt?: number;
};

/** 접힌 보고가 저절로 다시 후보가 되기까지의 시간(단테 결정 2026-09-21: 약 10분). */
export const DISMISSED_REPORT_REVIVE_MS = 10 * 60 * 1000;

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
  /**
   * 자기 자리(home)에 있는가. 회의 전후로 직원은 **같은 모양으로 돌아온다** — 회의석에 앉은
   * 직원도, 자리로 돌아온 직원도 `idle` · 주인 없음이다. 이것이 없으면 회의가 끝나는 순간
   * 낡은 화면 상태로 거절된 호출이, 복귀가 끝난 뒤에도 "달라진 것이 없다" 로 보여 영영
   * 재시도되지 않는다(스테이징 실측: 회의를 마치고 나와도 보고하러 오지 않았다).
   */
  atHome: boolean,
): string {
  const owner = !ownerSocketId ? "none" : ownerSocketId === mySocketId ? "mine" : "other";
  return `${phase ?? "unknown"}:${owner}:${atHome ? "home" : "away"}`;
}

/** 서명에서 "주인이 나인가" 부분만 읽는다. `npcSignature` 와 같은 파일에 두어 형식이 갈리지 않게 한다. */
function signatureOwner(signature: string): string {
  return signature.split(":")[1] ?? "none";
}

/**
 * 보낸 호출의 결과를 직원 상태로 정리한다.
 *
 * "보냄" 은 보고가 확인돼 큐에서 빠질 때만 풀렸다. 그래서 내 호출로 오던 직원을 회의가
 * 데려가면 그 보고는 영영 "보냄" 으로 남아, 회의가 끝나도 다시 부르지 않았다. 이제 직원이
 * 한 번 내 것이 된 뒤 **내 것이 아니게 되면** 그 시도를 그 순간의 서명으로 거절 처리한다 —
 * 상태가 다시 바뀌면(예: 집에 돌아오면) 후보가 된다.
 *
 * 내 것이 되기 전에는 건드리지 않는다. 호출을 막 보냈을 때는 스냅샷이 아직 옛 상태라
 * "내 것이 아니다" 로 보이는데, 그것을 잃은 것으로 보면 방금 보낸 호출을 스스로 취소한다.
 */
export function reconcileReportAttempts(
  attempts: readonly ReportAttempt[],
  signatures: Readonly<Record<string, string>>,
  queue: readonly ReportItem[],
): ReportAttempt[] {
  return attempts.map((attempt) => {
    if (attempt.outcome !== "sent") return attempt;
    const npcId = queue.find((item) => item.messageId === attempt.messageId)?.npcId;
    if (!npcId) return attempt;
    const signature = signatures[npcId];
    if (!signature) return attempt;
    const mine = signatureOwner(signature) === "mine";
    if (mine) return attempt.acquired ? attempt : { ...attempt, acquired: true };
    if (!attempt.acquired) return attempt;
    // 이미 자기 자리에 돌아와 있으면 서명이 더 바뀌지 않는다 — 그 서명으로 거절해 두면 영영
    // 다시 부르지 않는다(스테이징 실측: 올리버가 서버 복귀로 돌아간 뒤 배지 1건이 남고 아무도
    // 오지 않았다). 그때는 빈 서명으로 남겨 **즉시** 후보가 되게 한다. 아직 돌아가는 중이면
    // 그 순간의 서명으로 두어, 집에 닿아 서명이 바뀔 때 후보가 된다.
    const home = signature.endsWith(":home");
    return { messageId: attempt.messageId, outcome: "rejected", signature: home ? "" : signature };
  });
}

/**
 * 소켓이 끊기면 응답을 받지 못한 호출(보냈지만 직원이 내 것이 된 적 없는 것)을 거절로 바꾼다.
 * 서버가 그 호출을 받았는지 알 수 없으므로, 빈 서명으로 두어 재연결 뒤 **즉시** 다시 후보가
 * 되게 한다. 이미 내 것이 된 보고는 직원이 와 있거나 오는 중이라 그대로 둔다.
 */
export function releaseUnacquiredReportCalls(
  attempts: readonly ReportAttempt[],
): readonly ReportAttempt[] {
  if (!attempts.some((attempt) => attempt.outcome === "sent" && !attempt.acquired)) return attempts;
  return attempts.map((attempt) =>
    attempt.outcome === "sent" && !attempt.acquired
      ? { messageId: attempt.messageId, outcome: "rejected", signature: "" }
      : attempt,
  );
}

/**
 * 전하던 보고가 더는 "진행 중" 이 아닌가. 거절(또는 접힘)로 바뀐 보고를 active 로 쥐고 있으면
 * `decideReportCall` 이 그 보고만 기다리며 **큐 전체**를 멈춘다 — 화면은 이때 active 를 비운다.
 */
export function activeReportReleased(
  attempts: readonly ReportAttempt[],
  activeMessageId: string | null,
): boolean {
  if (!activeMessageId) return false;
  const attempt = attempts.find((a) => a.messageId === activeMessageId);
  return attempt !== undefined && attempt.outcome !== "sent";
}

/**
 * 복귀시킨 직원 목록을 정리한다 — 자리에 닿았으면(서명이 `:home` 이고 주인이 내가 아니면) 뺀다.
 * 복귀를 누른 직후에는 스냅샷이 아직 "내 호출에 대기" 라 서명만으로는 복귀 중인지 모른다.
 * 그래서 화면이 누른 순간 넣고, 여기서 도착을 확인해 뺀다.
 */
export function settleReturningNpcs(
  returning: ReadonlySet<string>,
  signatures: Readonly<Record<string, string>>,
): ReadonlySet<string> {
  let changed = false;
  const next = new Set(returning);
  for (const npcId of returning) {
    const signature = signatures[npcId] ?? "";
    if (signature.endsWith(":home") && signatureOwner(signature) !== "mine") {
      next.delete(npcId);
      changed = true;
    }
  }
  return changed ? next : returning;
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
  /** 지금 전하러 오는 중이거나 전하는 중인 보고. 직원이 아니라 보고 건으로 추적한다. */
  activeMessageId: string | null;
  /** 이 보고들에 무엇을 했고 어떻게 됐는지. */
  attempts: readonly ReportAttempt[];
  /** 지금 각 직원의 상태 서명. 거절 당시와 다르면 다시 부를 수 있다. */
  signatures: Readonly<Record<string, string>>;
  /** 지금 부르면 안 되는가(`reportCallBlocked`). 큐는 그대로 남는다. */
  blocked: boolean;
  /** 자리로 돌아가는 중이라 지금은 부르지 않을 직원(`settleReturningNpcs`). */
  returningNpcIds?: ReadonlySet<string>;
}): ReportItem | null {
  if (input.blocked) return null;
  const callable = (item: ReportItem): boolean => {
    // 복귀 중인 직원은 자리에 닿을 때까지 후보가 아니다. 복귀가 보고를 확인하는 순간 같은
    // 직원의 접힌 보고가 되살아나 곧바로 다시 불렸고, 그 호출이 복귀를 뒤집어 직원이 곁에
    // 남았다(스테이징 실측: 올리버를 복귀시켰는데 "내 호출에 대기" 로 남고 소피가 먼저 왔다).
    if (input.returningNpcIds?.has(item.npcId)) return false;
    if ((input.signatures[item.npcId] ?? "").startsWith("returning:")) return false;
    const attempt = input.attempts.find((a) => a.messageId === item.messageId);
    if (!attempt) return true;
    // 결과를 기다리는 중이면 다시 쏘지 않는다. 사용자가 닫은 보고도 다시 부르지 않는다.
    if (attempt.outcome === "sent" || attempt.outcome === "dismissed") return false;
    // 거절 — 그 직원의 상태가 바뀌었을 때만 다시 후보가 된다.
    return (input.signatures[item.npcId] ?? "unknown:none:away") !== attempt.signature;
  };
  // 전하는 중인 보고가 끝날 때까지 다음 사람을 부르지 않는다 — 한 번에 한 명이다.
  const active = input.queue.find((item) => item.messageId === input.activeMessageId);
  // 거절·접힘으로 끝난 보고는 active 라도 큐를 쥐지 않는다(`activeReportReleased`).
  if (active && !activeReportReleased(input.attempts, active.messageId))
    return callable(active) ? active : null;
  // 그 밖에는 **보고가 생긴 순서대로**다. 예전에는 보고 중이던 직원의 남은 보고를 먼저 골라,
  // 소피→올리버→소피 큐에서 소피가 다시 불리고 올리버는 오지 못했다(배지는 올리버 보고를
  // 가리키고 있었다). 같은 직원이 두 번 오가는 것은 감수한다. 맨 앞이 거절돼 막히면 큐 전체가
  // 멈추지 않게 다음 후보로 넘어간다(head-of-line blocking).
  return input.queue.find(callable) ?? null;
}

/**
 * 도착했는데 대화창이 열리지 않은 보고. 있으면 화면이 대신 대화창을 연다.
 *
 * 대화창은 `npc:movement-arrived` 한 번에만 열린다. 직원이 오는 도중 회의가 끼어들었거나
 * 그 신호를 놓치면 직원은 내 곁에서 `waiting` 으로 서 있고, 시도는 "보냄" 으로 남아
 * `decideReportCall` 이 그 직원을 우선한 채 null 만 돌려 **큐 전체가 멈췄다**(스테이징 실측:
 * 소피가 "내 호출에 대기" 로 서 있고 배지는 그대로, 다른 직원도 오지 않았다).
 */
export function missedReportArrival(input: {
  queue: readonly ReportItem[];
  activeMessageId: string | null;
  attempts: readonly ReportAttempt[];
  signatures: Readonly<Record<string, string>>;
  blocked: boolean;
}): ReportItem | null {
  if (input.blocked || !input.activeMessageId) return null;
  const item = input.queue.find((entry) => entry.messageId === input.activeMessageId);
  if (!item) return null;
  const attempt = input.attempts.find((a) => a.messageId === item.messageId);
  if (!attempt || attempt.outcome !== "sent" || attempt.opened) return null;
  const signature = input.signatures[item.npcId] ?? "";
  return signature.startsWith("waiting:mine:") ? item : null;
}

/**
 * 보고하러 온 직원과의 대화창을 확인 없이 닫았다 — 이 보고를 이 세션에서 다시 부르지 않는다.
 *
 * 확인은 알림 링크를 열거나 복귀시킬 때 일어난다. 대화창만 닫으면 시도가 "보냄" 으로 남아
 * 큐 전체가 멈췄다. **그 한 건만** 접는다 — 같은 직원의 다음 보고는 시간순 차례에 다시 온다.
 */
export function dismissReport(
  attempts: readonly ReportAttempt[],
  messageId: string,
  now: number,
): ReportAttempt[] {
  return [
    ...attempts.filter((attempt) => attempt.messageId !== messageId),
    { messageId, outcome: "dismissed", signature: "", dismissedAt: now },
  ];
}

/**
 * 접힌 보고를 다시 후보로 되돌린다 — 접은 뒤 **다른 보고를 확인했거나** 약 10분이 지났으면.
 * 영구히 접어 두면 배지에는 남았는데 아무도 오지 않는 상태가 세션 끝까지 간다(…75v1A).
 * 되돌린다는 것은 시도 기록을 지우는 것이다 — 기록이 없는 보고는 `decideReportCall` 의 후보다.
 */
export function reviveDismissedReports(
  attempts: readonly ReportAttempt[],
  now: number,
  lastAcknowledgedAt: number | null,
): ReportAttempt[] {
  const next = attempts.filter((attempt) => {
    if (attempt.outcome !== "dismissed") return true;
    const at = attempt.dismissedAt ?? 0;
    if (now - at >= DISMISSED_REPORT_REVIVE_MS) return false;
    return !(lastAcknowledgedAt !== null && lastAcknowledgedAt > at);
  });
  return next.length === attempts.length ? (attempts as ReportAttempt[]) : next;
}

/** "다시 부르기" — 그 보고를 즉시 후보로 되돌린다. */
export function recallReport(
  attempts: readonly ReportAttempt[],
  messageId: string,
): ReportAttempt[] {
  return attempts.filter((attempt) => attempt.messageId !== messageId);
}

/** 보고 목록에 "접힘" 과 "다시 부르기" 를 보일 보고들. */
export function dismissedReportIds(attempts: readonly ReportAttempt[]): Set<string> {
  return new Set(attempts.filter((a) => a.outcome === "dismissed").map((a) => a.messageId));
}

/**
 * 확인 기록(`ReportAck`)을 담아 두는 브라우저 저장 키. 서버 읽은 지점 스키마를 건드리지 않으려는 선택이라,
 * 대가로 기기마다 배지가 다를 수 있다. 읽은 지점이 정리되면 그 값으로 갈아끼운다.
 */
export function reportAckKey(channelId: string): string {
  return `deskrpg.reportAck.${channelId}`;
}
