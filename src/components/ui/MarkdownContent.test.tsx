import "../../test-setup/dom";
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n/context";

import MarkdownContent from "./MarkdownContent";

function render(content: string): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let root: Root;
  act(() => {
    root = createRoot(host);
    root.render(
      <I18nProvider initialLocale="ko">
        <MarkdownContent content={content} />
      </I18nProvider>,
    );
  });
  return host;
}

/** `download` 속성이 붙은 링크만 고른다 — 본문 링크와 구분한다. */
const downloads = (host: HTMLElement) => Array.from(host.querySelectorAll("a[download]"));

test("직원이 만든 문서 링크에는 다운로드 링크가 함께 붙는다", () => {
  const host = render("[보고서](/api/channels/c1/artifacts/a1/versions/2/content)");
  const links = downloads(host);
  assert.equal(links.length, 1);
  assert.equal(
    links[0].getAttribute("href"),
    "/api/channels/c1/artifacts/a1/versions/2/content?download=1",
  );
});

test("외부 파일 링크는 파일 이름으로 내려받는다", () => {
  const host = render("https://example.com/files/report.xlsx");
  const links = downloads(host);
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute("download"), "report.xlsx");
});

test("보통 웹페이지 링크에는 다운로드가 붙지 않는다", () => {
  const host = render("참고: [블로그](https://example.com/blog/post)");
  assert.equal(downloads(host).length, 0);
  // 본문 링크 자체는 그대로 있어야 한다.
  assert.equal(host.querySelectorAll('a[href="https://example.com/blog/post"]').length, 1);
});

test("이미지도 내려받을 수 있다 — 그림만 보이고 저장할 방법이 없으면 안 된다", () => {
  const host = render("![차트](https://example.com/out/chart.png)");
  assert.equal(host.querySelectorAll("img").length, 1);
  const links = downloads(host);
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute("href"), "https://example.com/out/chart.png");
});
