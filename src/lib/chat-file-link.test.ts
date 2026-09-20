import { test } from "node:test";
import assert from "node:assert/strict";

import { chatFileLink } from "./chat-file-link";

test("결과물 콘텐츠 링크는 파일로 보고 download=1 을 붙인다", () => {
  const link = chatFileLink("/api/channels/c1/artifacts/a1/versions/3/content");
  assert.deepEqual(link, {
    href: "/api/channels/c1/artifacts/a1/versions/3/content?download=1",
    filename: undefined,
  });
});

test("이미 download=1 이 붙어 있으면 두 번 붙이지 않는다", () => {
  const link = chatFileLink("/api/channels/c1/artifacts/a1/versions/3/content?download=1");
  assert.equal(link?.href, "/api/channels/c1/artifacts/a1/versions/3/content?download=1");
});

test("카드 첨부 링크는 파일이다", () => {
  assert.ok(chatFileLink("/api/channels/c1/kanban/attachments/f1"));
});

test("확장자가 문서·데이터·압축이면 외부 링크도 파일로 본다", () => {
  assert.equal(
    chatFileLink("https://example.com/files/보고서.xlsx")?.filename,
    "보고서.xlsx",
    "다운로드 이름은 마지막 경로 조각에서 가져온다",
  );
  assert.ok(chatFileLink("https://example.com/a/b.pdf"));
  assert.ok(chatFileLink("https://example.com/a/b.zip?v=2"));
  assert.ok(chatFileLink("https://example.com/a/b.md"));
});

test("보통 웹페이지 링크는 파일이 아니다 — 아이콘이 모든 링크에 붙으면 소음이 된다", () => {
  assert.equal(chatFileLink("https://example.com/blog/post"), null);
  assert.equal(chatFileLink("https://example.com/"), null);
  assert.equal(chatFileLink("https://example.com/index.html"), null);
});

test("http(s) 가 아니면 파일이 아니다", () => {
  assert.equal(chatFileLink("javascript:alert(1)"), null);
  assert.equal(chatFileLink("data:text/csv;base64,AAAA"), null);
  assert.equal(chatFileLink(undefined), null);
});

test("인라인 base64 이미지도 내려받을 수 있다 — 직원이 만든 그림은 파일이다", () => {
  const link = chatFileLink("data:image/png;base64,AAAA");
  assert.equal(link?.href, "data:image/png;base64,AAAA");
  assert.equal(link?.filename, "image.png");
  assert.equal(chatFileLink("data:image/jpeg;base64,AAAA")?.filename, "image.jpeg");
});

test("data:image/svg+xml 과 그 밖의 data: 는 파일로 보지 않는다", () => {
  assert.equal(chatFileLink("data:image/svg+xml;base64,AAAA"), null);
  assert.equal(chatFileLink("data:text/html;base64,AAAA"), null);
});
