/**
 * 승인 결정의 순수 판정 — "무엇을 풀 것인가" 하나만 답한다.
 *
 * 라우트에 두면 검증할 수 없다. 부분 승인은 "고른 것만" 이 아니라 "고르지 않은 것은 승인
 * 전체의 결정을 따른다" 라서, 말로는 맞아 보여도 구현이 어긋나기 쉬운 자리다.
 */
export type ApprovalDecision = "approve" | "reject" | "request_revision";

const DECISIONS: readonly ApprovalDecision[] = ["approve", "reject", "request_revision"];

export function parseDecision(raw: unknown): ApprovalDecision | null {
  return typeof raw === "string" && (DECISIONS as readonly string[]).includes(raw)
    ? (raw as ApprovalDecision)
    : null;
}

export function nextApprovalStatus(decision: ApprovalDecision): string {
  if (decision === "approve") return "approved";
  if (decision === "reject") return "rejected";
  return "revision_requested";
}

export type TargetDecision = { taskId: string; decision: ApprovalDecision };

export type DecideTargetsResult =
  | { ok: true; unblock: string[]; perTarget: TargetDecision[] }
  | { ok: false; error: "target_not_in_approval" | "target_duplicated"; taskId: string };

/**
 * 풀어야 할 카드 목록. `targets` 를 주지 않으면 전체가 승인 전체의 결정을 따른다.
 *
 * `request_revision` 은 아무것도 풀지 않는다 — 고쳐 달라고 한 일을 시작시키면 안 된다.
 */
export function decideTargets(
  targetIds: readonly string[],
  targets: readonly TargetDecision[] | undefined,
  decision: ApprovalDecision,
): DecideTargetsResult {
  const known = new Set(targetIds);
  const chosen = new Map<string, ApprovalDecision>();
  for (const t of targets ?? []) {
    if (!known.has(t.taskId))
      return { ok: false, error: "target_not_in_approval", taskId: t.taskId };
    if (chosen.has(t.taskId)) return { ok: false, error: "target_duplicated", taskId: t.taskId };
    chosen.set(t.taskId, t.decision);
  }
  const unblock = targetIds.filter((id) => {
    const per = chosen.get(id);
    // 수정 요청 중에는 개별 승인도 풀지 않는다. 그것이 이 결정의 뜻이다.
    if (decision === "request_revision") return false;
    return (per ?? decision) === "approve";
  });
  return {
    ok: true,
    unblock,
    perTarget: [...chosen].map(([taskId, d]) => ({ taskId, decision: d })),
  };
}
