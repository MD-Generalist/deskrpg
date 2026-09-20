/**
 * "손이 필요한 카드" 판정 — 판단 모음 화면과 운영 지표가 **같은 함수**를 쓴다.
 *
 * 두 곳이 각자 세면 다른 수가 나오고, 그때 어느 쪽이 맞는지 아무도 모른다. 순수 함수라
 * 클라이언트 번들에 들어가도 안전하다(`node:*`·`@/db` 를 쓰지 않는다).
 */
export type AttentionKind = "awaiting_approval" | "blocked" | "review";

type CardLike = { id: string; status: string };

/**
 * 이 카드가 왜 사람을 기다리는가. 아니면 null.
 *
 * `blocked` 는 두 뜻을 겸한다 — 승인 대기와 오류 차단이다. 가르는 것은 **대기 중인 승인
 * 대상에 이 카드가 있는가** 뿐이다. 칸반 열은 아홉 개로 고정이라 열을 나누지 않고
 * 배지로 가른다(`src/components/kanban/AGENTS.md`).
 */
export function attentionOf(
  card: CardLike,
  pendingApprovalTaskIds: ReadonlySet<string>,
): AttentionKind | null {
  if (card.status === "review") return "review";
  if (card.status !== "blocked") return null;
  return pendingApprovalTaskIds.has(card.id) ? "awaiting_approval" : "blocked";
}

export type AttentionCounts = Record<AttentionKind, number> & { total: number };

export function countNeedsAttention(
  cards: readonly CardLike[],
  pendingApprovalTaskIds: ReadonlySet<string>,
): AttentionCounts {
  const counts: AttentionCounts = {
    awaiting_approval: 0,
    blocked: 0,
    review: 0,
    total: 0,
  };
  for (const card of cards) {
    const kind = attentionOf(card, pendingApprovalTaskIds);
    if (!kind) continue;
    counts[kind] += 1;
    counts.total += 1;
  }
  return counts;
}
