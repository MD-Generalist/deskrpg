"use client";
import { useEffect, useRef, useState } from "react";

/** pdf.js 를 지연 로드해 캔버스에 페이지를 그린다. 실패하면 던져 오류 경계가 다운로드로 떨어뜨린다. */
export default function PdfViewer({ blob }: { blob: Blob }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const loaded = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) })
          .promise;
        if (alive) setDoc(loaded);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [blob]);
  useEffect(() => {
    if (!doc || !canvas.current) return;
    let task: { cancel(): void } | null = null;
    void doc.getPage(page).then((p) => {
      const viewport = p.getViewport({ scale: 1.25 });
      const c = canvas.current!;
      c.width = viewport.width;
      c.height = viewport.height;
      task = p.render({ canvasContext: c.getContext("2d")!, viewport, canvas: c });
    });
    return () => task?.cancel();
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
