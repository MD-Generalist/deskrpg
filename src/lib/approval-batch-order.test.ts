import assert from "node:assert/strict";
import test from "node:test";

import { orderApprovalBatch } from "./approval-batch-order";

const item = (parents: number[] = []) => ({ parents });

test("선행이 없으면 입력 순서 그대로다", () => {
  assert.deepEqual(orderApprovalBatch([item(), item(), item()]), { ok: true, order: [0, 1, 2] });
});

test("선행이 먼저 만들어진다 — 뒤 항목이 앞을 가리켜도", () => {
  // 0 은 1 을 선행으로 갖는다 → 1 을 먼저 만들어야 0 의 parents 를 id 로 채울 수 있다.
  assert.deepEqual(orderApprovalBatch([item([1]), item()]), { ok: true, order: [1, 0] });
});

test("사슬이 길어도 순서가 유지된다", () => {
  assert.deepEqual(orderApprovalBatch([item([1]), item([2]), item()]), {
    ok: true,
    order: [2, 1, 0],
  });
});

test("같은 선행을 여럿이 가리켜도 한 번만 만든다", () => {
  const r = orderApprovalBatch([item(), item([0]), item([0])]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.order, [0, 1, 2]);
});

test("선행 순서가 같으면 입력 순서를 지킨다 — 결과가 흔들리지 않는다", () => {
  assert.deepEqual(orderApprovalBatch([item([2]), item([2]), item()]), {
    ok: true,
    order: [2, 0, 1],
  });
});

test("범위 밖 선행 인덱스는 거절한다", () => {
  assert.deepEqual(orderApprovalBatch([item([5])]), {
    ok: false,
    error: "parent_out_of_range",
    index: 0,
  });
  assert.deepEqual(orderApprovalBatch([item([-1])]), {
    ok: false,
    error: "parent_out_of_range",
    index: 0,
  });
});

test("자기 자신을 선행으로 두면 거절한다", () => {
  assert.deepEqual(orderApprovalBatch([item([0])]), { ok: false, error: "parent_cycle", index: 0 });
});

test("순환하면 거절한다 — 무한 대기 카드를 만들지 않는다", () => {
  const r = orderApprovalBatch([item([1]), item([0])]);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error, "parent_cycle");
});

test("빈 묶음은 빈 순서다", () => {
  assert.deepEqual(orderApprovalBatch([]), { ok: true, order: [] });
});
