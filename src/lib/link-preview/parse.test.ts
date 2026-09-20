import { test } from "node:test";
import assert from "node:assert/strict";

import { parseOpenGraph } from "./parse";

test("og 태그에서 제목·설명·이미지를 뽑는다", () => {
  const html = `<html><head>
    <meta property="og:title" content="제목입니다">
    <meta property="og:description" content="설명입니다">
    <meta property="og:image" content="https://cdn.example.com/a.png">
    <meta property="og:site_name" content="예시">
  </head><body>본문</body></html>`;
  assert.deepEqual(parseOpenGraph(html, new URL("https://example.com/p")), {
    title: "제목입니다",
    description: "설명입니다",
    image: "https://cdn.example.com/a.png",
    siteName: "예시",
  });
});

test("og 가 없으면 <title> 과 meta description 으로 떨어진다", () => {
  const html = `<head><title>보통 제목</title>
    <meta name="description" content="보통 설명"></head>`;
  const got = parseOpenGraph(html, new URL("https://example.com/p"));
  assert.equal(got?.title, "보통 제목");
  assert.equal(got?.description, "보통 설명");
  assert.equal(got?.image, null);
  assert.equal(got?.siteName, "example.com");
});

test("상대 경로 이미지는 문서 주소를 기준으로 절대화한다", () => {
  const html = `<meta property="og:image" content="/img/a.png"><title>t</title>`;
  const got = parseOpenGraph(html, new URL("https://example.com/dir/p"));
  assert.equal(got?.image, "https://example.com/img/a.png");
});

test("http(s) 가 아닌 이미지는 버린다", () => {
  const html = `<meta property="og:image" content="data:image/png;base64,AAA"><title>t</title>`;
  assert.equal(parseOpenGraph(html, new URL("https://example.com/p"))?.image, null);
});

test("속성 순서가 뒤바뀌어도(content 먼저) 읽는다", () => {
  const html = `<meta content="뒤집힘" property="og:title">`;
  assert.equal(parseOpenGraph(html, new URL("https://example.com/p"))?.title, "뒤집힘");
});

test("HTML 엔티티를 풀고 길이를 자른다", () => {
  const html = `<meta property="og:title" content="A &amp; B &quot;C&quot;">
    <meta property="og:description" content="${"가".repeat(400)}">`;
  const got = parseOpenGraph(html, new URL("https://example.com/p"));
  assert.equal(got?.title, 'A & B "C"');
  assert.equal(got?.description?.length, 300);
});

test("제목도 이미지도 없으면 카드를 만들 값이 없다 — null", () => {
  assert.equal(parseOpenGraph("<html><body>본문만</body></html>", new URL("https://e.com/")), null);
});
