import { test } from "node:test";
import assert from "node:assert/strict";

import { REPORT_FORMAT_HEADER, formatReportFormat, prefixReportFormat } from "./report-format";

test("보고 형식 규칙은 이미지·링크·마크다운 세 가지를 모두 말한다", () => {
  const rules = formatReportFormat();
  assert.ok(rules.startsWith(REPORT_FORMAT_HEADER));
  // 화면이 실제로 그려 주는 형태를 그대로 지시해야 한다(MarkdownContent.tsx 의 img·a 렌더러).
  assert.match(rules, /!\[설명\]\(URL\)/);
  assert.match(rules, /한 줄에 URL 하나/);
  assert.match(rules, /마크다운/);
});

test("규칙은 한 줄짜리 항목들로만 되어 있다 — 앞머리가 대본을 밀어내지 않는다", () => {
  const lines = formatReportFormat().split("\n");
  assert.ok(lines.length <= 5, `너무 길다: ${lines.length}줄`);
  for (const line of lines.slice(1)) assert.match(line, /^- /);
});

test("앞머리로 붙이면 규칙이 먼저, 원래 대본이 뒤에 온다", () => {
  const out = prefixReportFormat("노아: 보고서 정리해 줘");
  assert.ok(out.startsWith(REPORT_FORMAT_HEADER));
  assert.ok(out.endsWith("노아: 보고서 정리해 줘"));
  assert.ok(out.includes("\n\n노아:"));
});

test("빈 대본에는 규칙만 붙지 않는다 — 대본이 없으면 그대로 돌려준다", () => {
  assert.equal(prefixReportFormat(""), "");
});
