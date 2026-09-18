"use client";
import { useEffect, useRef, useState } from "react";

type Pdfjs = typeof import("pdfjs-dist");

/**
 * pdf.js 를 가져오는 이음매. 운영에서는 늘 동적 `import("pdfjs-dist")` 이고, 테스트만 가짜
 * 모듈로 갈아 끼운다(`heavy-viewers.test.tsx`).
 */
export const pdfjsLoader: { load(): Promise<Pdfjs> } = {
  load: () => import("pdfjs-dist"),
};

export default function PdfViewer({ blob }: { blob: Blob }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    // getDocument 는 호출마다 워커를 띄운다 — 닫을 때 로딩 태스크를 없애 문서와 워커를 함께 거둔다.
    let loadingTask: { destroy(): Promise<void> } | null = null;
    void (async () => {
      try {
        const pdfjs = await pdfjsLoader.load();
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const data = new Uint8Array(await blob.arrayBuffer());
        if (!alive) return;
        const task = pdfjs.getDocument({ data });
        loadingTask = task;
        const loaded = await task.promise;
        if (alive) setDoc(loaded);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      void loadingTask?.destroy().catch(() => {});
    };
  }, [blob]);
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let task: { promise: Promise<void>; cancel(): void } | null = null;
    void (async () => {
      try {
        const p = await doc.getPage(page);
        const c = canvas.current;
        // 닫혔거나 페이지를 넘긴 뒤라면 그리지 않는다 — 같은 캔버스에 render 가 겹치면 pdf.js 가 던진다.
        if (cancelled || !c) return;
        const viewport = p.getViewport({ scale: 1.25 });
        c.width = viewport.width;
        c.height = viewport.height;
        task = p.render({ canvas: c, viewport });
        await task.promise;
      } catch (err) {
        // 정리(cancel)로 끊긴 렌더는 실패가 아니다. 그 밖의 거부는 오류 경계로 보낸다.
        if ((err as { name?: string } | null)?.name === "RenderingCancelledException") return;
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page]);
  if (failed) throw new Error("pdf_render_failed"); // ArtifactViewer 의 오류 경계가 다운로드로 떨어뜨린다
  return (
    <div className="flex h-full flex-col items-center gap-2 overflow-auto">
      <canvas ref={canvas} className="max-w-full shadow" />
      {doc && (
        <div className="flex items-center gap-2 text-xs">
          <button type="button" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
            ‹
          </button>
          <span>
            {page} / {doc.numPages}
          </span>
          <button
            type="button"
            disabled={page >= doc.numPages}
            onClick={() => setPage((n) => n + 1)}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
