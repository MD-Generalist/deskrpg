import assert from "node:assert/strict";
import test from "node:test";

import { decideTargets, nextApprovalStatus, parseDecision } from "./approval-decision";

test("결정은 세 가지뿐이다", () => {
  assert.equal(parseDecision("approve"), "approve");
  assert.equal(parseDecision("reject"), "reject");
  assert.equal(parseDecision("request_revision"), "request_revision");
  for (const bad of ["", "APPROVE", "unblock", null, 7, undefined])
    assert.equal(parseDecision(bad), null, String(bad));
});

test("승인은 승인, 반려는 반려, 수정요청은 수정요청으로 간다", () => {
  assert.equal(nextApprovalStatus("approve"), "approved");
  assert.equal(nextApprovalStatus("reject"), "rejected");
  assert.equal(nextApprovalStatus("request_revision"), "revision_requested");
});

const all = ["t1", "t2", "t3"];

test("대상을 고르지 않으면 전체가 결정을 따른다", () => {
  assert.deepEqual(decideTargets(all, undefined, "approve"), {
    ok: true,
    unblock: ["t1", "t2", "t3"],
    perTarget: [],
  });
});

test("부분 반려는 그 카드만 막고 나머지는 승인 전체를 따른다", () => {
  const r = decideTargets(
    all,
    [
      { taskId: "t1", decision: "approve" },
      { taskId: "t2", decision: "reject" },
    ],
    "approve",
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.unblock, ["t1", "t3"], "t2 만 막히고 고르지 않은 t3 는 풀린다");
  assert.deepEqual(r.perTarget, [
    { taskId: "t1", decision: "approve" },
    { taskId: "t2", decision: "reject" },
  ]);
});

test("고르지 않은 대상은 승인 전체의 결정을 따른다", () => {
  // t3 을 빼고 보냈다 — 승인 전체가 approve 면 t3 도 풀린다.
  const r = decideTargets(all, [{ taskId: "t1", decision: "reject" }], "approve");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.unblock, ["t2", "t3"]);
});

test("반려하면 아무것도 풀지 않는다 — 부분 지정이 있어도", () => {
  const r = decideTargets(all, [{ taskId: "t1", decision: "approve" }], "reject");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.unblock, ["t1"], "반려 안에서도 명시적으로 승인한 것은 푼다");
});

test("수정 요청은 아무것도 풀지 않는다", () => {
  assert.deepEqual(decideTargets(all, undefined, "request_revision"), {
    ok: true,
    unblock: [],
    perTarget: [],
  });
});

test("이 승인의 대상이 아닌 카드를 지정하면 거절한다", () => {
  assert.deepEqual(decideTargets(all, [{ taskId: "ghost", decision: "approve" }], "approve"), {
    ok: false,
    error: "target_not_in_approval",
    taskId: "ghost",
  });
});

test("같은 카드를 두 번 지정하면 거절한다 — 어느 쪽이 이기는지 정할 수 없다", () => {
  assert.deepEqual(
    decideTargets(
      all,
      [
        { taskId: "t1", decision: "approve" },
        { taskId: "t1", decision: "reject" },
      ],
      "approve",
    ),
    { ok: false, error: "target_duplicated", taskId: "t1" },
  );
});
