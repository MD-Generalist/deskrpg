import { test } from "node:test";
import assert from "node:assert/strict";

import { soleLinkUrl } from "./promote";

const text = (value: string) => ({ type: "text" as const, value });
const link = (href: string, label = href) => ({
  type: "element" as const,
  tagName: "a",
  properties: { href },
  children: [text(label)],
});

test("문단에 링크 하나만 있고 글자가 주소 그대로면 승격 대상이다", () => {
  assert.equal(soleLinkUrl({ children: [link("https://example.com/a")] }), "https://example.com/a");
});

test("링크 앞뒤 공백은 무시한다 — 마크다운은 줄바꿈을 텍스트로 남긴다", () => {
  assert.equal(
    soleLinkUrl({ children: [text("\n"), link("https://example.com/a"), text("  ")] }),
    "https://example.com/a",
  );
});

test("문장 안의 링크는 승격하지 않는다", () => {
  assert.equal(soleLinkUrl({ children: [text("참고: "), link("https://example.com/a")] }), null);
});

test("글자가 주소와 다르면 승격하지 않는다 — 사람이 붙인 제목을 카드로 덮지 않는다", () => {
  assert.equal(soleLinkUrl({ children: [link("https://example.com/a", "여기")] }), null);
});

test("링크가 둘이면 승격하지 않는다", () => {
  assert.equal(
    soleLinkUrl({ children: [link("https://e.com/a"), text(" "), link("https://e.com/b")] }),
    null,
  );
});

test("http(s) 가 아니면 승격하지 않는다", () => {
  assert.equal(soleLinkUrl({ children: [link("mailto:a@b.c")] }), null);
});

test("파일 링크는 승격하지 않는다 — 내려받기 아이콘이 이미 그 일을 한다", () => {
  assert.equal(soleLinkUrl({ children: [link("https://e.com/a/report.pdf")] }), null);
});

test("노드가 비어도 깨지지 않는다", () => {
  assert.equal(soleLinkUrl(undefined), null);
  assert.equal(soleLinkUrl({ children: [] }), null);
});
