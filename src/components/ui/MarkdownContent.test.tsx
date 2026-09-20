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

test("한 줄에 링크만 있는 문단은 미리보기 카드로 승격된다", async () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(
      JSON.stringify({
        title: "예시 문서",
        description: "설명",
        image: "/api/link-preview/image?url=x",
        siteName: "example.com",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const host = render("https://example.com/doc\n");
    // 카드가 그려지기까지 fetch 한 번 + 상태 반영을 기다린다.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.deepEqual(calls, ["/api/link-preview?url=https%3A%2F%2Fexample.com%2Fdoc"]);
    const card = host.querySelector("[data-link-preview]");
    assert.ok(card, "미리보기 카드가 없다");
    assert.match(card.textContent ?? "", /예시 문서/);
    assert.equal(card.getAttribute("href"), "https://example.com/doc");
  } finally {
    globalThis.fetch = original;
  }
});

test("미리보기가 없으면(204) 원래 밑줄 링크가 그대로 남는다", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
  try {
    const host = render("https://example.com/doc\n");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.equal(host.querySelector("[data-link-preview]"), null);
    assert.equal(host.querySelectorAll('a[href="https://example.com/doc"]').length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("인라인 base64 그림은 지워지지 않고 그려지며 내려받기도 된다", () => {
  const src = "data:image/png;base64,AAAA";
  const host = render(`![차트](${src})`);
  const img = host.querySelector("img");
  assert.equal(img?.getAttribute("src"), src);
  assert.equal(downloads(host).length, 1);
  assert.equal(downloads(host)[0].getAttribute("download"), "image.png");
});

test("주소를 잃은 이미지는 빈 칸이 아니라 못 불러왔다고 말한다", () => {
  // svg·file: 처럼 통과시키지 않는 주소는 react-markdown 이 빈 문자열로 지운다.
  const host = render("![차트](data:image/svg+xml;base64,AAAA)");
  assert.equal(host.querySelector("img"), null, "빈 src 로 깨진 아이콘을 남기지 않는다");
  assert.match(host.textContent ?? "", /이미지를 불러오지 못했습니다/);
});
