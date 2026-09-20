/**
 * 승인 묶음 안의 카드 생성 순서.
 *
 * 덩어리 1(회의 → 후속 업무)은 한 묶음 안에서 **선행 관계를 묶음 안 인덱스로** 넘긴다 —
 * 아직 카드가 없어 id 로 가리킬 수 없기 때문이다. 그래서 진입점이 선행부터 만들고, 만들어진
 * id 로 뒤 항목의 `parents` 를 채운다. 이 파일은 그 순서만 정한다.
 *
 * 순환을 여기서 잡아야 한다. Hermes 에서 서로를 기다리는 카드는 `recompute_ready` 가 영영
 * 승격하지 않아(`kanban_db.py` 의 부모 게이트) **아무 오류 없이 멈춰 있는** 카드가 된다.
 */
export type ApprovalBatchItem = { parents?: readonly number[] };

export type ApprovalBatchOrder =
  | { ok: true; order: number[] }
  | { ok: false; error: "parent_out_of_range" | "parent_cycle"; index: number };

export function orderApprovalBatch(items: readonly ApprovalBatchItem[]): ApprovalBatchOrder {
  const n = items.length;
  for (let i = 0; i < n; i++) {
    for (const p of items[i].parents ?? []) {
      if (!Number.isInteger(p) || p < 0 || p >= n)
        return { ok: false, error: "parent_out_of_range", index: i };
      if (p === i) return { ok: false, error: "parent_cycle", index: i };
    }
  }
  // 위상 정렬. 선행이 모두 끝난 것 중 **입력 순서가 앞선 것**을 먼저 꺼내, 같은 입력에
  // 늘 같은 순서가 나오게 한다 — 순서가 흔들리면 멱등 키가 다른 카드에 붙는다.
  const remaining = new Set<number>();
  for (let i = 0; i < n; i++) remaining.add(i);
  const order: number[] = [];
  while (remaining.size > 0) {
    let picked = -1;
    for (const i of remaining) {
      const parents = items[i].parents ?? [];
      if (parents.every((p) => !remaining.has(p))) {
        picked = i;
        break;
      }
    }
    if (picked === -1) {
      // 남은 것이 전부 서로를 기다린다 — 순환이다. 가장 앞 인덱스를 지목해 보고한다.
      return { ok: false, error: "parent_cycle", index: Math.min(...remaining) };
    }
    remaining.delete(picked);
    order.push(picked);
  }
  return { ok: true, order };
}
