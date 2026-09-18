import "../../../test-setup/dom";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { waitFor } from "@testing-library/react";

/**
 * `URL.createObjectURL` 은 이 러너 환경(happy-dom)에 없거나 실제 blob URL 을 만들지
 * 않으므로, 마지막으로 넘어온 blob 의 텍스트를 동기로 꺼낼 수 있게 부품을 가로챈다.
 * 브라우저의 `Blob` 은 파츠를 동기로 노출하지 않아서, 여기서는 우리가 만든 파츠 배열을
 * 직접 기억해 뒀다가 합친다 — 실제 렌더 결과(문자열)는 바뀌지 않는다.
 */
let lastParts: unknown[] = [];
const OriginalBlob = globalThis.Blob;
class RecordingBlob extends OriginalBlob {
  constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
    super(parts, options);
    lastParts = parts;
  }
}
globalThis.Blob = RecordingBlob as unknown as typeof Blob;

let objectUrlCounter = 0;
globalThis.URL.createObjectURL = (() =>
  `blob:mock-${(objectUrlCounter += 1)}`) as typeof URL.createObjectURL;
globalThis.URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;

function lastBlobText(): string {
  return lastParts.map((p) => (typeof p === "string" ? p : "")).join("");
}

let container: HTMLElement;
let root: Root | null = null;

async function render(ui: React.ReactElement) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(ui);
  });
}

test.afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
    root = null;
  }
  container?.remove();
});

test("SvgViewer 는 script·onload 를 지운 뒤 blob <img> 로 그린다", async () => {
  const { default: SvgViewer } = await import("./SvgViewer");
  await render(
    <SvgViewer
      text={
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect width="1" height="1"/></svg>'
      }
    />,
  );
  const img = container.querySelector("img")!;
  assert.match(img.getAttribute("src")!, /^blob:/);
  assert.equal(lastBlobText().includes("script"), false);
  assert.equal(lastBlobText().includes("onload"), false);
});

test("CodeViewer 는 shiki 로 강조한 HTML 을 그린다", async () => {
  const { default: CodeViewer } = await import("./CodeViewer");
  await render(<CodeViewer text={"const a = 1;"} language="ts" />);
  await waitFor(() => {
    if (!container.querySelector("pre.shiki")) throw new Error("shiki not rendered yet");
  });
});

test("무거운 뷰어 모듈은 ArtifactViewer 가 정적으로 import 하지 않는다", () => {
  const src = readFileSync("src/components/artifacts/ArtifactViewer.tsx", "utf8");
  for (const mod of ["pdfjs-dist", "shiki", "dompurify"]) {
    assert.equal(src.includes(`from "${mod}"`), false, mod);
  }
  assert.match(src, /lazy\(\(\) => import\("\.\/viewers\/PdfViewer"\)\)/);
});
