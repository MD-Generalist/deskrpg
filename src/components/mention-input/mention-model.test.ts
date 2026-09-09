import assert from "node:assert/strict";
import test from "node:test";

import {
  filterCandidates,
  findMentionQuery,
  reduceDropdown,
  serializeSegments,
  type Segment,
} from "./mention-model";

const cands = [
  { id: "a", name: "소피" },
  { id: "b", name: "올리버" },
  { id: "c", name: "소라" },
];

test("칩은 @[이름] 으로, 텍스트는 그대로 직렬화한다", () => {
  const segs: Segment[] = [
    { kind: "mention", id: "a", name: "소피" },
    { kind: "text", text: " 안녕 " },
    { kind: "mention", id: "b", name: "올리버" },
    { kind: "text", text: " 회의하자" },
  ];
  assert.equal(serializeSegments(segs), "@[소피] 안녕 @[올리버] 회의하자");
});

test("캐럿 앞 텍스트에서 열린 @쿼리를 찾는다 — 공백이 오면 닫힌다", () => {
  assert.deepEqual(findMentionQuery("안녕 @소"), { start: 3, query: "소" });
  assert.deepEqual(findMentionQuery("@"), { start: 0, query: "" });
  assert.equal(findMentionQuery("안녕 @소 피"), null, "공백 뒤는 쿼리가 아니다");
  assert.equal(findMentionQuery("이메일 a@b"), null, "단어 중간의 @ 는 멘션이 아니다");
  assert.equal(findMentionQuery("안녕"), null);
});

test("후보는 부분 일치, 빈 쿼리면 전부", () => {
  assert.deepEqual(
    filterCandidates("소", cands).map((c) => c.name),
    ["소피", "소라"],
  );
  assert.deepEqual(filterCandidates("", cands).length, 3);
  assert.deepEqual(filterCandidates("zz", cands), []);
});

test("드롭다운 키보드: ↑↓ 순환, Enter 는 선택, Esc 는 닫기", () => {
  let s = reduceDropdown({ open: true, index: 0, count: 3 }, "ArrowDown");
  assert.equal(s.index, 1);
  s = reduceDropdown(s, "ArrowUp");
  assert.equal(s.index, 0);
  s = reduceDropdown(s, "ArrowUp");
  assert.equal(s.index, 2, "맨 위에서 ↑ 는 맨 아래로");
  assert.equal(reduceDropdown(s, "Escape").open, false);
  assert.equal(reduceDropdown({ open: true, index: 1, count: 3 }, "Enter").select, 1);
  assert.equal(
    reduceDropdown({ open: true, index: 0, count: 0 }, "Enter").select,
    undefined,
    "후보 0건이면 선택 없음",
  );
});
