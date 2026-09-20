import assert from "node:assert/strict";
import test from "node:test";

import { attentionOf, countNeedsAttention } from "./needs-attention";

const card = (id: string, status: string) => ({ id, status });

test("승인 대기 중인 blocked 카드와 오류로 막힌 카드를 가른다", () => {
  const pending = new Set(["c1"]);
  assert.equal(attentionOf(card("c1", "blocked"), pending), "awaiting_approval");
  assert.equal(attentionOf(card("c2", "blocked"), pending), "blocked");
});

test("검토 대기는 그 자체로 사람의 손을 기다린다", () => {
  assert.equal(attentionOf(card("c3", "review"), new Set()), "review");
});

test("사람이 할 일이 없는 상태는 null 이다", () => {
  for (const s of ["triage", "todo", "scheduled", "ready", "running", "done", "archived"])
    assert.equal(attentionOf(card("c", s), new Set()), null, s);
});

test("승인이 풀린 카드는 더 이상 승인 대기가 아니다", () => {
  // 승인 뒤 카드는 ready 로 가지만, 아직 blocked 인 채로 보일 수 있다(폴링 사이).
  // 그때 대기 중인 승인 대상에서 빠졌으면 오류 차단으로 읽는 편이 안전하다 —
  // "승인해 달라" 고 다시 보여 주면 사용자가 같은 결정을 두 번 한다.
  assert.equal(attentionOf(card("c1", "blocked"), new Set()), "blocked");
});

test("개수는 종류별로 세고 합을 함께 준다", () => {
  const cards = [
    card("c1", "blocked"),
    card("c2", "blocked"),
    card("c3", "review"),
    card("c4", "running"),
  ];
  assert.deepEqual(countNeedsAttention(cards, new Set(["c1"])), {
    awaiting_approval: 1,
    blocked: 1,
    review: 1,
    total: 3,
  });
});

test("빈 보드는 0 이다", () => {
  assert.deepEqual(countNeedsAttention([], new Set()), {
    awaiting_approval: 0,
    blocked: 0,
    review: 0,
    total: 0,
  });
});
