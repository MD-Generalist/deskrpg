import assert from "node:assert/strict";
import test from "node:test";

import {
  appendRequesterLine,
  formatUserContext,
  prefixUserContext,
  requesterLine,
} from "./user-context";

test("이름과 소개를 한 줄로 만든다", () => {
  assert.equal(
    formatUserContext({ name: "곽지호", bio: "단테랩스 대표. 존댓말 선호." }),
    "[대화 상대] 이름: 곽지호 · 소개: 단테랩스 대표. 존댓말 선호.",
  );
});

test("소개가 비면 이름만 넣고, 줄바꿈은 공백으로 접는다", () => {
  assert.equal(formatUserContext({ name: "곽지호", bio: null }), "[대화 상대] 이름: 곽지호");
  assert.equal(
    formatUserContext({ name: "곽지호", bio: "첫 줄\n둘째 줄" }),
    "[대화 상대] 이름: 곽지호 · 소개: 첫 줄 둘째 줄",
  );
});

test("2,000자를 넘는 소개는 잘라 붙인다", () => {
  const out = formatUserContext({ name: "a", bio: "가".repeat(2500) });
  assert.ok(out.length <= "[대화 상대] 이름: a · 소개: ".length + 2000 + 1);
  assert.ok(out.endsWith("…"));
});

test("prefixUserContext 는 앞머리에 붙이고, 컨텍스트가 없으면 원문 그대로", () => {
  assert.equal(
    prefixUserContext("곽지호: 안녕", { name: "곽지호", bio: null }),
    "[대화 상대] 이름: 곽지호\n\n곽지호: 안녕",
  );
  assert.equal(prefixUserContext("곽지호: 안녕", null), "곽지호: 안녕");
});

test("칸반 요청자 줄", () => {
  assert.equal(requesterLine({ name: "곽지호", bio: "대표" }), "요청자: 곽지호 — 대표");
  assert.equal(requesterLine({ name: "곽지호", bio: null }), "요청자: 곽지호");
});

test("칸반 본문 끝에 요청자 줄 — 컨텍스트가 없으면 본문 그대로", () => {
  const ctx = { name: "곽지호", bio: "대표" };
  assert.equal(appendRequesterLine("본문", ctx), "본문\n\n요청자: 곽지호 — 대표");
  assert.equal(appendRequesterLine(undefined, ctx), "요청자: 곽지호 — 대표");
  assert.equal(appendRequesterLine("본문", null), "본문");
  assert.equal(appendRequesterLine(undefined, null), undefined);
});
