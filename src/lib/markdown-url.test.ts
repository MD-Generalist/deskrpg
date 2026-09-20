import { test } from "node:test";
import assert from "node:assert/strict";

import { chatUrlTransform } from "./markdown-url";

const img = { tagName: "img" };
const anchor = { tagName: "a" };

test("보통 주소는 기본 동작 그대로다", () => {
  assert.equal(chatUrlTransform("https://example.com/a", "src", img), "https://example.com/a");
  assert.equal(chatUrlTransform("/api/x", "href", anchor), "/api/x");
  // 위험한 스킴은 여전히 지워진다.
  assert.equal(chatUrlTransform("javascript:alert(1)", "href", anchor), "");
});

test("이미지의 data: 래스터는 통과시킨다 — 지우면 깨진 아이콘만 남는다", () => {
  const src = "data:image/png;base64,AAAA";
  assert.equal(chatUrlTransform(src, "src", img), src);
  assert.equal(
    chatUrlTransform("data:image/webp;base64,AAAA", "src", img),
    "data:image/webp;base64,AAAA",
  );
});

test("svg 와 이미지가 아닌 data: 는 지운다 — svg 는 스크립트를 품는 문서다", () => {
  assert.equal(chatUrlTransform("data:image/svg+xml;base64,AAAA", "src", img), "");
  assert.equal(chatUrlTransform("data:text/html;base64,AAAA", "src", img), "");
});

test("링크의 data: 는 통과시키지 않는다 — 이미지 자리에서만 허용한다", () => {
  assert.equal(chatUrlTransform("data:image/png;base64,AAAA", "href", anchor), "");
});
